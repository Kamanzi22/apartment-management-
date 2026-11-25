import { describe, expect, it, vi } from 'vitest'
import { bearerToken, clientIp, HttpError, safeEqual, withHttp } from './http.ts'
import { pickKey, readEnv } from './env.ts'
import {
  isAppPath, isIsoDate, isRwf, parseAddTenant, parseDeleteAccount, parseExpoToken, parseNotify,
  parseReplaceTenancy, parseResetTenantPassword, parseReviewPayment,
} from './validate.ts'
import { canNotify, reauthNeeded, requireLandlord, requireSignedIn, rpcErrorToHttp, deletionAllowed } from './authz.ts'
import { jwtIssuedAt, resolveCaller } from './context.ts'
import { broadcastNotifications, emailLayout, paymentReviewedNotification } from './messages.ts'
import { LANDLORD_ID, TENANT_ID, UNIT_ID, landlord, tenant } from './test-helpers.ts'

describe('withHttp', () => {
  const ok = withHttp('t', async (_req, body) => ({ echo: body }))
  it('answers CORS preflight', async () => {
    const r = await ok(new Request('https://x', { method: 'OPTIONS' }))
    expect(r.status).toBe(200)
    expect(r.headers.get('Access-Control-Allow-Headers')).toContain('authorization')
  })
  it('refuses GET', async () => {
    const r = await ok(new Request('https://x'))
    expect(r.status).toBe(405)
    expect(await r.json()).toEqual({ error: 'Use POST.', code: 'method_not_allowed' })
  })
  it('refuses non-JSON and arrays', async () => {
    expect((await ok(new Request('https://x', { method: 'POST', body: '{nope' }))).status).toBe(400)
    expect((await ok(new Request('https://x', { method: 'POST', body: '[1]' }))).status).toBe(400)
  })
  it('refuses huge bodies', async () => {
    const r = await ok(new Request('https://x', { method: 'POST', body: JSON.stringify({ a: 'x'.repeat(70_000) }) }))
    expect(r.status).toBe(413)
  })
  it('maps HttpError to its status and the shared shape', async () => {
    const h = withHttp('t', async () => { throw new HttpError('forbidden', 'Not authorized') })
    const r = await h(new Request('https://x', { method: 'POST', body: '{}' }))
    expect(r.status).toBe(403)
    expect(await r.json()).toEqual({ error: 'Not authorized', code: 'forbidden' })
  })
  it('hides unexpected errors and logs only the message', async () => {
    const log = vi.fn()
    const h = withHttp('t', async () => { throw new Error('boom') }, log)
    const r = await h(new Request('https://x', { method: 'POST', body: '{"password":"secret-pw"}' }))
    expect(r.status).toBe(500)
    expect((await r.json()).error).not.toContain('boom')
    expect(log).toHaveBeenCalledWith('t: unexpected error: boom')
    expect(JSON.stringify(log.mock.calls)).not.toContain('secret-pw')
  })
})

describe('http helpers', () => {
  it('reads the bearer token', () => {
    expect(bearerToken(new Request('https://x', { headers: { Authorization: 'Bearer abc.def' } }))).toBe('abc.def')
    expect(bearerToken(new Request('https://x', { headers: { Authorization: 'Basic abc' } }))).toBeNull()
    expect(bearerToken(new Request('https://x'))).toBeNull()
  })
  it('takes the first forwarded address', () => {
    expect(clientIp(new Request('https://x', { headers: { 'x-forwarded-for': '198.51.100.1, 10.0.0.1' } }))).toBe('198.51.100.1')
    expect(clientIp(new Request('https://x'))).toBeNull()
  })
  it('compares secrets', () => {
    expect(safeEqual('abc', 'abc')).toBe(true)
    expect(safeEqual('abc', 'abd')).toBe(false)
    expect(safeEqual('abc', 'abcd')).toBe(false)
  })
})

describe('env', () => {
  it('prefers the new keys, then the legacy ones', () => {
    expect(pickKey('{"default":"sb_secret_a","ci":"sb_secret_b"}', undefined, 'legacy')).toBe('sb_secret_a')
    expect(pickKey('{"default":"sb_secret_a","ci":"sb_secret_b"}', 'ci', 'legacy')).toBe('sb_secret_b')
    expect(pickKey(undefined, undefined, 'legacy')).toBe('legacy')
    expect(pickKey('not json', undefined, 'legacy')).toBe('legacy')
    expect(pickKey(undefined, undefined, undefined)).toBeNull()
  })
  it('fails without the Supabase settings', () => {
    expect(() => readEnv(() => undefined)).toThrow(/missing/)
  })
  it('reads flags as strict booleans', () => {
    const env = readEnv(n => ({ SUPABASE_URL: 'u', SUPABASE_ANON_KEY: 'a', SUPABASE_SERVICE_ROLE_KEY: 's', NOTIFY_WEBHOOK_ENABLED: 'yes' } as Record<string, string>)[n])
    expect(env.webhookDelivery).toBe(false)
    expect(env.vapid).toBeNull()
    expect(env.tenantAppUrl).not.toMatch(/\/$/)
  })
})

