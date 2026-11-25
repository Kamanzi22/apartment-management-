import { type NextRequest, NextResponse } from 'next/server'
import { updateSession } from '@/lib/supabase/middleware'

// Next 16: the `middleware` file convention is deprecated and renamed to `proxy`.
export async function proxy(request: NextRequest) {
  const moved = redirectToPublicAddress(request)
  if (moved) return moved
  if (process.env.NEXT_PUBLIC_DEMO_MODE === 'true') return NextResponse.next()
  return await updateSession(request)
}

// If PUBLIC_APP_URL points at a different address than the onrender.com one the
// request arrived on, send GET/HEAD page requests there. Requests that already
// carry x-proxy-host pass through. API routes are left alone so UptimeRobot and
// cron calls keep reaching Render directly. (Render onrender.com only; no
// other proxy or CDN is assumed.)
function redirectToPublicAddress(request: NextRequest) {
  const target = process.env.PUBLIC_APP_URL?.trim()
  if (!target || request.headers.has('x-proxy-host')) return null
  if (request.method !== 'GET' && request.method !== 'HEAD') return null
  const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host') ?? ''
  if (!host.endsWith('.onrender.com')) return null
  // PUBLIC_APP_URL may be this same onrender.com address: redirecting would loop.
  let targetHost: string
  try { targetHost = new URL(target).host } catch { return null }
  if (targetHost === host) return null
  const { pathname, search } = request.nextUrl
  if (pathname.startsWith('/api/')) return null
  return NextResponse.redirect(new URL(pathname + search, target), 307)
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|manifest.json|sw.js|api/health|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
