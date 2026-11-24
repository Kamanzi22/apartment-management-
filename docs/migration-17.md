# Migration 17 in plain English

File: `supabase/17_mobile_push_and_phone_login.sql` — **not applied**.
Undo: `supabase/17_rollback.sql`. Checks: `supabase/tests/17_checks.sql`.
Used by the Edge Functions in `supabase/functions/` (see its README).

It adds three things the phone apps need and nothing else changes for the web
apps. Applying it is safe on its own: until the Edge Functions and phone builds
use it, nothing calls the new functions.

## 0. A "deleted" mark on profiles

- New column `profiles.deleted_at` (empty for everyone today).
- The existing profile guard (from 08) gets one more rule: a tenant cannot set
  or clear `deleted_at` on their own row. Before this, tenants could already
  edit their own row (name, phone) but not role or unit; that stays the same.

## 1. Push tokens for the phone apps

- New table `expo_push_tokens`: one row per installed app (`user_id`, `token`,
  `platform` = `ios` or `android`, dates). A token is unique: one phone, one
  owner. The format is checked (`ExponentPushToken[...]`).
- Who sees what (row-level security): you can read, add and remove **your own**
  tokens only. The landlord **cannot** read tenants' tokens. Signed-out visitors
  have no access at all. Nobody can edit a row in place.
- `register_expo_push_token(token, platform)`: what the phone calls after
  sign-in. If the phone was used by someone else before (shared phone), the
  token moves to the new person, so pushes follow whoever is signed in. It
  refuses signed-out callers and deleted accounts.
- Sending pushes is done by the Edge Functions with the secret key. When Expo
  answers `DeviceNotRegistered` (app removed), the token is deleted.

## 2. Phone-number sign-in, safely

The web tenant app lets people sign in with a phone number by looking up the
email on the server. The phones cannot hold the server key, so:

- `phone_sign_in_lookup(phone, client_key)` finds the tenant's login email for a
  number. **Only the server (service role) can call it** — not signed-out
  visitors, not signed-in users. The `phone-sign-in` Edge Function calls it,
  signs in with the email itself, and gives the phone **only a session**. The
  email never leaves the server.
- Same matching as the web: digits only, at least 6, exactly one tenant with
  those digits (two tenants sharing a number → no match), deleted accounts
  never match.
- Rate limit, stored in `phone_login_attempts` (no one but the server can read
  it): 5 tries per number per 15 minutes, 30 per device/network per hour. Only
  hashes are stored: the number is hashed, and the client IP is hashed with a
  secret pepper (`PHONE_LOOKUP_PEPPER`) by the Edge Function before it reaches
  the database. Rows older than a day are removed.

**Why this design (the safest of the options):**

| Option | Problem |
|---|---|
| A database function the phone calls directly (anon or signed-in) | Anyone could ask "is 0788… a tenant, and what is their email?" → leaks who lives here and their emails |
| Return a yes/no instead of the email | Still tells an attacker which numbers are tenants |
| **Server-only lookup inside an Edge Function, answer = session or one generic error** (chosen) | Wrong number and wrong password give the same message, same status, similar time; attempts are limited the same way whether or not the number exists |

Note: Supabase Auth also limits password sign-ins per IP. All phone sign-ins
come from the Edge Function's IP, so for a big building that shared limit could
be reached; for 4 units it is not a concern.

## 3. Deleting an account from the app

Apple and Google require that people can delete their account from inside the
app. The catch: in this database, deleting a login also deletes (cascade) the
person's profile, leases, payments, repair requests and messages — the
landlord's rent history and accounts. So deletion depends on who it is:

| Account | What happens |
|---|---|
| Landlord | **Refused** in the app, with an explanation. It holds the whole building. Closing it is a manual request |
| Tenant who never had a lease, payment, repair, move-out or vacate notice | **Everything deleted**: profile and its rows, uploaded files, and the login itself |
| Tenant with any history | **Anonymised and disabled**, records kept (table below) |

For a tenant with history:

| Deleted | Changed | Kept (landlord's records) |
|---|---|---|
| push tokens (phone + browser), their notifications, their message read-marks | name → "Former tenant (deleted)", phone → empty, email alerts off, `deleted_at` set; the text of messages **they** sent → "(message deleted by the tenant)" | leases, rent history, payments and receipt files, repair requests and their history and photos, move-out and vacate notices, the landlord's own messages, alert log |

The login is banned first (so the account is unusable even if a later step
fails), every session is signed out, the password is replaced, and then the
login is **soft-deleted** in Supabase Auth (email, phone and sign-in methods
scrubbed by Supabase; the row stays, so the cascade never fires). If the tenant
still had an active lease, the landlord gets an alert ("A tenant deleted their
account") and ends the tenancy as usual.

`delete_account(user_id)` (only the server can call it) does the database part
in one transaction and is safe to call twice. The `delete-account` Edge
Function takes the user id **from the caller's token, never from the request**,
asks for the password again (or a sign-in in the last 10 minutes for a Google
login), then runs the steps above.

## Safety rules applied everywhere

- Every new function that runs with extra rights (`SECURITY DEFINER`) has a fixed,
  empty `search_path`, so nobody can slip in a fake table or function.
- `register_expo_push_token`: signed-in users only. `phone_sign_in_lookup` and
  `delete_account`: server only. Signed-out visitors can call none of them.
- Safe to run twice (`if not exists`, `create or replace`, `drop policy if exists`).

## How it was checked (25 Nov 2026)

`17_checks.sql` (40 assertions plus 13 "this must be refused" checks, all inside a transaction that is rolled back)
was run against migrations 01, 03–14, 16, 17 on **PGlite 0.3.14** (real Postgres
compiled to WebAssembly, in memory on this laptop; no Supabase project touched),
with `tests/supabase_stubs.sql` for the Supabase roles/schemas. Results:

- all migrations applied; 17 applied twice (safe to re-run): OK
- `all 17 checks passed`
- `17_rollback.sql` removed everything 17 added, and 17 applied cleanly again after it
- mutation check: granting `delete_account` to `authenticated` → check 7a fails;
  not deleting the tokens → check 7h fails (so the checks do catch mistakes)

Differences from real Supabase in that run: PGlite has no `pgcrypto`, so a
stand-in `extensions.digest()` (same SHA-256 result) was used; `pg_cron`/`pg_net`
(migration 15) were skipped; Auth itself (ban, soft delete) is not in the
database and is covered by the Edge Function unit tests instead. Before applying
to production, running the checks once on a Supabase branch or local stack is
still recommended.

## Applying it (owner)

1. Supabase dashboard → SQL editor → paste `17_mobile_push_and_phone_login.sql` → Run.
2. Optional check: `select to_regclass('public.expo_push_tokens'), to_regproc('public.delete_account');` → both not null.
3. Security advisor: no new warnings expected for these objects.
4. Then (later) set the Edge Function secrets and deploy (`supabase/functions/README.md`).
5. After applying: regenerate `src/lib/supabase/database.types.ts` in **both** web
   repos (new table `expo_push_tokens`, column `profiles.deleted_at`) in one commit
   each, so `scripts/check-shared.sh` stays green. Not done now on purpose: the
   types must match the live database.

## Open questions for the owner

- How long must a deleted tenant's records be kept (Rwandan tax and data
  protection rules)? Today: indefinitely, like any former tenant.
- Keep or remove the deleted tenant's **name** on old leases/payments? The plan
  removes it from the app; a signed lease contract (if uploaded) still has it.
- Replacing the text of messages the tenant sent: fine, or should the landlord
  keep the words (e.g. as evidence of a notice)? Move-out notices are kept either way.
