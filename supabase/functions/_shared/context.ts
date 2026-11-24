// Who is calling. Pure: the Auth lookup and the profile read are injected.
//
// The JWT is verified by Supabase Auth (getUser), not by decoding it here, so
// a forged or expired token gives caller = null. The role comes from
// public.profiles read with the caller's own client (RLS), never from
// user_metadata or the request body.

import type { Caller, Role } from './authz.ts'

export interface CallerLookups {
  getUser(jwt: string): Promise<{ id: string; email: string | null } | null>
  getProfile(id: string): Promise<{ role: Role; deleted_at: string | null } | null>
}

export async function resolveCaller(jwt: string | null, l: CallerLookups): Promise<Caller | null> {
  if (!jwt) return null
  // The publishable / anon key on its own is not a user.
  if (jwt.startsWith('sb_publishable_') || jwt.startsWith('sb_secret_')) return null
  let user: { id: string; email: string | null } | null = null
  try { user = await l.getUser(jwt) } catch { user = null }
  if (!user) return null
  const profile = await l.getProfile(user.id)
  return { id: user.id, email: user.email, role: profile?.role ?? null, deletedAt: profile?.deleted_at ?? null }
}

/** iat claim of a JWT, read without verifying (only used after getUser accepted the token). */
export function jwtIssuedAt(jwt: string | null): number | null {
  if (!jwt) return null
  const part = jwt.split('.')[1]
  if (!part) return null
  try {
    const b64 = part.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(part.length / 4) * 4, '=')
    const claims = JSON.parse(atob(b64)) as { iat?: unknown }
    return typeof claims.iat === 'number' ? claims.iat : null
  } catch {
    return null
  }
}
