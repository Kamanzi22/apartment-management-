# Mobile backend plan

What the two Expo apps (`C:\dev\apartment-mobile`) need from the backend, operation by
operation. Written 24 Nov 2026 from the server actions in both web repos and migrations
01–16. **Update 25 Nov:** the Edge Functions are now written (not deployed) under
`supabase/functions/` with slightly different names: `tenant-admin` became
`add-tenant` / `replace-tenancy` / `reset-tenant-password` (+ `end-tenancy`,
`confirm-payment`, `reject-payment`, `broadcast`), and `deliver-notification` is `notify`.
Migration 17 is final but not applied (`docs/migration-17.md`).

## The rule that decides everything

A phone app is a public client. It ships the **publishable key** (today: the legacy anon
JWT) and the user's own session JWT, nothing else. So every operation falls in one of
three groups:

| Group | When | How the phone calls it | Who checks the caller |
|---|---|---|---|
| **RLS** | Plain insert/update/select on rows the caller may touch | `supabase.from(...)` | RLS policies + the guard triggers (08, 10, 11, 14) |
| **DB function** (SECURITY DEFINER RPC) | Several rows must change together, or the caller needs one narrow privilege RLS can't express | `supabase.rpc(...)` | Inside the function: `caller_is_admin()` / `auth.uid()`; EXECUTE granted to `authenticated` only |
| **Edge Function** | Needs the secret (service-role) key: `auth.admin.*`, sending email (Brevo key), web push (VAPID private key), Expo push (Expo access token), or reading `auth.users` | `supabase.functions.invoke(name, { body })`; supabase-js adds `Authorization: Bearer <user JWT>` | In code: `getUser(jwt)` → `profiles.role`; then a **user-scoped client** for the DB writes, so RLS and `caller_is_admin()` still apply. The admin client is used only for the one call that needs it |

Edge Functions in this plan **never trust a role sent in the body**. They read the user from
the JWT, and they do the database part with a client built from that same JWT, so the
existing functions (`attach_tenant`, `end_tenancy`, `replace_tenancy`) keep doing their own
`caller_is_admin()` check. Defence in depth: if the role check in the function had a bug,
the database would still refuse.

