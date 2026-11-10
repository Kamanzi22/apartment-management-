#!/usr/bin/env python3
"""
Three-year simulation (Nov 2026 -> Nov 2029) of the apartment-manager database.

Builds a throwaway database on a LOCAL Postgres 16, applies the migrations
(01, 03, 04, the production-only "tenant reads landlord" policy, then 05+),
and plays out the scenario in supabase/README.md with every action run as the
right role: tenant JWT, landlord JWT, or service role. It then checks the
expected balances, the security rules, the daily alerts, and that every
policy survives request.jwt.claims = ''.

NEVER point this at the real Supabase database: it drops and recreates the
database named below.

    python3 -m venv .venv && .venv/bin/pip install "psycopg[binary]"
    PGURL=postgresql://postgres@127.0.0.1:54329/postgres .venv/bin/python supabase/tests/three_year_sim.py
"""
from __future__ import annotations

import datetime as dt
import glob
import json
import os
import random
import sys
import uuid
from decimal import Decimal

import psycopg
from psycopg import sql

HERE = os.path.dirname(os.path.abspath(__file__))
MIGRATIONS = os.path.dirname(HERE)
ADMIN_URL = os.environ.get('PGURL', 'postgresql://postgres@127.0.0.1:54329/postgres')
SIM_DB = os.environ.get('SIM_DB', 'apartment_sim')
if 'supabase.co' in ADMIN_URL or 'pooler.supabase' in ADMIN_URL:
    sys.exit('Refusing to run against Supabase. Use a local Postgres.')

KIGALI = dt.timezone(dt.timedelta(hours=2))
START, END = dt.date(2026, 11, 1), dt.date(2029, 11, 30)


def url_for(db: str, user: str | None = None) -> str:
    base, _, _ = ADMIN_URL.rpartition('/')
    if user:
        scheme, rest = base.split('://', 1)
        rest = rest.split('@', 1)[-1]
        base = f'{scheme}://{user}@{rest}'
    return f'{base}/{db}'


def kig(d: dt.date, hour: int = 9, minute: int = 0) -> dt.datetime:
    return dt.datetime(d.year, d.month, d.day, hour, minute, tzinfo=KIGALI)


def ym(d: dt.date) -> str:
    return f'{d.year:04d}-{d.month:02d}'


def add_months(month: str, n: int) -> str:
    y, m = map(int, month.split('-'))
    m += n
    y += (m - 1) // 12
    m = (m - 1) % 12 + 1
    return f'{y:04d}-{m:02d}'


# ── Results ──────────────────────────────────────────────────────────────────
class Results:
    def __init__(self):
        self.passed = 0
        self.failures: list[str] = []
        self.notes: list[str] = []

    def check(self, ok: bool, label: str):
        if ok:
            self.passed += 1
        else:
            self.failures.append(label)
            if len(self.failures) <= 40:
                print('  FAIL:', label)


R = Results()


# ── Database access ──────────────────────────────────────────────────────────
class Actor:
    """Runs statements the way PostgREST would: one transaction, a role and JWT claims."""

    def __init__(self, conn, role: str, uid: str | None = None, claims: str | None = None):
        assert role in ('anon', 'authenticated', 'service_role')
        self.conn, self.role, self.uid = conn, role, uid
        if claims is None:
            c = {'role': role}
            if uid:
                c['sub'] = uid
            claims = json.dumps(c)
        self.claims = claims

    def q(self, query: str, params=None):
        with self.conn.transaction():
            with self.conn.cursor() as cur:
                cur.execute(sql.SQL('set local role {}').format(sql.Identifier(self.role)))
                cur.execute("select set_config('request.jwt.claims', %s, true)", (self.claims,))
                cur.execute(query, params)
                return cur.fetchall() if cur.description else cur.rowcount

    def one(self, query: str, params=None):
        rows = self.q(query, params)
        return rows[0] if rows else None

    def attempt(self, query: str, params=None):
        try:
            return True, self.q(query, params)
        except psycopg.Error as e:
            return False, e


def setup():
    with psycopg.connect(ADMIN_URL, autocommit=True) as c:
        c.execute(sql.SQL('drop database if exists {} with (force)').format(sql.Identifier(SIM_DB)))
        c.execute(sql.SQL('create database {}').format(sql.Identifier(SIM_DB)))
    su = psycopg.connect(url_for(SIM_DB), autocommit=True)

    def run_file(path):
        with open(path) as f:
            su.execute(f.read())

    run_file(os.path.join(HERE, 'supabase_stubs.sql'))
    # 02 is a manual seed template (placeholder UUID); the landlord is created below.
    for name in ('01_schema.sql', '03_maintenance_categories.sql', '04_expenses.sql'):
        run_file(os.path.join(MIGRATIONS, name))
    su.execute("""create policy "profiles: tenant reads landlord" on public.profiles
                  for select using (role = 'landlord')""")
    applied = []
    for path in sorted(glob.glob(os.path.join(MIGRATIONS, '[0-9][0-9]_*.sql'))):
        n = int(os.path.basename(path)[:2])
        if n >= 5:
            run_file(path)
            applied.append(os.path.basename(path))
    print('Applied migrations: 01, 03, 04, prod policy, ' + ', '.join(applied))

    # Test clock: app_today() reads a table the simulation moves forward.
    su.execute("""
      create table public.sim_clock (d date not null);
      insert into public.sim_clock values ('2026-11-01');
      grant select on public.sim_clock to anon, authenticated, service_role;
      create or replace function public.app_today() returns date
        language sql stable set search_path = public as $$ select d from public.sim_clock $$;
    """)
    api = psycopg.connect(url_for(SIM_DB, 'authenticator'), autocommit=True)
    return su, api


