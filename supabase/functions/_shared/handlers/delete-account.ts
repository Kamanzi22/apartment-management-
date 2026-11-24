// delete-account: the signed-in user deletes THEIR OWN account (id from the
// JWT, never from the body). Required by App Store guideline 5.1.1(v) and
// Google Play's account-deletion policy.
//
// What happens (details and reasons: docs/migration-17.md):
//   - landlord: refused with an explanation (it would orphan the building).
//   - tenant who never had a lease / payment / repair / notice: everything is
//     deleted (SQL removes the profile and its rows, files are removed, then
//     auth.admin.deleteUser hard-deletes the login).
//   - tenant with history: the login is banned and soft-deleted (Supabase
//     scrubs email/phone/identities but keeps the auth.users row, so the
//     ON DELETE CASCADE to profiles never fires); the profile is anonymised
//     and personal rows are deleted by public.delete_account(); leases,
//     payments, receipts and repair records stay with the landlord.
//
// The ban goes first so the account is unusable even if a later step fails;
// every step is safe to repeat, so the phone can simply retry.

import { HttpError } from '../http.ts'
import { deletionAllowed, reauthNeeded, requireSignedIn } from '../authz.ts'
import { parseDeleteAccount } from '../validate.ts'
import { deliverNotifications } from '../deliver.ts'
import { tenantDeletedAccountNotification } from '../messages.ts'
import type { Ctx } from '../ports.ts'

export interface DeleteAccountSqlResult {
  mode: 'deleted' | 'anonymised'
  landlord_id: string | null
  unit_label: string | null
  had_active_lease: boolean
}

export interface DeleteAccountResult {
  ok: true
  mode: 'deleted' | 'anonymised'
  /** Steps that failed after the account was already disabled; retrying is safe. */
  warnings: string[]
}

export const STORAGE_BUCKETS_OWNED_BY_USER = ['receipts', 'maintenance-photos'] as const

function randomPassword(): string {
  return crypto.randomUUID() + crypto.randomUUID()
}

export async function deleteAccount(ctx: Ctx, body: Record<string, unknown>): Promise<DeleteAccountResult> {
  // A caller whose profile is already marked deleted may retry (finishing a
  // partial run); everything else needs a normal signed-in user.
  const caller = ctx.caller?.deletedAt ? ctx.caller : requireSignedIn(ctx.caller)
  if (!caller || !ctx.jwt) throw new HttpError('unauthorized', 'Please sign in again.')
  const allowed = deletionAllowed(caller)
  if (!allowed.ok) throw allowed.error
  const p = parseDeleteAccount(body)
  if (!p.ok) throw new HttpError('bad_request', p.error)

  const authUser = await ctx.admin.getAuthUser(caller.id)
  if (!authUser) throw new HttpError('not_found', 'Account not found.')

  if (!caller.deletedAt) {
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
  }

  // 1. Disable the login first.
  const banErr = await ctx.admin.updateUser(caller.id, { ban_duration: '876600h' })
  if (banErr) throw new HttpError('unavailable', 'Could not delete the account. Nothing was changed. Try again.')

  const warnings: string[] = []
  // 2. Database part, one transaction (migration 17).
  const { data, error } = await ctx.admin.rpc<DeleteAccountSqlResult>('delete_account', { p_user: caller.id })
  if (error || !data) {
    ctx.log(`delete-account: delete_account() failed (${error?.code ?? 'no data'})`)
    throw new HttpError('unavailable', 'Your account is disabled, but deleting its data failed. Try again.')
  }

  // 3. Tell the landlord if a lease was still running.
  if (data.had_active_lease && data.landlord_id) {
    const n = tenantDeletedAccountNotification(data.landlord_id, data.unit_label)
    const err = await ctx.admin.insertNotifications([n])
    if (err) warnings.push('landlord-alert')
    else if (!ctx.env.webhookDelivery) {
      try { await deliverNotifications(ctx, [n], { webPush: true }) } catch { warnings.push('landlord-push') }
    }
  }

  // 4. End every session (refresh tokens). Access tokens expire within the hour
  //    and the ban + soft delete stop any refresh.
  if (await ctx.admin.signOutEverywhere(ctx.jwt)) warnings.push('sign-out')

  // 5. The login itself.
  if (data.mode === 'deleted') {
    for (const bucket of STORAGE_BUCKETS_OWNED_BY_USER) {
      try { await ctx.admin.removeUserFolder(bucket, caller.id) } catch { warnings.push(`files-${bucket}`) }
    }
    if (await ctx.admin.deleteUser(caller.id, false)) warnings.push('delete-login')
  } else {
    // Make the old password useless and drop metadata, then soft delete.
    if (await ctx.admin.updateUser(caller.id, { password: randomPassword(), user_metadata: {} })) warnings.push('scrub-login')
    if (await ctx.admin.deleteUser(caller.id, true)) warnings.push('delete-login')
  }

  if (warnings.length) ctx.log(`delete-account: finished with warnings: ${warnings.join(', ')}`)
  return { ok: true, mode: data.mode, warnings }
}
