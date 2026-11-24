// reset-tenant-password (landlord only). Two modes:
//  - 'email' (default, recommended): sends the tenant a "set your password"
//    link (Supabase recovery link + Brevo), which also works as the invite
//    after add-tenant.
//  - 'set': the landlord types a new password, parity with the web dialog
//    (resetTenantPassword). Useful while email is not set up.
// The target must be a tenant: this can never touch the landlord's own login.

import { HttpError } from '../http.ts'
import { requireLandlord } from '../authz.ts'
import { parseResetTenantPassword } from '../validate.ts'
import { emailConfigured, sendEmail } from '../email.ts'
import { passwordResetEmail, recoveryLink } from '../messages.ts'
import type { Ctx } from '../ports.ts'

export async function resetTenantPassword(ctx: Ctx, body: Record<string, unknown>): Promise<{ ok: true; mode: 'email' | 'set' }> {
  requireLandlord(ctx.caller)
  const p = parseResetTenantPassword(body)
  if (!p.ok) throw new HttpError('bad_request', p.error)

  const profile = await ctx.admin.getProfile(p.value.tenantId)
  if (!profile || profile.role !== 'tenant' || profile.deleted_at) throw new HttpError('not_found', 'Tenant not found.')

  if (p.value.mode === 'set') {
    const err = await ctx.admin.updateUser(p.value.tenantId, { password: p.value.newPassword })
    if (err) throw new HttpError('bad_request', 'Could not set that password. Try a longer one.')
    return { ok: true, mode: 'set' }
  }

  if (!emailConfigured(ctx.env)) throw new HttpError('unavailable', 'Email is not set up yet')
  const authUser = await ctx.admin.getAuthUser(p.value.tenantId)
  if (!authUser?.email || authUser.email.endsWith('.invalid')) throw new HttpError('bad_request', 'This tenant has no email address.')
  const hashed = await ctx.admin.generateRecoveryToken(authUser.email)
  if (!hashed) throw new HttpError('unavailable', 'Failed to send. Please try again.')
  const mail = passwordResetEmail(recoveryLink(ctx.env.tenantAppUrl, hashed))
  const sent = await sendEmail(ctx.env, ctx.fetch, authUser.email, mail.subject, mail.html)
  if (!sent) throw new HttpError('unavailable', 'Failed to send. Please try again.')
  return { ok: true, mode: 'email' }
}