# ── Simulation ───────────────────────────────────────────────────────────────
class Sim:
    def __init__(self, su, api):
        self.su, self.api = su, api
        self.today = START
        self.units = {label: uid for uid, label in su.execute('select id, label from units').fetchall()}
        self.service = Actor(api, 'service_role')
        self.people: dict[str, str] = {}
        self.leases: dict[str, str] = {}          # key -> lease id
        self.tenant_alerts_attempted = 0
        self.tenant_alerts_delivered = 0
        self.alert_counts: dict[str, int] = {}
        self.rng = random.Random(42)
        self.open_repairs: list[tuple[str, str, dt.date]] = []   # (request id, tenant key, created)
        self.landlord_id = self.create_user('landlord', 'landlord@example.com')
        su.execute("insert into profiles (id, role, full_name, created_at) values (%s, 'landlord', 'Grace Landlord', %s)",
                   (self.landlord_id, kig(dt.date(2026, 1, 1))))
        self.landlord = Actor(api, 'authenticated', self.landlord_id)

    # helpers
    def create_user(self, key: str, email: str) -> str:
        uid = str(uuid.uuid4())
        self.su.execute('insert into auth.users (id, email) values (%s, %s)', (uid, email))
        self.people[key] = uid
        return uid

    def tenant(self, key: str) -> Actor:
        return Actor(self.api, 'authenticated', self.people[key])

    def set_day(self, d: dt.date):
        self.today = d
        self.su.execute('update sim_clock set d = %s', (d,))

    def backdate(self, table: str, col: str, row_id, when: dt.datetime):
        self.su.execute(sql.SQL('update {} set {} = %s where id = %s').format(sql.Identifier(table), sql.Identifier(col)),
                        (when, row_id))

    def landlord_id_as_seen_by(self, actor: Actor) -> str:
        # Same query as getLandlordId() in both apps: earliest landlord, works with several.
        row = actor.one("select id from profiles where role = 'landlord' order by created_at, id limit 1")
        return str(row[0])

    def alert_landlord(self, actor: Actor, kind: str, body: str, link: str):
        """A tenant-side action notifying the landlord, exactly as the apps do it."""
        self.tenant_alerts_attempted += 1
        landlord = self.landlord_id_as_seen_by(actor)
        # No RETURNING: the tenant may not read the landlord's notifications back
        # (supabase-js inserts with return=minimal for the same reason).
        nid = str(uuid.uuid4())
        ok, res = actor.attempt(
            'insert into notifications (id, user_id, type, title, body, link) values (%s, %s, %s, %s, %s, %s)',
            (nid, landlord, kind, kind.replace('_', ' ').title(), body, link))
        if ok and res == 1:
            self.tenant_alerts_delivered += 1
            self.backdate('notifications', 'created_at', nid, kig(self.today, 10))
        else:
            R.check(False, f'{self.today} tenant alert {kind} blocked: {res}')

    def notify_tenant(self, tenant_id: str, kind: str, body: str, link: str):
        self.landlord.q('insert into notifications (user_id, type, title, body, link) values (%s, %s, %s, %s, %s)',
                        (tenant_id, kind, kind.replace('_', ' ').title(), body, link))

    # tenancy (service role, like the server actions)
    def attach(self, key: str, unit: str, move_in: dt.date, rent: int, lease_end: dt.date | None = None,
               name: str | None = None) -> str:
        if key not in self.people:
            self.create_user(key, f'{key}@example.com')
        lease = self.service.one('select attach_tenant(%s, %s, %s, %s, %s, %s, %s, %s)',
                                 (self.people[key], name or key.title(), None, self.units[unit],
                                  move_in, rent, 0, lease_end))[0]
        self.leases[key] = str(lease)
        return str(lease)

    def ledger(self, actor: Actor, lease_id: str, day: dt.date | None = None):
        rows = actor.q('select period_month, due_date, expected, confirmed_paid, pending_paid, balance, status '
                       'from rent_ledger(%s, %s)', (lease_id, day or self.today))
        return {r[0]: dict(due=r[1], expected=r[2], confirmed=r[3], pending=r[4], balance=r[5], status=r[6])
                for r in rows}

    def balance(self, actor: Actor, tenant_key: str) -> Decimal:
        return actor.one('select tenant_balance(%s, %s)', (self.people[tenant_key], self.today))[0]

    def pay(self, key: str, lease_key: str, month: str, amount, hour: int = 9, expect_ok: bool = True,
            label: str = '') -> str | None:
        actor = self.tenant(key)
        path = f'{self.people[key]}/{month}-{self.rng.randrange(10**9)}.jpg'
        ok, res = actor.attempt(
            'insert into payments (lease_id, tenant_id, period_month, amount, receipt_file_url, status) '
            "values (%s, %s, %s, %s, %s, 'pending_review') returning id, status",
            (self.leases[lease_key], self.people[key], month, amount, path))
        if not expect_ok:
            R.check(not ok, f'{self.today} {label or "payment"} should be refused')
            return None
        R.check(ok, f'{self.today} {key} pays {month} {amount}: {res if not ok else ""}')
        if not ok:
            return None
        pid, status = res[0]
        R.check(status == 'pending_review', f'{self.today} payment saved as {status}')
        self.backdate('payments', 'submitted_at', pid, kig(self.today, hour))
        self.alert_landlord(actor, 'payment_submitted', f'{key} submitted a receipt for {month}.', '/landlord/rent')
        return str(pid)

    def review(self, pid: str, status: str, note: str | None = None):
        row = self.landlord.one(
            'update payments set status = %s, reviewed_by = %s, reviewed_at = %s, landlord_notes = %s '
            'where id = %s returning tenant_id, period_month',
            (status, self.landlord_id, kig(self.today, 12), note, pid))
        self.notify_tenant(str(row[0]), 'payment_reviewed', f'Your payment for {row[1]} was {status}.', '/')

    def review_pending(self, hold: set[str] = frozenset(), reject: set[str] = frozenset()):
        rows = self.landlord.q(
            "select id, (submitted_at at time zone 'Africa/Kigali')::date from payments where status = 'pending_review' "
            'order by submitted_at')
        for pid, submitted in rows:
            pid = str(pid)
            # Receipts are reviewed the day after they arrive.
            if pid in hold or submitted >= self.today:
                continue
            self.review(pid, 'rejected' if pid in reject else 'confirmed',
                        'Receipt is unreadable, please upload it again.' if pid in reject else None)