Secrets the Edge Functions need (set with `supabase secrets set`, never in the apps):
`SUPABASE_SECRET_KEYS` / the secret key (provided by the platform), `BREVO_API_KEY`,
`EMAIL_FROM`, `EMAIL_FROM_NAME`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`,
`EXPO_ACCESS_TOKEN` (optional, enables Expo's "enhanced push security"),
`NOTIFY_WEBHOOK_SECRET`, `TENANT_APP_URL`, `LANDLORD_APP_URL`.

With the new API keys (see `docs/key-rotation-plan.md`) the functions that take a user JWT
can keep `verify_jwt = true`; the one called by the database webhook (`deliver-notification`)
must use `verify_jwt = false` and check its own shared secret.

## Summary

| # | Operation | Web source | Kind | Function / table |
|---|---|---|---|---|
| 1 | Add tenant | landlord `actions/admin.ts` `createTenantAccount` | **Edge Function** + existing RPC | `tenant-admin` `{action:'add'}` → `attach_tenant` |
| 2 | End tenancy | landlord `admin.ts` `confirmTenantMoveOut` | **RPC** (exists) + notification row | `end_tenancy` |
| 3 | Replace tenancy | landlord `admin.ts` `replaceTenant` | **Edge Function** + existing RPC | `tenant-admin` `{action:'replace'}` → `replace_tenancy` |
| 4 | Archive tenant | landlord `admin.ts` `archiveTenant` | **Edge Function** | `tenant-admin` `{action:'archive'}` |
| 5 | Confirm / reject payment | landlord `actions/payments.ts` `reviewPayment` | **RLS** update (+ optional RPC later) | `payments` |
| 6 | Submit payment | tenant `actions/payments.ts` `submitPayment` | **RLS** insert + storage | `payments`, bucket `receipts` |
| 7 | Reset password / invite | landlord `admin.ts` `resetTenantPassword`; tenant + landlord `auth.ts` `sendPasswordResetEmail` | **Edge Function** | `tenant-admin` `{action:'send-reset'}`, `password-reset` |
| 8 | Broadcast | landlord `actions/messages.ts` `sendMessage(null, …)` | **RLS** insert; fan-out by the delivery function | `messages` |
| 9 | Messages (direct, mark read) | both `actions/messages.ts` | **RLS** | `messages`, `message_reads` |
| 10 | Maintenance status change | landlord `actions/maintenance.ts` `updateMaintenanceStatus` | **RLS** update (+ RLS insert of the expense) | `maintenance_requests`, `expenses` |
| 11 | Notify (in-app + web push + Expo push + email) | `src/lib/notify.ts`, `push.ts`, `email.ts`, cron route | **RLS** insert of the in-app row, then **Edge Function** via **database webhook** | `notifications` → `deliver-notification` |
| 12 | Account deletion | (none on the web) | **Edge Function** | `delete-account` |
| 13 | Expo push token registration | web twin: `actions/push.ts` `savePushSubscription` | **DB function** (draft 17) + RLS delete | `register_expo_push_token`, `expo_push_tokens` |
| 14 | Phone-number sign-in | tenant `actions/auth.ts` `signInWithIdentifier` / `tenantEmailForPhone` | **Edge Function** + service-role-only DB function (draft 17) | `phone-sign-in` → `phone_sign_in_lookup` |

Also needed but trivial (RLS only, already safe): tenant maintenance request + follow-ups
(`maintenance_requests` / `maintenance_updates` inserts, 14), move-out notice
(`move_out_notices` insert, 08), notifications mark read (`notifications` update, 01),
`profiles.email_notifications` toggle, rent change (`set_unit_rent` RPC, 09), acknowledge
move-out notice (landlord RLS), expenses, alert settings, lease contract upload (landlord
storage + `leases.contract_path`). Files are opened with `storage.createSignedUrl` from the
phone directly (storage RLS decides, same as `/api/file`).

---

## 1. Add tenant

**Web:** `apartment-manager/src/app/actions/admin.ts` → `createTenantAccount`
(`findOrCreateLogin` → `attach_tenant` → `afterAttach`).

**Kind:** Edge Function `tenant-admin`, `action: 'add'`. Needs `auth.admin.listUsers`,
`createUser`, `updateUserById` (un-ban a returning tenant) and `deleteUser` (roll back).

**Input:** `{ action:'add', email, fullName, phone|null, unitId, moveInDate 'YYYY-MM-DD',
monthlyRent int RWF, depositAmount int RWF, leaseEnd|null }`. The phone app parses amounts
with `parseAmountInput` before sending; the function rejects non-integers.

**Output:** `{ ok:true, leaseId, tenantId, created:boolean, warning?:string }` or
`{ error }` (HTTP 400 validation, 403 not landlord, 409 unit occupied / email in use, 500).

**Who / how checked:**
1. `Authorization` JWT → `auth.getUser(jwt)`; no user → 401.
2. `profiles.role = 'landlord'` read with the user-scoped client → else 403.
3. Same validation as `validateAttach` (email has `@`, name, date format, rent > 0,
   lease end ≥ move-in).
4. Admin client: find the login by email, else create it (random password,
   `email_confirm: true`).
5. **User-scoped client**: `rpc('attach_tenant', …)`. The function re-checks
   `caller_is_admin()` (is_landlord) and does profile + lease + unit in one transaction.
6. RPC failed and the login was just created → `auth.admin.deleteUser` (same as web).
7. Returning tenant → `updateUserById(id, { ban_duration: 'none' })`.

**RLS underneath:** `attach_tenant` is SECURITY DEFINER but refuses anyone who is not the
landlord (11); EXECUTE is revoked from `anon`. Tenants cannot change `profiles.role` /
`unit_id` (`profiles_guard`, 08). The admin client never writes `profiles`/`leases` here.

**Failure modes:**
- Unit already has an active lease → RPC error "This unit already has an active tenant" (409).
- Email belongs to the landlord or to a tenant with an active unit → RPC error (409).
- `createUser` fails (bad email, Auth rate limit) → 400/500, nothing written.
- RPC fails after `createUser` → user deleted; if the delete fails too, an orphan login with
  no profile is left (it can't sign in to either app: both refuse a user without a role).
  Log it.
- Un-ban fails → tenant attached but archived login still blocked → returned as `warning`.
- `listUsers` pages through all users (20 × 1000). Fine for one building; a later migration
  can add a service-role-only `auth_user_id_for_email(text)` lookup to replace it.
- Network drop after success → the phone retries → second call gets "unit already has an
  active tenant". The app should refresh the unit before showing an error.

**Note for later:** today the tenant gets a random password and must use "Forgot password".
On the phone, chain action 7 (`send-reset`) after a successful add so the tenant gets a
"set your password" email (needs Brevo set up; see TODO.md).

## 2. End tenancy

**Web:** `admin.ts` → `confirmTenantMoveOut`.

**Kind:** **RPC**, no Edge Function. `end_tenancy(p_lease, p_move_out)` already exists (11),
checks `caller_is_admin()`, and changes lease, profile, unit and move-out notices in one
transaction. The login stays (former tenants keep history and pay what they owe).

**Input:** `{ p_lease uuid, p_move_out 'YYYY-MM-DD' }`. **Output:** void / error.

**Then:** the landlord app inserts the `tenancy_ended` notification row for the tenant
(landlord has full access on `notifications`, 01). Delivery (push/email) happens through #11.

**Who:** landlord only, checked inside the function. Tenants and anon: EXECUTE revoked from
anon; a tenant calling it gets 42501 "Not authorized".

**Failure modes:** lease not found / already ended / move-out before move-in (raised by the
function). Notification insert fails after the RPC succeeded → tenancy still ended, no alert;
show a warning, don't retry the RPC.

## 3. Replace tenancy

**Web:** `admin.ts` → `replaceTenant`.

**Kind:** Edge Function `tenant-admin`, `action: 'replace'` (needs the login of the incoming
tenant, same as #1), then **user-scoped** `rpc('replace_tenancy', …)` which ends the old
lease and attaches the new tenant in one transaction or not at all.

**Input:** `{ action:'replace', outgoing:{ tenantId, leaseId, unitId, moveOutDate },
incoming:{ …same fields as add } }`. **Output:** as #1.

**Checks (on top of #1):** `incoming.unitId === outgoing.unitId`; the incoming login is not
the outgoing tenant; the function itself checks the old lease is on that unit.

**Then:** `tenancy_ended` notification for the outgoing tenant (user-scoped insert).

**Failure modes:** as #1; plus "The outgoing lease is not on this unit" and "already ended".
Because the RPC is all-or-nothing, a failure leaves the old tenancy intact.

## 4. Archive tenant

**Web:** `admin.ts` → `archiveTenant`.

**Kind:** Edge Function `tenant-admin`, `action: 'archive'`. Needs
`auth.admin.updateUserById(id, { ban_duration: '876600h' })` and deleting another user's
push rows (web push **and** Expo tokens), which RLS correctly forbids the landlord.

**Input:** `{ action:'archive', tenantId }`. **Output:** `{ ok:true }` / `{ error }`.

**Checks:** landlord (as #1); target `profiles.role = 'tenant'`, `unit_id is null`, no
active lease (else 409 "Confirm the move-out before archiving this tenant").

**RLS underneath:** the landlord's own client could read the profile and leases; the
deletes from `push_subscriptions` / `expo_push_tokens` must be admin because both are
own-rows-only and the landlord must not get a general delete right on them.

**Failure modes:** ban succeeds, token delete fails → the tenant can't sign in but may still
get pushes. So the delivery function (#11) also skips any user whose `banned_until` is in
the future, and the token deletes are retried on the next archive call (they are idempotent).
Un-archive happens automatically when the same email is added again (#1 step 7).

## 5. Confirm / reject payment

**Web:** landlord `actions/payments.ts` → `reviewPayment`.

**Kind:** **RLS** update from the landlord app:

```ts
supabase.from('payments')
  .update({ status, reviewed_by: uid, reviewed_at: new Date().toISOString(), landlord_notes })
  .eq('id', id).eq('status', 'pending_review')   // phone addition: no double review
  .select('tenant_id, period_month, amount').single()
