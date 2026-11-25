# HANDOFF: Apartment Manager

> RULE: At the start of every session read C:\dev\HANDOFF.md first. Every agent updates HANDOFF.md (DONE, IN PROGRESS with the exact next step, REMAINING, TEST STATUS, LAST UPDATED) after every finished task, after every commit, at least every 30 minutes while working, and IMMEDIATELY when usage is running low or a limit message appears. Keep it short, accurate and secret-free. Never stop work without updating it first.
>
> USAGE LOW RULE: if you see a usage warning or a limit message, do these three things in order: write your exact next step under IN PROGRESS, commit your work to your feature branch, then stop.

## LAST UPDATED
2026-11-25 15:20 SAST by lead (Claude Code, Sonnet), resumed after Codex.

---

## PROJECT
- **What it is:** Apartment Manager runs one small rental building in Kigali, Rwanda. Money is in RWF, as whole numbers. Time is Africa/Kigali.
- **Owner:** Kamanzi (also called Gautier in older notes). GitHub user: Kamanzi22.
- **Four apps, one Supabase database:**
  - **Landlord web:** units, tenants, rent review (confirm or reject), arrears, repairs, financials, building costs, messages and broadcasts, alert settings, move-out notices.
  - **Tenant web:** rent status, pay by uploading a receipt photo, history, lease, repairs, messages, notifications, move-out.
  - **Tenant phone app (Expo):** the same features as tenant web.
  - **Landlord phone app (Expo):** the same features as landlord web.
- **Goal:** all four apps finished, tested and working by **Wed 2 Dec 2026**. After that, only store publishing is left.

## ARCHITECTURE
- **Landlord web:** Next.js 16 App Router with Server Actions, React 19, Tailwind 4. Hosted on Render. Repo `apartment-manager`. **All SQL migrations live only here, in `supabase/`.**
- **Tenant web:** the same stack, also on Render. Repo `apartment-manager-tenant`. Some `src/lib` files are kept as identical copies in both web repos; `scripts/check-shared.sh` checks that they match.
- **Database:** Supabase project `evzdnnoryffsjpvtacio`: Postgres with RLS on every table, Auth (email and phone), and Storage buckets `receipts`, `maintenance-photos` and `lease-contracts`.
  - The web apps use `@supabase/ssr` with the anon key. Some server actions also use the service-role key on the server only.
  - **The phone apps use only the anon/publishable key.** Anything privileged goes through Edge Functions.
- **Edge Functions:** in `backend-plan/supabase/functions/` (Deno), **not deployed**: add-tenant, end-tenancy, replace-tenancy, confirm-payment, reject-payment, reset-tenant-password, broadcast, notify (in-app + Expo push + web push + email), phone-sign-in, delete-account (closes the account, ban only), reactivate-tenant.
  - Each function checks the caller's JWT and role, then their ownership, before it uses the service key.
  - The testable logic is in `_shared/`.
- **Phone apps:** `apartment-mobile` is an npm-workspaces repo with `apps/tenant`, `apps/landlord`, `packages/shared` and `packages/ui`.
  - Stack: Expo SDK 58, expo-router, React Native 0.88. The session is stored in SecureStore and sign-in uses PKCE.
  - `packages/shared` holds the client, RWF and Kigali date helpers, rent helpers, `tenant-api.ts`, `functions.ts` (typed Edge Function wrappers) and `push.ts`.
- **Alerts:** pg_cron runs every hour and calls the tenant app's `/api/cron/daily` through pg_net.
  - It sends only during the landlord's chosen send hour.
  - Each send is first claimed in `sent_alerts`, so nothing is sent twice.
  - Email goes through Brevo (not set up yet); web push uses VAPID.

