# Apartment Manager — what's left

Status on 18 Nov 2026 (branch `fix/rent-alerts-security`, both repos):
40/40 Vitest tests pass, `tsc` clean, 3-year DB simulation written. Lint: 14 errors in
landlord, 2 in tenant. Not merged to `main`, not applied to production.

Work top to bottom. Tick `[x]` when done.

## 1. Go live with what's already built  (mostly done by YOU in dashboards)
- [x] Confirm which Supabase project Render uses: `evzdnnoryffsjpvtacio` (both apps)
- [ ] Back up the production database (Supabase → Database → Backups)
- [ ] Apply migrations 05 → 14 in order (see `supabase/README.md`)
- [ ] Right after: merge `fix/rent-alerts-security` into `main` in BOTH repos so Render redeploys
- [ ] Check rent history of any tenant whose rent was raised before (SQL in `supabase/README.md`)
- [ ] Set env vars on Render: `PUBLIC_APP_URL` (each app's onrender.com address; no Cloudflare any more), VAPID keys (both apps), `CRON_SECRET` (tenant)
- [ ] Supabase Auth: add both `/auth/confirm` URLs (onrender.com addresses), leaked-password protection
- [ ] Set up Brevo email (needed for landlord Forgot password and email alerts): `BREVO_API_KEY`, `EMAIL_FROM`, `EMAIL_FROM_NAME` on the landlord app
- [ ] Google sign-in: create a Google Cloud OAuth client, turn on the Google provider in Supabase Auth
- [ ] Schedule the hourly job (free option: pg_cron in `supabase/README.md`)

## 2. Prove it works on real services  (agent writes a checklist, you tap through it)
These were only build-tested: file links on real storage, server-side sign-in, Google sign-in,
Brevo email, web push, landlord "Forgot password", "Archive tenant".
- [ ] Agent: write `docs/manual-test-checklist.md` — one landlord + one test-tenant walkthrough on a phone
- [ ] Fix whatever the walkthrough breaks

## 3. Clean-up  (agent)
- [ ] Fix the 14 + 2 ESLint errors
- [ ] Landlord repo still has an old copy of the tenant pages under `src/app/tenant/`. Decide: remove
      them and redirect tenants to the tenant app (ask before deleting)
- [ ] Remove or clearly gate demo mode (`NEXT_PUBLIC_DEMO_MODE`, `src/lib/demo-data.ts`)
- [ ] `vercel.json` in both repos is unused (hosting is Render) — remove if confirmed
- [ ] Replace the default create-next-app `README.md` with a real one
- [ ] Add a script that checks the shared `src/lib` files are identical in both repos
- [ ] Add a GitHub Action: `npm ci && npm test && npx tsc --noEmit` on every push

## 3b. Security follow-ups
- [ ] Backend & Security (before mobile work): fix the 2 database functions that signed-out
      visitors can call (`is_landlord()`, `my_unit_id()`: SECURITY DEFINER, executable by `anon`)
- [ ] Consider making both GitHub repos private, but only after checking that Render can
      still deploy from private repos

## 4. New features  (YOU choose — delete what you don't want, add your own)
- [ ] Mobile money payments (MTN MoMo / Airtel Money) instead of uploading receipts
- [ ] PDF receipt for each confirmed payment
- [ ] Monthly report export (income, expenses, arrears) as PDF / Excel
- [ ] Vacant-unit listing + rental applications
- [ ] Kinyarwanda / French language option
- [ ] Several buildings per landlord