```

then insert the `payment_reviewed` notification row for the tenant.

**Who:** "payments: landlord full access" (01). A tenant cannot: the guard (10) refuses any
tenant UPDATE ("A submitted payment cannot be changed") and there is no tenant update policy.

**Input/Output:** id, `'confirmed'|'rejected'`, optional note → the updated row.

**Failure modes:** 0 rows (already reviewed on another device / web) → PGRST116 from
`.single()`: show "Already reviewed" and refresh. Notification insert fails → payment still
reviewed; warn.

**Optional later (DB function):** `review_payment(p_id, p_status, p_notes)` that sets
`reviewed_by = auth.uid()` and `reviewed_at = now()` itself and inserts the notification in
the same transaction. Worth doing when the web app moves to shared functions too; not
needed for the MVP.

## 6. Submit payment (pending_review, partial, up to 6 months ahead)

**Web:** tenant `actions/payments.ts` → `submitPayment`.

**Kind:** **RLS** only. The phone:
1. checks the lease is its own (`leases` select, RLS "tenant reads own");
2. uploads the receipt to `receipts/<uid>/<YYYY-MM>-<ms>.<ext>` (storage policy
   "receipts: tenant uploads own" requires the first folder = `auth.uid()`);
3. inserts `{ tenant_id: uid, lease_id, period_month, amount, receipt_file_url: path,
   status: 'pending_review' }`;
4. inserts the `payment_submitted` notification for the landlord
   ("notifications: tenant alerts landlord", 08). Landlord id via the same lookup as
   `getLandlordId` (`profiles` where role = landlord; tenants may read the landlord's
   profile, 09).

**Business rules are in the database, not the app** (`guard_payment_changes`, 10): own lease;
amount > 0; `YYYY-MM`; not before move-in, not after lease end; active lease → at most 6
months after the current Kigali month; ended lease → only months with a balance and no more
than it; status forced to `pending_review`, review fields cleared. Several payments per month
are allowed (partial / top-ups). The phone should still pre-check with the ledger
(`rent_ledger_many` / `rent_upcoming`) to show friendly limits, but never relies on that.

**Failure modes:**
- Upload fails (size, network) → nothing inserted; show error.
- Insert refused by the guard → error message from the trigger (show it as is: the messages
  are written for tenants). The web then calls `storage.remove([path])`, **but there is no
  tenant DELETE policy on `receipts`**, so that cleanup silently does nothing and the file is
  orphaned (web and phone alike). Harmless (private bucket, own folder) but worth a cleanup
  job or a narrow delete policy later ("own file not referenced by any payment").
- Double tap → two pending rows. The phone disables the button while sending; the landlord
  can reject a duplicate.
- Kigali time: the month list comes from `currentPeriodMonth()` in the shared package; the
  guard uses `app_today()` (Kigali) so a phone with a wrong clock can't pay further ahead.

**Payment method (proposal, not applied).** The phone pay form
(`apps/tenant/src/app/(app)/pay/[month].tsx`) asks how the tenant paid: `momo`
(MTN MoMo), `airtel` (Airtel Money), `bank`, `cash`. `payments` has no column for it,
so today the choice is lost. Proposed for a **future** migration (18; no file written,
nothing applied):

```sql
alter table public.payments add column if not exists method text
  check (method is null or method in ('momo', 'airtel', 'bank', 'cash'));
