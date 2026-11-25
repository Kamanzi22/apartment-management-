// The whole push path with mocks, no network:
//   phone: register_expo_push_token(p_token, p_platform)  (RPC, migration 17)
//   server: notify / broadcast -> deliverNotifications -> Expo (batches of 100)
//   tickets -> receipts -> DeviceNotRegistered -> token deleted
// The fake database below applies the same rules as the SQL function and
// policies (token format, platform, closed account, token hand-over).
import { describe, expect, it, vi } from 'vitest'
import { notify } from './handlers/notify.ts'
import { broadcast } from './handlers/broadcast.ts'
import { checkExpoReceipts, EXPO_PUSH_URL, EXPO_RECEIPTS_URL, sendExpoPush, buildExpoMessages } from './expo.ts'
import { EXPO_TOKEN_RE } from './validate.ts'
import {
  LANDLORD_ID, OTHER_TENANT_ID, TENANT_ID, landlord, mockAdminDb, mockCtx, mockFetch, mockUserDb, req,
} from './test-helpers.ts'

const tok = (i: number) => `ExponentPushToken[token${String(i).padStart(8, '0')}]`

type RpcArgs = { p_token: string; p_platform: string }

/** In-memory expo_push_tokens + profiles, with the rules of register_expo_push_token(). */
function fakeDb(closed: string[] = []) {
  const tokens = new Map<string, { user_id: string; platform: string }>()
  const rpcAs = (uid: string | null) => async (name: string, args: RpcArgs) => {
    if (name !== 'register_expo_push_token') return { error: { code: 'PGRST202', message: 'nf' } }
    if (!uid || closed.includes(uid)) return { error: { code: '42501', message: 'x' } }
    if (!EXPO_TOKEN_RE.test(args.p_token ?? '') || !['ios', 'android'].includes(args.p_platform)) {
      return { error: { code: '22023', message: 'bad' } }
    }
    tokens.set(args.p_token, { user_id: uid, platform: args.p_platform }) // a token moves to its new owner
    return { error: null }
  }
  const admin = mockAdminDb({
    getProfile: vi.fn(async (id: string) => ({
      id, role: id === LANDLORD_ID ? 'landlord' as const : 'tenant' as const, full_name: 'X', unit_id: null,
      email_notifications: true, deleted_at: closed.includes(id) ? '2026-11-01T00:00:00Z' : null,
    })),
    listExpoTokens: vi.fn(async (ids: string[]) =>
      [...tokens].filter(([, v]) => ids.includes(v.user_id)).map(([token, v]) => ({ user_id: v.user_id, token }))),
    deleteExpoTokens: vi.fn(async (ts: string[]) => { ts.forEach(t => tokens.delete(t)) }),
  })
  return { tokens, rpcAs, admin }
}

