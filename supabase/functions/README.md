# Edge Functions (not deployed)

Server endpoints for the phone apps (and later the web apps), written for
Supabase Edge Functions (Deno, supabase-js v2). **Nothing here is deployed.**
Deploying is the owner's job, after migration 17 is applied (the functions read
`profiles.deleted_at`, `expo_push_tokens` and call `phone_sign_in_lookup()` /
`delete_account()`).

Design and reasons: `docs/mobile-backend-plan.md`, `docs/migration-17.md`.

## The functions

| Function | Who may call | Body | Returns |
|---|---|---|---|
| `add-tenant` | landlord | `{ email, fullName, phone?, unitId, moveInDate, monthlyRent, depositAmount?, leaseEnd? }` | `{ ok, leaseId, tenantId, created, warning? }` |
| `end-tenancy` | landlord | `{ leaseId, moveOutDate }` | `{ ok, warning? }` |
| `replace-tenancy` | landlord | `{ outgoing:{ tenantId, leaseId, unitId, moveOutDate }, incoming:{ …add-tenant fields } }` | as add-tenant |
| `confirm-payment` | landlord | `{ paymentId, note? }` | `{ ok, paymentId, status, warning? }` |
| `reject-payment` | landlord | `{ paymentId, note? }` | same |
| `reset-tenant-password` | landlord | `{ tenantId, mode?: 'email' }` or `{ tenantId, mode:'set', newPassword }` | `{ ok, mode }` |
| `broadcast` | landlord | `{ body }` | `{ ok, messageId, notified, warning? }` |
| `notify` | signed-in user, or the database webhook (`x-webhook-secret`) | `{ userId, type, title, body, link? }` / webhook payload | `{ ok, delivered }` |
| `phone-sign-in` | anyone (no session) | `{ phone, password }` | `{ ok, session }` or one generic 401 |
| `delete-account` | the signed-in tenant, for themselves | `{ confirm:'DELETE', password? }` | `{ ok, mode:'closed', warnings }`. **Blocks the login only** (ban, sign out everywhere, delete push tokens, set `profiles.deleted_at`); every record is kept. Landlord refused |
| `reactivate-tenant` | landlord, for a tenant who has (had) a lease here and closed their account | `{ tenantId }` | `{ ok, tenantId }`: lifts the ban, clears `deleted_at` |

Errors are always `{ error: string, code: string }` with a matching HTTP status
(400 bad_request, 401 unauthorized, 403 forbidden, 404 not_found, 409 conflict,
413, 429 rate_limited, 500 internal, 503 unavailable). `error` is written for
people and can be shown as is.

Typed client wrappers for the phones: `apartment-mobile/packages/shared/src/functions.ts`.

## How every function works

1. CORS preflight, POST only, JSON body ≤ 64 KB (`_shared/http.ts`).
2. Caller from the `Authorization: Bearer <user JWT>` header: `auth.getUser(jwt)`
   (Auth verifies it), role from `public.profiles` read **with the caller's own
   client** (RLS). A role in the body is never trusted (`_shared/context.ts`).
3. Role / ownership decision (`_shared/authz.ts`). Single-building product: the
   landlord role owns every unit and lease (same rule as `is_landlord()`).