def main():
    su, api = setup()
    s = Sim(su, api)
    L = s.landlord

    hold_until: dict[str, dt.date] = {}
    reject_ids: set[str] = set()
    chidi_rejected_once = False
    second_landlord_added = False
    bob_topped_up = False
    alice_attack_done = False
    broadcasts_sent: list[tuple[str, dt.datetime]] = []

    day = START
    while day <= END:
        s.set_day(day)
        mo = ym(day)

        # ── Scheduled life events ──────────────────────────────────────────
        if day == dt.date(2026, 11, 1):
            s.attach('alice', 'Unit 1', dt.date(2026, 11, 5), 350000)
        if day == dt.date(2026, 12, 1):
            s.attach('chidi', 'Unit 3', dt.date(2026, 12, 10), 400000)
        if day == dt.date(2027, 1, 31):
            s.attach('bob', 'Unit 2', dt.date(2027, 1, 31), 300000)
        if day == dt.date(2027, 10, 20):
            # Raise from November 2027, entered in advance in October.
            L.q('select set_unit_rent(%s, %s, %s)', (s.units['Unit 1'], 380000, '2027-11'))
            led = s.ledger(L, s.leases['alice'], dt.date(2027, 12, 31))
            R.check(led['2027-10']['expected'] == 350000 and led['2027-11']['expected'] == 380000
                    and led['2026-11']['expected'] == 350000, 'rent raise keeps history (350k before Nov 2027, 380k from)')
        if day == dt.date(2028, 1, 1) and not second_landlord_added:
            co = s.create_user('co_landlord', 'co@example.com')
            su.execute("insert into profiles (id, role, full_name, created_at) values (%s, 'landlord', 'Co Owner', %s)",
                       (co, kig(day)))
            second_landlord_added = True
        if day == dt.date(2028, 2, 10):
            bob = s.tenant('bob')
            ok, res = bob.attempt(
                'insert into move_out_notices (lease_id, tenant_id, intended_move_out_date, reason, status) '
                "values (%s, %s, %s, %s, 'submitted') returning id",
                (s.leases['bob'], s.people['bob'], dt.date(2028, 3, 15), 'Moving closer to work'))
            R.check(ok, f'Bob move-out notice: {res}')
            s.alert_landlord(bob, 'move_out_notice', 'Bob (Unit 2) gave notice for 2028-03-15.', f"/landlord/units/{s.units['Unit 2']}")
            open_notices = L.q("select count(*) from move_out_notices where status = 'submitted'")[0][0]
            R.check(open_notices == 1, 'landlord sees the open move-out notice')
        if day == dt.date(2028, 2, 11):
            L.q("update move_out_notices set status = 'acknowledged' where lease_id = %s", (s.leases['bob'],))
        if day == dt.date(2028, 3, 15):
            s.service.q('select end_tenancy(%s, %s)', (s.leases['bob'], day))
            s.leases['bob_unit2'] = s.leases['bob']
        if day == dt.date(2028, 3, 18):
            s.attach('diane', 'Unit 2', dt.date(2028, 3, 20), 320000)
        if day == dt.date(2028, 7, 1):
            # A replace that fails half-way must change nothing.
            ok, _ = s.service.attempt('select replace_tenancy(%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)',
                                      (s.leases['chidi'], dt.date(2028, 6, 30), s.landlord_id, 'Not A Tenant', None,
                                       s.units['Unit 3'], dt.date(2028, 7, 1), 400000, 0, None))
            still = su.execute('select status, lease_end from leases where id = %s', (s.leases['chidi'],)).fetchone()
            R.check(not ok and still == ('active', None), 'failed replace rolls back (old lease still active)')
            # Tenants cannot run it at all.
            ok, _ = s.tenant('chidi').attempt('select end_tenancy(%s, %s)', (s.leases['chidi'], day))
            R.check(not ok, 'tenant cannot call end_tenancy')
            # The real turnover: Chidi out 30 Jun, Eric in 1 Jul, one transaction.
            s.create_user('eric', 'eric@example.com')
            lease = s.service.one('select replace_tenancy(%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)',
                                  (s.leases['chidi'], dt.date(2028, 6, 30), s.people['eric'], 'Eric', None,
                                   s.units['Unit 3'], dt.date(2028, 7, 1), 400000, 0, dt.date(2029, 6, 30)))[0]
            s.leases['eric'] = str(lease)
        if day == dt.date(2029, 1, 30):
            s.attach('bob', 'Unit 4', dt.date(2029, 2, 1), 330000, name='Bob')
            s.leases['bob_unit4'] = s.leases['bob']
        if day == dt.date(2029, 6, 15):
            L.q('update leases set lease_end = %s where id = %s', (dt.date(2030, 6, 30), s.leases['eric']))

        # ── Tenant payments ────────────────────────────────────────────────
        def regular(key: str, lease_key: str, pay_day: int):
            if day.day != pay_day:
                return None
            led = s.ledger(s.tenant(key), s.leases[lease_key])
            row = led.get(mo)
            if not row:
                return None
            due = row['expected'] - row['confirmed'] - row['pending']
            return s.pay(key, lease_key, mo, due) if due > 0 else None

        regular('alice', 'alice', 3)
        if s.leases.get('diane'):
            pid = regular('diane', 'diane', 18)
            if pid and mo == '2028-08':
                hold_until[pid] = dt.date(2028, 8, 24)     # landlord forgets it for 6 days
        if s.leases.get('eric'):
            regular('eric', 'eric', 1)
        if s.leases.get('bob_unit4') and day >= dt.date(2029, 2, 1):
            regular('bob', 'bob_unit4', 1)

        # Chidi pays on the 8th; skips Dec 2027; first March 2027 receipt is rejected.
        if 'chidi' in s.leases and dt.date(2026, 12, 8) <= day <= dt.date(2028, 6, 30):
            if day.day == 8 and mo != '2027-12':
                pid = s.pay('chidi', 'chidi', mo, 400000)
                if mo == '2027-03' and not chidi_rejected_once:
                    reject_ids.add(pid)
                    chidi_rejected_once = True
            if day == dt.date(2027, 3, 10):
                s.pay('chidi', 'chidi', '2027-03', 400000)     # resubmission

        # Bob (first lease) pays two days after each due date: 200k for Jun 2027,
        # nothing for Feb 2028, and leaves before paying March 2028.
        if 'bob_unit2' not in s.leases and 'bob' in s.leases:
            for pm, row in s.ledger(s.tenant('bob'), s.leases['bob']).items():
                if row['due'] + dt.timedelta(days=2) == day and pm not in ('2028-02', '2028-03'):
                    s.pay('bob', 'bob', pm, 200000 if pm == '2027-06' else row['expected'] - row['confirmed'])

        # Diane pays six months ahead in January 2029; a seventh month is refused.
        if day == dt.date(2029, 1, 18):
            for k in range(1, 7):
                s.pay('diane', 'diane', add_months(mo, k), 320000)
            s.pay('diane', 'diane', add_months(mo, 7), 320000, expect_ok=False, label='7th month ahead')

        # Bob tops up the June 2027 shortfall on his OLD lease after returning.
        if day == dt.date(2029, 6, 10):
            s.pay('bob', 'bob_unit2', '2028-02', 400000, expect_ok=False, label='former-tenant overpayment')
            s.pay('bob', 'bob_unit2', '2027-05', 1000, expect_ok=False, label='paying a month already paid')
            s.pay('bob', 'bob_unit2', '2027-06', 100000)
            bob_topped_up = True

        # ── Landlord reviews receipts ──────────────────────────────────────
        held = {p for p, until in hold_until.items() if day < until}
        s.review_pending(hold=held, reject=reject_ids)
        reject_ids = {p for p in reject_ids
                      if su.execute("select status from payments where id = %s", (p,)).fetchone()[0] == 'pending_review'}

        # ── Messages: 6 sent + 6 received per tenant per month; 2 broadcasts ─
        active = [k for k, in [(r[0],) for r in su.execute(
            "select p.id from profiles p join leases l on l.tenant_id = p.id and l.status = 'active' "
            "where l.move_in_date <= %s", (day,)).fetchall()]]
        active_keys = [k for k, v in s.people.items() if v in {str(a) for a in active}]
        if day.day in (1, 15):
            when = kig(day, 8)
            mid = L.one("insert into messages (sender_id, recipient_id, body) values (%s, null, %s) returning id",
                        (s.landlord_id, f'Building notice {day}'))[0]
            s.backdate('messages', 'created_at', mid, when)
            broadcasts_sent.append((str(mid), when))
            for k in active_keys:
                s.notify_tenant(s.people[k], 'broadcast', f'Building notice {day}', '/messages')
        if day.day in (2, 7, 12, 17, 22, 27):
            for k in active_keys:
                t = s.tenant(k)
                landlord = s.landlord_id_as_seen_by(t)
                mid = t.one('insert into messages (sender_id, recipient_id, body) values (%s, %s, %s) returning id',
                            (s.people[k], landlord, f'{k} question {day}'))[0]
                s.backdate('messages', 'created_at', mid, kig(day, 11))
                s.alert_landlord(t, 'new_message', f'{k} sent you a message.', '/landlord/messages')
                rid = L.one('insert into messages (sender_id, recipient_id, body) values (%s, %s, %s) returning id',
                            (s.landlord_id, s.people[k], f'Reply to {k} {day}'))[0]
                s.backdate('messages', 'created_at', rid, kig(day, 15))
                s.notify_tenant(s.people[k], 'new_message', 'Grace sent you a message.', '/messages')

        # ── Repairs: about a third of tenants each month ───────────────────
        if day.day == 14:
            for k in active_keys:
                if s.rng.random() < 1 / 3:
                    t = s.tenant(k)
                    unit = t.one('select unit_id from profiles where id = %s', (s.people[k],))[0]
                    rid = t.one("insert into maintenance_requests (unit_id, tenant_id, category, description, urgency, "
                                "photo_urls, status) values (%s, %s, 'plumbing', %s, 'medium', %s, 'submitted') returning id",
                                (unit, s.people[k], f'Leak reported by {k} on {day}', [f'{s.people[k]}/leak.jpg']))[0]
                    s.backdate('maintenance_requests', 'created_at', rid, kig(day, 9))
                    s.alert_landlord(t, 'maintenance_submitted', f'{k} reported a leak.', '/landlord/maintenance')
                    s.open_repairs.append((str(rid), k, day))
        for rid, k, created in list(s.open_repairs):
            age = (day - created).days
            step = {2: 'acknowledged', 5: 'in_progress', 10: 'resolved'}.get(age)
            if step:
                L.q('update maintenance_requests set status = %s where id = %s', (step, rid))
                s.notify_tenant(s.people[k], 'maintenance_updated', f'Your request is {step}.', '/maintenance')
                if step == 'resolved':
                    s.open_repairs.remove((rid, k, created))

        # ── Daily alerts job (service role) ────────────────────────────────
        runs = 2 if day.day == 10 else 1        # run twice some days: must not resend
        for run in range(runs):
            sent_now = 0
            for key, user_id, audience, title, body, link in s.service.q('select * from due_alerts(%s)', (day,)):
                inserted = s.service.q('insert into sent_alerts (key) values (%s) on conflict do nothing returning key', (key,))
                if inserted:
                    s.service.q('insert into notifications (user_id, type, title, body, link) values (%s, %s, %s, %s, %s)',
                                (user_id, 'alert', title, body, link))
                    kind = key.split(':')[0]
                    s.alert_counts[kind] = s.alert_counts.get(kind, 0) + 1
                    sent_now += 1
            if run == 1:
                R.check(sent_now == 0, f'{day} second alert run sent {sent_now} duplicates')

        # ── Checks ─────────────────────────────────────────────────────────
        alice = s.tenant('alice')
        R.check(s.balance(alice, 'alice') == 0, f'{day} Alice balance {s.balance(alice, "alice")}')
        R.check(s.balance(L, 'alice') == 0, f'{day} Alice balance (landlord view)')

        if 'bob' in s.people and dt.date(2027, 7, 3) <= day < dt.date(2029, 6, 10):
            jun = s.ledger(L, s.leases.get('bob_unit2', s.leases['bob']))['2027-06']
            R.check(jun['balance'] == 100000 and jun['status'] == 'partial',
                    f'{day} Bob owes 100,000 for Jun 2027 (got {jun["balance"]} {jun["status"]})')
        if day == dt.date(2027, 2, 28):
            R.check(s.ledger(L, s.leases['bob'])['2027-02']['status'] == 'overdue', 'Bob overdue on 28 Feb 2027')
        if day == dt.date(2027, 4, 30):
            R.check(s.ledger(L, s.leases['bob'])['2027-04']['status'] == 'overdue', 'Bob overdue on 30 Apr 2027')
        if day == dt.date(2027, 4, 29):
            R.check(s.ledger(L, s.leases['bob'])['2027-04']['status'] == 'not_due', 'Bob Apr 2027 not due on 29 Apr')
        if dt.date(2028, 3, 15) <= day and (not bob_topped_up or day < dt.date(2029, 6, 10)):
            old = sum(r['balance'] for r in s.ledger(s.tenant('bob'), s.leases['bob_unit2']).values())
            R.check(old == 700000, f'{day} Bob owes 700,000 after moving out (got {old})')
        if day == dt.date(2028, 3, 15):
            R.check(s.balance(L, 'bob') == 700000 and s.balance(s.tenant('bob'), 'bob') == 700000,
                    'tenant_balance(Bob) = 700,000 in both views')
        if day == dt.date(2028, 3, 25):
            leases_mar = L.q("select l.id, p.full_name from leases l join profiles p on p.id = l.tenant_id "
                             "where l.unit_id = %s and l.move_in_date <= '2028-03-31' "
                             "and coalesce(l.lease_end, 'infinity') >= '2028-03-01' order by l.move_in_date",
                             (s.units['Unit 2'],))
            names = [n for _, n in leases_mar]
            R.check(names == ['Bob', 'Diane'], f'Unit 2 March 2028 shows Bob and Diane (got {names})')
            rows = L.q("select lease_id, status, expected from rent_ledger_many(%s::uuid[], %s) where period_month = '2028-03'",
                       ([str(l) for l, _ in leases_mar], day))
            R.check(len(rows) == 2, f'each March 2028 tenant has their own ledger row (got {rows})')
        if day == dt.date(2028, 1, 15):
            dec = s.ledger(L, s.leases['chidi'])['2027-12']
            R.check(dec['status'] == 'overdue' and dec['balance'] == 400000,
                    f'Chidi Dec 2027 is 400,000 overdue on 15 Jan 2028 (got {dec})')
            mar = L.q("select status from payments where lease_id = %s and period_month = '2027-03' order by submitted_at",
                      (s.leases['chidi'],))
            R.check([m[0] for m in mar] == ['rejected', 'confirmed'], f'Chidi Mar 2027 rejected then confirmed (got {mar})')
            R.check(s.ledger(L, s.leases['chidi'])['2027-03']['status'] == 'paid', 'Chidi Mar 2027 paid after resubmit')
        if day == dt.date(2028, 7, 2):
            chidi = s.tenant('chidi')
            R.check(s.balance(chidi, 'chidi') == 400000, 'former tenant Chidi still sees his 400,000 balance')
            unit = chidi.q('select label from units')
            R.check(unit == [('Unit 3',)], f'former tenant can still read his old unit (got {unit})')
            hist = chidi.q('select count(*) from payments')[0][0]
            R.check(hist >= 18, f'former tenant still sees his payment history ({hist})')
            ok, _ = chidi.attempt("insert into maintenance_requests (unit_id, tenant_id, category, description, urgency, status) "
                                  "values (%s, %s, 'other', 'x', 'low', 'submitted')", (s.units['Unit 3'], s.people['chidi']))
            R.check(not ok, 'former tenant cannot file repairs')
            s.pay('chidi', 'chidi', '2028-06', 1000, expect_ok=False, label='former tenant paying a paid month')
        if day == dt.date(2029, 2, 1):
            bob = s.tenant('bob')
            prev_tenant = sum(r['balance'] for r in s.ledger(bob, s.leases['bob_unit2']).values())
            prev_landlord = sum(r['balance'] for r in s.ledger(L, s.leases['bob_unit2']).values())
            R.check(prev_tenant == 700000 and prev_landlord == 700000, 'returning Bob: 700,000 previous balance in both apps')
            current = sum(r['balance'] for r in s.ledger(bob, s.leases['bob_unit4']).values())
            R.check(s.balance(bob, 'bob') == 700000 + current, 'tenant_balance(Bob) = previous 700,000 + current lease')
        if day == dt.date(2029, 6, 11):
            R.check(s.balance(L, 'bob') == 600000, f'after the 100,000 top-up Bob owes 600,000 (got {s.balance(L, "bob")})')
        if day == dt.date(2029, 3, 5):
            unit4 = L.one('select count(*) from payments where lease_id in (select id from leases where unit_id = %s)',
                          (s.units['Unit 4'],))[0]
            by_tenant = L.one('select count(*) from payments where tenant_id = %s', (s.people['bob'],))[0]
            R.check(unit4 < by_tenant and unit4 == 2, f'unit 4 payments come from unit 4 leases only ({unit4} vs {by_tenant})')

        # Security attacks, once, mid-simulation (Alice has a pending receipt on the 3rd).
        if day == dt.date(2027, 5, 3) and not alice_attack_done:
            alice_attack_done = True
            run_attacks(s)

        day += dt.timedelta(days=1)

    final_checks(s, broadcasts_sent)
    empty_claims_check(s)

    print()
    print(f'Tenant -> landlord alerts: {s.tenant_alerts_delivered} delivered of {s.tenant_alerts_attempted} sent')
    print('Scheduled alerts sent:', dict(sorted(s.alert_counts.items())))
    total_msgs = su.execute('select count(*) from messages').fetchone()[0]
    print(f'Messages stored: {total_msgs}')
    print(f'Checks passed: {R.passed}, failed: {len(R.failures)}')
    for n in R.notes:
        print('note:', n)
    if R.failures:
        print('\nFirst failures:')
        for f in R.failures[:25]:
            print(' -', f)
        sys.exit(1)
    print('ALL CHECKS PASSED')


