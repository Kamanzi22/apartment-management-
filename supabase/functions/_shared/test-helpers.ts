// Mock Ctx for the handler tests: every port is an in-memory fake with vi.fn
// spies. No network, no Supabase.
import { vi } from 'vitest'
import { readEnv, type FunctionEnv } from './env.ts'
import type { AdminDb, AnonAuth, Ctx, UserDb } from './ports.ts'
import type { Caller } from './authz.ts'
import type { FetchLike } from './expo.ts'

export const LANDLORD_ID = '00000000-0000-4000-8000-0000000000a1'
export const TENANT_ID = '00000000-0000-4000-8000-0000000000a2'
export const OTHER_TENANT_ID = '00000000-0000-4000-8000-0000000000a3'
export const UNIT_ID = '00000000-0000-4000-8000-0000000000b1'
export const LEASE_ID = '00000000-0000-4000-8000-0000000000c1'
export const PAYMENT_ID = '00000000-0000-4000-8000-0000000000d1'

export const landlord: Caller = { id: LANDLORD_ID, email: 'landlord@example.test', role: 'landlord', deletedAt: null }
export const tenant: Caller = { id: TENANT_ID, email: 'tenant@example.test', role: 'tenant', deletedAt: null }

export function testEnv(overrides: Record<string, string> = {}): FunctionEnv {
  const vars: Record<string, string> = {
    SUPABASE_URL: 'https://example.supabase.co',
    SUPABASE_PUBLISHABLE_KEYS: '{"default":"sb_publishable_test"}',
    SUPABASE_SECRET_KEYS: '{"default":"sb_secret_test"}',
    PHONE_LOOKUP_PEPPER: 'pepper',
    ...overrides,
  }
  return readEnv(n => vars[n])
}

export function mockUserDb(over: Partial<UserDb> = {}): UserDb {
  return {
    rpc: vi.fn(async () => ({ data: LEASE_ID, error: null })) as UserDb['rpc'],
    getProfile: vi.fn(async (id: string) => id === LANDLORD_ID
      ? { id, role: 'landlord' as const, full_name: 'Landlord', deleted_at: null }
      : { id, role: 'tenant' as const, full_name: 'Tenant', deleted_at: null }),
    getLease: vi.fn(async (id: string) => ({ id, tenant_id: TENANT_ID, unit_id: UNIT_ID, status: 'active' as const })),
    reviewPayment: vi.fn(async () => ({ data: { tenant_id: TENANT_ID, period_month: '2026-11', amount: 300000 }, error: null })),
    insertNotifications: vi.fn(async () => null),
    insertBroadcast: vi.fn(async () => ({ data: { id: 'msg-1' }, error: null })),
    currentTenantIds: vi.fn(async () => [TENANT_ID, OTHER_TENANT_ID]),
    ...over,
  }
}

export function mockAdminDb(over: Partial<AdminDb> = {}): AdminDb {
  return {
    findUserIdByEmail: vi.fn(async () => ({ data: null, error: null })),
    createUser: vi.fn(async () => ({ data: { id: 'new-user' }, error: null })),
    deleteUser: vi.fn(async () => null),
    updateUser: vi.fn(async () => null),
    getAuthUser: vi.fn(async (id: string) => ({ id, email: `${id}@example.test`, bannedUntil: null, providers: ['email'] })),
    getProfile: vi.fn(async (id: string) => ({
      id, role: id === LANDLORD_ID ? 'landlord' as const : 'tenant' as const, full_name: 'X', unit_id: UNIT_ID,
      email_notifications: true, deleted_at: null,
    })),
    generateRecoveryToken: vi.fn(async () => 'hashed-token'),
    rpc: vi.fn(async () => ({ data: null, error: null })) as AdminDb['rpc'],
    insertNotifications: vi.fn(async () => null),
    listExpoTokens: vi.fn(async () => []),
    deleteExpoTokens: vi.fn(async () => {}),
    listWebPushSubs: vi.fn(async () => []),
    deleteWebPushSub: vi.fn(async () => {}),
    signOutEverywhere: vi.fn(async () => null),
    removeUserFolder: vi.fn(async () => 0),
    ...over,
  }
}

export function mockAnon(ok = true): AnonAuth {
  return {
    signInWithPassword: vi.fn(async () => ok
      ? { session: { access_token: 'at', refresh_token: 'rt', expires_at: 1, expires_in: 3600 }, error: null }
      : { session: null, error: { status: 400 } }),
  }
}

/** fetch that records calls and answers Expo/Brevo without the network. */
export function mockFetch(respond?: (url: string, body: unknown) => { status?: number; json?: unknown }): FetchLike & { calls: { url: string; body: unknown; headers: Record<string, string> }[] } {
  const calls: { url: string; body: unknown; headers: Record<string, string> }[] = []
  const fn = (async (url: string, init: { body: string; headers: Record<string, string> }) => {
    const body = JSON.parse(init.body)
    calls.push({ url, body, headers: init.headers })
    const r = respond?.(url, body) ?? {
      json: Array.isArray(body) ? { data: body.map(() => ({ status: 'ok', id: 'ticket' })) } : {},
    }
    const status = r.status ?? 200
    return { ok: status < 300, status, json: async () => r.json }
  }) as unknown as FetchLike & { calls: typeof calls }
  fn.calls = calls
  return fn
}

export function mockCtx(over: Partial<Ctx> = {}): Ctx {
  return {
    env: testEnv(),
    caller: landlord,
    jwt: 'header.eyJpYXQiOjB9.sig',
    tokenIssuedAt: null,
    clientIp: '203.0.113.7',
    user: mockUserDb(),
    admin: mockAdminDb(),
    anon: mockAnon(),
    fetch: mockFetch(),
    webPush: null,
    log: vi.fn(),
    now: () => new Date('2026-11-24T12:00:00Z'),
    ...over,
  }
}

export const req = (headers: Record<string, string> = {}) =>
  new Request('https://fn.test', { method: 'POST', headers })
