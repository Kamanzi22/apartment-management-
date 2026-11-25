// The real UserDb / AdminDb / AnonAuth on top of supabase-js v2. The clients
// are passed in (created in runtime.ts), so this file has no Deno or npm
// imports and type-checks under Node too. Not unit-tested: it is a thin
// mapping, and the handlers above it are tested with mocks.

// deno-lint-ignore-file no-explicit-any
import type { AdminDb, AnonAuth, AuthUserInfo, DbError, DbResult, UserDb } from './ports.ts'
import type { NewNotification } from './messages.ts'

// supabase-js client, typed loosely on purpose (no generated types in Deno).
type Sb = any

const toErr = (e: any): DbError => ({ message: String(e?.message ?? 'error'), code: e?.code ?? undefined })
const res = <T>(data: T, error: any): DbResult<T> => (error ? { data: null, error: toErr(error) } : { data, error: null })

export function userDb(sb: Sb): UserDb {
  return {
    async rpc(fn, args) {
      const { data, error } = await sb.rpc(fn, args)
      return res(data, error)
    },
    async getProfile(id) {
      const { data } = await sb.from('profiles').select('id, role, full_name, deleted_at').eq('id', id).maybeSingle()
      return data ?? null
    },
    async getLease(id) {
      const { data } = await sb.from('leases').select('id, tenant_id, unit_id, status').eq('id', id).maybeSingle()
      return data ?? null
    },
    async reviewPayment(id, status, note, reviewerId) {
      const { data, error } = await sb.from('payments')
        .update({ status, reviewed_by: reviewerId, reviewed_at: new Date().toISOString(), landlord_notes: note })
        .eq('id', id).eq('status', 'pending_review')
        .select('tenant_id, period_month, amount')
        .maybeSingle()
      return res(data ?? null, error)
    },
    async insertNotifications(items: NewNotification[]) {
      // No .select(): a tenant may not read the landlord's rows back.
      const { error } = await sb.from('notifications').insert(items)
      return error ? toErr(error) : null
    },
    async insertBroadcast(senderId, body) {
      const { data, error } = await sb.from('messages')
        .insert({ sender_id: senderId, recipient_id: null, body }).select('id').single()
      return res(data, error)
    },
    async currentTenantIds() {
      const { data } = await sb.from('profiles').select('id').eq('role', 'tenant').not('unit_id', 'is', null)
        .is('deleted_at', null)
      return (data ?? []).map((r: { id: string }) => r.id)
    },
    async countLeasesForTenant(tenantId) {
      const { count } = await sb.from('leases').select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId)
      return count ?? 0
    },
  }
}

function authInfo(u: any): AuthUserInfo {
  const providers: string[] = Array.isArray(u?.identities) && u.identities.length
    ? u.identities.map((i: any) => String(i.provider))
    : (Array.isArray(u?.app_metadata?.providers) ? u.app_metadata.providers : [u?.app_metadata?.provider].filter(Boolean))
  return { id: u.id, email: u.email ?? null, bannedUntil: u.banned_until ?? null, providers }
}

export function adminDb(sb: Sb): AdminDb {
  return {
    async findUserIdByEmail(email) {
      // Same paging as the web (fine for one building; at most 20 000 users).
      for (let page = 1; page <= 20; page++) {
        const { data, error } = await sb.auth.admin.listUsers({ page, perPage: 1000 })
        if (error) return { data: null, error: toErr(error) }
        const found = data.users.find((u: any) => u.email?.toLowerCase() === email)
        if (found) return { data: found.id as string, error: null }
        if (data.users.length < 1000) break
      }
      return { data: null as string | null, error: null }
    },
    async createUser(email, password) {
      const { data, error } = await sb.auth.admin.createUser({ email, password, email_confirm: true })
      if (error || !data?.user) return { data: null, error: toErr(error ?? { message: 'no user' }) }
      return { data: { id: data.user.id }, error: null }
    },
    async updateUser(id, attrs) {
      const { error } = await sb.auth.admin.updateUserById(id, attrs)
      return error ? toErr(error) : null
    },
    async getAuthUser(id) {
      const { data, error } = await sb.auth.admin.getUserById(id)
      return error || !data?.user ? null : authInfo(data.user)
    },
    async getProfile(id) {
      const { data } = await sb.from('profiles')
        .select('id, role, full_name, unit_id, email_notifications, deleted_at').eq('id', id).maybeSingle()
      return data ?? null
    },
    async generateRecoveryToken(email) {
      const { data, error } = await sb.auth.admin.generateLink({ type: 'recovery', email })
      return error ? null : (data?.properties?.hashed_token ?? null)
    },
    async rpc(fn, args) {
      const { data, error } = await sb.rpc(fn, args)
      return res(data, error)
    },
    async insertNotifications(items) {
      const { error } = await sb.from('notifications').insert(items)
      return error ? toErr(error) : null
    },
    async listExpoTokens(userIds) {
      if (!userIds.length) return []
      const { data } = await sb.from('expo_push_tokens').select('user_id, token').in('user_id', userIds)
      return data ?? []
    },
    async deleteExpoTokens(tokens) {
      if (tokens.length) await sb.from('expo_push_tokens').delete().in('token', tokens)
    },
    async listWebPushSubs(userIds) {
      if (!userIds.length) return []
      const { data } = await sb.from('push_subscriptions').select('id, user_id, endpoint, p256dh, auth').in('user_id', userIds)
      return data ?? []
    },
    async deleteWebPushSub(id) {
      await sb.from('push_subscriptions').delete().eq('id', id)
    },
    async signOutEverywhere(jwt) {
      const { error } = await sb.auth.admin.signOut(jwt, 'global')
      return error ? toErr(error) : null
    },
  }
}

export function anonAuth(sb: Sb): AnonAuth {
  return {
    async signInWithPassword(email, password) {
      const { data, error } = await sb.auth.signInWithPassword({ email, password })
      if (error || !data?.session) return { session: null, error: { status: error?.status ?? null } }
      const s = data.session
      return {
        session: { access_token: s.access_token, refresh_token: s.refresh_token, expires_at: s.expires_at ?? null, expires_in: s.expires_in },
        error: null,
      }
    },
  }
}
