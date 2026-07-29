'use server'

import { createClient, createAdminClient } from '@/lib/supabase/server'

export async function updateLandlordEmail(formData: FormData): Promise<{ error?: string; success?: boolean }> {
  const currentPassword = formData.get('current_password') as string
  const newEmail = (formData.get('new_email') as string).trim().toLowerCase()

  if (!currentPassword || !newEmail) return { error: 'All fields are required.' }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user?.email) return { error: 'Not authenticated.' }

  if (newEmail === user.email) return { error: 'New email is the same as current email.' }

  // Verify current password
  const { error: signInError } = await supabase.auth.signInWithPassword({
    email: user.email,
    password: currentPassword,
  })
  if (signInError) return { error: 'Current password is incorrect.' }

  // Update email via admin (takes effect immediately, no confirmation email)
  const admin = await createAdminClient()
  const { error: updateError } = await admin.auth.admin.updateUserById(user.id, {
    email: newEmail,
    email_confirm: true,
  })
  if (updateError) return { error: updateError.message }

  return { success: true }
}

export async function updateLandlordPassword(formData: FormData): Promise<{ error?: string; success?: boolean }> {
  const currentPassword = formData.get('current_password') as string
  const newPassword = formData.get('new_password') as string
  const confirmPassword = formData.get('confirm_password') as string

  if (!currentPassword || !newPassword || !confirmPassword) return { error: 'All fields are required.' }
  if (newPassword.length < 8) return { error: 'New password must be at least 8 characters.' }
  if (newPassword !== confirmPassword) return { error: 'New passwords do not match.' }
  if (newPassword === currentPassword) return { error: 'New password must differ from current password.' }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user?.email) return { error: 'Not authenticated.' }

  // Verify current password
  const { error: signInError } = await supabase.auth.signInWithPassword({
    email: user.email,
    password: currentPassword,
  })
  if (signInError) return { error: 'Current password is incorrect.' }

  // Update password via admin
  const admin = await createAdminClient()
  const { error: updateError } = await admin.auth.admin.updateUserById(user.id, {
    password: newPassword,
  })
  if (updateError) return { error: updateError.message }

  return { success: true }
}