4. Input validation (`_shared/validate.ts`).
5. Database writes run **as the caller** (publishable key + user JWT), so RLS,
   `caller_is_admin()` and the guard triggers still apply. The secret-key client
   is used only after step 3 and only for what needs it (`auth.admin.*`,
   other users' push tokens, `phone_sign_in_lookup`, `delete_account`).
6. Logs contain the function name and an error message or code only: never
   bodies, tokens, emails, passwords or keys.

Notification delivery (`_shared/deliver.ts`): Expo push
(`https://exp.host/--/api/v2/push/send`, batches of 100, `DeviceNotRegistered`
deletes the token), web push (VAPID, 404/410 deletes the subscription), and email
through Brevo for `maintenance_updated` when the recipient has
`email_notifications` on (same as the web). Banned (archived) and deleted users
get nothing.

## Layout

```
supabase/functions/
  <name>/index.ts          3 lines: Deno.serve(serveFunction(name, handler))
  _shared/handlers/*.ts    one handler per function (pure, takes a Ctx)
  _shared/*.ts             http, env, validate, authz, messages, expo, email, deliver, context
  _shared/ports.ts         the interfaces handlers use (UserDb, AdminDb, AnonAuth, ...)
  _shared/supabase-ports.ts  those interfaces on top of supabase-js
  _shared/runtime.ts       Deno glue: env, clients, Ctx per request
  _shared/deps.ts          the only npm: imports (supabase-js 2.108.2, web-push 3.6.7)
  _shared/*.test.ts        vitest, mocked ports, no network
  tsconfig.json, types/    Node-side type-check (Deno is not installed here)
```

Checks (from the repo root):

```sh
npx vitest run supabase/functions      # also part of `npm test`
npx tsc -p supabase/functions          # type-check incl. the Deno files via types/deno-shim.d.ts
```

The root `tsconfig.json` and `eslint.config.mjs` skip `supabase/functions` (Deno
code, `.ts` import extensions).

## Secrets (names only)

Set with `npx supabase secrets set NAME=value --project-ref <ref>` or in the
dashboard (Edge Functions → Secrets). Never in the apps, never in git.

| Name | Needed by | Notes |
|---|---|---|
| `SUPABASE_URL` | all | provided by the platform |
| `SUPABASE_PUBLISHABLE_KEYS` / `SUPABASE_SECRET_KEYS` | all | provided by the platform once new API keys exist (JSON `{"default": ...}`). Before that `SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` are used. Optional `PUBLISHABLE_KEY_NAME` / `SECRET_KEY_NAME` pick a named key |
| `PHONE_LOOKUP_PEPPER` | phone-sign-in | **required**: random 32+ bytes; the function refuses to run without it |
| `NOTIFY_WEBHOOK_SECRET` | notify (webhook mode) | random 32+ bytes, also typed into the webhook header |
| `NOTIFY_WEBHOOK_ENABLED` | all that notify | `true` only once the database webhook is set up; then functions stop delivering themselves (no double push) |
| `WEBHOOK_DELIVER_WEB_PUSH` | notify (webhook mode) | `true` only after the web apps stop sending web push in `notify.ts` / the cron route |
| `EXPO_ACCESS_TOKEN` | delivery | optional; required if "enhanced push security" is on in expo.dev |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | delivery | same values as the web apps; without them web push is skipped |
| `BREVO_API_KEY`, `EMAIL_FROM`, `EMAIL_FROM_NAME` | delivery, reset-tenant-password | without them email is skipped / reset by email returns "Email is not set up yet" |
| `TENANT_APP_URL`, `LANDLORD_APP_URL` | email links | default to the Render URLs |

## Deploy (owner, later)

Order: key rotation (`docs/key-rotation-plan.md`) → migration 17 → secrets →
functions.

```sh
npx supabase login
npx supabase secrets set --project-ref <ref> PHONE_LOOKUP_PEPPER=... NOTIFY_WEBHOOK_SECRET=...   # etc.
# --no-verify-jwt: every function checks the caller itself (getUser), and the
# new sb_publishable_ keys are not JWTs, so the gateway check would refuse them.
for f in add-tenant end-tenancy replace-tenancy confirm-payment reject-payment \
         reset-tenant-password broadcast notify phone-sign-in delete-account reactivate-tenant; do
  npx supabase functions deploy "$f" --no-verify-jwt --project-ref <ref>
done
```

Verify after deploying (no real data needed):

- `curl -i -X OPTIONS https://<ref>.supabase.co/functions/v1/add-tenant` → 200 with CORS headers.
- `curl -i -X POST https://<ref>.supabase.co/functions/v1/add-tenant -H "apikey: <publishable>" -d '{}'` → 401 `unauthorized`.
- Same with a **tenant** session JWT → 403. Function logs show no bodies or keys.
- `phone-sign-in` with a made-up number → 401 with the generic text; six quick
  tries on one number → 429.

Optional webhook (owner, dashboard: Database → Webhooks): table `notifications`,
event INSERT, type "Supabase Edge Functions" → `notify`, header
`x-webhook-secret: <NOTIFY_WEBHOOK_SECRET>`. Then set `NOTIFY_WEBHOOK_ENABLED=true`.
