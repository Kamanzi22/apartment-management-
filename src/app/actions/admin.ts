'use server'

import { createClient, createAdminClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { parseAmountInput } from '@/lib/currency'
import { currentPeriodMonth } from '@/lib/rent-utils'
import { notify } from '@/lib/notify'

type AdminClient = Awaited<ReturnType<typeof createAdminClient>>
type Result = { error: string } | { success: true }

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

async function requireLandlord() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'Not authenticated' } as const
  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  if (profile?.role !== 'landlord') return { ok: false, error: 'Not authorized' } as const
  return { ok: true, supabase, user } as const
}

function revalidateAll() {
  revalidatePath('/landlord', 'layout')
  revalidatePath('/tenant', 'layout')
}

interface AttachTenantParams {
  email: string
  fullName: string
  phone: string | null
  unitId: string
  moveInDate: string
  monthlyRent: number
  depositAmount: number
  leaseEnd: string | null
}

function attachParamsFromFormData(formData: FormData): AttachTenantParams {
  return {
    email: ((formData.get('email') as string) ?? '').trim().toLowerCase(),
    fullName: ((formData.get('full_name') as string) ?? '').trim(),
    phone: ((formData.get('phone') as string) ?? '').trim() || null,
    unitId: formData.get('unit_id') as string,
    moveInDate: formData.get('move_in_date') as string,
    monthlyRent: parseAmountInput(formData.get('monthly_rent') as string),
    depositAmount: parseAmountInput((formData.get('deposit_amount') as string) || '0'),
    leaseEnd: (formData.get('lease_end') as string) || null,
  }
}

function validateAttach(p: AttachTenantParams): string | null {
  if (!p.email.includes('@')) return 'A valid email is required.'
  if (!p.fullName) return 'Full name is required.'
  if (!DATE_RE.test(p.moveInDate ?? '')) return 'Move-in date is required.'
  if (!(p.monthlyRent > 0)) return 'Monthly rent must be more than zero.'
  if (p.leaseEnd && p.leaseEnd < p.moveInDate) return 'Lease end cannot be before move-in.'
  return null
}

/**
 * The login for the incoming tenant: their existing account if this email is
 * already known (a returning tenant keeps their history), otherwise a new one
 * with a random password (they set their own through "Forgot password").
 */
async function findOrCreateLogin(
  admin: AdminClient, email: string,
): Promise<{ error: string } | { id: string; created: boolean }> {
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 })
    if (error) return { error: error.message }
    const found = data.users.find(u => u.email?.toLowerCase() === email)
    if (found) return { id: found.id, created: false }
    if (data.users.length < 1000) break
  }
  const password = crypto.randomUUID().replace(/-/g, '') + 'Aa1!'
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true })
  if (error || !data.user) return { error: error?.message ?? 'Failed to create the login' }
  return { id: data.user.id, created: true }
}

async function afterAttach(admin: AdminClient, login: { id: string; created: boolean }): Promise<string | null> {
  if (login.created) return null
  // A returning tenant may have been archived (login disabled): switch it back on.
  const { error } = await admin.auth.admin.updateUserById(login.id, { ban_duration: 'none' })
  return error ? `The tenant was added, but their login could not be re-enabled: ${error.message}` : null
}

function attachArgs(tenantId: string, p: AttachTenantParams) {
  return {
    p_tenant: tenantId, p_full_name: p.fullName, p_phone: p.phone, p_unit: p.unitId,
    p_move_in: p.moveInDate, p_rent: p.monthlyRent, p_deposit: p.depositAmount, p_lease_end: p.leaseEnd,
  }
}