def run_attacks(s: Sim):
    su, alice = s.su, s.tenant('alice')
    bob = s.tenant('bob')
    print('Running attacks as Alice (tenant JWT) on', s.today)

    ok, _ = alice.attempt("update profiles set role = 'landlord' where id = %s", (s.people['alice'],))
    role = su.execute('select role from profiles where id = %s', (s.people['alice'],)).fetchone()[0]
    R.check(role == 'tenant', 'attack: tenant makes herself landlord')
    ok, _ = alice.attempt('update profiles set unit_id = %s where id = %s', (s.units['Unit 4'], s.people['alice']))
    R.check(not ok, 'attack: tenant moves herself to another unit')

    pending = su.execute("select id from payments where tenant_id = %s and status = 'pending_review'",
                         (s.people['alice'],)).fetchone()
    R.check(pending is not None, 'Alice has a pending payment to attack')
    alice.attempt("update payments set status = 'confirmed' where id = %s", (pending[0],))
    st = su.execute('select status from payments where id = %s', (pending[0],)).fetchone()[0]
    R.check(st == 'pending_review', 'attack: tenant confirms her own pending payment')
    alice.attempt('update payments set amount = 1 where id = %s', (pending[0],))
    R.check(su.execute('select amount from payments where id = %s', (pending[0],)).fetchone()[0] > 1,
            'attack: tenant edits a submitted payment')

    ok, res = alice.attempt("insert into payments (lease_id, tenant_id, period_month, amount, status, reviewed_by) "
                            "values (%s, %s, %s, 5000, 'confirmed', %s) returning status, reviewed_by",
                            (s.leases['alice'], s.people['alice'], '2027-05', s.people['alice']))
    R.check(ok and res[0] == ('pending_review', None), f'attack: insert as confirmed is saved as pending_review ({res})')
    if ok:
        su.execute("delete from payments where amount = 5000 and tenant_id = %s", (s.people['alice'],))

    ok, _ = alice.attempt("insert into payments (lease_id, tenant_id, period_month, amount, status) "
                          "values (%s, %s, '2027-05', 1000, 'pending_review')", (s.leases['bob'], s.people['alice']))
    R.check(not ok, "attack: tenant pays on another tenant's lease")
    ok, _ = alice.attempt("insert into payments (lease_id, tenant_id, period_month, amount, status) "
                          "values (%s, %s, '2027-05', 1000, 'pending_review')", (s.leases['bob'], s.people['bob']))
    R.check(not ok, 'attack: tenant files a payment in another tenant’s name')

    ok, _ = alice.attempt('insert into messages (sender_id, recipient_id, body) values (%s, null, %s)',
                          (s.people['alice'], 'Free rent for all!'))
    R.check(not ok, 'attack: tenant sends a broadcast')
    ok, _ = alice.attempt('insert into messages (sender_id, recipient_id, body) values (%s, %s, %s)',
                          (s.people['alice'], s.people['bob'], 'hi neighbour'))
    R.check(not ok, 'attack: tenant messages another tenant')
    ok, _ = alice.attempt('insert into messages (sender_id, recipient_id, body) values (%s, %s, %s)',
                          (s.people['bob'], s.landlord_id, 'spoofed'))
    R.check(not ok, 'attack: tenant sends a message as someone else')

    ok, _ = alice.attempt("insert into maintenance_requests (unit_id, tenant_id, category, description, urgency, status) "
                          "values (%s, %s, 'other', 'done', 'low', 'resolved')", (s.units['Unit 1'], s.people['alice']))
    R.check(not ok, 'attack: tenant files a repair as resolved')
    ok, _ = alice.attempt("insert into maintenance_requests (unit_id, tenant_id, category, description, urgency, status) "
                          "values (%s, %s, 'other', 'x', 'low', 'submitted')", (s.units['Unit 2'], s.people['alice']))
    R.check(not ok, "attack: tenant files a repair on someone else's unit")

    ok, _ = alice.attempt("insert into notifications (user_id, type, title, body) values (%s, 'x', 'x', 'x')",
                          (s.people['bob'],))
    R.check(not ok, 'attack: tenant sends a notification to another tenant')

    ok, _ = alice.attempt("insert into move_out_notices (lease_id, tenant_id, intended_move_out_date, status) "
                          "values (%s, %s, '2027-09-01', 'submitted')", (s.leases['bob'], s.people['alice']))
    R.check(not ok, "attack: move-out notice on someone else's lease")

    for fn, args in [('set_unit_rent(%s, 1, %s)', (s.units['Unit 1'], '2027-05')),
                     ('end_tenancy(%s, %s)', (s.leases['bob'], s.today)),
                     ('attach_tenant(%s, %s, null, %s, %s, 1, 0, null)',
                      (s.people['alice'], 'x', s.units['Unit 4'], s.today)),
                     ('due_alerts(%s)', (s.today,))]:
        ok, _ = alice.attempt(f'select {fn}', args)
        R.check(not ok, f'attack: tenant calls {fn.split("(")[0]}')

    R.check(alice.q('select count(*) from payments where tenant_id <> %s', (s.people['alice'],))[0][0] == 0,
            "tenant cannot read other tenants' payments")
    R.check(alice.q('select count(*) from sent_alerts')[0][0] == 0, 'tenant cannot read sent_alerts')
    R.check(alice.one('select tenant_balance(%s)', (s.people['bob'],))[0] == 0,
            "tenant_balance of someone else reveals nothing (RLS)")

    bmsg = su.execute('select id from messages where recipient_id = %s limit 1', (s.people['alice'],)).fetchone()
    alice.attempt("update messages set body = 'edited' where id = %s", (bmsg[0],))
    R.check(su.execute('select body from messages where id = %s', (bmsg[0],)).fetchone()[0] != 'edited',
            'attack: recipient rewrites a message')
    bc = su.execute('select id from messages where recipient_id is null order by created_at desc limit 1').fetchone()
    ok, _ = alice.attempt("update messages set read_at = now() where id = %s", (bc[0],))
    R.check(su.execute('select read_at from messages where id = %s', (bc[0],)).fetchone()[0] is None,
            'a tenant cannot mark a broadcast read for everyone')
    ok, _ = alice.attempt('insert into message_reads (message_id, user_id) values (%s, %s)', (bc[0], s.people['alice']))
    R.check(ok, 'tenant marks a broadcast read for herself')
    ok, _ = alice.attempt('insert into message_reads (message_id, user_id) values (%s, %s)', (bc[0], s.people['bob']))
    R.check(not ok, 'attack: tenant marks a broadcast read for someone else')
    ok, _ = bob.attempt("select count(*) from push_subscriptions")
    R.check(ok and _[0][0] == 0, 'push subscriptions are private')