```

Optional (old rows and the web form stay `null`); no RLS change (the tenant insert
policy covers new columns); `guard_payment_changes` needs no change (the method is the
tenant's own statement, like the receipt, and the landlord can correct it). Then update
`database.types.ts` in both web repos + apartment-mobile and show it on the landlord
review sheet. Until then the phone must not send the field (the insert would fail with
"column does not exist").

## 7. Reset tenant password / invite

**Web:** landlord `admin.ts` → `resetTenantPassword` (landlord types a new password);
tenant and landlord `auth.ts` → `sendPasswordResetEmail` (Brevo + `/auth/confirm`).

**Kind:** Edge Function. Two entry points:

- `tenant-admin` `{ action:'send-reset', tenantId }` (landlord only): `generateLink({ type:
  'recovery', email })` with the admin client, then a Brevo email whose button goes to
  `${TENANT_APP_URL}/auth/confirm?token_hash=…&type=recovery&next=/reset-password` (the web
  page the tenant already uses). Doubles as the **invite** after #1.
- `tenant-admin` `{ action:'set-password', tenantId, newPassword }` (landlord only, ≥ 8
  chars): parity with the web. Recommend the phone offers only `send-reset`; a landlord
  typing tenants' passwords is the weaker pattern. Keep `set-password` for when there is no
  email (Brevo not set up yet).
- `password-reset` `{ email }` (signed-out "Forgot password" on either phone app): same as
  the web — always returns `{}` so it can't reveal who has an account; for the landlord app,
  only sends if the profile is a landlord. Needs rate-limiting (Supabase Auth's own limit on
  `generateLink` is per project, not per IP): reuse the attempts-table pattern from 17 keyed
  by hashed email + hashed IP.

**Who:** JWT + landlord role for `tenant-admin`; target must be `role = 'tenant'` (never
let this reset the landlord's own password through a tenant id). `password-reset` is
unauthenticated by design (`verify_jwt` on with the publishable key is fine; it has no user).

**Failure modes:** Brevo not configured → `{ error: 'Email is not set up yet' }` (same text as
web); Brevo 4xx/5xx → "Failed to send"; tenant has a placeholder email → nothing useful sent
(show the email on the confirm sheet so the landlord sees it).

Deep link back into the app (instead of the web reset page) is possible later with an
`apartmenttenant://reset-password` redirect allowed in Supabase Auth; not needed now.

