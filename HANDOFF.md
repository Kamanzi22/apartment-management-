# HANDOFF: Apartment Manager

> RULE: At the start of every session read C:\dev\HANDOFF.md first. Every agent updates HANDOFF.md (DONE, IN PROGRESS with the exact next step, REMAINING, TEST STATUS, LAST UPDATED) after every finished task, after every commit, at least every 30 minutes while working, and IMMEDIATELY when usage is running low or a limit message appears. Keep it short, accurate and secret-free. Never stop work without updating it first.
>
> USAGE LOW RULE: if you see a usage warning or a limit message, do these three things in order: write your exact next step under IN PROGRESS, commit your work to your feature branch, then stop.

## LAST UPDATED
2026-11-25 14:30 SAST by mobile (Claude Code, Sonnet).

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
| `apartment-manager` | landlord web repo | `fix/rent-alerts-security` | 1728c61 (24 Nov) | none | yes, Kamanzi22/apartment-management- (branch pushed, not merged) |
| `backend-plan` | worktree of apartment-manager | `agent/backend-plan` | 166dbc6 (25 Nov) | none | yes, pushed |
| `qa-landlord` | worktree of apartment-manager | `agent/qa` | 1728c61 | none | yes |
| `apartment-manager-tenant` | tenant web repo | `fix/rent-alerts-security` | 52dcc23 (23 Nov) | none | yes, Kamanzi22/apartment-manager-tenant |
| `qa-tenant` | worktree of tenant repo | `agent/qa` | 52dcc23 | none | yes |
| `apartment-mobile` | phone apps repo | `overnight` (also `round2`, `main`) | 752f440 (25 Nov, QA) | none from QA | **NO: only on this laptop, no remote** |
| `e2e` | Playwright + attack tests | `flows` (from `attacks`; also `master`) | 8149a46 (25 Nov) | none | **NO: only on this laptop** |
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
| qa | idle: Playwright web flows done | `e2e` branch `flows` (acfbd0e) | Next: landlord fixes F8 app bug (see KNOWN BUGS), then un-fixme F8 in `tests/flows.spec.ts`. |
| mobile | tenant flags done; landlord app waits for Mon 30 Nov | `overnight` (1f08913) | Next: (1) after migration 19 set `CONTRACT_READ_ENABLED = true` (tenant-api.ts); (2) after 17 applied + `npx expo install expo-notifications expo-device` in apps/tenant + EAS projectId in app.json: set `PUSH_ENABLED = true`; (3) after 17 + phone-sign-in deployed: `PHONE_SIGN_IN_ENABLED = true` (both in packages/shared/src/flags.ts); (4) PAYMENTS_HAVE_METHOD after 17. Then device check at Android 200% text. Landlord live work from Mon 30 Nov. |
| backend | idle | `agent/backend-plan` (pushed) | Wait for Kamanzi to approve 17, 19 and the deploys. Meanwhile: fix the QA LOW finding (phone-sign-in trusts the first `x-forwarded-for` header) and the lease-contracts storage policy so tenants can read their own contract (as migration 20, draft). |
| release | done | `overnight` `store/` | Nothing until Kamanzi fills the placeholders. |

