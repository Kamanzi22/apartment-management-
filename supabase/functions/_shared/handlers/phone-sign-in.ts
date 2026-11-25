// phone-sign-in: { phone, password } -> a session, or one generic error.
// The tenant's email never leaves the server, and a wrong number and a wrong
// password look the same (same message, same status, similar time), so the
// endpoint cannot be used to find out who lives here.
//
// phone_sign_in_lookup() (migration 17) is EXECUTE-able by service_role only,
// counts every attempt per number and per hashed client IP, and says
// "limited" the same way whether or not the number exists.

import { HttpError } from '../http.ts'
import { parsePhoneSignIn } from '../validate.ts'
import type { Ctx } from '../ports.ts'

export const GENERIC_ERROR = 'Invalid credentials. Check your email/phone and password.'
export const NETWORK_ERROR = 'Could not reach the server. Check your connection and try again.'
export const LIMITED_ERROR = 'Too many attempts. Try again in a few minutes.'

export interface PhoneSignInResult {
  ok: true
  session: { access_token: string; refresh_token: string; expires_at: number | null; expires_in: number }
}

export async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('')
}

/** Peppered so the stored hash cannot be reversed by trying every IPv4 address. */
export async function clientKey(ip: string | null, pepper: string): Promise<string | null> {
  return ip ? sha256Hex(`${pepper}:${ip}`) : null
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

export async function phoneSignIn(
  ctx: Ctx, body: Record<string, unknown>, _req?: Request,
  opts: { padMs?: () => number } = {},
): Promise<PhoneSignInResult> {
  const p = parsePhoneSignIn(body)
  if (!p.ok) throw new HttpError('unauthorized', GENERIC_ERROR)
  if (!ctx.env.phoneLookupPepper) {
    ctx.log('phone-sign-in: PHONE_LOOKUP_PEPPER is not set')
    throw new HttpError('unavailable', NETWORK_ERROR)
  }

  // Owner decision 25 Nov: only the PER-NUMBER limit is enforced (5 per 15 min, in the database).
  // The client IP header is NOT trusted: a caller can set x-forwarded-for, which would let them dodge
  // a per-client limit or burn someone else's. So p_client_key is always null, and the hashed IP is
  // only logged (best effort, for investigating abuse).
  // TODO(before launch): confirm with Supabase that the Edge gateway overwrites the forwarded IP
  // header so it cannot be spoofed; only then pass the hash as p_client_key to enforce it.
  const ipHash = await clientKey(ctx.clientIp, ctx.env.phoneLookupPepper)
  if (ipHash) ctx.log(`phone-sign-in: attempt, client hash ${ipHash.slice(0, 8)} (logged only, not enforced)`)
  const { data, error } = await ctx.admin.rpc<{ email: string | null; limited: boolean }[]>(
    'phone_sign_in_lookup', { p_phone: p.value.phone, p_client_key: null })
  if (error) {
    ctx.log(`phone-sign-in: lookup failed (${error.code ?? 'no code'})`)
    throw new HttpError('unavailable', NETWORK_ERROR)
  }
  const row = Array.isArray(data) ? data[0] : null
  if (row?.limited) throw new HttpError('rate_limited', LIMITED_ERROR)

  if (!row?.email) {
    // No Auth call for an unknown number (Auth's own per-IP limit is shared by
    // every phone, since all requests come from the function's IP). Pad the
    // time instead so "unknown number" is not visibly faster than "wrong password".
    await sleep(opts.padMs ? opts.padMs() : 250 + Math.floor(Math.random() * 200))
    throw new HttpError('unauthorized', GENERIC_ERROR)
  }

  const res = await ctx.anon.signInWithPassword(row.email, p.value.password)
  if (res.error) {
    if (res.error.status === 429) throw new HttpError('rate_limited', LIMITED_ERROR)
    if (res.error.status && res.error.status >= 500) throw new HttpError('unavailable', NETWORK_ERROR)
    throw new HttpError('unauthorized', GENERIC_ERROR)
  }
  const s = res.session
  return { ok: true, session: { access_token: s.access_token, refresh_token: s.refresh_token, expires_at: s.expires_at, expires_in: s.expires_in } }
}