def final_checks(s: Sim, broadcasts_sent):
    su, L = s.su, s.landlord
    # Eric only sees broadcasts sent since his lease began (1 Jul 2028).
    eric = s.tenant('eric')
    seen = eric.q('select min(created_at), count(*) from messages where recipient_id is null')[0]
    expected = sum(1 for _, when in broadcasts_sent if when >= kig(dt.date(2028, 7, 1), 0))
    R.check(seen[0] >= kig(dt.date(2028, 7, 1), 0) and seen[1] == expected,
            f'Eric sees only broadcasts from 1 Jul 2028 ({seen[1]} of {expected}, first {seen[0]})')
    R.check(s.tenant('chidi').q('select count(*) from messages where recipient_id is null')[0][0] == 0,
            'former tenant no longer sees broadcasts')

    # Landlord Messages page: newest 200 per thread, newest message present.
    total = su.execute('select count(*) from messages').fetchone()[0]
    R.check(total > 1000, f'over 1,000 messages stored, so the old query would have been cut off ({total})')
    for key in ('alice', 'diane', 'eric', 'bob'):
        t = s.people[key]
        rows = L.q('select id, created_at from messages where (sender_id = %s and recipient_id = %s) '
                   'or (sender_id = %s and recipient_id = %s) order by created_at desc limit 200',
                   (t, s.landlord_id, s.landlord_id, t))
        newest = su.execute('select max(created_at) from messages where %s in (sender_id, recipient_id) '
                            'and recipient_id is not null', (t,)).fetchone()[0]
        R.check(rows and rows[0][1] == newest and len(rows) == min(200, rows and len(rows)),
                f'{key} thread shows the newest message')
        older = L.q('select count(*) from messages where ((sender_id = %s and recipient_id = %s) '
                    'or (sender_id = %s and recipient_id = %s)) and created_at < %s',
                    (t, s.landlord_id, s.landlord_id, t, rows[-1][1]))[0][0]
        if older:
            R.notes.append(f'{key}: {older} older messages available through "Load older"')

    # Read receipts: landlord opens Alice's thread; Alice opens Messages.
    alice = s.tenant('alice')
    L.q('update messages set read_at = now() where sender_id = %s and recipient_id = %s and read_at is null',
        (s.people['alice'], s.landlord_id))
    R.check(L.q('select count(*) from messages where sender_id = %s and recipient_id = %s and read_at is null',
                (s.people['alice'], s.landlord_id))[0][0] == 0, 'landlord unread badge clears for the thread')
    alice.q('update messages set read_at = now() where recipient_id = %s and read_at is null', (s.people['alice'],))
    alice.q('insert into message_reads (message_id, user_id) select id, %s from messages where recipient_id is null '
            'on conflict do nothing', (s.people['alice'],))
    unread = alice.q('select count(*) from messages m where (m.recipient_id = %s and m.read_at is null) or '
                     '(m.recipient_id is null and not exists (select 1 from message_reads r where r.message_id = m.id '
                     'and r.user_id = %s))', (s.people['alice'], s.people['alice']))[0][0]
    R.check(unread == 0, 'tenant unread badge clears after opening Messages')
    R.check(s.tenant('diane').q('select count(*) from message_reads')[0][0] == 0,
            "one tenant's broadcast reads are not another's")

    # Every tenant alert reached the landlord.
    R.check(s.tenant_alerts_delivered == s.tenant_alerts_attempted and s.tenant_alerts_attempted > 0,
            f'all tenant alerts delivered ({s.tenant_alerts_delivered}/{s.tenant_alerts_attempted})')
    # Alerts went to the earliest landlord even after a second landlord was added.
    other = su.execute("select count(*) from notifications n join profiles p on p.id = n.user_id "
                       "where p.full_name = 'Co Owner'").fetchone()[0]
    R.check(other == 0, 'with two landlords, alerts still go to the first one')
    for kind in ('rent_due_soon', 'rent_overdue_1d', 'rent_overdue_7d', 'lease_ending', 'receipt_waiting', 'repair_open'):
        R.check(s.alert_counts.get(kind, 0) > 0, f'scheduled alert type {kind} was sent at least once')
    dupes = su.execute('select count(*) - count(distinct key) from sent_alerts').fetchone()[0]
    R.check(dupes == 0, 'no duplicate scheduled alerts')


