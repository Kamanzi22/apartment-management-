# Key rotation plan: legacy JWT keys → publishable + secret keys

Goal: stop accepting the exposed legacy keys (the `anon` JWT and the `service_role` JWT)
by switching every client to Supabase's new API keys, with no downtime.

- `sb_publishable_...` replaces the anon key (safe in browsers and phone apps; runs as
  `anon` / `authenticated`, RLS applies).
- `sb_secret_...` replaces the service_role key (server only; bypasses RLS).

Written 24 Nov 2026. Nothing has been changed yet. The owner does every dashboard step.

## What the Supabase docs say (checked 24 Nov 2026)

Sources: <https://supabase.com/docs/guides/api/api-keys> and
<https://supabase.com/docs/guides/getting-started/migrating-to-new-api-keys>.

- New and legacy keys **work side by side**. Creating new keys revokes nothing.
- Legacy keys stop working only when you **deactivate** them under **Project Settings →
  API Keys**. Deactivating is **reversible** (they can be re-activated).
- Supabase is deprecating the legacy keys "by the end of 2026", so this has to happen soon
  anyway.
- The new keys are **not JWTs**. Send them on the `apikey` header. Places that put a key in
  `Authorization: Bearer` and expect a JWT (pg_net calls, database webhooks, Edge Functions
  with `verify_jwt`) need changes. For migration, the Edge Functions `verify_jwt` check also
  accepts them on `Authorization`, but that does not authenticate the caller.
- A **secret key sent from a browser** (matched on `User-Agent`) gets HTTP 401.
- Rotating API keys does **not** sign anybody out: user sessions are signed with the JWT
  secret / signing keys, which is a separate system.
- Edge Functions read new keys from `SUPABASE_SECRET_KEYS` (JSON). None exist yet here.

