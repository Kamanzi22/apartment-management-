# Apartment Manager — landlord app

You are the dedicated engineer for ONE product: a rental-apartment manager for a
small building in Kigali, Rwanda. Do not generalise, scaffold other apps, or add
frameworks. Stay inside this product.

## The product (two repos, one database)
| App | Repo | Folder |
|---|---|---|
| Landlord (this repo) | github.com/Kamanzi22/apartment-management- | `C:\dev\apartment-manager` |
| Tenant | github.com/Kamanzi22/apartment-manager-tenant | `C:\dev\apartment-manager-tenant` |

Both apps talk to the same Supabase project. **All SQL migrations live only in this
repo, in `supabase/`.** Working branch: `fix/rent-alerts-security` (not merged to
`main` yet).

## Machine
The project now lives in `C:\dev` on a **Windows** laptop (the Lenovo only; no Mac any more).
Shell: **Git Bash**. **8 GB RAM**: ask before starting a dev server, `next build`, Expo or an
emulator, and run one heavy command at a time. iPhone builds go through **EAS cloud builds**
(no Xcode on Windows).

## Stack
- Next.js **16.2.9** (App Router, Server Actions). `middleware.ts` is now `src/proxy.ts`.
  Read `node_modules/next/dist/docs/` before using any Next API you are unsure of.
- React 19, TypeScript, Tailwind 4, shadcn/base-ui components in `src/components/ui`
- Supabase (`@supabase/ssr`): `src/lib/supabase/{client,server,middleware}.ts`;
  types in `src/lib/supabase/database.types.ts`
- Vitest for unit tests (`src/**/*.test.ts`)
- Hosting: Render. Email: Brevo. Web push: VAPID.

## Commands (run all four before saying a task is done)
```sh
npm test            # vitest
npx tsc --noEmit    # type-check
npm run lint        # eslint (0 errors; CI fails on any error)
npm run build       # only for bigger changes; slow on this laptop
bash scripts/check-shared.sh [../apartment-manager-tenant]  # shared src/lib files identical in both repos (also runs in CI)
```
Dev server: `npm run dev` → http://localhost:3000 (ask first, start it only when
needed and stop it afterwards; this laptop has 8 GB RAM).

## Domain rules (don't break these)
- Money is **RWF, whole numbers**. Use `formatRWF` / `parseAmountInput` from `src/lib/currency.ts`.
- Time is **Africa/Kigali**, computed with `Intl` (no date-fns-tz). 22:30 UTC on 30 Nov is December.
- Rent comes from `rent_schedule` + the ledger functions (`rent_ledger`, `tenant_balance`,
  `rent_ledger_many`, `set_unit_rent`). Never compute balances ad hoc in a page.
- Payments from tenants are always `pending_review` until the landlord confirms.
  Partial payments allowed; at most 6 months ahead.
- Only the landlord changes maintenance status. Tenants report and add follow-ups.
- Moving out keeps the tenant's login and history; "Archive tenant" is separate.
- Alerts: `/api/cron/daily` in the tenant app runs hourly and sends only in the landlord's
  send hour; every send is claimed in `sent_alerts` first (no duplicates).
- Security: RLS on every table. A tenant must never read another tenant's data or act as
  the landlord. Never use the service-role key in client code.

## Code shared by both apps (kept as copies)
`src/lib/rent-ledger.ts`, `rent-alerts.ts`, `rent-utils.ts`, `currency.ts`, `categories.ts`,
`public-origin.ts`, `storage-url.ts`, `email.ts`, `push.ts`, `notify.ts`, `maintenance.ts`,
`landlord.ts`, `supabase/database.types.ts`, and their tests.
**If you change one, make the same change in the tenant repo and run tests in both.**

## Database changes
1. New file `supabase/NN_short_name.sql` (next number after the highest one). Make it
   safe to run twice (`create ... if not exists`, `create or replace`, `drop policy if exists`).
2. Add a row to the table in `supabase/README.md`.
3. Update `database.types.ts` in **both** apps.
4. Never run SQL against production. The user applies migrations in the Supabase SQL editor.
5. If the change affects rent/alerts, extend `supabase/tests/three_year_sim.py`.

## How to work
- One task from `TODO.md` at a time: plan in a few lines → implement → test → commit.
- Small commits with plain-English messages (see `git log`). Push only when asked.
- Never commit `.env*` files (only `.env.example`). Never print secrets.
- Ask before: deleting files, changing auth, dropping/renaming columns, adding dependencies.
- When done, tick the item in `TODO.md` and tell the user what to test by hand on their phone.

## Handoff (applies to every agent)
RULE: At the start of every session read C:\dev\HANDOFF.md first. Every agent updates HANDOFF.md (DONE, IN PROGRESS with the exact next step, REMAINING, TEST STATUS, LAST UPDATED) after every finished task, after every commit, at least every 30 minutes while working, and IMMEDIATELY when usage is running low or a limit message appears. Keep it short, accurate and secret-free. Never stop work without updating it first.

USAGE LOW RULE: on any usage warning or limit message, first write your exact next step into HANDOFF.md, commit your work to your feature branch, then stop.