def empty_claims_check(s: Sim):
    """Every policy and helper with request.jwt.claims = '' must deny, never crash."""
    su = s.su
    tables = [r[0] for r in su.execute(
        "select tablename from pg_tables where schemaname = 'public' and tablename <> 'sim_clock'").fetchall()]
    ok_codes = {'42501', 'P0001', '23502', '23503', '23505', '23514'}
    crashes = []
    for role in ('anon', 'authenticated'):
        a = Actor(s.api, role, claims='')
        for t in tables:
            ok, res = a.attempt(sql.SQL('select count(*) from {}').format(sql.Identifier(t)).as_string(su))
            if not ok and res.sqlstate not in ok_codes:
                crashes.append(f'{role} select {t}: {res.sqlstate} {res}')
            cols = [r[0] for r in su.execute(
                "select column_name from information_schema.columns where table_schema='public' and table_name=%s "
                "order by ordinal_position", (t,)).fetchall()]
            row = su.execute(sql.SQL('select row_to_json(x) from {} x limit 1').format(sql.Identifier(t))).fetchone()
            if row:
                data = row[0]
                for pk in ('id', 'key'):
                    if pk in data:
                        data[pk] = str(uuid.uuid4())
                ins = sql.SQL('insert into {} select * from json_populate_record(null::{}, %s)').format(
                    sql.Identifier(t), sql.Identifier(t)).as_string(su)
                ok, res = a.attempt(ins, (json.dumps(data),))
                if ok:
                    crashes.append(f'{role} could insert into {t} with empty claims')
                elif res.sqlstate not in ok_codes:
                    crashes.append(f'{role} insert {t}: {res.sqlstate} {res}')
                upd = sql.SQL('update {} set {} = {}').format(sql.Identifier(t), sql.Identifier(cols[0]),
                                                             sql.Identifier(cols[0])).as_string(su)
                ok, res = a.attempt(upd)
                if not ok and res.sqlstate not in ok_codes:
                    crashes.append(f'{role} update {t}: {res.sqlstate} {res}')
                elif ok and res:
                    crashes.append(f'{role} updated {res} rows of {t} with empty claims')
                ok, res = a.attempt(sql.SQL('delete from {}').format(sql.Identifier(t)).as_string(su))
                if not ok and res.sqlstate not in ok_codes:
                    crashes.append(f'{role} delete {t}: {res.sqlstate} {res}')
                elif ok and res:
                    crashes.append(f'{role} deleted {res} rows of {t} with empty claims')
        ok, res = a.attempt('select count(*) from storage.objects')
        if not ok and res.sqlstate not in ok_codes:
            crashes.append(f'{role} storage.objects: {res}')
        for fn in ('is_service_role()', 'is_landlord()', 'my_unit_id()', 'caller_is_admin()', 'my_broadcasts_since()',
                   'app_today()', f"tenant_balance('{s.people['alice']}')", f"rent_ledger('{s.leases['alice']}')"):
            ok, res = a.attempt(f'select ({fn})::text')
            if not ok and res.sqlstate not in ok_codes:
                crashes.append(f'{role} {fn}: {res.sqlstate} {res}')
    R.check(not crashes, 'empty request.jwt.claims: ' + ('; '.join(crashes[:5]) or 'no crashes'))
    print(f"Empty-claims check: {len(tables)} tables x 2 roles, {'no crashes' if not crashes else crashes[:3]}")


if __name__ == '__main__':
    main()
