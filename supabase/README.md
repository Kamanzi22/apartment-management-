# Database migrations

Run each file in **Supabase Dashboard → SQL Editor → New query**, one at a
time, in the order below. Every file from 05 on can be run again if it fails
part-way or you are not sure it was applied. Keep the order: re-running an
earlier file (say 08) after a later one (10) puts back the older rules, so
then re-run every later file too.

Production has 01–14 (05–14 applied 20 Nov 2026). New files go after 14.
For a fresh database, apply in this order:

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
| 13 | `13_rent_alert_settings.sql` | Rent alerts the landlord controls (`alert_settings`, `lease_alert_overrides`), the send log columns on `sent_alerts`, the unpaid-rent limit (`rent_limit_status`, `rent_limit_actions`, `vacate_notices`), a faster `rent_ledger_range`, and the hourly `due_alerts(timestamptz)` that replaces 12's fixed timings |
| 14 | `14_maintenance_workflow.sql` | Only the landlord sets repair status; new statuses (scheduled, on hold, closed) and `scheduled_for`; `maintenance_status_history` (trigger) and `maintenance_updates` (tenant follow-ups); `profiles.email_notifications` |
| 15 | `15_enable_pg_cron_pg_net.sql` | The `pg_cron` and `pg_net` extensions for the hourly alerts job (production: already enabled by hand). The job itself is below, not in the file, because it holds the secret |
| 16 | `16_lock_down_helper_functions.sql` | Signed-out visitors can no longer call `is_landlord()` / `my_unit_id()` (revoked from `public` and `anon`); empty `search_path` on those two and `set_updated_at()` |
| 17 | `17_mobile_push_and_phone_login.sql` | **Not applied yet.** `expo_push_tokens` (own rows only; the landlord cannot read them) + `register_expo_push_token()`; `phone_sign_in_lookup()` for the phone-sign-in Edge Function (service role only, rate-limited in `phone_login_attempts`); `profiles.deleted_at` + `delete_account()` for in-app account deletion (service role only). Explained in `docs/migration-17.md`. Checks: `tests/17_checks.sql` (throwaway database only). Undo: `17_rollback.sql` |

So: **05 → 06 → 07 → 08 → 09 → 10 → 11 → 12 → 13 → 14 → 15 → 16.**

`02_landlord_seed.sql` is a template for creating the first landlord by hand;
it is not part of the sequence.

## Deploy order

The new app code calls functions from 09–14, and the old tenant app's
"upsert" stops working once 10 drops the one-payment-per-month rule. So:

1. Apply 05–14.
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

## Scheduled alerts: run the job every hour

The tenant app has `GET /api/cron/daily`, protected by the `CRON_SECRET`
header. Call it **every hour**. It only sends in the landlord's chosen send
hour (Settings → Rent alerts, Kigali time, 09:00 by default); every other
hour it returns `"due": 0`. Running it twice in the same hour sends nothing
new: each alert is claimed in `sent_alerts` (key + channel) before it is sent.

**A. Render cron job** (paid, about $1/month): New → Cron Job, schedule
`0 * * * *`, command:

```sh
curl -fsS -H "x-cron-secret: $CRON_SECRET" https://apartment-manager-tenant.onrender.com/api/cron/daily
```

and set `CRON_SECRET` on the cron job too.

**Production uses B** (since 20 Nov 2026): job `hourly-alerts`, schedule `0 * * * *`.
Check it with:

```sql
select jobid, jobname, schedule, active from cron.job;
select status, return_message, start_time from cron.job_run_details
 order by start_time desc limit 5;
select status_code, created from net._http_response order by created desc limit 5;  -- expect 200
```

To change the secret: `select cron.unschedule('hourly-alerts');`, then schedule it
again as below with the new value (and change `CRON_SECRET` on Render at the same time).
Never commit the secret.

**B. Supabase pg_cron + pg_net** (free): run `15_enable_pg_cron_pg_net.sql` (or
enable both under Database → Extensions), then run once (replace the secret). If you scheduled
the old daily job, remove it first with `select cron.unschedule('daily-alerts');`.

```sql
select cron.schedule('hourly-alerts', '0 * * * *', $$
  select net.http_get(
    url := 'https://apartment-manager-tenant.onrender.com/api/cron/daily',
    headers := jsonb_build_object('x-cron-secret', '<CRON_SECRET>'),
    timeout_milliseconds := 60000);
$$);
```

The free Render plan sleeps; the first request wakes it (that can take about
a minute, hence the long timeout). Waking it every hour also keeps the tenant
app quicker to open.

To test a moment without waiting: `.../api/cron/daily?at=2027-02-28T09:00:00%2B02:00`.

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
