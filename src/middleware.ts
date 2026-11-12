import { type NextRequest, NextResponse } from 'next/server'
import { updateSession } from '@/lib/supabase/middleware'

export async function middleware(request: NextRequest) {
  const moved = redirectToPublicAddress(request)
  if (moved) return moved
  if (process.env.NEXT_PUBLIC_DEMO_MODE === 'true') return NextResponse.next()
  return await updateSession(request)
}

// Old onrender.com links go to the Cloudflare address in PUBLIC_APP_URL, which
// shows a branded page while Render wakes the app. Requests forwarded by that
// proxy carry x-proxy-host and pass through. API routes are left alone so
// UptimeRobot and cron calls keep reaching Render directly.
function redirectToPublicAddress(request: NextRequest) {
  const target = process.env.PUBLIC_APP_URL?.trim()
  if (!target || request.headers.has('x-proxy-host')) return null
  if (request.method !== 'GET' && request.method !== 'HEAD') return null
  const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host') ?? ''
  if (!host.endsWith('.onrender.com')) return null
  const { pathname, search } = request.nextUrl
  if (pathname.startsWith('/api/')) return null
  return NextResponse.redirect(new URL(pathname + search, target), 307)
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|manifest.json|sw.js|api/health|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
