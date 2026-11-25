# Migration 19: advisor fixes and tenant contract access

File: `supabase/19_advisor_fixes.sql` (DRAFT, not applied). Undo: `supabase/19_rollback.sql`.
Checks: `supabase/tests/19_checks.sql`. Safe to run twice.
**Apply 17 first**: part C below reads `profiles.deleted_at`, which 17 adds.

## Part A: fixed search_path on 5 helper functions (advisor 0011)

`fmt_rwf`, `valid_day_list`, `render_alert_template`, `fmt_month` and `fmt_day` now have an
empty `search_path`. A function without one can be tricked into calling a look-alike object
from another schema. These five only use built-in functions, so nothing changes for the app.

## Part B: two trigger functions no longer callable over the API (advisor 0028/0029)

`create_alert_settings()` and `record_maintenance_status()` only exist to run as triggers.
Their EXECUTE right is taken away from the public, anon and signed-in users, so nobody can
call them through the API. The triggers keep working (Postgres checks the right when the
trigger is created, not each time it fires).

## Part C: a tenant can read their own contract file (new)

**Problem.** Since migration 06 the `lease-contracts` bucket is landlord-only, so a tenant's
phone or web app can never open their own contract.

**How contracts are stored.** The landlord web upload (`src/app/actions/admin.ts`,
`uploadContract`) saves the file at `<lease id>/contract.<ext>` inside the bucket and writes
the same text to the column `leases.contract_path`. The landlord page makes a 1-hour signed
link from that path.

**What 19 adds.**
- A helper `public.tenant_can_read_contract(name)`. It answers yes only when a lease exists
  whose `tenant_id` is the caller, whose `contract_path` equals the file name exactly, and the
  caller's account is not closed (`profiles.deleted_at` is empty). It is SECURITY DEFINER with
  an empty `search_path` (so it can look at leases and profiles) and is revoked from the public
  and anon; only signed-in users and the server can call it.
- A storage policy `lease-contracts: tenant reads own`: SELECT on `storage.objects`, for
  signed-in users, for that bucket, only when the helper says yes. It is checked per file,
  so there is no bucket-wide read. Listing the bucket only ever shows the tenant's own file.
- Not changed: only the landlord can upload, replace or delete contracts. Anon gets nothing.
  A closed account gets nothing. Another tenant gets nothing.

**What the app does after 19.** The tenant app calls
`supabase.storage.from('lease-contracts').createSignedUrl(lease.contract_path, 3600)` (or
`download(contract_path)`) with the tenant's own session, using `contract_path` from their own
lease row (tenants already can read their own lease).

## How it was checked

`19_checks.sql` ran on PGlite (in-memory Postgres) after migrations 01, 03-14, 16, 17, 18 and
19, with the Supabase stubs. Part C checks: tenant A sees exactly their own contract and nothing
else (not B's, not another file in A's folder that is not the `contract_path`); tenant B sees
only B's; a closed tenant sees nothing; anon sees nothing and cannot call the helper; the
landlord still sees all contracts. A deliberately broken copy (policy not checking the
tenant) is caught. Results are in the board line and HANDOFF-LOG.

Live attack cases are written, not run (19 is not applied): `attacks/contract-cases.ts` and
`attacks/run-contract.ts` on branch `attacks` (worktree `C:\dev\e2e-attacks`). Cases marked
"EXPECTED AFTER MIGRATION 19" fail until 19 is applied; every "denied" case must pass before
and after.

## Not in 19 (left on purpose)

`attach_tenant`, `end_tenancy`, `replace_tenancy`, `is_landlord`, `my_unit_id`,
`my_broadcasts_since`, `rent_limit_status` and `alert_settings_current` stay callable by
signed-in users because the app uses them and each one checks the caller. `pg_net` in the
public schema and "Leaked password protection" are dashboard/cron settings, not SQL here.

## Applying it (owner)

1. Apply 17 first.
2. Supabase dashboard, SQL editor, paste `19_advisor_fixes.sql`, Run.
3. Check: `select to_regproc('public.tenant_can_read_contract');` is not null, and the
   advisor no longer lists the five 0011 warnings or the two trigger functions.
4. Then run the live contract cases (with the owner's go).
