import { NextResponse, type NextRequest } from 'next/server'
import { createAdminClient, createClient } from '@/lib/supabase/server'
import { publicOrigin } from '@/lib/public-origin'

// After Google sign-in. Only existing landlord profiles get in; Google never
// creates a landlord. Everyone else is signed out again.
export async function GET(request: NextRequest) {
  const origin = publicOrigin(request)
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.redirect(`${origin}/login?error=google_failed`)

  const admin = await createAdminClient()
  const { data: profile } = await admin.from('profiles').select('role').eq('id', user.id).maybeSingle()
  if (profile?.role === 'landlord') return NextResponse.redirect(`${origin}/landlord`)

  await supabase.auth.signOut()
  return NextResponse.redirect(`${origin}/login?error=not_landlord`)
}