describe('validation', () => {
  const good = {
    email: ' New@Example.com ', fullName: ' Aline ', phone: '+250 788 000 111', unitId: UNIT_ID,
    moveInDate: '2026-12-01', monthlyRent: 300000, depositAmount: 0, leaseEnd: null,
  }
  it('accepts and normalises a new tenant', () => {
    const r = parseAddTenant(good)
    expect(r).toEqual({ ok: true, value: { ...good, email: 'new@example.com', fullName: 'Aline' } })
  })
  it.each([
    [{ email: 'nope' }, 'A valid email is required.'],
    [{ fullName: '' }, 'Full name is required.'],
    [{ unitId: 'x' }, 'Choose a unit.'],
    [{ moveInDate: '2026-02-30' }, 'Move-in date is required.'],
    [{ monthlyRent: 300000.5 }, 'Monthly rent must be a whole number of RWF more than zero.'],
    [{ monthlyRent: '300000' }, 'Monthly rent must be a whole number of RWF more than zero.'],
    [{ depositAmount: -1 }, 'Deposit must be a whole number of RWF.'],
    [{ leaseEnd: '2026-11-30' }, 'Lease end cannot be before move-in.'],
    [{ phone: '<script>' }, 'Phone number has invalid characters.'],
  ])('refuses %o', (patch, msg) => {
    expect(parseAddTenant({ ...good, ...patch })).toEqual({ ok: false, error: msg })
  })
  it('checks dates, money and app paths', () => {
    expect(isIsoDate('2028-02-29')).toBe(true)
    expect(isIsoDate('2027-02-29')).toBe(false)
    expect(isRwf(0)).toBe(false)
    expect(isRwf(0, { allowZero: true })).toBe(true)
    expect(isRwf(2_000_000_000)).toBe(false)
    expect(isAppPath('/landlord/rent?tab=due')).toBe(true)
    expect(isAppPath('//evil.example')).toBe(false)
    expect(isAppPath('https://evil.example')).toBe(false)
    expect(isAppPath('/x" onclick="y')).toBe(false)
  })
  it('replace-tenancy needs the same unit', () => {
    const r = parseReplaceTenancy({
      outgoing: { tenantId: TENANT_ID, leaseId: TENANT_ID, unitId: UNIT_ID, moveOutDate: '2026-11-30' },
      incoming: { ...good, unitId: TENANT_ID },
    })
    expect(r).toEqual({ ok: false, error: 'The new tenant must move into the same unit.' })
  })
  it('payment notes, reset modes, delete confirm, expo tokens, notify', () => {
    expect(parseReviewPayment({ paymentId: UNIT_ID, note: 'x'.repeat(501) }).ok).toBe(false)
    expect(parseReviewPayment({ paymentId: UNIT_ID, note: '  ' })).toEqual({ ok: true, value: { paymentId: UNIT_ID, note: null } })
    expect(parseResetTenantPassword({ tenantId: TENANT_ID })).toEqual({ ok: true, value: { tenantId: TENANT_ID, mode: 'email' } })
    expect(parseResetTenantPassword({ tenantId: TENANT_ID, mode: 'set', newPassword: 'short' }).ok).toBe(false)
    expect(parseDeleteAccount({ password: 'pw' }).ok).toBe(false)
    expect(parseDeleteAccount({ confirm: 'DELETE', password: 'pw' })).toEqual({ ok: true, value: { confirm: 'DELETE', password: 'pw' } })
    expect(parseExpoToken({ token: 'ExponentPushToken[abcdefghijkl]', platform: 'ios' }).ok).toBe(true)
    expect(parseExpoToken({ token: 'ExponentPushToken[abc]', platform: 'ios' }).ok).toBe(false)
    expect(parseExpoToken({ token: 'ExponentPushToken[abcdefghijkl]', platform: 'web' }).ok).toBe(false)
    expect(parseNotify({ userId: LANDLORD_ID, type: 'payment_submitted', title: 'T', body: 'B', link: 'https://x' }).ok).toBe(false)
    expect(parseNotify({ userId: LANDLORD_ID, type: 'Bad Type', title: 'T', body: 'B' }).ok).toBe(false)
  })
})

