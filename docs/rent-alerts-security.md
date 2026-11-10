# Branch `fix/rent-alerts-security`: release notes

This branch exists in both repos (`apartment-management-` for the landlord app and `apartment-manager-tenant`) and covers items 1–25 of the rent, alerts and security work.

**Status:** both apps pass `npx tsc --noEmit`, the Vitest suite (20 tests, run under UTC and other time zones) and `next build`. The 3-year database simulation passes all 3,758 checks. Nothing on this branch has been run against the production database.

**Before applying the migrations:** check which Supabase project the Render apps use (`evzdnnoryffsjpvtacio` or `icmkgfgiwbysxzgiafzl`). Older project notes say 06 was already applied there; that is harmless, because 05–12 can all be run again safely.

## Items 1–25

| # | Item | How it was tested |
|---|---|---|
| 1 | File links (`/api/file`, signed URLs, bare paths) | Builds; the simulation stores bare paths. Not yet tried against real storage. |
| 2 | Admin client uses the service key without cookies | Type-check and build only. |
| 3 | Email leak on login (server-side `signInWithIdentifier`) | Same error whether the account exists or not. Not yet tried against real auth. |
| 4 | Public landlord sign-up removed | Nothing references it any more. |
| 5 | Google sign-in in both apps | Build only; needs Google switched on in Supabase. |
| 6 | Notification links point at tenant-app pages | Code review. |
| 7 | Type error in `unit-add-tenant-dialog.tsx` | Fixed with `'error' in result`. |
| 8 | Landlord Notifications page and bell | Build. |
| 9 | Move-out notices with Acknowledge / Confirm move-out | Build; notices and acknowledging are covered by the simulation. |
| 10 | Rent history (`rent_schedule`, "Effective from month") | Simulation and Vitest: the raise from Nov 2027 leaves earlier months at 350,000. |
| 11 | One rent ledger (`rent_ledger`, `tenant_balance`) | Simulation and Vitest: Bob overdue on 28 Feb and 30 Apr 2027; Chidi 400,000 overdue on 15 Jan 2028. |
| 12 | Partial payments | Simulation: Bob's June top-up; Chidi's rejected receipt resubmitted. |
| 13 | Returning tenants and previous balance | Simulation: Bob's 700,000 previous balance in both views; unit 4 payments filtered by lease. |
| 14 | Turnover month shows both tenants | Simulation and Vitest: Bob and Diane both in Mar 2028. |
| 15 | Kigali time | Vitest: 22:30 UTC on 30 Nov counts as December. |
| 16 | Messages (newest 200, Load older, read badges, `message_reads`) | Simulation: 1,470 messages, newest shown, badges clear. |
| 17 | Broadcast privacy | Simulation: Eric sees nothing sent before 1 Jul 2028. |
| 18 | Move-out keeps the login; separate "Archive tenant" | Simulation: a former tenant sees their history and can pay only the balance. "Archive tenant" is build-only. |
| 19 | Safe "replace tenant" (one transaction) | Simulation: a failed replace changes nothing; tenants cannot call it. |
| 20 | Daily alerts (`/api/cron/daily`) | Simulation: every alert type is sent and a second run sends no duplicates. Brevo email not yet tried. |
| 21 | Web push with an opt-in toggle | Build only; needs VAPID keys. |
| 22 | Pay up to 6 months ahead | Simulation: 6 months accepted, the 7th refused. |
| 23 | Year picker on the Rent page | Build. |
| 24 | "Forgot password" on the landlord login | Build only; needs the Brevo variables on the landlord app. |
| 25 | Works with more than one landlord | Simulation: with a second landlord added, alerts still go to the first. |

All 8 tested attacks fail, and a payment inserted as "confirmed" is saved as `pending_review`. Running every policy with `request.jwt.claims = ''` crashes nothing.

## Decisions

- **Test database:** the simulation runs on a local Postgres 16 (Postgres.app). `02_landlord_seed.sql` is a template with a placeholder id, so the simulation creates the landlord itself.
- **Alert count:** the simulated scenario sends 863 tenant → landlord alerts, and all 863 arrive. The task list mentioned 878; the exact number depends on scenario details such as message volume.
- **Kigali time:** handled with the built-in `Intl` API instead of `date-fns-tz`, so there is no new dependency.
- **"Overdue":** a month counts as overdue from its due date itself. The "day 1" and "day 7" alerts go out 1 and 7 days after the due date.
- **Daily job:** lives in the tenant app (`/api/cron/daily`) because Brevo is already set up there.
- **Server-side sign-in:** Supabase's sign-in rate limit is per IP, and every sign-in now comes from Render's IP. That is fine for a 4-unit building.
- **Next 16:** `middleware.ts` is renamed to `proxy.ts` in both apps, as the deprecation notice asks.
- **Lint:** the remaining ESLint errors in changed files are on lines this branch did not change.

## Migrations, in order (landlord repo, `supabase/`)

05 → 06 → 07 → 08 → 09 → 10 → 11 → 12.

Apply them all, then deploy both apps straight away: the old tenant app's payment form stops working once 10 is applied. After 09, check the rent history of anyone whose rent was already raised. `supabase/README.md` has the SQL for that and the cron setup.

## New environment variables on Render

- **Both apps:**
  - `PUBLIC_APP_URL`: each app's own address.
  - `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`: the same key pair in both apps. Create it with `npx web-push generate-vapid-keys`.
  - `TZ=Africa/Kigali`: optional extra safety.
- **Landlord app:** `BREVO_API_KEY`, `EMAIL_FROM`, `EMAIL_FROM_NAME`.
- **Tenant app:** `CRON_SECRET`. `TENANT_APP_URL` and `LANDLORD_APP_URL` are optional; they default to the live addresses.

## Manual steps

1. Apply 05–12 in the Supabase SQL Editor.
2. Turn on Google under Supabase → Auth → Providers. Under URL Configuration, add `https://apartment-manager-landlord.onrender.com/auth/confirm` and `https://apartment-manager-tenant.onrender.com/auth/confirm`.
3. Turn on leaked-password protection.
4. Set up the daily call to `/api/cron/daily`: either a Render cron job (about $1/month) or the free Supabase pg_cron option in `supabase/README.md`.
5. Push both `fix/rent-alerts-security` branches so Render redeploys.
