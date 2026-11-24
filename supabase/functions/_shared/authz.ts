// Authorization decisions, kept pure so they can be unit-tested.
// The database still re-checks everything (RLS, caller_is_admin(), guard
// triggers): these checks are the first of two locks, not the only one.

import { HttpError } from './http.ts'

export type Role = 'landlord' | 'tenant'

export interface Caller {
  id: string
  email: string | null
  /** From public.profiles (RLS-protected), never from user_metadata or the request body. */
  role: Role | null
  deletedAt: string | null
}

export function requireSignedIn(caller: Caller | null): Caller {
  if (!caller) throw new HttpError('unauthorized', 'Please sign in again.')
  if (caller.deletedAt) throw new HttpError('forbidden', 'This account has been deleted.')
  return caller
}

export function requireLandlord(caller: Caller | null): Caller {
  const c = requireSignedIn(caller)
  // Single-building product: the landlord role owns every unit and lease
  // (there is no owner column; is_landlord() in SQL is the same rule).
  if (c.role !== 'landlord') throw new HttpError('forbidden', 'Not authorized')
  return c
}

/** Notification types a tenant may send to the landlord (what the tenant web app sends today). */
export const TENANT_NOTIFY_TYPES = new Set([
  'payment_submitted', 'maintenance_submitted', 'maintenance_follow_up', 'move_out_notice', 'new_message',
])

export interface Recipient { id: string; role: Role; deletedAt: string | null }

/**
 * Who may notify whom. Mirrors the notifications INSERT policies (01, 08):
 * the landlord may notify anyone; a tenant only the landlord, and only with
 * the types the tenant app really uses (so a tenant cannot fake a
 * "payment confirmed" alert on the landlord's phone).
 */
export function canNotify(caller: Caller, recipient: Recipient | null, type: string): { ok: true } | { ok: false; error: HttpError } {
  if (!recipient || recipient.deletedAt) return { ok: false, error: new HttpError('not_found', 'Recipient not found.') }
  if (caller.role === 'landlord') return { ok: true }
  if (caller.role === 'tenant' && recipient.role === 'landlord' && TENANT_NOTIFY_TYPES.has(type)) return { ok: true }
  return { ok: false, error: new HttpError('forbidden', 'Not authorized') }
}

// ── Account deletion ─────────────────────────────────────────

export interface AuthUserFacts {
  /** Providers linked to the login, e.g. ['email'] or ['google']. */
  providers: string[]
}

/**
 * Re-authentication before deleting: a password login must re-enter the
 * password (a stolen unlocked phone is not enough). A login without a
 * password (Google only) must have signed in within the last 10 minutes,
 * read from the JWT's iat claim.
 */
export function reauthNeeded(user: AuthUserFacts, tokenIssuedAt: number | null, nowSec: number):
  'password' | 'recent-login-ok' | 'recent-login-required' {
  if (user.providers.includes('email')) return 'password'
  if (tokenIssuedAt !== null && nowSec - tokenIssuedAt <= 600) return 'recent-login-ok'
  return 'recent-login-required'
}

/** Landlord accounts are never deleted automatically: that would orphan the building. */
export function deletionAllowed(caller: Caller): { ok: true } | { ok: false; error: HttpError } {
  if (caller.role === 'landlord') {
    return {
      ok: false,
      error: new HttpError('forbidden',
        'The landlord account holds the whole building\'s records and cannot be deleted from the app. Contact support to close it.'),
    }
  }
  return { ok: true }
}

// ── Database errors → HTTP ───────────────────────────────────

/** Messages raised by our own SQL functions (11, 17): safe to show as is. */
const CONFLICT_MESSAGES = [
  'This unit already has an active tenant',
  'That email is already in use by a non-tenant account.',
  'That email belongs to a tenant currently assigned to another unit.',
  'That lease has already ended',
  'The outgoing lease is not on this unit',
]
const BAD_REQUEST_MESSAGES = [
  'Move-out date cannot be before the move-in date',
  'Full name is required',
  'Move-in date is required',
  'Monthly rent must be more than zero',
  'Lease end cannot be before move-in',
]
const NOT_FOUND_MESSAGES = ['Lease not found', 'Unit not found']

export function rpcErrorToHttp(err: { message?: string; code?: string } | null | undefined): HttpError {
  const msg = err?.message ?? ''
  if (err?.code === '42501') return new HttpError('forbidden', 'Not authorized')
  if (CONFLICT_MESSAGES.includes(msg)) return new HttpError('conflict', msg)
  if (BAD_REQUEST_MESSAGES.includes(msg)) return new HttpError('bad_request', msg)
  if (NOT_FOUND_MESSAGES.includes(msg)) return new HttpError('not_found', msg)
  // Trigger messages from the payment / maintenance guards are written for users too,
  // but anything else (constraint names, internals) gets a generic text.
  if (err?.code === 'P0001' && msg && msg.length <= 200) return new HttpError('bad_request', msg)
  return new HttpError('internal', 'The database refused the change. Please try again.')
}
