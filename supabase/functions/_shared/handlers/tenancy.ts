// add-tenant, end-tenancy, replace-tenancy. Same steps as createTenantAccount,
// confirmTenantMoveOut and replaceTenant in the landlord web app
// (src/app/actions/admin.ts). The database work runs as the landlord
// (attach_tenant / end_tenancy / replace_tenancy re-check caller_is_admin()),
// the secret key is used only for the login itself.

import { HttpError } from '../http.ts'
import { requireLandlord, rpcErrorToHttp } from '../authz.ts'
import { parseAddTenant, parseEndTenancy, parseReplaceTenancy, type TenantDetails } from '../validate.ts'
import { notifyAndDeliver } from '../deliver.ts'
import { tenancyEndedNotification } from '../messages.ts'
import type { AdminDb, Ctx } from '../ports.ts'

export interface TenancyResult { ok: true; leaseId: string; tenantId: string; created: boolean; warning?: string }

function randomPassword(): string {
  // Never shown to anyone: the tenant sets their own through the reset email.
  return crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().slice(0, 8) + 'Aa1!'
}

export async function findOrCreateLogin(admin: AdminDb, email: string): Promise<{ id: string; created: boolean }> {
  const found = await admin.findUserIdByEmail(email)
  if (found.error) throw new HttpError('unavailable', 'Could not reach the login service. Please try again.')
  if (found.data) return { id: found.data, created: false }
  const made = await admin.createUser(email, randomPassword())
  if (made.error) throw new HttpError('bad_request', 'Could not create a login for that email.')
  return { id: made.data.id, created: true }
}

/** A returning tenant may have been archived (login disabled): switch it back on. */
async function afterAttach(admin: AdminDb, login: { id: string; created: boolean }): Promise<string | null> {
  if (login.created) return null
  const err = await admin.updateUser(login.id, { ban_duration: 'none' })
  return err ? 'The tenant was added, but their login could not be re-enabled.' : null
}

export function attachArgs(tenantId: string, p: TenantDetails) {
  return {
    p_tenant: tenantId, p_full_name: p.fullName, p_phone: p.phone, p_unit: p.unitId,
    p_move_in: p.moveInDate, p_rent: p.monthlyRent, p_deposit: p.depositAmount, p_lease_end: p.leaseEnd,
  }
}

// No Auth login is ever deleted (owner rule, 25 Nov). A login just created for a
// refused attach has no profile, so it cannot sign in to either app, and the next
// add-tenant with the same email reuses it (findOrCreateLogin finds it).
function rollbackLogin(ctx: Ctx, login: { id: string; created: boolean }) {
  if (login.created) ctx.log('tenancy: attach refused; the new login is kept without a profile and will be reused')
}

export async function addTenant(ctx: Ctx, body: Record<string, unknown>): Promise<TenancyResult> {
  const caller = requireLandlord(ctx.caller)
  const p = parseAddTenant(body)
  if (!p.ok) throw new HttpError('bad_request', p.error)

  const login = await findOrCreateLogin(ctx.admin, p.value.email)
  if (login.id === caller.id) throw new HttpError('conflict', 'That email is already in use by a non-tenant account.')

  const { data, error } = await ctx.user.rpc<string>('attach_tenant', attachArgs(login.id, p.value))
  if (error) {
    rollbackLogin(ctx, login)
    throw rpcErrorToHttp(error)
  }
  const warning = await afterAttach(ctx.admin, login)
  return { ok: true, leaseId: data as string, tenantId: login.id, created: login.created, ...(warning ? { warning } : {}) }
}

export async function endTenancy(ctx: Ctx, body: Record<string, unknown>): Promise<{ ok: true; warning?: string }> {
  requireLandlord(ctx.caller)
  const p = parseEndTenancy(body)
  if (!p.ok) throw new HttpError('bad_request', p.error)

  const lease = await ctx.user.getLease(p.value.leaseId)
  if (!lease) throw new HttpError('not_found', 'Lease not found')
  if (lease.status !== 'active') throw new HttpError('conflict', 'That lease has already ended')

  const { error } = await ctx.user.rpc('end_tenancy', { p_lease: p.value.leaseId, p_move_out: p.value.moveOutDate })
  if (error) throw rpcErrorToHttp(error)

  const warning = await notifyAndDeliver(ctx, [tenancyEndedNotification(lease.tenant_id, p.value.moveOutDate)])
  return { ok: true, ...(warning ? { warning } : {}) }
}

export async function replaceTenancy(ctx: Ctx, body: Record<string, unknown>): Promise<TenancyResult> {
  const caller = requireLandlord(ctx.caller)
  const p = parseReplaceTenancy(body)
  if (!p.ok) throw new HttpError('bad_request', p.error)
  const { outgoing, incoming } = p.value

  const lease = await ctx.user.getLease(outgoing.leaseId)
  if (!lease || lease.tenant_id !== outgoing.tenantId || lease.unit_id !== outgoing.unitId) {
    throw new HttpError('conflict', 'The outgoing lease is not on this unit')
  }

  const login = await findOrCreateLogin(ctx.admin, incoming.email)
  if (login.id === caller.id) throw new HttpError('conflict', 'That email is already in use by a non-tenant account.')
  if (login.id === outgoing.tenantId) {
    throw new HttpError('conflict', 'The new tenant is the same person as the outgoing tenant.')
  }

  const { data, error } = await ctx.user.rpc<string>('replace_tenancy', {
    p_old_lease: outgoing.leaseId, p_move_out: outgoing.moveOutDate, ...attachArgs(login.id, incoming),
  })
  if (error) {
    rollbackLogin(ctx, login)
    throw rpcErrorToHttp(error)
  }
  const warnings = [
    await afterAttach(ctx.admin, login),
    await notifyAndDeliver(ctx, [tenancyEndedNotification(outgoing.tenantId, outgoing.moveOutDate)]),
  ].filter(Boolean)
  return {
    ok: true, leaseId: data as string, tenantId: login.id, created: login.created,
    ...(warnings.length ? { warning: warnings.join(' ') } : {}),
  }
}
