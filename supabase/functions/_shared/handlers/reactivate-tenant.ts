// reactivate-tenant (landlord only): re-opens a tenant account that was closed
// from the phone app. Lifts the Auth ban and clears profiles.deleted_at
// (reactivate_account(), migration 17). The tenant then signs in as before;
// all their data was kept, and their phone registers its push token again.
//
// Ownership: single-building product, so "the landlord's tenant" means the
// tenant has, or had, a lease here, read with the landlord's own client (RLS).
// Only closed accounts are touched: this never lifts an "Archive tenant" ban.

import { HttpError } from '../http.ts'
import { requireLandlord } from '../authz.ts'
import { isUuid } from '../validate.ts'
import { CLOSED_BAN_DURATION } from './delete-account.ts'
import type { Ctx } from '../ports.ts'

export interface ReactivateTenantResult { ok: true; tenantId: string }

export async function reactivateTenant(ctx: Ctx, body: Record<string, unknown>): Promise<ReactivateTenantResult> {
  requireLandlord(ctx.caller)
  if (!isUuid(body.tenantId)) throw new HttpError('bad_request', 'Tenant id is missing.')
  const tenantId = body.tenantId

  const profile = await ctx.admin.getProfile(tenantId)
  if (!profile || profile.role !== 'tenant') throw new HttpError('not_found', 'Tenant not found.')
  if ((await ctx.user.countLeasesForTenant(tenantId)) === 0) throw new HttpError('not_found', 'Tenant not found.')
  if (!profile.deleted_at) throw new HttpError('conflict', 'This account is not closed.')

  if (await ctx.admin.updateUser(tenantId, { ban_duration: 'none' })) {
    throw new HttpError('unavailable', 'Could not reactivate the account. Try again.')
  }
  const { error } = await ctx.admin.rpc<boolean>('reactivate_account', { p_user: tenantId })
  if (error) {
    // Put the ban back so the account is consistently closed, then report.
    await ctx.admin.updateUser(tenantId, { ban_duration: CLOSED_BAN_DURATION })
    ctx.log(`reactivate-tenant: reactivate_account() failed (${error.code ?? 'no code'})`)
    throw new HttpError('unavailable', 'Could not reactivate the account. Try again.')
  }
  return { ok: true, tenantId }
}