describe('authz', () => {
  it('requires a signed-in, not deleted user', () => {
    expect(() => requireSignedIn(null)).toThrow(HttpError)
    expect(() => requireSignedIn({ ...tenant, deletedAt: '2026-01-01' })).toThrow(/closed/)
  })
  it('requires the landlord role', () => {
    expect(requireLandlord(landlord)).toBe(landlord)
    expect(() => requireLandlord(tenant)).toThrow('Not authorized')
    expect(() => requireLandlord({ ...tenant, role: null })).toThrow('Not authorized')
  })
  it('mirrors the notifications policies', () => {
    const L = { id: LANDLORD_ID, role: 'landlord' as const, deletedAt: null }
    const T = { id: TENANT_ID, role: 'tenant' as const, deletedAt: null }
    expect(canNotify(landlord, T, 'anything').ok).toBe(true)
    expect(canNotify(tenant, L, 'payment_submitted').ok).toBe(true)
    expect(canNotify(tenant, L, 'payment_reviewed').ok).toBe(false)
    expect(canNotify(tenant, T, 'new_message').ok).toBe(false)
    expect(canNotify(landlord, null, 'x').ok).toBe(false)
    expect(canNotify(landlord, { ...T, deletedAt: 'x' }, 'x').ok).toBe(false)
  })
  it('re-auth rules', () => {
    expect(reauthNeeded({ providers: ['email'] }, 1000, 1000)).toBe('password')
    expect(reauthNeeded({ providers: ['google'] }, 1000, 1500)).toBe('recent-login-ok')
    expect(reauthNeeded({ providers: ['google'] }, 1000, 1700)).toBe('recent-login-required')
    expect(reauthNeeded({ providers: ['google'] }, null, 1700)).toBe('recent-login-required')
  })
  it('never deletes the landlord', () => {
    expect(deletionAllowed(landlord).ok).toBe(false)
    expect(deletionAllowed(tenant).ok).toBe(true)
  })
  it('maps database errors without leaking internals', () => {
    expect(rpcErrorToHttp({ code: '42501', message: 'Not authorized' }).status).toBe(403)
    expect(rpcErrorToHttp({ code: 'P0001', message: 'This unit already has an active tenant' }).status).toBe(409)
    expect(rpcErrorToHttp({ code: 'P0001', message: 'Lease not found' }).status).toBe(404)
    const e = rpcErrorToHttp({ code: '23505', message: 'duplicate key value violates unique constraint "x_pkey"' })
    expect(e.status).toBe(500)
    expect(e.message).not.toContain('x_pkey')
  })
})

describe('caller', () => {
  it('null without a token, or with a bare API key', async () => {
    const l = { getUser: vi.fn(), getProfile: vi.fn() }
    expect(await resolveCaller(null, l)).toBeNull()
    expect(await resolveCaller('sb_publishable_abc', l)).toBeNull()
    expect(l.getUser).not.toHaveBeenCalled()
  })
  it('null when Auth rejects the token', async () => {
    expect(await resolveCaller('jwt', { getUser: async () => null, getProfile: vi.fn() })).toBeNull()
    expect(await resolveCaller('jwt', { getUser: async () => { throw new Error('x') }, getProfile: vi.fn() })).toBeNull()
  })
  it('role comes from the profile', async () => {
    const c = await resolveCaller('jwt', {
      getUser: async () => ({ id: TENANT_ID, email: 'a@b.c' }),
      getProfile: async () => ({ role: 'tenant', deleted_at: null }),
    })
    expect(c).toEqual({ id: TENANT_ID, email: 'a@b.c', role: 'tenant', deletedAt: null })
  })
  it('reads iat', () => {
    const payload = btoa(JSON.stringify({ iat: 1234 })).replace(/=+$/, '')
    expect(jwtIssuedAt(`h.${payload}.s`)).toBe(1234)
    expect(jwtIssuedAt('garbage')).toBeNull()
  })
})

describe('messages', () => {
  it('payment texts match the web', () => {
    expect(paymentReviewedNotification(TENANT_ID, 'rejected', '2026-11', null).body)
      .toBe('Your payment for 2026-11 was rejected. Please upload the receipt again.')
  })
  it('broadcast preview and dedupe', () => {
    const n = broadcastNotifications([TENANT_ID, TENANT_ID], 'Jean', 'x'.repeat(100))
    expect(n).toHaveLength(1)
    expect(n[0].body).toBe(`Jean: ${'x'.repeat(80)}…`)
  })
  it('escapes email content', () => {
    expect(emailLayout('<b>', 'ok', { href: '/a?b=1&c=2', label: '<i>' })).not.toContain('<b>')
  })
})
