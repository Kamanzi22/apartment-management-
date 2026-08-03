import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import type { Database } from './database.types'

export async function updateSession(request: NextRequest) {
  // Defense in depth: strip any client-supplied value before we set our own
  // trusted one below, so a forged header can never reach the app.
  request.headers.delete('x-verified-user-id')

  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  const { data: { user } } = await supabase.auth.getUser()

  const pathname = request.nextUrl.pathname

  const isAuthPage = pathname === '/login'
  const isPublicPath = pathname === '/' || isAuthPage || pathname === '/setup' || pathname.startsWith('/api/')

  if (!user && !isPublicPath) {
    return NextResponse.redirect(new URL('/login', request.url))
  }

  if (user && isAuthPage) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single()

    if (profile?.role === 'landlord') {
      return NextResponse.redirect(new URL('/landlord', request.url))
    } else if (profile?.role === 'tenant') {
      return NextResponse.redirect(new URL('/tenant', request.url))
    }
  }

  if (!user) return supabaseResponse

  // Forward the id this request already proved is authenticated, so Server
  // Components can skip a second auth.getUser() network round trip for the
  // same navigation instead of re-verifying with Supabase.
  request.headers.set('x-verified-user-id', user.id)
  const response = NextResponse.next({ request })
  supabaseResponse.cookies.getAll().forEach(cookie => response.cookies.set(cookie))
  return response
}