## 8. Broadcasts

**Web:** landlord `actions/messages.ts` → `sendMessage(null, body)`.

**Kind:** **RLS** insert `messages { sender_id: uid, recipient_id: null, body }`
("messages: landlord full access", 01; tenants are blocked from broadcasting by the 08 policy
that requires a landlord recipient).

**Fan-out:** the web inserts one `broadcast` notification per current tenant (`profiles`
role tenant with `unit_id` not null). The phone does the same insert (landlord may insert any
notification). Each row then goes through #11. Tenants only **see** broadcasts sent since
their current lease began (`my_broadcasts_since`, 11).

**Failure modes:** the message is saved but the notification batch insert fails → no alerts;
warn. Large building → one insert of N rows, fine for 4 units.

## 9. Messages

**Web:** tenant `actions/messages.ts` (`sendMessage`, `markMessagesRead`), landlord
`actions/messages.ts` (`sendMessage`, `markMessagesRead`, `loadThreadMessages`).

**Kind:** **RLS** only.
- Tenant send: insert with `recipient_id = landlordId` (policy forces a landlord recipient).
- Landlord send: insert with `recipient_id = tenantId`.
- Mark read: update `read_at` on rows where `recipient_id = uid` (`messages_guard`, 11, lets a
  recipient change only `read_at`); broadcasts: upsert `message_reads` own rows (11).
- Threads: select, paged by `created_at` (`messages_pair_idx`). Realtime subscription on
  `messages` is allowed by the same RLS.
- Notification row: `new_message` for the recipient; delivered by #11.

**Failure modes:** empty body (app check), RLS refusal (tenant → tenant) returns 42501.

## 10. Maintenance status changes

**Web:** landlord `actions/maintenance.ts` → `updateMaintenanceStatus`.

**Kind:** **RLS** update of `maintenance_requests { status, landlord_comment, scheduled_for }`
by the landlord. `guard_maintenance_changes` (14) refuses any non-landlord update/delete;
`record_maintenance_status` writes `maintenance_status_history`. Allowed transitions and
required fields come from `validateStatusChange` in `src/lib/maintenance.ts`: copy it into
`@apartment/shared` so web and phone use the same rules.

Optional repair cost → RLS insert into `expenses` (landlord). Then the `maintenance_updated`
notification row for the tenant.

**Email:** the web emails the tenant here if `email_notifications` is on. On the phone this
moves into #11: the delivery function emails `maintenance_updated` notifications when the
recipient has `email_notifications = true`. So the phone does not need the admin client.