## REMAINING (in order; owner, estimated hours)
1. Kamanzi rotates the keys; the agent does its own steps and re-checks both web apps (backend, 2 h, needs Kamanzi).
2. Apply migration 17 → regenerate `database.types.ts` in both web repos and in mobile → set `PAYMENTS_HAVE_METHOD = true` (backend + mobile, 1 h, needs approval).
3. Deploy the Edge Functions with their secrets, then run a live smoke test of each function with test users (backend + qa, 3 h, needs approval).
4. Tenant phone: phone sign-in, push registration, the contract-download policy fix, and a first run in Expo Go with a test tenant (mobile, 4 h, needs Kamanzi's phone).
5. Run the Maestro flows on Kamanzi's phone, fix what they find, and do the accessibility device checklist (qa + mobile, 4 h).
6. Accessibility MEDIUM fixes: text scale up to 200%, and input borders at 3:1 contrast (mobile, 1 h).
7. QA LOW finding: rate-limit phone-sign-in by the real client IP (backend, 1 h).
8. Web Playwright: finish and fix the remaining features (reject payment, end/replace tenancy, history, financials, costs, messages, alerts, profile, move-out, lease) (qa, 4 h).
9. Web clean-up after Kamanzi decides: the old `src/app/tenant/` pages in the landlord repo, demo mode, removing the register form for invite-only sign-up, `vercel.json`, the README (qa, 3 h).
10. Brevo email (reset password and email alerts) once Kamanzi gives the key; Google sign-in (optional) (backend, 1 h).
11. Apply migration 19 (advisor fixes) (backend, 0.5 h, needs approval).
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

## LIVE STATE
- **Supabase project:** `evzdnnoryffsjpvtacio`.
  - **Applied migrations:** 01–16 and 18. In the migration table, 07–16 and 18 are listed; 01–06 were applied by hand earlier.
  - **Drafts, not applied:** 17 and 19.
- **Edge Functions deployed:** none.
- **Render:**
  - `apartment-manager-landlord.onrender.com` serves landlord `main` (b434d1f).
  - `apartment-manager-tenant.onrender.com` serves tenant `main` (52dcc23).
  - Branch work is **not deployed**.
- **Cron:** pg_cron calls the tenant app's `/api/cron/daily` every hour. It is running, but has no e2e test.
- **Data baseline that the tests always restore:** 1 user (the landlord), 0 leases, 4 of 4 units vacant (`e2e/baseline.json`).
- **Not set up:** Brevo email, Google sign-in, new API keys, Edge Function secrets, an Expo/EAS project. Public sign-up is still on.

## TEST STATUS
| Mobile: tsc shared/ui/tenant + vitest shared | clean, 86/86 | 25 Nov | `npx tsc --noEmit` in each; `npx vitest run` in packages/shared |
| Suite | Last result | Date | How to run |
|---|---|---|---|
| Web unit tests (vitest), both repos | 128/128 (landlord repo on `backend-plan`); typecheck and lint clean | 25 Nov | `npm test && npx tsc --noEmit && npm run lint` in the repo |
| Shared-lib check | pass | 23 Nov | `bash scripts/check-shared.sh ../apartment-manager-tenant` |
| Edge Functions (vitest, mocked) | pass after the ban-only rework (89 before the rework, more since) | 25 Nov | in `backend-plan`: `npx vitest run supabase/functions` and `npx tsc -p supabase/functions` |
| Migration 17 + 19 checks (in-memory Postgres, PGlite) | pass, including the rollback and deliberately broken versions | 25 Nov 06:49 | see `backend-plan/docs/migration-17.md`. The real run (on a Supabase branch) has not been done. |
| Mobile typecheck (shared, ui, tenant, landlord) | 0 errors in all four (landlord re-checked by QA 12:40) | 25 Nov | `npm run typecheck` in `apartment-mobile` |
| Mobile shared tests | 80/80 | 25 Nov | `npx vitest run` in `apartment-mobile/packages/shared` |
| Attack tests (live database) | **130/130 blocked**, database back to baseline | 25 Nov | `cd e2e/attacks && npm run verify && npm run attacks && npm run cleanup && npm run verify` (needs the lock and `.pause`) |
| Web e2e core flow (Playwright) | 9/9 | 24 Nov | `cd e2e && npm run test:e2e` |
| Web e2e feature flows (`tests/flows.spec.ts`, branch `flows`) | run 4 (25 Nov): 14 pass, 1 fixme (F8, app bug). Baseline 1/0/4 verified | 25 Nov | `cd e2e && npx playwright test tests/flows.spec.ts` |
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

- **F8 (QA, 25 Nov):** `AddExpenseDialog` at `apartment-manager/src/app/landlord/financials/add-expense-dialog.tsx:21` is never rendered, so unit-level expenses cannot be added from the landlord web. Only building costs can.
- **HIGH:** the legacy service-role key leaked and is not rotated yet.
- **HIGH:** `apartment-mobile`, `e2e` and `backups/` exist **only on this laptop**. A dead disk means losing the phone apps.
- **MEDIUM:** nothing on the phones has ever run on a real device. Expect runtime bugs on the first Expo Go run.
- **MEDIUM:** reset password and email alerts don't work until Brevo is set up.
- **MEDIUM:** Apple and Google may reject block-login-only deletion. Revisit before submission.
- **MEDIUM:** in the phone apps, text stops growing at 160% (200% is needed), and input borders are too faint at 1.69:1.
- **MEDIUM:** the privacy draft promises "download your data", which doesn't exist yet.
- **LOW:** phone-sign-in's per-client limit trusts a header the caller can fake (the per-number limit still holds).
- **LOW:** tenants may not be able to open their lease contract, because the storage rules are landlord-only.
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
