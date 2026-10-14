'use server'

import { createClient, createAdminClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { parseAmountInput } from '@/lib/currency'

type AdminClient = Awaited<ReturnType<typeof createAdminClient>>

// Ends the active lease, vacates the unit, detaches the tenant's profile from
// it, and disables their login — but keeps the profile and all history
// (payments, maintenance, messages) intact so it can be picked back up later.
async function detachTenant(
  adminClient: AdminClient,
  { tenantId, leaseId, unitId, moveOutDate }: { tenantId: string; leaseId: string; unitId: string; moveOutDate: string }
) {
  await adminClient.auth.admin.updateUserById(tenantId, { ban_duration: '876600h' })
  await adminClient.from('profiles').update({ unit_id: null }).eq('id', tenantId)
  await adminClient.from('leases').update({ status: 'ended', lease_end: moveOutDate }).eq('id', leaseId)
  await adminClient.from('units').update({ status: 'vacant' }).eq('id', unitId)
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

// Creates a fresh tenant account for this unit, or — if a profile with this
// email already exists and is currently detached from any unit (i.e. a
// former tenant who moved out) — reactivates that same account instead, so
// their old payment/maintenance history is picked back up rather than
// starting a new, disconnected record.
async function attachTenant(
  adminClient: AdminClient, params: AttachTenantParams
): Promise<{ error: string } | { success: true }> {
  const { email, fullName, phone, unitId, moveInDate, monthlyRent, depositAmount, leaseEnd } = params

  let tenantId: string
  const { data: existingUsers } = await adminClient.auth.admin.listUsers({ perPage: 1000 })
  const existingUser = existingUsers?.users.find(u => u.email?.toLowerCase() === email.toLowerCase())

  if (existingUser) {
    const { data: existingProfile } = await adminClient
      .from('profiles').select('role, unit_id').eq('id', existingUser.id).single()

    if (!existingProfile || existingProfile.role !== 'tenant') {
      return { error: 'That email is already in use by a non-tenant account.' }
    }
    if (existingProfile.unit_id) {
      return { error: 'That email belongs to a tenant currently assigned to another unit.' }
    }

    tenantId = existingUser.id
    await adminClient.auth.admin.updateUserById(tenantId, { ban_duration: 'none' })
    await adminClient.from('profiles').update({ full_name: fullName, phone, unit_id: unitId }).eq('id', tenantId)
  } else {
    // Generate a random password — tenant sets their own via "Forgot Password"
    const password = crypto.randomUUID().replace(/-/g, '') + 'Aa1!'
    const { data: newUser, error: createError } = await adminClient.auth.admin.createUser({
      email, password, email_confirm: true,
    })
    if (createError || !newUser.user) {
      return { error: createError?.message ?? 'Failed to create user' }
    }
    tenantId = newUser.user.id

    const { error: profileError } = await adminClient.from('profiles').insert({
      id: tenantId, role: 'tenant', full_name: fullName, phone, unit_id: unitId,
    })
    if (profileError) {
      await adminClient.auth.admin.deleteUser(tenantId)
      return { error: profileError.message }
    }
  }

  const rentDueDay = new Date(moveInDate).getDate()
  const { error: leaseError } = await adminClient.from('leases').insert({
    unit_id: unitId,
    tenant_id: tenantId,
    move_in_date: moveInDate,
    rent_due_day: rentDueDay,
    monthly_rent: monthlyRent,
    deposit_amount: depositAmount,
    lease_start: moveInDate,
    lease_end: leaseEnd || null,
    status: 'active',
  })
  if (leaseError) {
    if (!existingUser) await adminClient.auth.admin.deleteUser(tenantId)
    return { error: leaseError.message }
  }

  await adminClient.from('units').update({ status: 'occupied' }).eq('id', unitId)
  return { success: true as const }
}

function attachParamsFromFormData(formData: FormData): AttachTenantParams {
  return {
    email: formData.get('email') as string,
    fullName: formData.get('full_name') as string,
    phone: (formData.get('phone') as string) || null,
    unitId: formData.get('unit_id') as string,
    moveInDate: formData.get('move_in_date') as string,
    monthlyRent: parseAmountInput(formData.get('monthly_rent') as string),
    depositAmount: parseAmountInput((formData.get('deposit_amount') as string) || '0'),
    leaseEnd: (formData.get('lease_end') as string) || null,
  }
}

export async function updateTenantInfo(
  tenantId: string,
  data: { fullName: string; phone: string | null }
) {
  if (process.env.NEXT_PUBLIC_DEMO_MODE === 'true') {
    revalidatePath('/landlord', 'layout')
    return { success: true }
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const { data: profile } = await supabase
    .from('profiles').select('role').eq('id', user.id).single()
  if (profile?.role !== 'landlord') return { error: 'Not authorized' }

  const adminClient = await createAdminClient()

  const { error: profileError } = await adminClient
    .from('profiles')
    .update({ full_name: data.fullName, phone: data.phone })
    .eq('id', tenantId)
  if (profileError) return { error: profileError.message }

  revalidatePath('/landlord', 'layout')
  return { success: true }
}

export async function updateUnitRent(unitId: string, newRent: number) {
  if (process.env.NEXT_PUBLIC_DEMO_MODE === 'true') {
    revalidatePath('/landlord', 'layout')
    return { success: true }
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const { data: profile } = await supabase
    .from('profiles').select('role').eq('id', user.id).single()
  if (profile?.role !== 'landlord') return { error: 'Not authorized' }

  await supabase.from('units').update({ monthly_rent: newRent }).eq('id', unitId)
  await supabase.from('leases')
    .update({ monthly_rent: newRent })
    .eq('unit_id', unitId)
    .eq('status', 'active')

  revalidatePath('/landlord', 'layout')
  return { success: true }
}

export async function updateLeaseInfo(
  leaseId: string,
  data: {
    moveInDate: string
    leaseStart: string
    leaseEnd: string | null
    rentDueDay: number
    depositAmount: number
  }
) {
  if (process.env.NEXT_PUBLIC_DEMO_MODE === 'true') {
    revalidatePath('/landlord', 'layout')
    return { success: true }
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const { data: profile } = await supabase
    .from('profiles').select('role').eq('id', user.id).single()
  if (profile?.role !== 'landlord') return { error: 'Not authorized' }

  const { error } = await supabase
    .from('leases')
    .update({
      move_in_date: data.moveInDate,
      lease_start: data.leaseStart,
      lease_end: data.leaseEnd,
      rent_due_day: data.rentDueDay,
      deposit_amount: data.depositAmount,
    })
    .eq('id', leaseId)

  if (error) return { error: error.message }

  revalidatePath('/landlord', 'layout')
  return { success: true }
}

export async function createTenantAccount(formData: FormData) {
  if (process.env.NEXT_PUBLIC_DEMO_MODE === 'true') {
    revalidatePath('/landlord', 'layout')
    return { success: true }
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const { data: profile } = await supabase
    .from('profiles').select('role').eq('id', user.id).single()
  if (profile?.role !== 'landlord') return { error: 'Not authorized' }

  const adminClient = await createAdminClient()
  const result = await attachTenant(adminClient, attachParamsFromFormData(formData))
  if ('error' in result) return result

  revalidatePath('/landlord', 'layout')
  return { success: true }
}

export async function confirmTenantMoveOut(
  tenantId: string,
  unitId: string,
  leaseId: string,
  moveOutDate: string,
) {
  if (process.env.NEXT_PUBLIC_DEMO_MODE === 'true') {
    revalidatePath('/landlord', 'layout')
    return { success: true }
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const { data: profile } = await supabase
    .from('profiles').select('role').eq('id', user.id).single()
  if (profile?.role !== 'landlord') return { error: 'Not authorized' }

  const adminClient = await createAdminClient()
  await detachTenant(adminClient, { tenantId, leaseId, unitId, moveOutDate })

  revalidatePath('/landlord', 'layout')
  return { success: true }
}

// Turnover in one step: ends the outgoing tenant's lease and detaches them
// (history preserved, login disabled), then immediately attaches the new
// tenant to the same unit.
export async function replaceTenant(
  outgoing: { tenantId: string; leaseId: string; unitId: string; moveOutDate: string },
  incoming: FormData,
): Promise<{ error: string } | { success: true }> {
  if (process.env.NEXT_PUBLIC_DEMO_MODE === 'true') {
    revalidatePath('/landlord', 'layout')
    return { success: true }
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const { data: profile } = await supabase
    .from('profiles').select('role').eq('id', user.id).single()
  if (profile?.role !== 'landlord') return { error: 'Not authorized' }

  const adminClient = await createAdminClient()
  await detachTenant(adminClient, outgoing)

  const result = await attachTenant(adminClient, attachParamsFromFormData(incoming))
  if ('error' in result) return result

  revalidatePath('/landlord', 'layout')
  return { success: true }
}

export async function resetTenantPassword(tenantId: string, newPassword: string) {
  if (process.env.NEXT_PUBLIC_DEMO_MODE === 'true') return { success: true }

  if (newPassword.length < 8) return { error: 'Password must be at least 8 characters.' }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const { data: profile } = await supabase
    .from('profiles').select('role').eq('id', user.id).single()
  if (profile?.role !== 'landlord') return { error: 'Not authorized' }

  const adminClient = await createAdminClient()
  const { error } = await adminClient.auth.admin.updateUserById(tenantId, { password: newPassword })
  if (error) return { error: error.message }

  return { success: true }
}

const MAX_CONTRACT_SIZE = 15 * 1024 * 1024 // 15MB
const ALLOWED_CONTRACT_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp']

export async function uploadLeaseContract(leaseId: string, formData: FormData) {
  if (process.env.NEXT_PUBLIC_DEMO_MODE === 'true') return { success: true }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const { data: profile } = await supabase
    .from('profiles').select('role').eq('id', user.id).single()
  if (profile?.role !== 'landlord') return { error: 'Not authorized' }

  const file = formData.get('contract') as File | null
  if (!file || file.size === 0) return { error: 'No file selected' }
  if (file.size > MAX_CONTRACT_SIZE) return { error: 'File is too large (max 15MB).' }
  if (!ALLOWED_CONTRACT_TYPES.includes(file.type)) return { error: 'Only PDF, JPG, PNG, or WEBP files are allowed.' }

  const ext = file.name.split('.').pop()
  const path = `${leaseId}/contract.${ext}`

  const { error: uploadError } = await supabase.storage
    .from('lease-contracts')
    .upload(path, file, { upsert: true })
  if (uploadError) return { error: uploadError.message }

  const { error } = await supabase.from('leases').update({ contract_path: path }).eq('id', leaseId)
  if (error) return { error: error.message }

  revalidatePath('/landlord', 'layout')
  revalidatePath('/tenant', 'layout')
  return { success: true }
}