## WHERE EVERYTHING IS (all in C:\dev)
| Path | Type | Branch | Last commit | Uncommitted | On GitHub? |
|---|---|---|---|---|---|
| `apartment-manager` | landlord web repo | `fix/rent-alerts-security` | ee6ab7e (25 Nov) | none | yes, Kamanzi22/apartment-management- (branch pushed, not merged) |
| `backend-plan` | worktree of apartment-manager | `agent/backend-plan` | 666e842 (25 Nov) | `supabase/tests/19_checks.sql` (Codex's migration-19e checks, kept on purpose) | yes, pushed |
| `qa-landlord` | worktree of apartment-manager | `agent/qa` | 30ab738 (F8 fix, 25 Nov) | none | yes, pushed |
| `apartment-manager-tenant` | tenant web repo | `fix/rent-alerts-security` | c479f62 (25 Nov) | none | yes, Kamanzi22/apartment-manager-tenant (pushed, not merged) |
| `qa-tenant` | worktree of tenant repo | `agent/qa` | 52dcc23 | none | yes |
| `apartment-mobile` | phone apps repo | `overnight` (also `round2`, `main`) | ccdf439 (25 Nov) | none | **NO: only on this laptop, no remote** |
| `e2e` | Playwright + attack tests | `flows` (also `master`) | acfbd0e (25 Nov) | none | **NO: only on this laptop** |
| `e2e-attacks` | worktree of e2e for the DB attack + contract tests | `attacks` | 1c8e659 (25 Nov) | none | **NO: only on this laptop** |
| `backups/` | DB backups (2026-11-23, rollback-16.sql) | n/a | n/a | n/a | **NO: only on this laptop** |
| `C:\dev` root | HANDOFF.md, RESUME-PROMPT.txt, CLAUDE.md, AGENTS-BOARD.md (agent log), MORNING-REPORT.md, STATUS-FOR-CLAUDE.md (24 Nov survey, older) | `handoff` (local repo that tracks only the handoff files) | see HANDOFF-LOG | n/a | branch `handoff` pushed to the landlord repo |

**Not merged to main:**
- landlord repo: `fix/rent-alerts-security`, `agent/backend-plan`, `agent/qa`
- tenant repo: nothing new (its `main` already contains everything)
- mobile: `overnight`, which is about 40 commits ahead of `main`

## DECISIONS MADE (by Kamanzi)
- **Before 23 Nov:**
  - All migrations live in the landlord repo, and Kamanzi applies them himself (now through Claude chat after his approval).
  - Hosting is on Render (Vercel is not used).
- **23 Nov:** iPhone builds go through EAS cloud builds, because there is no Xcode on Windows.
- **24 Nov, overnight rules:**
  - no production writes except the tester's own test data, which is cleaned up afterwards
  - no merges to main, no deploys, no applied migrations
  - only one heavy command at a time (8 GB RAM)
- **25 Nov, account deletion = block login only:**
  - Ban the login, end all sessions, remove push tokens, set `profiles.deleted_at`.
  - Keep **all** data: name, phone, email, photos, payments, receipts, repairs, messages.
  - The landlord sees the tenant as "Former tenant (account closed)" and can reactivate the account from the web.
  - The store drafts must not promise erasure.
  - Revisit this before store submission, because Apple 5.1.1(v) and Rwanda Law 058/2021 may require erasure.
- **25 Nov, payment method:** a `payments.method` column with the values momo, bank or cash. It is nullable and lives in migration 17. Airtel was dropped.
- **25 Nov, alert settings:** migration 18 lets only the landlord read them. Kamanzi has already applied it.
- **25 Nov, phone testing:** use Expo Go on Kamanzi's phone, started with `npx expo start --tunnel`. Only Kamanzi, or an agent with his go-ahead, starts it. EAS comes later.
- **25 Nov, agents:** use **Sonnet** for sub-agents (the `model: sonnet` setting).
- **25 Nov, usage-saving rules:**
  - short logs and answers
  - don't re-read whole repos (use targeted greps)
  - one heavy command at a time
  - the landlord phone app waits until the new weekly limit on Mon 30 Nov

## RULES
- **Product rules** (from `apartment-manager/CLAUDE.md`):
  - **Money:** RWF, whole numbers. Use `formatRWF` / `parseAmountInput`.
  - **Time:** Kigali time through `Intl`. 22:30 UTC on 30 Nov already counts as December.
  - **Balances:** always from `rent_schedule` and the ledger functions (`rent_ledger`, `tenant_balance`, `rent_ledger_many`, `set_unit_rent`), never computed ad hoc.
  - **Tenant payments:** always start as `pending_review` until the landlord confirms. Partial payments are allowed, up to 6 months ahead.
  - **Repairs:** only the landlord changes their status. Tenants report and add follow-ups.
  - **Moving out:** keeps the tenant's login and history. Archiving is a separate action.
  - **Security:** RLS on every table. A tenant never sees another tenant's data or acts as the landlord. The service key is never used in client or phone code.
  - **Shared lib files:** a change to one copy is made in both web repos, and the tests run in both.
  - **Before saying a task is done:** run `npm test`, `npx tsc --noEmit` and `npm run lint` (0 errors).
- **Safety rules:**
  - No production changes, no merges to main, no deploys, no applied migrations.
  - No deleting real data without Kamanzi's approval.
  - **Never put secrets in files, commits or chat.** Read `.env` variable names only.
  - Commit in small steps on feature branches. Plain-English commit messages.
  - 8 GB RAM, so only one heavy command at a time. Take the lock first: `until mkdir /c/dev/.heavy-lock 2>/dev/null; do sleep 15; done`. Write a `HEAVY:` line on `AGENTS-BOARD.md`, run the command, then `rmdir` the lock. Do nothing heavy while `/c/dev/.pause` exists.
  - In `apartment-mobile`, commit with a pathspec (`git commit -m ... -- <paths>`), because several agents share that checkout.
  - If the same thing fails 3 times, write it on the board and move on.
  - Never run an emulator or Docker. `expo start` needs Kamanzi's go.

## DONE
- **23 Nov:**
  - Lint fixed and CI set up in both web repos (`agent/qa`, merged).
  - Migration 16 applied, with a backup in `backups/2026-11-23`.
  - E2E Playwright suite built (5469c8f).
  - Mobile monorepo scaffolded.
- **24 Nov:**
  - Live e2e 9/9 pass after deploy.
  - Repair status label fix (b434d1f, on main).
  - Mobile round 2: shared rent helpers, the ui package, tenant screens on sample data, and QA's security fixes (round2, ca04ce1).
  - Backend plan, key-rotation plan and migration 17 draft (e1e4065).
- **24–25 Nov overnight:**
  - **Mobile:** every tenant and landlord screen on sample data (ed1bd4e … 29eff7c), plus testIDs (7d45e54).
  - **Backend:** the Edge Functions (de5ce0b), migration 17 (c9580ef), and the key-rotation steps marked by owner (89dcaac).
  - **QA:**
    - attack run, 128 of 130 blocked (05e58b0)
    - Maestro flows (388991f, 4f449ac)
    - fixes: 2611de4 (upload paths), ce0cd4f (delete-account retry), 1b7477f (accessibility contrast)
  - **Release:** store drafts (1bf2e16, 4cb8ee9, 9139215).
- **25 Nov:**
  - **Account closing = block login only:**
    - mobile 67b7d36 (store drafts) and fe6f5e9 (app text, "Former tenant" in landlord sample data)
    - backend 543fcb9 (delete-account and reactivate-tenant), 6a9db3c (landlord web: closed tenants plus Reactivate), d0d41bb (docs and the store-prep to-do)
  - **Migration 18 file** saved to match production (e46c91e).
  - **Migration 17 final** (11c1579, 3a6118e):
    - push tokens
    - phone sign-in lookup that only the server can call
    - ban-only closing with `reactivate_account`
    - write policies that block closed accounts
    - `payments.method`
    - `tenant_rent_policy()`
  - **Edge Functions:** payment method shown in the landlord's review, plus Expo push receipts. Migration 19 draft for the advisor leftovers (166dbc6).
  - **Mobile:** push helper `push.ts` (e3688d3).
  - **Tenant phone app on live Supabase:** every screen, with receipt and repair photo uploads, move-out, Delete account and all testIDs (4e6f520..66781b2). The payment method is switched off by the setting `PAYMENTS_HAVE_METHOD=false` until 17 is applied.
  - **QA:** attack rerun, **130 of 130 blocked** (ab7e0a5). Playwright feature flows ran 4 times; see TEST STATUS.

## IN PROGRESS
<!-- mobile DONE 25 Nov: Open contract (3dbfb00, flag CONTRACT_READ_ENABLED), push + phone sign-in behind flags (b8c7331), a11y text cap 2.0 + field border (1f08913) -->
| Agent | Task | Branch / files | Exact next step |
|---|---|---|---|
| qa | idle. Contract diagnostic done (1c8e659): migration 19 is correct, the earlier failure was a cached copy. F8 smoke passed. | `e2e-attacks` `attacks`; `qa-landlord` `agent/qa` (30ab738) | Next: once Kamanzi merges the F8 fix and Render redeploys, remove `test.fixme` on F8 in `e2e/tests/flows.spec.ts` and rerun the flows (1 live run). After Edge Functions deploy: run `contract`+function smoke tests. |
| mobile | idle. Payment method and own-contract access are enabled; tenant screens are on live data; phone sign-in and push stay behind flags. | `overnight` (ccdf439) | After Kamanzi approves Expo Go: verify payment method and contract on the phone. From Mon 30 Nov: landlord phone app on live data. |
| backend | idle. Migrations 17–19 saved and verified in production; types synced; phone-sign-in now enforces only the per-number limit (666e842). | `agent/backend-plan` (pushed); landlord/tenant fix branches | Keep Edge Functions undeployed until Kamanzi approves. Do NOT delete the uncommitted `supabase/tests/19_checks.sql` edit in `backend-plan`. Before launch: confirm with Supabase that the Edge gateway overwrites the forwarded IP header (TODO in `phone-sign-in.ts`). |
| release | done | `overnight` `store/` | Nothing until Kamanzi fills the placeholders. |

## REMAINING (in order; owner, estimated hours)
1. Kamanzi rotates the keys; the agent does its own steps and re-checks both web apps (backend, 2 h, needs Kamanzi).
2. Migrations 17–19 are applied; finish schema-derived type sync in both web repos and mobile, then typecheck. Full remote CLI generation needs Kamanzi Supabase CLI login and DB password.
3. Deploy the Edge Functions with their secrets, then run a live smoke test of each function with test users (backend + qa, 3 h, needs approval).
4. Tenant phone: phone sign-in, push registration, and first Expo Go run with a test tenant (mobile, 4 h; needs Kamanzi phone). Open contract and payment method wiring are enabled.
5. Run the Maestro flows on Kamanzi's phone, fix what they find, and do the accessibility device checklist (qa + mobile, 4 h).
6. Accessibility MEDIUM fixes (text scale cap 2.0, field border) are done (1f08913); still to verify on a device at 200% text (qa + mobile, with item 5).
7. Phone-sign-in: only the per-number limit is enforced (decision 25 Nov); confirm the Edge gateway IP header is unspoofable before launch, then optionally enforce the per-client limit (backend, 0.5 h).
8. Web Playwright: 14 of 15 flows pass on Render; F8 (Add Expense) needs the fix merged and deployed, then un-skip and rerun (qa, 0.5 h, needs Kamanzi's merge approval).
9. Web clean-up after Kamanzi decides: the old `src/app/tenant/` pages in the landlord repo, demo mode, removing the register form for invite-only sign-up, `vercel.json`, the README (qa, 3 h).
10. Brevo email (reset password and email alerts) once Kamanzi gives the key; Google sign-in (optional) (backend, 1 h).
11. Migration 19 applied and verified (25 Nov).
12. Landlord phone app on live data, from Mon 30 Nov: units, add tenant, rent confirm/reject, repairs, financials, building costs, messages, notifications, alert settings, profile (mobile, 16 h; qa reviews).
13. Final regression of all four apps: attacks, e2e, Maestro tenant + landlord (qa, 4 h).
14. Store prep: screenshots, fill placeholders, EAS builds (release + Kamanzi, 6 h, after 2 Dec).

## NEEDS KAMANZI
### His actions (exact steps)
1. **Rotate the leaked keys:** follow `backend-plan/docs/key-rotation-plan.md`.
   - Do every **[GAUTIER — click]** step: create the publishable and secret keys, update the env on both Render services, update the local `.env` files, deactivate the legacy keys, move to JWT signing keys, then revoke the legacy secret.
   - Never paste the keys into chat.
2. **Back up the laptop-only code:**
   - Install the GitHub CLI (`winget install GitHub.cli`), then run `gh auth login`.
   - Or create two empty **private** repos on github.com, `apartment-mobile` and `apartment-e2e`, and give the agent their URLs. The agent then adds the remotes and pushes.
3. **Phone testing:**
   - Install Expo Go on your phone.
   - Approve running `npx expo start --tunnel` in `apartment-mobile/apps/tenant`.
   - Create, or let QA create, a test tenant login, then scan the QR code.
4. **Brevo:** put `BREVO_API_KEY`, `EMAIL_FROM` and `EMAIL_FROM_NAME` into the landlord Render service yourself, in the dashboard.
5. **Store:**
   - Fill the placeholders in `apartment-mobile/store/*.md`: legal name, address, emails, NCSA registration, regions, data-processing agreements, retention periods, hosted URLs, demo reviewer accounts.
   - Get a Rwandan lawyer to review the three legal drafts.
   - Approve the icons.
   - Open Apple Developer ($99/yr) and Google Play ($25) accounts.
6. Tap through `apartment-manager/docs/manual-test-checklist.md` on your phone.

7. **Phone-sign-in IP (before launch):** ask Supabase Support whether the Edge gateway always overwrites the forwarded IP header so it cannot be spoofed. Until then only the per-number limit is enforced (your decision).

### His approvals
1. **Migration 17:** read `backend-plan/supabase/17_mobile_push_and_phone_login.sql` (with `17_rollback.sql` and `docs/migration-17.md`), then say yes. Claude chat applies it.
2. **Edge Functions deploy** after 17: set the secrets listed in `supabase/functions/README.md` (`PHONE_LOOKUP_PEPPER` is required) and deploy with `--no-verify-jwt`.
3. **Migration 19** (advisor fixes): read `backend-plan/supabase/19_advisor_fixes.sql`.
4. **Decisions:**
   - Delete the old `src/app/tenant/` pages in the landlord repo?
   - Remove demo mode?
   - Go invite-only, removing the tenant register form?
   - Should landlords stay unable to close their own account (refused today)?
5. **Merges:** `fix/rent-alerts-security` and `agent/backend-plan` into main (landlord repo), and `overnight` into main (mobile), each after review.
6. **Merge the F8 fix** (Add Expense button on Financials): branch `agent/qa` in the landlord repo, commit `30ab738` (one file, +3/-1 lines: `financial-dashboard.tsx` renders the existing `AddExpenseDialog`). The local smoke test passed at desktop and phone width (dialog opens, nothing submitted, server stopped). Merging to main redeploys Render, so it needs your yes. After it deploys, QA un-skips the F8 test and reruns once.

## LIVE STATE
- **Supabase project:** `evzdnnoryffsjpvtacio`.
  - **Applied migrations:** 01-19, including 17 and 19 applied by Claude chat on 25 Nov and verified by Kamanzi.
  - **Drafts, not applied:** none; canonical 17–19 SQL saved on `fix/rent-alerts-security` (commit 49fd0f8).
- **Edge Functions deployed:** none; deployment still needs Kamanzi approval and required secrets.
- **Render:**
  - `apartment-manager-landlord.onrender.com` serves landlord `main` (b434d1f).
  - `apartment-manager-tenant.onrender.com` serves tenant `main` (52dcc23).
  - Branch work is **not deployed**.
- **Cron:** pg_cron calls the tenant app's `/api/cron/daily` every hour. It is running, but has no e2e test.
- **Data baseline that the tests always restore:** 1 user (the landlord), 0 leases, 4 of 4 units vacant (`e2e/baseline.json`).
- **Not set up:** Brevo email, Google sign-in, new API keys, Edge Function secrets, an Expo/EAS project. Public sign-up is still on.

## TEST STATUS
| Suite | Last result | Date | How to run |
|---|---|---|---|
| Web unit tests (vitest), both repos | 128/128 (landlord repo on `backend-plan`); typecheck and lint clean | 25 Nov | `npm test && npx tsc --noEmit && npm run lint` in the repo |
| Shared-lib check | pass | 23 Nov | `bash scripts/check-shared.sh ../apartment-manager-tenant` |
| Edge Functions (vitest, mocked) | **99/99 pass**, `tsc -p supabase/functions` clean (after the phone-sign-in change, 666e842) | 25 Nov 15:00 | in `backend-plan`: `npx vitest run supabase/functions` and `npx tsc -p supabase/functions` |
| Migration 17 + 19 checks (in-memory Postgres, PGlite) | pass incl. 19 contract policy (own/other/closed/anon/landlord), mutation caught | 25 Nov 14:45 | see `backend-plan/docs/migration-17.md`. The real run (on a Supabase branch) has not been done. |
| Mobile typecheck (shared, ui, tenant, landlord) | clean (Codex, after 8edf5c0) | 25 Nov 14:29 | `npm run typecheck` in `apartment-mobile` |
| Mobile shared tests | **86/86** (Codex, 8edf5c0) | 25 Nov 14:29 | `npx vitest run` in `packages/shared` |
| Attack tests (live database) | general suite **130/130 denied** (after migrations 17-19); baseline 1 user / 0 leases / 4 vacant after every run | 25 Nov 13:46 | `cd e2e-attacks/attacks && npm run attacks` (take the lock, set `.pause`; verify after) |
| Contract tests (live, `attacks/run-contract.ts`) | **14/15, the 15th is info only.** Diagnostic: fresh path denied for a closed tenant, helper false, signed URL denied. The earlier "allowed" was a cached copy at the same path, not a policy gap. Baseline restored. | 25 Nov 15:05 | `cd e2e-attacks && npx tsx attacks/run-contract.ts` (lock + `.pause`; then `npx tsx cleanup.ts --verify-only`) |
| F8 Add Expense local smoke (demo mode, no submit) | **PASS** at 1280px and 390px; dev server stopped | 25 Nov 15:08 | `bash <scratchpad>/f8-run.sh` (port 3100, qa-landlord) |
| Production schema check (read-only SQL) | all 17-19 objects present: 8 functions, `profiles.deleted_at`, `payments.method` + check, 2 tables, 30 closed-account policies, contract read policy | 25 Nov 15:15 | read `pg_proc`, `information_schema`, `pg_policies` |
| Web e2e core flow (Playwright) | 9/9 | 24 Nov | `cd e2e && npm run test:e2e` |
| Web e2e feature flows (`tests/flows.spec.ts`, branch `flows`) | run 5 (25 Nov): 14 pass, 1 skipped (F8 fix not on Render); baseline 1/0/4 verified | 25 Nov | `cd e2e && npx playwright test tests/flows.spec.ts` |
| Smoke | 2/2 | 23 Nov | `cd e2e && npm run smoke` |
| Maestro (tenant) | written, NOT run | n/a | `maestro test maestro/tenant/` (needs the app on a phone) |

## HOW TO RUN
- **Landlord web:**
  - `cd C:\dev\apartment-manager && npm run dev` → http://localhost:3000 (heavy; stop it afterwards)
  - Tenant web works the same way, in `apartment-manager-tenant`.
- **Web checks:** `npm test`, `npx tsc --noEmit`, `npm run lint`. `npm run build` is slow and only needed for big changes.
- **Phone, tenant app:**
  - `cd C:\dev\apartment-mobile\apps\tenant && npx expo start --tunnel`, then scan the QR code with Expo Go. This needs Kamanzi's go.
  - It needs `apps/tenant/.env` with `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY` (see `.env.example`).
  - Add `EXPO_PUBLIC_SAMPLE_DATA=1` to use sample data instead.
- **Phone, landlord app:** the same steps, in `apps/landlord`.
- **Phone checks:** `npm run typecheck` (in the repo root), and `npx vitest run` in `packages/shared`.
- **Tests:** see the TEST STATUS table. Always take the heavy lock first.

## KNOWN BUGS / RISKS

- **F8 (QA, 25 Nov):** unit-level expenses could not be added from the landlord web because `AddExpenseDialog` was never rendered. **Fixed in `agent/qa` 30ab738 (smoke-tested locally), not on main or Render yet: waiting for Kamanzi's merge.**
- **Closed-account cache (LOW, accepted):** a closed tenant can re-read a contract file they already downloaded, at the same path, for the storage cache lifetime. Own file, login banned.
- **HIGH:** the legacy service-role key leaked and is not rotated yet.
- **HIGH:** `apartment-mobile`, `e2e` and `backups/` exist **only on this laptop**. A dead disk means losing the phone apps.
- **MEDIUM:** nothing on the phones has ever run on a real device. Expect runtime bugs on the first Expo Go run.
- **MEDIUM:** reset password and email alerts don't work until Brevo is set up.
- **MEDIUM:** Apple and Google may reject block-login-only deletion. Revisit before submission.
- **MEDIUM:** phone text size and input borders are fixed in code (1f08913: cap 2.0, border about 3.5:1 estimated), but not measured or checked on a device.
- **MEDIUM:** the privacy draft promises "download your data", which doesn't exist yet.
- **LOW:** phone-sign-in enforces only the per-number limit (5 per 15 min); the client IP is logged, not trusted. TODO before launch: confirm the Edge gateway header is unspoofable.
- **INFO:** tenants can now read their own lease contract (migration 19, verified live).
- **LOW:** demo mode is not switched off; old duplicate tenant pages are still in the landlord repo; the register form uses the service role.
- **Risk:** weekly usage is low until Mon 30 Nov, and the landlord phone app (16 h) is squeezed into Mon–Tue.

## SCHEDULE (to Wed 2 Dec)
- **Wed 25:**
  - QA wraps up.
  - Kamanzi: key rotation, approve 17, GitHub repos.
  - Backend: phone-sign-in IP fix and the contract policy draft.
- **Thu 26:**
  - Apply 17, then deploy the functions.
  - Mobile: switch on the payment method, add phone sign-in and push.
  - First Expo Go run on Kamanzi's phone.
- **Fri 27:**
  - Fix bugs from the phone run.
  - Maestro tenant run.
  - QA: finish Playwright for the web features.
  - Brevo.
- **Sat 28:**
  - Accessibility MEDIUM fixes.
  - Web clean-up (after Kamanzi decides).
  - Apply migration 19.
- **Sun 29:**
  - Tenant phone app done.
  - Full regression (attacks, e2e, Maestro).
- **Mon 30** (new weekly limit): landlord phone app on live data: units, add tenant, rent confirm/reject, repairs.
- **Tue 1 Dec:** landlord phone app: financials, costs, messages, notifications, alerts, profile. Maestro landlord flows.
- **Wed 2 Dec:** final regression of all four apps, fixes, final handoff. Only store publishing is left after this.

## HOW TO RESUME
Paste the contents of `C:\dev\RESUME-PROMPT.txt` into a new session.

---

## HANDOFF-LOG
Each agent adds one line per task. Never delete old lines.
Format: `YYYY-MM-DD HH:MM | agent | what changed | commit`
- 2026-11-25 06:10 | lead | saved migration 18 file matching prod | e46c91e (agent/backend-plan)
- 2026-11-25 06:32 | mobile | account closing text + Former tenant sample | fe6f5e9 (overnight)
- 2026-11-25 06:40 | release | store drafts: block login only, no erasure promised | 67b7d36 (overnight)
- 2026-11-25 06:49 | mobile | tenant screens on live Supabase | 4e6f520..66781b2 (overnight)
- 2026-11-25 06:50 | backend | ban-only closing, reactivate, migration 17 final, payments.method, functions, migration 19 draft | 543fcb9..166dbc6 (agent/backend-plan, pushed)
- 2026-11-25 ~10:10 | qa | attack rerun 130/130; Playwright flows runs 1-4 | ab7e0a5 (e2e attacks)
- 2026-11-25 12:30 | lead | full HANDOFF.md, RESUME-PROMPT.txt, workspace CLAUDE.md | 116f47f (C:\dev `handoff`, pushed to the landlord repo's branch `handoff`)
- 2026-11-25 12:30 | lead | HANDOFF rule added to CLAUDE.md | landlord 3aba21b (fix/rent-alerts-security, pushed), tenant 7c230da (fix/rent-alerts-security, pushed), backend-plan bef5ca1 (pushed), mobile 6a25e26 (overnight, local only)
- 2026-11-25 12:45 | qa | Playwright flows spec + cleanup, runs 1-4 (F1-F7 pass, F8 selector fail) | 8149a46 (e2e flows)
- 2026-11-25 12:45 | qa | sample data gated on __DEV__; Maestro README methods momo/bank/cash; landlord+tenant tsc 0 | 752f440 (overnight)
- 2026-11-25 12:45 | qa | review 543fcb9..166dbc6 OK; note: lease-contracts policy landlord-only (tenants can't open contract) | board only

- 2026-11-25 13:30 | qa | flows run: 12 pass, F8 app bug (dialog unwired), F13 test fix pending rerun, F14 unrun; verify 1/0/4 | b8032d9 (e2e flows)
- 2026-11-25 14:00 | qa | flows run 4: 14 pass, F13/F14 confirmed, F8 app bug logged; verify 1/0/4 | acfbd0e (e2e flows)
- 2026-11-25 14:30 | mobile | Open contract, push + phone sign-in behind flags (all off), a11y MEDIUM fixes; tsc clean, vitest 86/86 | 3dbfb00, b8c7331, 1f08913 (overnight)
- 2026-11-25 14:50 | backend | Migration 19 now has tenant contract read policy (storage.objects, per-object, closed accounts denied, needs 17); PGlite 17+19 pass, mutation caught; live contract attack cases written on branch attacks, tsc clean, not run | 4e4fb9e, 0685754 (backend-plan), c39940e (attacks)

- 2026-11-25 12:30 SAST | Codex | Codex took over; read HANDOFF and all three repo rules, created requested AGENTS.md files; current state: beginning parallel mobile, backend and QA work.

- 2026-11-25 13:11 | qa | wired AddExpenseDialog; flows 14 pass/1 skipped, attacks 130/130 denied and baseline restored; landlord test 40/40, tsc clean, lint 0 errors/12 warnings | 30ab738 (qa-landlord agent/qa)
- 2026-11-25 12:47 SAST | Codex | takeover verified: read HANDOFF and three CLAUDE.md files; required AGENTS.md files already present; mobile/backend/QA agents dispatched; backend worktree has pre-existing migration-19e checks in supabase/tests/19_checks.sql; work is pending filesystem approval.

- 2026-11-25 12:56 SAST | Codex | F8 confirmed as app bug and wired AddExpenseDialog into FinancialDashboard in qa-landlord; diff --check clean; QA review and six flows/attack rerun pending; not committed or tested yet.

- 2026-11-25 13:07 | qa | F8 wired locally (unverified); Playwright full flows 14 passed/1 skipped because Render lacks branch fix; attacks 130/130 denied, cleanup+verify pass, baseline restored | pending
- 2026-11-25 13:19 | backend | reviewed phone-sign-in IP headers; no code changed because Edge gateway trust is unverified; needs Kamanzi/Supabase decision; existing migration-19e test diff preserved | no commit
- 2026-11-25 13:20 | Codex | added requested handoff instruction to apartment-mobile/AGENTS.md; verified root and all three repo AGENTS files contain the exact required sentence | no commit
- 2026-11-25 13:32 | Codex | updated LIVE STATE to applied migrations 01-19 per Kamanzi; post-migration SQL parity, contract/closed-account attacks, and typegen dispatched | no commit
- 2026-11-25 13:42 | mobile | Enabled tenant payment.method and contract read flags; corrected migration comments; mobile type sync pending QA lock/typecheck | abbbbb1 (overnight)
- 2026-11-25 13:43 SAST | backend | saved applied migrations 17–19 and updated landlord migration index; Edge Functions remain undeployed | 49fd0f8
- 2026-11-25 13:46 | mobile | Updated curated types for applied 17/19 mobile schema and adjusted tests for enabled payment method and own-contract signed URL; QA diagnostic running, checks pending | uncommitted (overnight)

- 2026-11-25 13:46 | qa | general attacks after migrations 17/19: 130/130 denied; contract cases 12/13, one unexpected closed-account download; signed URL denied; cleanup restored baseline; diagnosing harness/policy | pending
- 2026-11-25 14:03 | backend | Supabase CLI remote typegen attempted; no local access token/DB password, no files written; switching to migration-derived schema sync; general attacks 130/130 denied, closed-account direct download diagnostic pending | no commit
- 2026-11-25 14:11 | QA | reran contract via attacks/run-contract.ts; runner exit 1, cleanup and final verify exit 0/baseline restored; detailed assertion output unavailable after command session detached | pending
- 2026-11-25 14:13 | Codex | corrected remaining items: migrations 17-19 canonical files committed; contract/payment feature flags enabled; remote typegen auth need recorded | no commit
- 2026-11-25 14:15 | mobile | post-migration shared test/typecheck attempted; 66 assertions pass but test syntax error blocks suite and typecheck; fix quote and rerun | pending
- 2026-11-25 14:18 | mobile | Enabled payments.method and tenant contract access; updated applied-schema mobile types and tests; shared vitest 86/86 and workspace typecheck clean | a1bca01 (overnight)
- 2026-11-25 14:17 SAST | backend | committed landlord applied-schema types after tests, typecheck and lint; shared file hashes match | f1f5c95
- 2026-11-25 14:21 | mobile | Compared migration 17/19 schema against landlord types; added phone_login_attempts and missing migration 17 RPC signatures to mobile types; checks pending after backend lock | uncommitted (overnight)
- 2026-11-25 14:22 | Codex | Restored tenant repo Next.js AGENTS guidance while preserving required handoff directive | uncommitted setup file
- 2026-11-25 14:24 | Codex | Tenant checks attempt exited before tests with ENOENT due to wrong current directory; no files changed; lock released; retry with explicit working directory | pending
- 2026-11-25 14:26 | Codex | Tenant check retry was blocked before tests by PowerShell execution policy resolving npm.ps1; use explicit npm.cmd/npx.cmd paths; no repo files changed, lock released | pending
- 2026-11-25 14:27 SAST | backend | committed tenant applied-schema types after tests, typecheck and lint; shared type files match | f0703ea
- 2026-11-25 14:29 SAST | mobile | completed migration 17/19 types including phone_login_attempts and RPCs; sample method comment corrected; shared vitest 86/86 and workspace typecheck passed | 8edf5c0
- 2026-11-25 14:55 | Claude Code (Sonnet) | resumed after Codex. State: migrations 01-19 applied; types synced (landlord f1f5c95, tenant f0703ea, mobile 8edf5c0); contract runner 12/13 (closed-account download unexplained); F8 wired in qa-landlord 30ab738 unverified; uncommitted left by Codex: AGENTS.md files, e2e-attacks attacks/contract-cases.ts, backend-plan tests/19_checks.sql | no commit
- 2026-11-25 15:05 | qa (lead) | contract diagnostic: fresh path denied for a closed tenant, helper false => the earlier "allowed" was a cached copy; migration 19 is correct, no migration 20 needed; same-path check now info only; baseline 1/0/4 verified | 1c8e659 (e2e-attacks `attacks`)
- 2026-11-25 15:08 | qa (lead) | F8 Add Expense local smoke (demo mode, nothing submitted) passed at desktop + phone width; dev server stopped, port 3100 free | 30ab738 (agent/qa, pushed, waiting for Kamanzi's merge)
- 2026-11-25 15:12 | backend (lead) | phone-sign-in: per-number limit only, IP logged not trusted (TODO before launch), test updated; functions 99/99, tsc clean | 666e842 (agent/backend-plan, pushed)
- 2026-11-25 15:13 | lead | proxy.ts Cloudflare comment reworded in both web repos (comment only); AGENTS.md notes committed | landlord ee6ab7e, tenant c479f62 (pushed), mobile ccdf439
- 2026-11-25 15:15 | lead | verified production has every object from migrations 17-19 (read-only SQL); 17-19 SQL saved in repo (49fd0f8); types synced by Codex in landlord f1f5c95, tenant f0703ea, mobile 8edf5c0 (derived from migrations; official CLI typegen still needs Kamanzi login) | no commit
