# Database migrations

Run each file in **Supabase Dashboard → SQL Editor → New query**, one at a
time, in the order below. Every file from 05 on can be run again if it fails
part-way or you are not sure it was applied. Keep the order: re-running an
earlier file (say 08) after a later one (10) puts back the older rules, so
then re-run every later file too.

Production has 01–04. Apply, in this order:

| # | File | What it does |
|---|------|--------------|
| 05 | `05_building_config.sql` | Building config table, more expense categories |
| 06 | `06_lease_contracts.sql` | `leases.contract_path` and the `lease-contracts` bucket. **Without it every unit page fails to load** (it is where tenants are added) |
| 07 | `07_tenant_resubmit_rejected.sql` | Tenants can resubmit a rejected receipt (superseded by 10, kept for history) |
| 08 | `08_security_and_alerts_fixes.sql` | Blocks 8 attacks (tenant -> landlord, self-confirmed payments, broadcasts, ...) and lets tenant alerts reach the landlord |
| 09 | `09_rent_schedule_and_ledger.sql` | Rent history (`rent_schedule`) and the shared ledger: `rent_ledger`, `rent_upcoming`, `rent_ledger_many`, `tenant_balance`, `set_unit_rent` |
| 10 | `10_partial_payments.sql` | Several payments per month, pay up to 6 months ahead, former tenants pay only what they owe |
| 11 | `11_tenancy_and_messages.sql` | Broadcast privacy, per-tenant broadcast reads, former tenants keep read access, all-or-nothing `end_tenancy` / `attach_tenant` / `replace_tenancy` |
| 12 | `12_alerts_and_push.sql` | `due_alerts()` for the daily job, `sent_alerts`, `push_subscriptions` |

So: **05 → 06 → 07 → 08 → 09 → 10 → 11 → 12.**

`02_landlord_seed.sql` is a template for creating the first landlord by hand;
it is not part of the sequence.

## Deploy order

The new app code calls functions from 09–12, and the old tenant app's
"upsert" stops working once 10 drops the one-payment-per-month rule. So:

1. Apply 05–12.
2. Straight after, push/merge `fix/rent-alerts-security` in **both** repos so
   Render redeploys them.

Payments submitted in the few minutes between the two steps may fail; tenants
can simply try again.

## After 09: check rent history

09 creates one `rent_schedule` row per lease from its move-in month, at the
rent the lease has **today**. If you already raised someone's rent by typing
over it, their earlier months now show the new amount. Fix it once, e.g. for a
lease raised from 350,000 to 380,000 in November 2027:

```sql
-- find the lease
select l.id, p.full_name, l.move_in_date, l.monthly_rent
from leases l join profiles p on p.id = l.tenant_id order by p.full_name;

-- old rent from move-in, new rent from the month it changed
update rent_schedule set monthly_rent = 350000
 where lease_id = '<lease id>' and effective_month = '2026-11';
insert into rent_schedule (lease_id, effective_month, monthly_rent)
values ('<lease id>', '2027-11', 380000)
on conflict (lease_id, effective_month) do update set monthly_rent = excluded.monthly_rent;
```

From now on, "Edit rent" on the unit page asks for the month the new rent
starts, and earlier months keep their old rent.

## Daily alerts (item 20)

The tenant app has `GET /api/cron/daily`, protected by the `CRON_SECRET`
header. Call it once a day, early morning Kigali time (e.g. 05:00 Kigali =
03:00 UTC). Either:

**A. Render cron job** (paid, about $1/month): New → Cron Job, schedule
`0 3 * * *`, command:

```sh
curl -fsS -H "x-cron-secret: $CRON_SECRET" https://apartment-manager-tenant.onrender.com/api/cron/daily
```

and set `CRON_SECRET` on the cron job too.

**B. Supabase pg_cron + pg_net** (free): enable both extensions under
Database → Extensions, then run once (replace the secret):

```sql
select cron.schedule('daily-alerts', '0 3 * * *', $$
  select net.http_get(
    url := 'https://apartment-manager-tenant.onrender.com/api/cron/daily',
    headers := jsonb_build_object('x-cron-secret', '<CRON_SECRET>'),
    timeout_milliseconds := 60000);
$$);
```

The free Render plan sleeps; the first request wakes it (that can take about
a minute, hence the long timeout). Running the job twice in a day sends
nothing new: every alert has a key in `sent_alerts`.

To test without waiting for a date: `.../api/cron/daily?date=2027-02-28`.

## Testing locally

Never run anything here against the production database.

```sh
# 3-year simulation on a local Postgres 16 (drops and recreates "apartment_sim")
python3 -m venv .venv && .venv/bin/pip install "psycopg[binary]"
PGURL=postgresql://postgres@127.0.0.1:54329/postgres .venv/bin/python supabase/tests/three_year_sim.py

# TypeScript rent helpers (in either app)
npm test
```

`tests/supabase_stubs.sql` stands in for Supabase's `auth`, `storage` and API
roles. The simulation also swaps `public.app_today()` for a test clock.
