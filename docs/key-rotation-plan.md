# Key rotation: replace the leaked legacy keys with publishable + secret keys

Goal: the legacy `anon` JWT and `service_role` JWT (both exposed) stop working
everywhere, every client uses Supabase's new keys, and no one notices.

- `sb_publishable_...` replaces the anon key: safe in browsers and phone apps,
  runs as `anon` / `authenticated`, RLS applies.
- `sb_secret_...` replaces the service_role key: server only, bypasses RLS.

Revised 25 Nov 2026 (first version 24 Nov). **Nothing has been changed yet.**
Every step is tagged:

- **[GAUTIER — click]** needs the owner: a dashboard, a password, or a key value.
- **[agent can do]** an agent can do it on a branch (code, docs, local checks
  without secrets). Agents never see or paste key values.

Project: `evzdnnoryffsjpvtacio` (from `e2e/lib/env.ts`; the URL is not secret).

## What the Supabase docs say (checked 24 Nov 2026)

Sources: <https://supabase.com/docs/guides/api/api-keys>,
<https://supabase.com/docs/guides/getting-started/migrating-to-new-api-keys>,
<https://supabase.com/docs/guides/auth/signing-keys>.

- New and legacy keys **work side by side**; creating new keys revokes nothing.
- Legacy API keys stop working when you **deactivate** them (Project Settings →
  API Keys → Legacy). Reversible.
- New keys are **not JWTs**: send them as `apikey`. A secret key sent from a
  browser (matched on `User-Agent`) is refused with 401.
- Rotating API keys does **not** sign anybody out.
- **Important for a leak:** the legacy `service_role` key *is a JWT signed with the
  project's legacy JWT secret*. Deactivating the legacy API keys stops it being
  accepted as an API key, but the only way to be sure it can never be accepted
  as a signed token again is to move Auth to **JWT signing keys** and then
  **revoke the legacy JWT secret** (step 9). Both are in this plan.
- Edge Functions get the new keys as `SUPABASE_PUBLISHABLE_KEYS` /
  `SUPABASE_SECRET_KEYS` (JSON). Our functions already read those first
  (`supabase/functions/_shared/env.ts`) and fall back to the legacy variables.

**Check before starting (docs change):** the exact button names on the API Keys
and JWT Keys pages.

## Every place a key is used (names only; grep across C:\dev, 25 Nov)

Values were never printed; only the kind was checked (legacy JWT = starts with `eyJ`).
All 11 real values found today are legacy JWTs.

