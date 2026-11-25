// The narrow set of database / auth operations the handlers use. Handlers
// depend on these interfaces only, so tests pass plain mock objects and the
// real implementation (supabase-ports.ts) is the only code that knows
// supabase-js.

import type { Caller, Role } from './authz.ts'
import type { FetchLike } from './expo.ts'
import type { FunctionEnv } from './env.ts'
import type { NewNotification } from './messages.ts'

export interface DbError { message: string; code?: string }
export type DbResult<T> = { data: T; error: null } | { data: null; error: DbError }

/** Runs as the signed-in caller: RLS, caller_is_admin() and the guard triggers all apply. */
export interface UserDb {
  rpc<T = unknown>(fn: string, args: Record<string, unknown>): Promise<DbResult<T>>
  getProfile(id: string): Promise<{ id: string; role: Role; full_name: string; deleted_at: string | null } | null>
  getLease(id: string): Promise<{ id: string; tenant_id: string; unit_id: string; status: 'active' | 'ended' } | null>
  /** Updates only while status is still pending_review; null when nothing matched (already reviewed / not found). */
  reviewPayment(id: string, status: 'confirmed' | 'rejected', note: string | null, reviewerId: string):
    Promise<DbResult<{ tenant_id: string; period_month: string; amount: number } | null>>
  insertNotifications(items: NewNotification[]): Promise<DbError | null>
  insertBroadcast(senderId: string, body: string): Promise<DbResult<{ id: string }>>
  /** Tenants with a current unit (the ones who can see a broadcast). */
  currentTenantIds(): Promise<string[]>
  /** How many leases (any status) this tenant has had here. */
  countLeasesForTenant(tenantId: string): Promise<number>
}

export interface AuthUserInfo {
  id: string
  email: string | null
  bannedUntil: string | null
  providers: string[]
}

export interface PushSubscriptionRow { id: string; endpoint: string; p256dh: string; auth: string }

/** Secret-key client. Only used after the caller has been authorized. */
export interface AdminDb {
  findUserIdByEmail(email: string): Promise<DbResult<string | null>>
  createUser(email: string, password: string): Promise<DbResult<{ id: string }>>
  updateUser(id: string, attrs: { ban_duration?: string; password?: string; email?: string; user_metadata?: Record<string, unknown> }): Promise<DbError | null>
  getAuthUser(id: string): Promise<AuthUserInfo | null>
  getProfile(id: string): Promise<{
    id: string; role: Role; full_name: string; unit_id: string | null
    email_notifications: boolean; deleted_at: string | null
  } | null>
  /** hashed_token of a recovery link, or null. */
  generateRecoveryToken(email: string): Promise<string | null>
  rpc<T = unknown>(fn: string, args: Record<string, unknown>): Promise<DbResult<T>>
  insertNotifications(items: NewNotification[]): Promise<DbError | null>
  listExpoTokens(userIds: string[]): Promise<{ user_id: string; token: string }[]>
  deleteExpoTokens(tokens: string[]): Promise<void>
  listWebPushSubs(userIds: string[]): Promise<(PushSubscriptionRow & { user_id: string })[]>
  deleteWebPushSub(id: string): Promise<void>
  /** Revokes every refresh token of the user who owns this JWT. */
  signOutEverywhere(jwt: string): Promise<DbError | null>
}

/** Publishable-key client with no session: only used to check a password. */
export interface AnonAuth {
  signInWithPassword(email: string, password: string): Promise<
    | { session: { access_token: string; refresh_token: string; expires_at: number | null; expires_in: number }; error: null }
    | { session: null; error: { status: number | null } }
  >
}

export interface WebPushSender {
  send(sub: PushSubscriptionRow, payload: string): Promise<{ ok: true } | { ok: false; status: number | null }>
}

export interface Ctx {
  env: FunctionEnv
  /** null when there was no valid JWT. Handlers that need a user call requireSignedIn / requireLandlord. */
  caller: Caller | null
  jwt: string | null
  /** iat claim of the caller's JWT (seconds), for "signed in recently" checks. */
  tokenIssuedAt: number | null
  clientIp: string | null
  user: UserDb
  admin: AdminDb
  anon: AnonAuth
  fetch: FetchLike
  webPush: WebPushSender | null
  log: (msg: string) => void
  now: () => Date
}
