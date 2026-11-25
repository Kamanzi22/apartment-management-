// delete-account: the signed-in tenant closes THEIR OWN account (id from the
// JWT, never from the body). Owner decision 25 Nov 2026: this BLOCKS THE LOGIN
// ONLY. Nothing is erased: name, phone, email, files, payments, receipts,
// repairs, messages and notifications stay, and the landlord keeps them.
//
// Steps:
//   1. password re-check (or a sign-in in the last 10 minutes for Google)
//   2. ban the Auth login, so no new sign-in works
//   3. sign out every session (refresh tokens revoked)
//   4. delete_account() in SQL: removes the phone push tokens, sets
//      profiles.deleted_at (one transaction)
//   5. alert the landlord if a lease is still running
// If step 3 or 4 fails the ban is lifted again, so the tenant can simply retry
// (a banned login could not pass the password re-check). No Auth login is ever
// deleted. The landlord can undo all of it with reactivate-tenant.
// Landlord accounts are refused (open question for the owner).

import { HttpError } from '../http.ts'
import { deletionAllowed, reauthNeeded, requireSignedIn } from '../authz.ts'
import { parseDeleteAccount } from '../validate.ts'
import { deliverNotifications } from '../deliver.ts'
import { tenantDeletedAccountNotification } from '../messages.ts'
import type { Ctx } from '../ports.ts'

/** About 100 years: Auth's way of saying "until someone lifts it". */
export const CLOSED_BAN_DURATION = '876000h'

export interface DeleteAccountSqlResult {
  mode: 'closed'
  already_closed: boolean
  landlord_id: string | null
  unit_label: string | null
  had_active_lease: boolean
}

export interface DeleteAccountResult {
  ok: true
  mode: 'closed'
  /** Secondary steps that failed (the account IS closed), e.g. 'landlord-alert'. */
  warnings: string[]
}

const FAILED = 'Could not close the account. Nothing was changed. Try again.'

async function liftBan(ctx: Ctx, userId: string, step: string) {
  const err = await ctx.admin.updateUser(userId, { ban_duration: 'none' })
  if (err) ctx.log(`delete-account: could not lift the ban after a failed ${step}`)
}

export async function deleteAccount(ctx: Ctx, body: Record<string, unknown>): Promise<DeleteAccountResult> {
  const caller = requireSignedIn(ctx.caller)
  if (!ctx.jwt) throw new HttpError('unauthorized', 'Please sign in again.')
  const allowed = deletionAllowed(caller)
  if (!allowed.ok) throw allowed.error
  const p = parseDeleteAccount(body)
  if (!p.ok) throw new HttpError('bad_request', p.error)

  const authUser = await ctx.admin.getAuthUser(caller.id)
  if (!authUser) throw new HttpError('not_found', 'Account not found.')

  // 1. Re-authenticate.
  const nowSec = Math.floor(ctx.now().getTime() / 1000)
  const need = reauthNeeded({ providers: authUser.providers }, ctx.tokenIssuedAt, nowSec)
  if (need === 'recent-login-required') {
    throw new HttpError('forbidden', 'For your security, sign out and sign in again, then delete your account.')
  }
  if (need === 'password') {
    if (!p.value.password || !authUser.email) throw new HttpError('bad_request', 'Enter your password to confirm.')
    const check = await ctx.anon.signInWithPassword(authUser.email, p.value.password)
    if (check.error) {
      if (check.error.status && check.error.status >= 500) throw new HttpError('unavailable', 'Could not reach the server. Try again.')
      throw new HttpError('unauthorized', 'Wrong password.')
    }
  }

  // 2. No new sign-ins.
  if (await ctx.admin.updateUser(caller.id, { ban_duration: CLOSED_BAN_DURATION })) {
    throw new HttpError('unavailable', FAILED)
  }

  // 3. End every session (includes the one the password check just made).
  if (await ctx.admin.signOutEverywhere(ctx.jwt)) {
    ctx.log('delete-account: sign-out failed')
    await liftBan(ctx, caller.id, 'sign-out')
    throw new HttpError('unavailable', FAILED)
  }

  // 4. Push tokens + deleted_at, one transaction.
  const { data, error } = await ctx.admin.rpc<DeleteAccountSqlResult>('delete_account', { p_user: caller.id })
  if (error || !data) {
    ctx.log(`delete-account: delete_account() failed (${error?.code ?? 'no data'})`)
    await liftBan(ctx, caller.id, 'delete_account()')
    throw new HttpError('unavailable', FAILED)
  }

  // 5. Tell the landlord if a lease is still running.
  const warnings: string[] = []
  if (data.had_active_lease && data.landlord_id && !data.already_closed) {
    const n = tenantDeletedAccountNotification(data.landlord_id, data.unit_label)
    const err = await ctx.admin.insertNotifications([n])
    if (err) warnings.push('landlord-alert')
    else if (!ctx.env.webhookDelivery) {
      try { await deliverNotifications(ctx, [n], { webPush: true }) } catch { warnings.push('landlord-push') }
    }
  }

  if (warnings.length) ctx.log(`delete-account: finished with warnings: ${warnings.join(', ')}`)
  return { ok: true, mode: 'closed', warnings }
}
