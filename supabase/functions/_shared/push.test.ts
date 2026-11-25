import { describe, expect, it, vi } from 'vitest'
import { buildExpoMessages, checkExpoReceipts, chunk, deadTokensFromTickets, EXPO_PUSH_URL, EXPO_RECEIPTS_URL, sendExpoPush } from './expo.ts'
import { deliverNotifications } from './deliver.ts'
import { LANDLORD_ID, OTHER_TENANT_ID, TENANT_ID, mockAdminDb, mockCtx, mockFetch, testEnv } from './test-helpers.ts'

const tok = (i: number) => `ExponentPushToken[token${String(i).padStart(8, '0')}]`

describe('expo push', () => {
  it('chunks by 100', () => {
    expect(chunk(Array.from({ length: 250 }, (_, i) => i)).map(c => c.length)).toEqual([100, 100, 50])
    expect(chunk([])).toEqual([])
  })
  it('drops invalid and duplicate tokens', () => {
    const m = buildExpoMessages([tok(1), tok(1), 'garbage'], { title: 'T', body: 'B', url: '/rent', tag: 'x' })
    expect(m).toEqual([{ to: tok(1), title: 'T', body: 'B', sound: 'default', priority: 'high', data: { url: '/rent', type: 'x' } }])
  })
  it('sends 250 messages in 3 requests and collects DeviceNotRegistered', async () => {
    const messages = buildExpoMessages(Array.from({ length: 250 }, (_, i) => tok(i)), { title: 'T', body: 'B' })
    const fetch = mockFetch((_url, body) => ({
      json: { data: (body as { to: string }[]).map(m => m.to === tok(5) || m.to === tok(150)
        ? { status: 'error', message: 'gone', details: { error: 'DeviceNotRegistered' } }
        : { status: 'ok', id: 'x' }) },
    }))
    const r = await sendExpoPush(messages, { fetch, accessToken: 'expo-access' })
    expect(fetch.calls.map(c => (c.body as unknown[]).length)).toEqual([100, 100, 50])
    expect(fetch.calls[0].url).toBe(EXPO_PUSH_URL)
    expect(fetch.calls[0].headers.Authorization).toBe('Bearer expo-access')
    expect(r).toMatchObject({ sent: 248, failed: 2, deadTokens: [tok(5), tok(150)] })
    expect(r.tickets).toHaveLength(248)
  })
  it('a failed batch does not stop the next one', async () => {
    let n = 0
    const fetch = mockFetch((_u, body) => (n++ === 0 ? { status: 503 } : { json: { data: (body as unknown[]).map(() => ({ status: 'ok' })) } }))
    const messages = buildExpoMessages(Array.from({ length: 150 }, (_, i) => tok(i)), { title: 'T', body: 'B' })
    const log = vi.fn()
    const r = await sendExpoPush(messages, { fetch, log })
    expect(r).toMatchObject({ sent: 50, failed: 100, deadTokens: [] })
    expect(fetch.calls[0].headers.Authorization).toBeUndefined()
    expect(log).toHaveBeenCalledWith('expo push: HTTP 503 for a batch of 100')
  })
  it('uses the token from the ticket when Expo gives one', () => {
    const m = buildExpoMessages([tok(1)], { title: 'T', body: 'B' })
    expect(deadTokensFromTickets(m, [{ status: 'error', details: { error: 'DeviceNotRegistered', expoPushToken: tok(9) } }])).toEqual([tok(9)])
    expect(deadTokensFromTickets(m, [{ status: 'error', details: { error: 'MessageRateExceeded' } }])).toEqual([])
  })
})