**Verify before starting** (the docs don't say): the exact button names on the API Keys page
(they change), and that `auth.admin.*` works with a secret key (it is the documented
replacement for the service_role key in backend code, so expected yes: confirmed in step 4
below by the landlord name sign-in and the cron run, which both use the admin client).

## Where keys live today

| # | Place | Variable(s) | Key | Becomes |
|---|---|---|---|---|
| 1 | Render: landlord service (`apartment-manager-landlord`) | `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | anon JWT, service_role JWT | publishable, secret `render-landlord` |
| 2 | Render: tenant service (`apartment-manager-tenant`) | same two | same | publishable, secret `render-tenant` |
| 3 | `C:\dev\apartment-manager\.env.local` | same two | same | publishable, secret `local-dev` |
| 4 | `C:\dev\apartment-manager-tenant\.env.local` | same two | same | publishable, secret `local-dev` |
| 5 | `C:\dev\qa-landlord\.env.local` (worktree) | same two | same | publishable, secret `local-dev` |
| 6 | `C:\dev\qa-tenant\.env.local` (worktree) | same two | same | publishable, secret `local-dev` |
| 7 | `C:\dev\e2e\.env` | `SUPABASE_SERVICE_ROLE_KEY` (falls back to #3 if empty) | service_role JWT | secret `e2e` |
| 8 | `C:\dev\apartment-mobile\apps\tenant\.env` | `EXPO_PUBLIC_SUPABASE_ANON_KEY` | anon JWT | publishable |
| 9 | `C:\dev\apartment-mobile\apps\landlord\.env` | `EXPO_PUBLIC_SUPABASE_ANON_KEY` | anon JWT | publishable |
| 10 | pg_cron job `hourly-alerts` | header `x-cron-secret` | **no Supabase key**, only `CRON_SECRET` | unchanged (see "CRON_SECRET" below) |
| 11 | GitHub Actions CI (`.github/workflows/ci.yml`, both repos) | dummy values | none real | unchanged |
| 12 | Supabase Edge Function secrets | none yet | — | new functions use `SUPABASE_SECRET_KEYS` |

Not affected: `.env.example` files (placeholders only), Brevo, VAPID, Google OAuth.
Search done with `grep` for `ANON_KEY|SERVICE_ROLE|apikey|Bearer` across `C:\dev` (outside
`node_modules`): the keys are read only in `src/lib/supabase/{client,server,middleware}.ts`
and `src/app/auth/confirm/route.ts` in both web apps, `apps/*/src/lib/supabase.ts` in the
mobile apps, and `e2e/lib/env.ts`. Nothing sends a key on `Authorization` by hand.

Before starting, the owner should also check: Render **Environment Groups** (if the keys
are in a group instead of on the service), any other Render service (e.g. an old cron job
from README option A), and any copy of the keys in password managers / notes, so nothing is
missed.

**Keep the variable names.** `NEXT_PUBLIC_SUPABASE_ANON_KEY` will hold the publishable key
and `SUPABASE_SERVICE_ROLE_KEY` the secret key. No code change, no deploy ordering between
code and config. Renaming them (`..._PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`) is a separate,
later code change in both repos.

## Do the installed library versions accept the new keys?

| Repo | `@supabase/supabase-js` | `@supabase/ssr` |
|---|---|---|
| apartment-manager | 2.108.2 | 0.12.0 |
| apartment-manager-tenant | 2.108.2 | 0.12.0 |
| apartment-mobile (all) | 2.119.2 | — |
| e2e | 2.119.2 | — |

Yes, as far as can be checked without a live test. The libraries treat the key as an opaque
string: `supabase-js` sends it as `apikey` and, when there is no user session, also as
`Authorization: Bearer <key>` (seen in `node_modules/@supabase/supabase-js/dist/index.mjs`,
`fetchWithAuth`). The Supabase API gateway accepts the new keys there for REST, Auth and
Storage; the official examples pass `sb_publishable_...` / `sb_secret_...` straight to
`createClient` / `createServerClient`. These versions are well after the new keys launched
(mid-2025). With a signed-in user the `Authorization` header carries the user's JWT, as
before.

Two things to know:
- **Edge Functions** called with no session would get `Authorization: Bearer
  sb_publishable_...`; that passes `verify_jwt` only via the migration allowance. The
  functions in `docs/mobile-backend-plan.md` always need a signed-in user anyway.
- **Realtime** connections that stay unauthenticated are cut after 24 hours with the new
  keys. Not used signed-out here.

## Order (no downtime)

Each step is safe because both old and new keys work until step 7.

### 1. Create the keys (Supabase dashboard)

1. <https://supabase.com/dashboard> → project → **Project Settings** (gear) → **API Keys**.
2. On the **Publishable and secret API keys** tab: if there is no publishable key yet, click
   **Create new API keys** (this makes a `default` publishable key and a `default` secret
   key). Copy the publishable key (`sb_publishable_...`).
3. Under **Secret keys** click **Add new secret key** and create one per consumer, so each can
   be revoked alone: `render-landlord`, `render-tenant`, `local-dev`, `e2e`. Copy each when
   shown (reveal / copy button). Delete or leave unused the `default` secret key.
4. Do **not** touch the **Legacy API keys** tab yet.

Verify: the page lists one publishable key and four named secret keys; legacy keys still
show as active.

### 2. Update Render (one service at a time, tenant first)

Tenant first because it also runs the hourly job; check it before doing the landlord.

1. <https://dashboard.render.com> → **apartment-manager-tenant** → **Environment**.
2. Edit `NEXT_PUBLIC_SUPABASE_ANON_KEY` → paste the publishable key.
3. Edit `SUPABASE_SERVICE_ROLE_KEY` → paste the `render-tenant` secret key.
4. Click **Save, rebuild, and deploy** (not "Save only"/"Save and deploy" without a
   rebuild: `NEXT_PUBLIC_*` values are compiled into the browser bundle at build time, so a
   restart alone keeps the old anon key in the pages).

While it builds (several minutes on the free plan), the old deploy keeps serving with the old
keys: no downtime.

### 3. Verify the tenant app

- Render → **Events**: deploy is "live"; **Logs**: no `Invalid API key` / 401 errors.
- Open the tenant app in a private window, sign in **with a phone number** (uses the secret
  key via the admin client) and with an email. Rent page loads with real numbers.
- Browser dev tools → Network → any request to `*.supabase.co`: the `apikey` header starts
  with `sb_publishable_`. (Do not screenshot or paste the value anywhere.)
- Open a receipt / photo link (`/api/file`, signed URL through storage).
- Trigger the hourly job by hand (uses the secret key):
  `curl -fsS -H "x-cron-secret: $CRON_SECRET" https://apartment-manager-tenant.onrender.com/api/cron/daily`
  → JSON with `"due"`, no `"error"`. (Outside the send hour it returns `"due": 0`; that still
  proves `due_alerts` ran with the secret key. Don't use `?at=` in the send hour on
  production unless you want real alerts sent.)
- Note: `/api/health` is **not** a valid check: it ignores the Supabase error and returns
  `{ ok: true }` even with a bad key. (Worth fixing in a later code change: check `error`.)

Then repeat step 2 + 3 for **apartment-manager-landlord** with the `render-landlord`
secret key; verify: landlord sign-in **by name** (admin client), Rent and a unit page load,
open a receipt, and (if there is a test tenant) the Reset password dialog reaches Supabase.

### 4. Run the e2e walkthrough against the live apps

Update `C:\dev\e2e\.env` → `SUPABASE_SERVICE_ROLE_KEY=<e2e secret key>` first, then
`npm run test:e2e` (heavy: take the lock, follow the board's PAUSE rule). It uses the secret
key from Node, not from a browser, so the browser 401 rule does not apply. Expect 9/9 and
cleanup + verify PASS, as on 24 Nov.

### 5. Update the local files

`.env.local` in `apartment-manager`, `apartment-manager-tenant`, `qa-landlord`,
`qa-tenant`: anon → publishable, service_role → `local-dev` secret. Mobile `apps/tenant/.env`
and `apps/landlord/.env`: `EXPO_PUBLIC_SUPABASE_ANON_KEY` → publishable. None of these are in
git (checked: only `.env.example` is committed). Restart any dev server that is running.

Mobile: no build has been shipped yet, so there are no installed apps with the old key.
After the first EAS build, a key change means a new build, so do this **before** the first
TestFlight / Play build.

### 6. Wait and watch (a day is enough)

Let at least one hourly job run in the landlord's send hour and check
`select status_code, created from net._http_response order by created desc limit 5;`
(expect 200). Check Render logs of both services once more.

### 7. Deactivate the legacy keys

Supabase → **Project Settings → API Keys → Legacy API keys** tab → deactivate / disable the
JWT-based `anon` and `service_role` keys (confirm the dialog).

Verify straight after:
- Both web apps: sign in, load a page (still works = nothing used the legacy keys).
- A request with the **old** anon key now fails: owner runs, in Git Bash, with the old key
  pasted into a variable (not on the command line history):
  `read -s OLD; curl -s -o /dev/null -w '%{http_code}\n' -H "apikey: $OLD" "https://<project>.supabase.co/rest/v1/units?select=id&limit=1"; unset OLD`
  → expect `401`.

### 8. Afterwards

- The legacy JWT **secret** itself was not exposed (only tokens signed with it), so
  deactivating the keys is enough. Optional, separate: move to **JWT signing keys**
  (Project Settings → JWT Keys → "Migrate JWT secret", then rotate). Users are not signed out.
- Update `.env.example` comments in both repos to say the values are now
  `sb_publishable_...` / `sb_secret_...` (code change, small commit).
- Tick the TODO.md item.

## Rollback

| Situation | Rollback |
|---|---|
| A service breaks after step 2 | Render → Environment → put the old legacy values back → Save, rebuild, and deploy. Or Render → Events → **Rollback** to the previous deploy (it was built with the old values). Old keys still work at this point |
| Something breaks after step 7 | Supabase → API Keys → Legacy API keys → **re-activate**. Reversible per the docs. Then find the missed consumer, switch it, deactivate again |
| A new secret key leaks | Supabase → API Keys → delete that one secret key; create a new one; update only its consumer. The others keep working |

Keep the old legacy values somewhere safe (not in git, not in chat) until step 7 has been
stable for a week; then discard them.

## CRON_SECRET

The pg_cron job holds `CRON_SECRET` in its command (`cron.job`), and Render has it on the
tenant service. If it was ever pasted into a chat, a log, a screenshot or a commit, rotate it
(it lets anyone trigger the alert job, which sends real emails/alerts in the send hour):

1. Generate a new value locally (e.g. `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`)
   and keep it out of the terminal history / chat.
2. Render → apartment-manager-tenant → Environment → `CRON_SECRET` → new value → Save and
   deploy (a server-only variable: no rebuild needed, but a rebuild is harmless).
3. When the deploy is live, in the Supabase SQL editor: `select cron.unschedule('hourly-alerts');`
   then schedule it again with the new value (exact SQL in `supabase/README.md`,
   "Scheduled alerts").
4. Verify: the next run's `net._http_response.status_code` is 200 (401 means the two values
   differ).

The order matters: between steps 2 and 3 any run gets 401. That only matters if the run
that fails is the one in the landlord's send hour (`due_alerts` returns nothing in other
hours), in which case that day's alerts are skipped. So do steps 2–3 together, well away from
the send hour (09:00 Kigali by default).