| # | Where | Variable | Holds today | Becomes |
|---|---|---|---|---|
| 1 | Render service **apartment-manager-tenant** → Environment | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | anon JWT | publishable |
| 2 | same | `SUPABASE_SERVICE_ROLE_KEY` | service_role JWT | secret `render-tenant` |
| 3 | Render service **apartment-manager-landlord** → Environment | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | anon JWT | publishable |
| 4 | same | `SUPABASE_SERVICE_ROLE_KEY` | service_role JWT | secret `render-landlord` |
| 5 | `C:\dev\apartment-manager\.env.local` | `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | legacy JWT ×2 | publishable, secret `local-dev` |
| 6 | `C:\dev\apartment-manager-tenant\.env.local` | same two | legacy JWT ×2 | same |
| 7 | `C:\dev\qa-landlord\.env.local` (worktree) | same two | legacy JWT ×2 | same |
| 8 | `C:\dev\qa-tenant\.env.local` (worktree) | same two | legacy JWT ×2 | same |
| 9 | `C:\dev\e2e\.env` | `SUPABASE_SERVICE_ROLE_KEY` (falls back to #5) | legacy JWT | secret `e2e` |
| 10 | `C:\dev\e2e\attacks` | reads `NEXT_PUBLIC_SUPABASE_ANON_KEY` (or `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`) and the secret from #5 / #9 | — | follows #5 / #9 |
| 11 | `C:\dev\apartment-mobile\apps\tenant\.env` | `EXPO_PUBLIC_SUPABASE_ANON_KEY` | anon JWT | publishable |
| 12 | `C:\dev\apartment-mobile\apps\landlord\.env` | `EXPO_PUBLIC_SUPABASE_ANON_KEY` | anon JWT | publishable |
| 13 | Supabase **Edge Function secrets** | `SUPABASE_*` provided by the platform; nothing deployed yet | — | platform adds `SUPABASE_PUBLISHABLE_KEYS` / `SUPABASE_SECRET_KEYS` |
| 14 | pg_cron job `hourly-alerts` | header `x-cron-secret` = `CRON_SECRET` | **no Supabase key** | unchanged (see "CRON_SECRET") |
| 15 | GitHub Actions `ci.yml` (all repos) | `dummy-anon-key-for-ci` etc. | no real key | unchanged |
| 16 | Vercel | `vercel.json` exists in both web repos but hosting is Render (TODO.md: "unused") | unknown | check in step 0 |
| 17 | Future EAS builds | `EXPO_PUBLIC_*` are baked into the app bundle | none built yet | publishable, **before** the first build |

Code that reads the keys (no change needed, they are opaque strings):
`src/lib/supabase/{client,server,middleware}.ts` and `src/app/auth/confirm/route.ts`
in both web apps (+ the qa worktrees), `apps/*/src/lib/supabase.ts` and
`packages/shared/src/supabase.ts` in apartment-mobile, `e2e/lib/env.ts`,
`e2e/attacks/lib.ts`. Nothing sends a key on `Authorization` by hand. Not
affected: `.env.example` files (placeholders), Brevo, VAPID, Google OAuth.

**Keep the variable names.** `..._ANON_KEY` will hold the publishable key and
`SUPABASE_SERVICE_ROLE_KEY` the secret key. No code change, no ordering between
code and config. Renaming is a later, separate code change.

Library versions accept the new keys: supabase-js 2.108.2 (web), 2.119.2
(mobile, e2e), @supabase/ssr 0.12.0 — all well after the new keys launched; the
key is sent as `apikey` (and as `Authorization` only when there is no session).

## Order of operations (no downtime)

Old and new keys both work until step 8, so every step before it can be undone
by putting the old value back.

### 0. Inventory check **[GAUTIER — click]**

1. Render → each of the two services → **Environment**: confirm the two
   variables are on the service (if they come from an **Environment Group**,
   edit the group in steps 3/5 instead). Check no other Render service uses
   Supabase (e.g. an old cron job).
2. vercel.com → if a project for this app exists, delete it or note its
   environment variables for step 3 (it would break silently at step 8).
3. Note any other copy of the keys (password manager, notes).

### 1. Create the new keys **[GAUTIER — click]**

1. supabase.com/dashboard → project → **Project Settings** → **API Keys**.
2. Tab **Publishable and secret API keys**: if empty, **Create new API keys**
   (makes a `default` publishable and a `default` secret key).
3. **Add new secret key** once per consumer, so each can be revoked alone:
   `render-tenant`, `render-landlord`, `local-dev`, `e2e`. (Edge Functions use
   the platform-provided `default` secret key.)
4. Do **not** touch the Legacy tab yet.

Verify: one publishable key and the named secret keys are listed; legacy still active.

### 2. Code readiness **[agent can do]**

Done on agent/backend-plan: the Edge Functions read the new keys first; the e2e
attack suite already accepts `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`. Nothing else
needs code. An agent can re-run `npm test` / `tsc` in each repo (no secrets).

### 3. Render, tenant service first **[GAUTIER — click]**

The tenant service also runs the hourly alert job, so do it first.

1. Render → **apartment-manager-tenant** → **Environment**.
2. `NEXT_PUBLIC_SUPABASE_ANON_KEY` → paste the publishable key.
3. `SUPABASE_SERVICE_ROLE_KEY` → paste the `render-tenant` secret key.
4. **Save, rebuild, and deploy** (a rebuild is required: `NEXT_PUBLIC_*` is
   compiled into the browser bundle; a plain restart keeps the old anon key).

The old deploy serves until the new one is live: no downtime.

### 4. Verify the tenant app **[GAUTIER — click]**

- Render → **Events**: deploy live. **Logs**: no `Invalid API key`, no 401.
- Private window: sign in with a **phone number** (uses the secret key) and with
  an email; Rent page shows real numbers; open a receipt link.
- Dev tools → Network → a request to `*.supabase.co`: `apikey` starts with
  `sb_publishable_` (don't screenshot or paste the value).
- Hourly job by hand: `curl -fsS -H "x-cron-secret: $CRON_SECRET" https://apartment-manager-tenant.onrender.com/api/cron/daily`
  → JSON with `"due"` and no `"error"` (outside the send hour `"due": 0`, which
  still proves the secret key works).
- Not a valid check: `/api/health` (it ignores the Supabase error).

### 5. Render, landlord service **[GAUTIER — click]**

Same as step 3 for **apartment-manager-landlord** with the `render-landlord`
secret key. Verify: sign in **by name** (admin client), Rent and a unit page load,
a receipt opens, the Reset password dialog reaches Supabase on a test tenant.

### 6. Local files **[GAUTIER — click]** (pasting) then **[agent can do]** (checking)

Owner pastes, in an editor (not a terminal, not chat):
- `.env.local` in `apartment-manager`, `apartment-manager-tenant`, `qa-landlord`,
  `qa-tenant`: publishable + `local-dev` secret.
- `e2e/.env`: `SUPABASE_SERVICE_ROLE_KEY=` the `e2e` secret.
- `apartment-mobile/apps/tenant/.env` and `apps/landlord/.env`:
  `EXPO_PUBLIC_SUPABASE_ANON_KEY=` publishable.

Agent check afterwards (prints only the kind, never the value):

```sh
cd /c/dev
for f in apartment-manager/.env.local apartment-manager-tenant/.env.local qa-landlord/.env.local \
         qa-tenant/.env.local e2e/.env apartment-mobile/apps/tenant/.env apartment-mobile/apps/landlord/.env; do
  grep -E '^(NEXT_PUBLIC_SUPABASE_ANON_KEY|SUPABASE_SERVICE_ROLE_KEY|EXPO_PUBLIC_SUPABASE_ANON_KEY)=' "$f" |
  while IFS== read -r k v; do case "$v" in eyJ*) t=LEGACY;; sb_publishable_*) t=publishable;; sb_secret_*) t=secret;; *) t=other;; esac; echo "$f $k $t"; done
done
```

Expect no `LEGACY`. None of these files are in git (only `.env.example`).

### 7. End-to-end run **[agent can do]** (heavy lock + PAUSE rule)

`cd /c/dev/e2e && npm run test:e2e` → expect 9/9 and cleanup + verify PASS (the
secret key is used from Node, so the browser rule doesn't apply). Optionally the
attack suite (`cd attacks && npm run attacks`). Then wait about a day so one
hourly run happens in the landlord's send hour; **[GAUTIER — click]** SQL editor:
`select status_code, created from net._http_response order by created desc limit 5;` → 200s.

### 8. Deactivate the legacy API keys **[GAUTIER — click]**

Supabase → **Project Settings → API Keys → Legacy API keys** → deactivate `anon`
and `service_role` → confirm.

Verify straight away:
- both web apps: sign in, load a page; the phone app (Expo Go) signs in.
- the old key is refused (Git Bash; the value goes into a hidden prompt, not the
  command line):
  `read -s OLD; curl -s -o /dev/null -w '%{http_code}\n' -H "apikey: $OLD" "https://evzdnnoryffsjpvtacio.supabase.co/rest/v1/units?select=id&limit=1"; unset OLD`
  → `401`.

### 9. Retire the legacy JWT secret **[GAUTIER — click]** (required because service_role leaked)

1. Project Settings → **JWT Keys** → migrate the legacy JWT secret to **JWT
   signing keys** (creates a new key as standby; the legacy secret stays valid).
2. **Rotate** so the new key signs new user tokens. Nobody is signed out: phones
   and browsers get new tokens at their next refresh.
3. Wait **at least 1 hour** (access-token lifetime) plus margin — easiest: next day.
4. **Revoke** the legacy JWT secret. Every token signed with it — including the
   leaked `service_role` and `anon` JWTs — is now invalid.

Verify: sign in on both web apps and a phone; e2e smoke passes; the old
`service_role` value as a bearer token is refused:
`read -s OLD; read -s PUB; curl -s -o /dev/null -w '%{http_code}\n' -H "apikey: $PUB" -H "Authorization: Bearer $OLD" "https://evzdnnoryffsjpvtacio.supabase.co/rest/v1/units?select=id&limit=1"; unset OLD PUB`
→ `401`.

### 10. Afterwards **[agent can do]**

- Update `.env.example` comments in both web repos and apartment-mobile to say the
  values are `sb_publishable_...` / `sb_secret_...`.
- Later code change (both repos together): rename to
  `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` / `SUPABASE_SECRET_KEY`.
- Tick the TODO.md item. **[GAUTIER]**: delete the stored old values after a week.

## Edge Functions and the new keys

- Deploy with `--no-verify-jwt` (`supabase/functions/README.md`): the gateway's JWT
  check does not understand `sb_publishable_` keys; every function verifies the
  user itself with `auth.getUser(jwt)`.
- None of the function secrets is a Supabase API key: the platform provides those.
- The `notify` webhook uses its own `NOTIFY_WEBHOOK_SECRET`, never a Supabase key
  (the webhook config is stored in the database).

## Rollback

| Situation | What to do | Who |
|---|---|---|
| A Render service misbehaves after step 3/5 | Render → Environment → put the old values back → Save, rebuild, and deploy; or Render → Events → **Rollback** to the previous deploy (built with the old values) | **[GAUTIER — click]** |
| A local tool fails after step 6 | Put the old value back in that one file | **[GAUTIER]** |
| Something breaks after step 8 | API Keys → Legacy → **re-activate** (reversible); find the missed consumer, switch it, deactivate again | **[GAUTIER — click]** |
| Sign-in breaks after step 9.2 | JWT Keys → make the legacy secret current again (possible until it is revoked) | **[GAUTIER — click]** |
| After 9.4 (revoked) | **Not reversible** — that is the point. Only do 9.4 after 9.2 has been fine for a day | — |
| One new secret key leaks | API Keys → delete that one key, create a new one, update only its consumer | **[GAUTIER — click]** |

Keep the old legacy values in a password manager (not git, not chat) until step 9
has been stable for a week; then delete them.

## CRON_SECRET

The pg_cron job keeps `CRON_SECRET` in `cron.job`; Render has it on the tenant
service. If it was ever pasted into a chat, log, screenshot or commit, rotate it:

1. **[GAUTIER]** Generate locally: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` (keep it out of chat).
2. **[GAUTIER — click]** Render → apartment-manager-tenant → Environment → `CRON_SECRET` → Save and deploy.
3. **[GAUTIER — click]** When live, SQL editor: `select cron.unschedule('hourly-alerts');`
   then schedule again with the new value (SQL in `supabase/README.md`, "Scheduled alerts").
4. Verify: next run's `net._http_response.status_code` is 200 (401 = values differ).

Between 2 and 3 runs get 401: do both together, away from the send hour (09:00 Kigali by default).