describe('deliverNotifications', () => {
  const n = (user_id: string, type = 'payment_reviewed') => ({ user_id, type, title: 'Hi', body: 'Body', link: '/' })

  it('skips banned and deleted recipients', async () => {
    const admin = mockAdminDb({
      getAuthUser: vi.fn(async (id: string) => ({ id, email: 'a@b.c', bannedUntil: id === TENANT_ID ? '2126-01-01T00:00:00Z' : null, providers: ['email'] })),
      getProfile: vi.fn(async (id: string) => ({ id, role: 'tenant' as const, full_name: 'x', unit_id: null, email_notifications: true, deleted_at: id === OTHER_TENANT_ID ? '2026-01-01' : null })),
      listExpoTokens: vi.fn(async () => [{ user_id: TENANT_ID, token: tok(1) }]),
    })
    const ctx = mockCtx({ admin })
    const s = await deliverNotifications(ctx, [n(TENANT_ID), n(OTHER_TENANT_ID)], { webPush: true })
    expect(s.recipients).toBe(0)
    expect(s.skipped).toBe(2)
    expect(admin.listExpoTokens).not.toHaveBeenCalled()
  })

  it('pushes to Expo, deletes dead tokens, cleans up gone web push subscriptions', async () => {
    const admin = mockAdminDb({
      listExpoTokens: vi.fn(async () => [{ user_id: TENANT_ID, token: tok(1) }, { user_id: TENANT_ID, token: tok(2) }]),
      listWebPushSubs: vi.fn(async () => [
        { id: 's1', user_id: TENANT_ID, endpoint: 'e1', p256dh: 'p', auth: 'a' },
        { id: 's2', user_id: TENANT_ID, endpoint: 'e2', p256dh: 'p', auth: 'a' },
      ]),
    })
    const fetch = mockFetch((_u, body) => ({
      json: { data: (body as { to: string }[]).map(m => m.to === tok(2) ? { status: 'error', details: { error: 'DeviceNotRegistered' } } : { status: 'ok' }) },
    }))
    const webPush = { send: vi.fn(async (s: { id: string }, _payload: string) => (s.id === 's2' ? { ok: false as const, status: 410 } : { ok: true as const })) }
    const ctx = mockCtx({ admin, fetch, webPush })
    const s = await deliverNotifications(ctx, [n(TENANT_ID)], { webPush: true })
    expect(s.expo).toEqual({ sent: 1, failed: 1, removed: 1 })
    expect(admin.deleteExpoTokens).toHaveBeenCalledWith([tok(2)])
    expect(s.webPush).toEqual({ sent: 1, removed: 1 })
    expect(admin.deleteWebPushSub).toHaveBeenCalledWith('s2')
    expect(JSON.parse(webPush.send.mock.calls[0][1])).toEqual({ title: 'Hi', body: 'Body', url: '/', tag: 'payment_reviewed' })
  })

  it('web push off -> not sent', async () => {
    const webPush = { send: vi.fn() }
    const admin = mockAdminDb({ listWebPushSubs: vi.fn(async () => [{ id: 's1', user_id: TENANT_ID, endpoint: 'e', p256dh: 'p', auth: 'a' }]) })
    await deliverNotifications(mockCtx({ admin, webPush }), [n(TENANT_ID)], { webPush: false })
    expect(webPush.send).not.toHaveBeenCalled()
  })

  it('emails maintenance updates only, only when opted in, with the right app URL', async () => {
    const env = testEnv({ BREVO_API_KEY: 'brevo', EMAIL_FROM: 'from@example.test', TENANT_APP_URL: 'https://tenant.test/' })
    const fetch = mockFetch()
    const admin = mockAdminDb({
      getProfile: vi.fn(async (id: string) => ({ id, role: 'tenant' as const, full_name: 'x', unit_id: null, email_notifications: id === TENANT_ID, deleted_at: null })),
    })
    const ctx = mockCtx({ env, fetch, admin })
    const s = await deliverNotifications(ctx, [
      { ...n(TENANT_ID, 'maintenance_updated'), link: '/maintenance' },
      n(TENANT_ID, 'payment_reviewed'),
      n(OTHER_TENANT_ID, 'maintenance_updated'),
    ], { webPush: false })
    expect(s.email.sent).toBe(1)
    const brevo = fetch.calls.filter(c => c.url.includes('brevo'))
    expect(brevo).toHaveLength(1)
    expect(brevo[0].headers['api-key']).toBe('brevo')
    expect(JSON.stringify(brevo[0].body)).toContain('https://tenant.test/maintenance')
  })

  it('no email for placeholder addresses of deleted accounts', async () => {
    const env = testEnv({ BREVO_API_KEY: 'brevo', EMAIL_FROM: 'from@example.test' })
    const fetch = mockFetch()
    const admin = mockAdminDb({ getAuthUser: vi.fn(async (id: string) => ({ id, email: 'x@deleted.invalid', bannedUntil: null, providers: [] })) })
    const s = await deliverNotifications(mockCtx({ env, fetch, admin }), [n(LANDLORD_ID, 'maintenance_updated')], { webPush: false })
    expect(s.email.sent).toBe(0)
  })
})

describe('expo receipts', () => {
  it('DeviceNotRegistered in a receipt -> dead token; missing receipt -> ask later', async () => {
    const fetch = mockFetch(() => ({
      json: { data: {
        t1: { status: 'ok' },
        t2: { status: 'error', message: 'gone', details: { error: 'DeviceNotRegistered' } },
        t3: { status: 'error', details: { error: 'MessageTooBig' } },
      } },
    }))
    const r = await checkExpoReceipts(
      [{ id: 't1', token: tok(1) }, { id: 't2', token: tok(2) }, { id: 't3', token: tok(3) }, { id: 't4', token: tok(4) }],
      { fetch, accessToken: 'a' },
    )
    expect(r).toEqual({ delivered: 1, failed: 2, deadTokens: [tok(2)], pending: ['t4'] })
    expect(fetch.calls[0].url).toBe(EXPO_RECEIPTS_URL)
    expect(fetch.calls[0].body).toEqual({ ids: ['t1', 't2', 't3', 't4'] })
    expect(fetch.calls[0].headers.Authorization).toBe('Bearer a')
  })
  it('Expo down -> everything stays pending, nothing deleted', async () => {
    const r = await checkExpoReceipts([{ id: 't1', token: tok(1) }], { fetch: mockFetch(() => ({ status: 500 })) })
    expect(r).toEqual({ delivered: 0, failed: 0, deadTokens: [], pending: ['t1'] })
  })
  it('sendExpoPush returns the accepted ticket ids with their tokens', async () => {
    const fetch = mockFetch((_u, body) => ({ json: { data: (body as { to: string }[]).map((m, i) => ({ status: 'ok', id: `id-${i}` })) } }))
    const r = await sendExpoPush(buildExpoMessages([tok(1), tok(2)], { title: 'T', body: 'B' }), { fetch })
    expect(r.tickets).toEqual([{ id: 'id-0', token: tok(1) }, { id: 'id-1', token: tok(2) }])
  })
})