**Failure modes:** invalid transition / missing date (app + shared validator; the DB only
enforces the status list); status saved but expense insert fails → warn (web ignores it).
Two-step write is not atomic; acceptable now. If it matters: a later
`set_maintenance_status(...)` RPC can do both in one transaction.

## 11. Notify: in-app + web push + Expo push + email

**Web today:** `notify()` inserts `notifications` rows, then `after()` sends web push with the
admin client; maintenance status also emails; the cron route inserts rows and pushes itself.

**The problem for the phones:** they can insert the in-app row (RLS allows it, as above), but
sending push/email needs secrets.

**Recommended design: a database webhook on `notifications` INSERT** →
Edge Function `deliver-notification`.

```
any client (web, phone, cron)          Postgres                         Edge Function
insert into notifications  ───────►  AFTER INSERT webhook  ──pg_net──►  deliver-notification
                                     (header x-webhook-secret)          · load recipient (admin)
                                                                        · skip if banned / deleted
                                                                        · Expo push → expo_push_tokens
                                                                        · web push → push_subscriptions
                                                                        · email if type in EMAIL_TYPES
                                                                          and email_notifications
```

Why this over "the phone calls a notify function":
- A notify function that takes `{ user_id, title, body }` from a client is a spam relay
  (any tenant could push any text to any tenant). Making it safe means re-deriving every
  notification server-side, i.e. moving all business logic into Edge Functions.
- With the webhook, **who may create which notification is already decided by RLS**
  (tenants can only notify the landlord, 08; the landlord anyone). The function only
  delivers rows that exist. No new attack surface.
- Every writer gets push for free, including the web apps and the cron job.

**Inputs:** the webhook payload `{ type:'INSERT', table:'notifications', record:{…} }`.
**Checks:** constant-time compare of `x-webhook-secret` with `NOTIFY_WEBHOOK_SECRET`;
`verify_jwt = false` for this function only. Use a dedicated secret, **not** the secret API
key, because it is stored in the database (webhook config), like `CRON_SECRET` in pg_cron.

**Sending:**
- Expo: `POST https://exp.host/--/api/v2/push/send` in batches of ≤ 100, body
  `{ to, title, body, data:{ url: link, type }, sound:'default' }`. On ticket error
  `DeviceNotRegistered` → delete that token. (Receipts check can come later.)
- Web push: same as `src/lib/push.ts` (`web-push` works in Deno via `npm:web-push`; verify,
  else use a small VAPID implementation). 404/410 → delete subscription.
- Email: types `maintenance_updated` (and whatever is added later) when
  `profiles.email_notifications` is true. Same layout as `emailLayout`.
- Links: web paths (`/landlord/rent`, `/maintenance`) are stored today. The phone maps them
  to its routes in `data.url` handling; no schema change needed.

**Cut-over (avoid double pushes):** when the webhook is live, remove the `after(sendPush)`
from `notify.ts` and the `sendPush` in the cron route's in-app branch, in both repos at the
same deploy. Until then, the webhook can skip web push (flag `DELIVER_WEB_PUSH=false`) and
only do Expo, so phones work without touching the web.

**Failure modes:** pg_net is fire-and-forget: if the function is down, the in-app row still
exists (the source of truth) but no push. Acceptable; optionally add
`notifications.delivered_at` and a sweep in the hourly cron. Edge cold start ≈ 1 s. Expo or
Brevo outage → logged, not retried. A tenant can still flood the landlord with
self-written notifications (true today on the web): add a per-user rate limit in the
delivery function if it is ever abused.

**Webhook setup (owner, dashboard):** Database → Webhooks → Create: table `notifications`,
event Insert, type Supabase Edge Function `deliver-notification`, header
`x-webhook-secret: <value>`. Not in a migration because it holds a secret (same reason as the
cron job in README.md).

## 12. Account deletion (App Store requirement)

Apple (guideline 5.1.1(v)) requires that an app which lets people sign in also lets them
**start deleting their account from inside the app**. Retaining records required for legal /
financial reasons is allowed if the app says so.

