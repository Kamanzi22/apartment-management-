// Kept identical in apartment-manager and apartment-manager-tenant.
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { NextResponse, type NextRequest } from 'next/server'
import type { EmailOtpType } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/database.types'
import { publicOrigin } from '@/lib/public-origin'

// Finishes an email link (password reset) or a Google sign-in, then continues
// to `next`. Redirects use the public address, not Render's internal one.
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const origin = publicOrigin(request)
  const code = searchParams.get('code')
  const tokenHash = searchParams.get('token_hash')
  const type = searchParams.get('type') as EmailOtpType | null
  // Only allow same-site relative paths
  const nextParam = searchParams.get('next') ?? '/'
  const next = nextParam.startsWith('/') && !nextParam.startsWith('//') && !nextParam.includes('\\') ? nextParam : '/'
  const failure = tokenHash ? 'invalid_link' : 'google_failed'

  if (searchParams.get('error') || searchParams.get('error_description')) {
    return NextResponse.redirect(`${origin}/login?error=${failure}`)
  }

  if (code || (tokenHash && type)) {
    const cookieStore = await cookies()
    const supabase = createServerClient<Database>(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() { return cookieStore.getAll() },
          setAll(cookiesToSet) {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          },
        },
      }
    )

    const { error } = tokenHash && type
      ? await supabase.auth.verifyOtp({ token_hash: tokenHash, type })
      : await supabase.auth.exchangeCodeForSession(code!)
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`)
    }
  }

  return NextResponse.redirect(`${origin}/login?error=${failure}`)
}
