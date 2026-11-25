# Migration 17 in plain English

File: `supabase/17_mobile_push_and_phone_login.sql` — **not applied**.
Undo: `supabase/17_rollback.sql`. Checks: `supabase/tests/17_checks.sql`.
Used by the Edge Functions in `supabase/functions/` (see its README).

It adds what the phone apps need (sections 0-5); nothing else changes for the web
apps. Applying it is safe on its own: until the Edge Functions and phone builds
use it, nothing calls the new functions.

## 0. A "closed" mark on profiles (`deleted_at`)

- New column `profiles.deleted_at` (empty for everyone today): set when a tenant closes their account (section 3).
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

## 3. Closing an account from the app ("Delete my account")

**Owner decision, 25 Nov 2026: closing an account blocks the login only.
Nothing is erased.**

When a tenant taps "Delete my account" and confirms with their password:

1. their login is **banned** (Supabase Auth, about 100 years) — no new sign-in works;
2. **every session is signed out** (refresh tokens revoked);
3. `delete_account(user_id)` (server only) deletes **their phone push tokens** and
   sets `profiles.deleted_at` — nothing else;
4. if a lease is still running, the landlord gets an alert ("A tenant closed their
   account") and ends the tenancy as usual.

| Removed | Kept, exactly as it was |
|---|---|
| Expo push tokens (so their phones stop getting pushes) | name, phone, email, the Auth login row, lease, rent history, payments and receipt files, repairs and photos, messages (both sides), notifications, move-out and vacate notices |

- If step 2 or 3 fails, the ban is lifted again so the tenant can retry.
- No Auth login is ever deleted (`auth.admin.deleteUser` is not used anywhere).
- A token issued before closing can live up to an hour; while `deleted_at` is set,
  new "restrictive" policies refuse **every insert, update and delete** from that
  account (profiles, payments, repairs, repair updates, messages, read marks,
  move-out notices, notifications, push subscriptions, push tokens).
  `register_expo_push_token` and the phone-number lookup also refuse it.
- The landlord's access is unchanged: the landlord still reads the closed tenant's
  profile and every row, and the landlord's totals and arrears do not change.
  Other tenants and signed-out visitors see nothing of it, as before.
- The landlord web app shows **"Former tenant (account closed)"** next to the
  tenant (unit page and unit history), still with name, phone and email, and a
  **"Reactivate account"** button.
- **Reactivating** (`reactivate_account(user_id)`, server only, tenants only) clears
  `deleted_at`; the landlord's button / the `reactivate-tenant` function also lifts
  the ban. The tenant signs in again with their old password and everything is there.
- Landlord accounts cannot be closed from the app (still open, see below).

## 4. How a payment was made (`payments.method`)

New optional column: `momo`, `bank` or `cash` (the values the owner gave). Old
payments, the web form and landlord entries stay empty. Nothing else changes
(same rules for who may insert, the landlord may correct it).

## 5. The notice period for tenants (`tenant_rent_policy()`)

Migration 18 (already live) made the full alert settings landlord-only, because
they include the landlord's message templates. The tenant move-out form only needs
the notice period, so `tenant_rent_policy()` returns that one number (30 days when
not set). Signed-in users only.

## Safety rules applied everywhere

- Every new function that runs with extra rights (`SECURITY DEFINER`) has a fixed,
  empty `search_path`, so nobody can slip in a fake table or function.
- `register_expo_push_token`, `tenant_rent_policy`: signed-in users only.
  `phone_sign_in_lookup`, `delete_account`, `reactivate_account`: server only.
  Signed-out visitors can call none of them.
- Safe to run twice (`if not exists`, `create or replace`, `drop policy if exists`).

## How it was checked (25 Nov 2026)

`17_checks.sql` (all inside a transaction that is rolled back) was run against
migrations 01, 03–14, 16, 17, 18 on **PGlite 0.3.14** (real Postgres compiled to
WebAssembly, in memory on this laptop; no Supabase project touched), with
`tests/supabase_stubs.sql` for the Supabase roles/schemas. It checks, among others:

- push tokens: own rows only, landlord can't read them, shared-phone hand-over;
- phone lookup: server only, same digits rule as the web, rate limit, closed accounts never match;
- closing: only the push token disappears; name/phone/email, payments, lease,
  messages, repair + photo path and notifications are unchanged; **the landlord's
  payment total, the tenant's arrears and the building's income are identical
  before and after**; the landlord still reads all of it; another tenant and
  signed-out visitors read none of it; the closed account cannot send a message,
  create an alert, submit a payment, edit its profile or register a push token;
- reactivating: clears `deleted_at`, the number signs in again, writes work again;
- `payments.method` accepts momo, refuses anything unknown, stays optional;
  `tenant_rent_policy()` gives a tenant one number and the 18 function gives them nothing.

Result: `all 17 checks passed`; 17 applied twice; `17_rollback.sql` removed
everything and 17 applied again after it. Mutation check (deliberately broken
copies): granting `delete_account` to signed-in users → caught (7a); leaving the
messages table out of the restrictive policies → caught (7g); deleting the
tenant's pending payments on closing → caught (7d).

Differences from real Supabase in that run: PGlite has no `pgcrypto`, so a
stand-in `extensions.digest()` (same SHA-256 result) was used; `pg_cron`/`pg_net`
(migration 15) were skipped; Auth itself (ban, sign-out) is not in the database
and is covered by the Edge Function unit tests. Running the checks once on a
Supabase branch before applying is still recommended.

## Applying it (owner)

1. Supabase dashboard → SQL editor → paste `17_mobile_push_and_phone_login.sql` → Run.
2. Optional check: `select to_regclass('public.expo_push_tokens'), to_regproc('public.delete_account'), to_regproc('public.reactivate_account');` → none null.
3. Security advisor: no new warnings expected for these objects.
4. Then (later) set the Edge Function secrets and deploy (`supabase/functions/README.md`).
5. After applying: regenerate `src/lib/supabase/database.types.ts` in **both** web
   repos and apartment-mobile (`expo_push_tokens`, `profiles.deleted_at`,
   `payments.method`, the new functions), so `scripts/check-shared.sh` stays green.

## Open questions for the owner

- **Before App Store / Play submission:** Apple 5.1.1(v) asks for account
  *deletion*, and Rwanda's Law 058/2021 may require erasing personal data on
  request. "Block login only" may not be enough there (also in TODO.md).
- Closing a **landlord** account from the app is refused; decide what should happen.
- `payments.method`: the phone form also offers **Airtel Money**. Add `'airtel'` to
  the allowed values, or remove it from the form (inserting it today would fail).