**The trap:** `profiles` → `auth.users on delete cascade`, and `leases`, `payments`,
`messages`, `maintenance_requests`, `move_out_notices` all reference `profiles … on delete
cascade`. A hard `auth.admin.deleteUser(tenant)` **wipes the landlord's rent history** for
that unit (payments, ledgers, financials). So never hard-delete a tenant who has any lease.

**Kind:** Edge Function `delete-account` (needs `auth.admin`). Called by the signed-in user
for **themselves only** (id from the JWT, never from the body). Requires re-entering the
password (sign in again server-side, like `updateLandlordPassword`) so a stolen unlocked
phone can't do it in one tap.

**Tenant with no lease ever** (e.g. self-registered, never attached): hard delete
(`auth.admin.deleteUser`), everything cascades. Also remove their storage files.

**Tenant with lease history:** anonymise and disable, keep the financial records:
1. `ban_duration: '876600h'` (as archive), sign out all sessions.
2. Auth email → `deleted+<uuid>@invalid.example`, random password, clear phone/metadata.
3. `profiles`: `full_name = 'Former tenant (deleted)'`, `phone = null`,
   `email_notifications = false`. (Needs the admin client: `profiles_guard` would allow it,
   but name changes by a tenant are fine anyway.)
4. Delete `expo_push_tokens`, `push_subscriptions`, `notifications`, `message_reads`.
5. **Kept:** leases, payments + receipt files, maintenance requests and history,
   move-out notices, and messages (the landlord's side of the conversation; the body is the
   tenant's words, so optionally replace tenant-sent message bodies with "(deleted)").
   The app explains this before confirming: "Your rent and payment records stay with your
   landlord for their accounts."
6. If the lease is still **active**: the deletion still goes ahead (Apple does not accept
   "ask your landlord first"), and a `tenant_deleted_account` notification goes to the
   landlord, who then ends the tenancy as usual.

**Landlord account:** deleting it would orphan the whole building. The landlord app shows a
"Delete my account" screen that explains this and sends a request (email to the owner /
support address) instead of deleting automatically. Apple allows a request flow when
deletion needs manual steps; confirm wording before submission. (Single-landlord product:
the landlord is the owner, so in practice this is a documented manual procedure.)

**Failure modes:** partial anonymisation (one step fails) → run steps idempotently and report
which failed; the ban goes first so the account is unusable even if later steps fail.

Open question for the owner: how long to keep a deleted tenant's records (Rwandan tax / data
protection rules). The plan keeps them indefinitely like any former tenant.

## 13. Expo push token registration

**Kind:** **DB function** `register_expo_push_token(p_token, p_platform)` (draft 17),
SECURITY DEFINER, EXECUTE for `authenticated` only. Plain RLS delete for sign-out.

**Why not plain RLS upsert:** the token is unique per device. If another account used the
phone before, that user's row holds the token and RLS hides it, so the insert hits the unique
index and fails. The function moves the token to the caller (like `savePushSubscription`
does for web push with the admin client), and refreshes `last_seen_at`.

**Phone flow:** after sign-in and on every app start: `Notifications.getExpoPushTokenAsync
({ projectId })` → `rpc('register_expo_push_token', { p_token, p_platform })`. On sign out:
`from('expo_push_tokens').delete().eq('token', token)` **before** `auth.signOut()` (needs the
session). Permission denied → don't register; the Alerts tab shows a "Turn on notifications"
row.

**RLS:** select / insert / delete own rows only; no UPDATE grant; no landlord policy (the
landlord can't read tenants' tokens); `anon` has no privileges at all. The delivery function
reads tokens with the secret key.

**Failure modes:** invalid token format → 22023; not signed in → 42501; profile missing →
42501. Stale tokens are removed by the delivery function on `DeviceNotRegistered`; tokens not
seen for 90 days can be swept by the hourly cron later.

## 14. Phone-number sign-in

**Web:** tenant `actions/auth.ts` → `signInWithIdentifier` + `tenantEmailForPhone`
(digits only, ≥ 6, exactly one tenant whose `phone` digits are equal, email from
`auth.admin.getUserById`). The email never reaches the browser.

**Kind:** Edge Function `phone-sign-in` + `phone_sign_in_lookup(p_phone, p_client_key)`
(draft 17), EXECUTE for `service_role` only.

