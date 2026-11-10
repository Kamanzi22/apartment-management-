import { type NextRequest, NextResponse } from 'next/server'
import { updateSession } from '@/lib/supabase/middleware'

// Next 16: the `middleware` file convention is deprecated and renamed to `proxy`.
export async function proxy(request: NextRequest) {
  if (process.env.NEXT_PUBLIC_DEMO_MODE === 'true') return NextResponse.next()
  return await updateSession(request)
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|manifest.json|sw.js|api/health|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
