'use server'

import { createClient, createAdminClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { emailConfigured, emailLayout, sendEmail } from '@/lib/email'
import { publicOriginFromHeaders } from '@/lib/public-origin'

export async function signOut() {
  const supabase = await createClient()
  await supabase.auth.signOut()
  redirect('/login')
}

// Same message whether or not the account exists, so the login form cannot be
// used to find out who has an account.
const GENERIC_ERROR = 'Invalid name, email or password.'
const NETWORK_ERROR = 'Could not reach the server. Check your connection and try again.'

async function landlordEmailForName(name: string): Promise<string | null> {
  const admin = await createAdminClient()
  const { data: profiles } = await admin.from('profiles').select('id, full_name').eq('role', 'landlord')
  const q = name.trim().toLowerCase()
  const matches = (profiles ?? []).filter(p => p.full_name?.toLowerCase().includes(q))
  const exact = matches.filter(p => p.full_name.trim().toLowerCase() === q)
  const match = exact.length === 1 ? exact[0] : matches.length === 1 ? matches[0] : null
  if (!match) return null
  const { data } = await admin.auth.admin.getUserById(match.id)
  return data.user?.email ?? null
}

/**
 * Signs in with a name or an email. The email for a name is looked up and
 * used here on the server; it is never sent to the browser.
 */
export async function signInWithIdentifier(
  identifier: string,
  password: string,
): Promise<{ error?: string; redirectTo?: string }> {
  const id = (identifier ?? '').trim()
  if (!id || !password) return { error: GENERIC_ERROR }

  try {
    const email = id.includes('@') ? id : await landlordEmailForName(id)
    if (!email) return { error: GENERIC_ERROR }

    const supabase = await createClient()
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })
    if (error || !data.user) {
      return { error: error?.status && error.status >= 500 ? NETWORK_ERROR : GENERIC_ERROR }
    }

    const { data: profile } = await supabase.from('profiles').select('role').eq('id', data.user.id).maybeSingle()
    if (profile?.role === 'landlord') return { redirectTo: '/landlord' }
    if (profile?.role === 'tenant') return { redirectTo: '/tenant' }
    await supabase.auth.signOut()
    return { error: 'Account not configured. Contact your landlord.' }
  } catch {
    return { error: NETWORK_ERROR }
  }
}

/** "Forgot password" for landlord accounts, through Brevo and /auth/confirm. */
export async function sendPasswordResetEmail(email: string): Promise<{ error?: string }> {
  if (!emailConfigured()) {
    return { error: 'Password reset email is not set up yet (BREVO_API_KEY and EMAIL_FROM).' }
  }
  const address = (email ?? '').trim().toLowerCase()
  if (!address.includes('@')) return {}

  const admin = await createAdminClient()
  const { data, error } = await admin.auth.admin.generateLink({ type: 'recovery', email: address })
  // Generic success either way, so this cannot reveal which emails are registered.
  if (error || !data?.properties?.hashed_token || !data.user) return {}
  const { data: profile } = await admin.from('profiles').select('role').eq('id', data.user.id).maybeSingle()
  if (profile?.role !== 'landlord') return {}

  const origin = await publicOriginFromHeaders()
  const link = `${origin}/auth/confirm?token_hash=${encodeURIComponent(data.properties.hashed_token)}&type=recovery&next=/reset-password`
  const ok = await sendEmail(address, 'Reset your Apartment Manager password', emailLayout(
    'Password reset',
    'Click the button below to set a new password for your landlord account. This link expires in 24&nbsp;hours. If you did not ask for this, ignore this email.',
    { href: link, label: 'Reset password' },
  ))
  return ok ? {} : { error: 'Failed to send email. Please try again.' }
}