**Choice and why:** the option "SECURITY DEFINER function callable by authenticated/anon"
is out: whoever can call it learns that a number exists and whose email it is. Returning
the email to the phone is the same leak. So the phone sends `{ phone, password }` to the Edge
Function and gets back **only a session or one generic error**:

1. Normalise nothing in the app; send what was typed.
2. Function: `client_key = sha256(client IP + pepper)`; call `phone_sign_in_lookup` with the
   admin client → `{ email, limited }`.
3. `limited` → 429 "Too many attempts. Try again in a few minutes." (counted whether or not
   the number exists, so it reveals nothing).
4. `email` null → still call `signInWithPassword` with a fixed dummy address (keeps the
   timing similar), then return 401 with exactly the web's text: "Invalid credentials. Check
   your email/phone and password."
5. Else `signInWithPassword({ email, password })` with a **publishable-key** client (not the
   admin client) → on success return `{ access_token, refresh_token, expires_at }`; the phone
   calls `supabase.auth.setSession(...)`. Then the phone's role guard runs as today.
6. Auth 5xx → 503 "Could not reach the server…" (web text).

The session JWT does contain the user's email claim, but only after the correct password,
i.e. to the account owner.

**Rate limiting:** the lookup allows 5 tries per number per 15 minutes and 30 per client key
per hour, stored in `phone_login_attempts` (service-role only, pruned after a day).
Supabase Auth's own password sign-in limit is per IP, and here every request comes from the
Edge Function's IP, so Auth's limit alone would lock out everyone together. That is why the
function keeps its own counts. Email sign-in on the phone keeps calling Auth directly.

**Same digits rule as the web, on purpose:** `+250 788 …` and `0788 …` are different
numbers on both. Normalising to E.164 is a good later change, but it must change in the web
and the SQL at the same time.

---

## Recommended build order

1. **Migration 17** (after review + `tests/17_checks.sql` on a throwaway DB): push tokens and
   phone lookup tables exist; nothing uses them yet, so applying it is safe.
2. **RLS-only screens** (no backend work): submit payment, review payment, messages,
   broadcasts, maintenance (report, follow-up, landlord status), end tenancy RPC, mark read.
   Each also inserts its notification row. In-app alerts work immediately.
3. **Key rotation** (`docs/key-rotation-plan.md`) before any Edge Function goes live, so
   new functions are written against the new keys from day one.
4. **`deliver-notification` + webhook**, Expo push only first (`DELIVER_WEB_PUSH=false`).
   Phone registers tokens (step 13). Then cut web push over to it and remove `sendPush`
   from `notify.ts` / cron in both repos in one deploy.
5. **`phone-sign-in`**. Small, isolated, unblocks the third REQUEST-LEAD.
6. **`tenant-admin`** (add, replace, archive, send-reset, set-password) for the landlord app.
7. **`delete-account`** before the first App Store submission (review will check it).
8. **`password-reset`** (signed-out Forgot password) once Brevo is set up.

## Sharing the Edge Functions with the web apps later

- The web server actions can call the same functions with the user's session:
  `supabase.functions.invoke('tenant-admin', { body })` from a server action already has
  the cookie session. Then `SUPABASE_SERVICE_ROLE_KEY` can be **removed from the landlord
  web app** for add/replace/archive/reset, leaving fewer places that hold the secret key.
- `deliver-notification` already serves the web once the cut-over in step 4 is done.
  Afterwards `push.ts` and the VAPID private key exist only in the Edge Function.
- The cron route (`/api/cron/daily`) could move to an Edge Function `hourly-alerts` called by
  pg_cron, so the free Render instance no longer needs waking every hour. Bigger change;
  only once the rest is stable.
- Shared rules stay in SQL (guards, RPCs) so every client gets them. Copy the pure helpers
  the functions need (`validateStatusChange`, `emailLayout`, `formatRWF`) into one
  `supabase/functions/_shared/` folder in this repo; the "kept identical" check in
  `scripts/check-shared.sh` can include it.
- Edge Function source lives in this repo under `supabase/functions/` (migrations already
  live here), deployed with `npx supabase functions deploy <name>` by the owner.
