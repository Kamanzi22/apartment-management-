# Edge Functions security audit (26 Nov 2026, backend agent)

Scope: every function in `supabase/functions/*` and the handlers in `_shared/handlers`. Nothing deployed.
Code reading plus tests: `_shared/denials.test.ts` (table-driven denial paths), `_shared/push-e2e.test.ts`,
`_shared/handlers.test.ts`, `_shared/pure.test.ts`.

## Checks

- **A. Acting user from the verified JWT.** `resolveCaller()` calls `auth.getUser(jwt)` (Auth verifies it), the role and
  `deleted_at` come from `public.profiles` read with the caller's own client. Nothing in the body names the actor.
  Target ids in the body are only used by landlord-only actions, after `requireLandlord`.
- **B. No secret / email / internal id in responses or logs.** Responses are `{ error, code }` or small result objects.
  Logs hold the function name plus a code or fixed text.
- **C. Generic errors.** Unknown, closed, wrong-role and not-owned targets give the same status and text.
- **D. A test for every denial path** (no JWT, forged JWT, wrong role, not owner, closed account, bad input).

| Function | A actor from JWT | B no leaks | C generic errors | D denial tests |
|---|---|---|---|---|
| add-tenant | yes (landlord role; email lookup is landlord-only) | yes | landlord sees "email in use by a non-tenant / other unit" (needed UX, landlord only) | 401/403/closed/400 + smuggled role |
| end-tenancy | yes | yes | unknown lease = 404 (RLS client) | same + not-found |
| replace-tenancy | yes | yes | outgoing lease/tenant/unit mismatch = one 409 text | same |
| confirm-payment / reject-payment | yes (reviewer = caller.id) | yes | missing or already-reviewed = one 409; RLS refusal = "Not authorized" | same + 409 + 42501 |
| reset-tenant-password | yes | yes (no email returned, recovery token only mailed) | landlord / closed / missing target = one 404 | same + 3-way identical test |
| broadcast | yes | yes | n/a | same |
| reactivate-tenant | yes | yes | unknown id and "no lease here" = one 404 | same + identical-answer test |
| notify (user) | yes (recipient only validated via RLS client) | yes (delivery counts only) | tenant to tenant or unknown = 404, not "forbidden" | 401/closed/400/hidden recipient/smuggled sender |
| notify (webhook) | n/a: shared secret, constant-time compare | yes | bad/missing/empty secret = one 401 | keys and blanks refused |
| delete-account | yes (closes `caller.id`, ids in body ignored) | yes | wrong password / recent-login messages fixed | 401/closed/landlord/400 + ignored body ids |
| phone-sign-in | n/a (no session) | yes: email stays on the server; only the session returns | unknown number, wrong password and bad input = one 401 text, padded time | bad input, limits, closed account |

## Result

No blocking issue. Observations (none changed code):

1. **Landlord-only messages name the conflict** (`add-tenant`, `replace-tenancy`: "email belongs to a tenant assigned to another unit").
   This tells the landlord something about an email. Accepted: the caller is the only landlord and needs it.
2. **`withHttp` logs `e.message` for unexpected errors.** Supabase client errors carry codes and short messages, not
   keys. Keep it that way: never put request data in thrown messages.
3. **CORS `*`** is fine because every function needs a bearer token or the webhook secret (no cookies).
4. **Expo tickets are not stored.** `deliverNotifications` does not keep ticket ids, so receipt-only
   `DeviceNotRegistered` tokens are never cleaned (only ticket-time errors are). Needs a small pending-tickets table and a
   scheduled caller (a future migration; not applied). Tracked in HANDOFF.
5. **Phone sign-in per-client limit** still off until the gateway IP header is confirmed (see `phone-sign-in.ts`).