describe('push path: register -> notify -> Expo -> cleanup', () => {
  it('registration stores the token for the signed-in user only (args match the SQL signature)', async () => {
    const db = fakeDb()
    // What packages/shared/src/functions.ts sends: { p_token, p_platform }.
    expect(await db.rpcAs(TENANT_ID)('register_expo_push_token', { p_token: tok(1), p_platform: 'ios' })).toEqual({ error: null })
    expect(db.tokens.get(tok(1))).toEqual({ user_id: TENANT_ID, platform: 'ios' })
    expect((await db.rpcAs(null)('register_expo_push_token', { p_token: tok(2), p_platform: 'ios' })).error?.code).toBe('42501')
    expect((await db.rpcAs(TENANT_ID)('register_expo_push_token', { p_token: 'nope', p_platform: 'ios' })).error?.code).toBe('22023')
    expect((await db.rpcAs(TENANT_ID)('register_expo_push_token', { p_token: tok(2), p_platform: 'web' })).error?.code).toBe('22023')
    const closed = fakeDb([TENANT_ID])
    expect((await closed.rpcAs(TENANT_ID)('register_expo_push_token', { p_token: tok(3), p_platform: 'android' })).error?.code).toBe('42501')
    expect(closed.tokens.size).toBe(0)
    expect(db.tokens.size).toBe(1)
  })

  it('landlord notifies a tenant: one Expo request with the stored tokens, a dead token is deleted', async () => {
    const db = fakeDb()
    await db.rpcAs(TENANT_ID)('register_expo_push_token', { p_token: tok(1), p_platform: 'ios' })
    await db.rpcAs(TENANT_ID)('register_expo_push_token', { p_token: tok(2), p_platform: 'android' })
    await db.rpcAs(OTHER_TENANT_ID)('register_expo_push_token', { p_token: tok(3), p_platform: 'ios' })
    const fetch = mockFetch((_u, body) => ({
      json: { data: (body as { to: string }[]).map(m => m.to === tok(2)
        ? { status: 'error', details: { error: 'DeviceNotRegistered' } } : { status: 'ok', id: `id-${m.to}` }) },
    }))
    const ctx = mockCtx({ caller: landlord, admin: db.admin, fetch, user: mockUserDb() })
    const r = await notify(ctx, { userId: TENANT_ID, type: 'payment_reviewed', title: 'Rent confirmed', body: 'Thanks', link: '/rent' }, req())
    expect(r).toMatchObject({ ok: true, delivered: { recipients: 1, expo: { sent: 1, failed: 1, removed: 1 } } })
    expect(fetch.calls).toHaveLength(1)
    expect(fetch.calls[0].url).toBe(EXPO_PUSH_URL)
    const msg = (to: string) => ({ to, title: 'Rent confirmed', body: 'Thanks', sound: 'default', priority: 'high', data: { url: '/rent', type: 'payment_reviewed' } })
    expect(fetch.calls[0].body).toEqual([msg(tok(1)), msg(tok(2))])
    expect(JSON.stringify(fetch.calls[0].body)).not.toContain(tok(3))
    expect([...db.tokens.keys()].sort()).toEqual([tok(1), tok(3)])
  })

  it('a closed account gets no push: the landlord cannot address it, and delivery skips it anyway', async () => {
    const db = fakeDb([TENANT_ID])
    db.tokens.set(tok(1), { user_id: TENANT_ID, platform: 'ios' }) // left over from before closing
    const fetch = mockFetch()
    // the landlord's RLS read already shows deleted_at -> 404, nothing inserted or sent
    const closedProfile = async (id: string) => ({ id, role: 'tenant' as const, full_name: 'T', deleted_at: '2026-11-01T00:00:00Z' })
    const user = mockUserDb({ getProfile: closedProfile })
    const ctx = mockCtx({ caller: landlord, admin: db.admin, fetch, user })
    await expect(notify(ctx, { userId: TENANT_ID, type: 'broadcast', title: 'T', body: 'B' }, req())).rejects.toMatchObject({ status: 404 })
    expect(user.insertNotifications).not.toHaveBeenCalled()
    // race: closed after that read -> the delivery layer re-checks with the admin client
    const raced = mockCtx({ caller: landlord, admin: db.admin, fetch })
    const r = await notify(raced, { userId: TENANT_ID, type: 'broadcast', title: 'T', body: 'B' }, req())
    expect(r).toMatchObject({ ok: true, delivered: { recipients: 0, skipped: 1 } })
    expect(fetch.calls).toHaveLength(0)
    expect(db.admin.listExpoTokens).not.toHaveBeenCalled()
  })

  it('broadcast to 150 phones: batches of 100 + 50, a closed tenant is skipped', async () => {
    const closedId = '00000000-0000-4000-8000-0000000000e9'
    const ids = Array.from({ length: 150 }, (_, i) => `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`)
    const db = fakeDb([closedId])
    ids.forEach((id, i) => db.tokens.set(tok(i), { user_id: id, platform: 'ios' }))
    db.tokens.set(tok(999), { user_id: closedId, platform: 'ios' })
    const fetch = mockFetch()
    const user = mockUserDb({ currentTenantIds: vi.fn(async () => [...ids, closedId]) })
    const ctx = mockCtx({ caller: landlord, admin: db.admin, fetch, user })
    const r = await broadcast(ctx, { body: 'Water off tomorrow 9-12' })
    expect(r.notified).toBe(151)
    expect(fetch.calls.map(c => (c.body as unknown[]).length)).toEqual([100, 50])
    expect(JSON.stringify(fetch.calls.map(c => c.body))).not.toContain(tok(999))
  })

  it('tickets -> receipts: a token that only fails in the receipt is deleted', async () => {
    const db = fakeDb()
    await db.rpcAs(TENANT_ID)('register_expo_push_token', { p_token: tok(1), p_platform: 'ios' })
    await db.rpcAs(TENANT_ID)('register_expo_push_token', { p_token: tok(2), p_platform: 'ios' })
    const fetch = mockFetch((url, body) => url === EXPO_RECEIPTS_URL
      ? { json: { data: { 'id-1': { status: 'ok' }, 'id-2': { status: 'error', details: { error: 'DeviceNotRegistered' } } } } }
      : { json: { data: (body as { to: string }[]).map((_m, i) => ({ status: 'ok', id: `id-${i + 1}` })) } })
    const sent = await sendExpoPush(buildExpoMessages([tok(1), tok(2)], { title: 'T', body: 'B' }), { fetch })
    expect(sent.deadTokens).toEqual([])
    const receipts = await checkExpoReceipts(sent.tickets, { fetch })
    expect(receipts).toMatchObject({ delivered: 1, failed: 1, deadTokens: [tok(2)] })
    await db.admin.deleteExpoTokens(receipts.deadTokens)
    expect([...db.tokens.keys()]).toEqual([tok(1)])
  })

  it('Expo down: the in-app row is saved, nothing is sent, tokens are kept', async () => {
    const db = fakeDb()
    db.tokens.set(tok(1), { user_id: TENANT_ID, platform: 'ios' })
    const fetch = mockFetch(() => ({ status: 503 }))
    const ctx = mockCtx({ caller: landlord, admin: db.admin, fetch })
    const r = await notify(ctx, { userId: TENANT_ID, type: 'broadcast', title: 'T', body: 'B' }, req())
    expect(r).toMatchObject({ ok: true, delivered: { expo: { sent: 0, failed: 1, removed: 0 } } })
    expect(ctx.user.insertNotifications).toHaveBeenCalledOnce()
    expect(db.tokens.has(tok(1))).toBe(true)
  })
})
