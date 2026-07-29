'use server'

import { createClient, createAdminClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'

export async function updateTenantInfo(
  tenantId: string,
  data: { fullName: string; email: string; phone: string | null }
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

  const { error: authError } = await adminClient.auth.admin.updateUserById(tenantId, {
    email: data.email,
  })
  if (authError) return { error: authError.message }

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
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  if (profile?.role !== 'landlord') return { error: 'Not authorized' }

  const email = formData.get('email') as string
  const fullName = formData.get('full_name') as string
  // Generate a random password — tenant sets their own via "Forgot Password"
  const password = crypto.randomUUID().replace(/-/g, '') + 'Aa1!'
  const phone = (formData.get('phone') as string) || null
  const unitId = formData.get('unit_id') as string
  const moveInDate = formData.get('move_in_date') as string
  const monthlyRent = parseFloat(formData.get('monthly_rent') as string)
  const depositAmount = parseFloat((formData.get('deposit_amount') as string) || '0')
  const leaseEnd = (formData.get('lease_end') as string) || null

  const adminClient = await createAdminClient()

  // Create auth user
  const { data: newUser, error: createError } = await adminClient.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  })

  if (createError || !newUser.user) {
    return { error: createError?.message ?? 'Failed to create user' }
  }

  const newUserId = newUser.user.id

  // Create profile (bypasses RLS via admin client)
  const { error: profileError } = await adminClient.from('profiles').insert({
    id: newUserId,
    role: 'tenant',
    full_name: fullName,
    phone,
    unit_id: unitId,
  })

  if (profileError) {
    await adminClient.auth.admin.deleteUser(newUserId)
    return { error: profileError.message }
  }

  // Derive rent_due_day from move_in_date
  const rentDueDay = new Date(moveInDate).getDate()

  // Create lease
  const { error: leaseError } = await adminClient.from('leases').insert({
    unit_id: unitId,
    tenant_id: newUserId,
    move_in_date: moveInDate,
    rent_due_day: rentDueDay,
    monthly_rent: monthlyRent,
    deposit_amount: depositAmount,
    lease_start: moveInDate,
    lease_end: leaseEnd || null,
    status: 'active',
  })

  if (leaseError) {
    await adminClient.auth.admin.deleteUser(newUserId)
    return { error: leaseError.message }
  }

  // Mark unit as occupied
  await adminClient.from('units').update({ status: 'occupied' }).eq('id', unitId)

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

  // Ban the auth user permanently so they can't log in — profile and all history is kept
  await adminClient.auth.admin.updateUserById(tenantId, { ban_duration: '876600h' })

  // Detach tenant from unit (profile stays, history stays)
  await adminClient.from('profiles').update({ unit_id: null }).eq('id', tenantId)

  // End the lease
  await adminClient.from('leases')
    .update({ status: 'ended', lease_end: moveOutDate })
    .eq('id', leaseId)

  // Mark unit vacant
  await adminClient.from('units').update({ status: 'vacant' }).eq('id', unitId)

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