// Edits everything the landlord entered when creating the tenant: profile
// (name, phone), login email, and the active lease's dates and amounts.
export async function updateTenantDetails(
  tenantId: string,
  leaseId: string | null,
  data: {
    fullName: string
    email: string
    phone: string | null
    moveInDate: string
    leaseStart: string
    leaseEnd: string | null
    rentDueDay: number
    monthlyRent: number
    depositAmount: number
  }
) {
  if (process.env.NEXT_PUBLIC_DEMO_MODE === 'true') {
    revalidatePath('/landlord', 'layout')
    return { success: true }
  }

  const auth = await requireLandlord()
  if (!auth.ok) return { error: auth.error }

  if (!data.fullName) return { error: 'Full name is required.' }
  if (leaseId && (data.rentDueDay < 1 || data.rentDueDay > 31)) {
    return { error: 'Rent due day must be between 1 and 31.' }
  }
  if (leaseId && data.leaseEnd && data.leaseEnd < data.leaseStart) {
    return { error: 'Lease end cannot be before lease start.' }
  }

  const adminClient = await createAdminClient()

  const { data: authUser } = await adminClient.auth.admin.getUserById(tenantId)
  const email = data.email.trim().toLowerCase()
  if (email && authUser.user && authUser.user.email?.toLowerCase() !== email) {
    const { error: emailError } = await adminClient.auth.admin.updateUserById(tenantId, {
      email, email_confirm: true,
    })
    if (emailError) return { error: emailError.message }
  }

  const { error: profileError } = await adminClient
    .from('profiles')
    .update({ full_name: data.fullName, phone: data.phone })
    .eq('id', tenantId)
  if (profileError) return { error: profileError.message }

  if (leaseId) {
    // A rent change here is recorded in rent_schedule from the current month
    // (trigger in migration 09); use "Edit rent" to pick another month.
    const { data: lease, error: leaseError } = await adminClient
      .from('leases')
      .update({
        move_in_date: data.moveInDate,
        lease_start: data.leaseStart,
        lease_end: data.leaseEnd,
        rent_due_day: data.rentDueDay,
        monthly_rent: data.monthlyRent,
        deposit_amount: data.depositAmount,
      })
      .eq('id', leaseId)
      .select('unit_id, status')
      .single()
    if (leaseError) return { error: leaseError.message }

    // Keep the unit's listed rent in step with the tenant's current lease.
    if (lease?.status === 'active') {
      const { error } = await adminClient.from('units').update({ monthly_rent: data.monthlyRent }).eq('id', lease.unit_id)
      if (error) return { error: error.message }
    }
  }

  revalidateAll()
  return { success: true }
}

/** New rent for the unit and its active lease, from `effectiveMonth` on. Past months keep their old rent. */
export async function updateUnitRent(unitId: string, newRent: number, effectiveMonth?: string) {
  if (process.env.NEXT_PUBLIC_DEMO_MODE === 'true') {
    revalidatePath('/landlord', 'layout')
    return { success: true }
  }

  const auth = await requireLandlord()
  if (!auth.ok) return { error: auth.error }
  if (!(newRent > 0)) return { error: 'Rent must be more than zero.' }
  const month = effectiveMonth || currentPeriodMonth()
  if (!MONTH_RE.test(month)) return { error: 'Choose the month the new rent starts.' }

  const { error } = await auth.supabase.rpc('set_unit_rent', { p_unit: unitId, p_rent: newRent, p_effective_month: month })
  if (error) return { error: error.message }

  revalidateAll()
  return { success: true }
}

export async function createTenantAccount(formData: FormData): Promise<Result> {
  if (process.env.NEXT_PUBLIC_DEMO_MODE === 'true') {
    revalidatePath('/landlord', 'layout')
    return { success: true }
  }

  const auth = await requireLandlord()
  if (!auth.ok) return { error: auth.error }

  const params = attachParamsFromFormData(formData)
  const invalid = validateAttach(params)
  if (invalid) return { error: invalid }

  const admin = await createAdminClient()
  const login = await findOrCreateLogin(admin, params.email)
  if ('error' in login) return login

  // Profile, lease and unit status change together (one SQL transaction).
  const { error } = await auth.supabase.rpc('attach_tenant', attachArgs(login.id, params))
  if (error) {
    if (login.created) await admin.auth.admin.deleteUser(login.id)
    return { error: error.message }
  }
  const warning = await afterAttach(admin, login)
  revalidateAll()
  return warning ? { error: warning } : { success: true }
}

/**
 * Ends the lease, vacates the unit and detaches the tenant's profile, in one
 * transaction. The login stays: a former tenant can still see their history
 * and pay what they owe. Use archiveTenant to disable the login.
 */
export async function confirmTenantMoveOut(
  tenantId: string,
  unitId: string,
  leaseId: string,
  moveOutDate: string,
): Promise<Result> {
  if (process.env.NEXT_PUBLIC_DEMO_MODE === 'true') {
    revalidatePath('/landlord', 'layout')
    return { success: true }
  }

  const auth = await requireLandlord()
  if (!auth.ok) return { error: auth.error }
  if (!DATE_RE.test(moveOutDate ?? '')) return { error: 'Choose the move-out date.' }

  const { error } = await auth.supabase.rpc('end_tenancy', { p_lease: leaseId, p_move_out: moveOutDate })
  if (error) return { error: error.message }

  await notify(auth.supabase, {
    user_id: tenantId,
    type: 'tenancy_ended',
    title: 'Your tenancy has ended',
    body: `Your move-out on ${moveOutDate} is confirmed. You can still sign in to see your receipts and pay any balance.`,
    link: '/',
  })
  void unitId
  revalidateAll()
  return { success: true }
}

