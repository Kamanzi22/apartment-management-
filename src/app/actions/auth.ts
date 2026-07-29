'use server'

import { createClient, createAdminClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'

export async function signOut() {
  const supabase = await createClient()
  await supabase.auth.signOut()
  redirect('/login')
}

export async function lookupEmailByName(name: string): Promise<string | null> {
  const admin = await createAdminClient()
  const { data: profiles } = await admin
    .from('profiles')
    .select('id, full_name')
    .eq('role', 'landlord')

  if (!profiles?.length) return null

  const match = profiles.find(
    p => p.full_name?.toLowerCase().includes(name.toLowerCase())
  )
  if (!match) return null

  const { data } = await admin.auth.admin.getUserById(match.id)
  return data.user?.email ?? null
}

export async function registerLandlord(
  formData: FormData
): Promise<{ error?: string; email?: string }> {
  const email    = (formData.get('email')     as string).trim()
  const password = formData.get('password')   as string
  const fullName = (formData.get('full_name') as string).trim()

  if (!email || !password || !fullName) return { error: 'Name, email and password are required.' }
  if (password.length < 8) return { error: 'Password must be at least 8 characters.' }

  const admin = await createAdminClient()

  const { data: newUser, error: createError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  })

  if (createError || !newUser.user) {
    return { error: createError?.message ?? 'Failed to create account.' }
  }

  const { error: profileError } = await admin.from('profiles').insert({
    id: newUser.user.id,
    role: 'landlord',
    full_name: fullName,
    phone: null,
    unit_id: null,
  })

  if (profileError) {
    await admin.auth.admin.deleteUser(newUser.user.id)
    return { error: profileError.message }
  }

  return { email }
}
