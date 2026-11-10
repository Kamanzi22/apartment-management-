// Kept identical in apartment-manager and apartment-manager-tenant.
//
// Render runs the app behind a proxy, so request.url is the internal address
// (http://localhost:10000). Links and redirects must use the public address.
// PUBLIC_APP_URL, when set, always wins: it stops a forged X-Forwarded-Host
// header from pointing a password-reset link at someone else's site.

function fromParts(host: string | null, proto: string | null): string | null {
  const h = host?.split(',')[0].trim()
  if (!h) return null
  const local = h.startsWith('localhost') || h.startsWith('127.0.0.1')
  const p = proto?.split(',')[0].trim() || (local ? 'http' : 'https')
  return `${p}://${h}`
}

function configured(): string | null {
  const v = process.env.PUBLIC_APP_URL?.trim()
  return v ? v.replace(/\/+$/, '') : null
}

export function publicOrigin(request: Request): string {
  const h = request.headers
  return configured()
    ?? fromParts(h.get('x-forwarded-host') ?? h.get('host'), h.get('x-forwarded-proto'))
    ?? new URL(request.url).origin
}

/** Same, for Server Actions (no Request object). */
export async function publicOriginFromHeaders(): Promise<string> {
  const { headers } = await import('next/headers')
  const h = await headers()
  return configured()
    ?? fromParts(h.get('x-forwarded-host') ?? h.get('host'), h.get('x-forwarded-proto'))
    ?? 'http://localhost:3000'
}