// Turnover in one step: ends the outgoing tenant's lease and moves the new
// tenant in. Both happen in one SQL transaction, or neither does.
export async function replaceTenant(
  outgoing: { tenantId: string; leaseId: string; unitId: string; moveOutDate: string },
  incoming: FormData,
): Promise<Result> {
  if (process.env.NEXT_PUBLIC_DEMO_MODE === 'true') {
    revalidatePath('/landlord', 'layout')
    return { success: true }
  }

  const auth = await requireLandlord()
  if (!auth.ok) return { error: auth.error }
  if (!DATE_RE.test(outgoing.moveOutDate ?? '')) return { error: 'Choose the move-out date.' }

  const params = attachParamsFromFormData(incoming)
  const invalid = validateAttach(params)
  if (invalid) return { error: invalid }
  if (params.unitId !== outgoing.unitId) return { error: 'The new tenant must move into the same unit.' }

  const admin = await createAdminClient()
  const login = await findOrCreateLogin(admin, params.email)
  if ('error' in login) return login
  if (login.id === outgoing.tenantId) return { error: 'The new tenant is the same person as the outgoing tenant.' }

  const { error } = await auth.supabase.rpc('replace_tenancy', {
    p_old_lease: outgoing.leaseId, p_move_out: outgoing.moveOutDate, ...attachArgs(login.id, params),
  })
  if (error) {
    if (login.created) await admin.auth.admin.deleteUser(login.id)
    return { error: error.message }
  }
  const warning = await afterAttach(admin, login)

  await notify(auth.supabase, {
    user_id: outgoing.tenantId,
    type: 'tenancy_ended',
    title: 'Your tenancy has ended',
    body: `Your move-out on ${outgoing.moveOutDate} is confirmed. You can still sign in to see your receipts and pay any balance.`,
    link: '/',
  })
  revalidateAll()
  return warning ? { error: warning } : { success: true }
}

/** Disables a former tenant's login. Their history is kept. */
export async function archiveTenant(tenantId: string): Promise<Result> {
  if (process.env.NEXT_PUBLIC_DEMO_MODE === 'true') return { success: true }
  const auth = await requireLandlord()
  if (!auth.ok) return { error: auth.error }

  const admin = await createAdminClient()
  const [{ data: profile }, { count: activeLeases }] = await Promise.all([
    admin.from('profiles').select('role, unit_id').eq('id', tenantId).maybeSingle(),
    admin.from('leases').select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId).eq('status', 'active'),
  ])
  if (profile?.role !== 'tenant') return { error: 'Only tenant accounts can be archived.' }
  if (profile.unit_id || (activeLeases ?? 0) > 0) return { error: 'Confirm the move-out before archiving this tenant.' }

  const { error } = await admin.auth.admin.updateUserById(tenantId, { ban_duration: '876600h' })
  if (error) return { error: error.message }
  const { error: pushError } = await admin.from('push_subscriptions').delete().eq('user_id', tenantId)
  if (pushError) return { error: pushError.message }

  revalidateAll()
  return { success: true }
}

export async function resetTenantPassword(tenantId: string, newPassword: string) {
  if (process.env.NEXT_PUBLIC_DEMO_MODE === 'true') return { success: true }

  if (newPassword.length < 8) return { error: 'Password must be at least 8 characters.' }

  const auth = await requireLandlord()
  if (!auth.ok) return { error: auth.error }

  const adminClient = await createAdminClient()
  const { error } = await adminClient.auth.admin.updateUserById(tenantId, { password: newPassword })
  if (error) return { error: error.message }

  return { success: true }
}

const MAX_CONTRACT_SIZE = 15 * 1024 * 1024 // 15MB
const ALLOWED_CONTRACT_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp']

export async function uploadLeaseContract(leaseId: string, formData: FormData) {
  if (process.env.NEXT_PUBLIC_DEMO_MODE === 'true') return { success: true }

  const auth = await requireLandlord()
  if (!auth.ok) return { error: auth.error }
  const supabase = auth.supabase

  const file = formData.get('contract') as File | null
  if (!file || file.size === 0) return { error: 'No file selected' }
  if (file.size > MAX_CONTRACT_SIZE) return { error: 'File is too large (max 15MB).' }
  if (!ALLOWED_CONTRACT_TYPES.includes(file.type)) return { error: 'Only PDF, JPG, PNG, or WEBP files are allowed.' }

  const ext = (file.name.split('.').pop() ?? 'pdf').replace(/[^a-z0-9]/gi, '').slice(0, 5) || 'pdf'
  const path = `${leaseId}/contract.${ext}`

  const { error: uploadError } = await supabase.storage
    .from('lease-contracts')
    .upload(path, file, { upsert: true })
  if (uploadError) return { error: uploadError.message }

  const { error } = await supabase.from('leases').update({ contract_path: path }).eq('id', leaseId)
  if (error) return { error: error.message }

  revalidateAll()
  return { success: true }
}
