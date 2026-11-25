import { describe, expect, it, vi } from 'vitest'
import { HttpError } from './http.ts'
import { addTenant, endTenancy, replaceTenancy } from './handlers/tenancy.ts'
import { confirmPayment, rejectPayment } from './handlers/payments.ts'
import { resetTenantPassword } from './handlers/reset-tenant-password.ts'
import { broadcast } from './handlers/broadcast.ts'
import { notify, parseWebhookRecord } from './handlers/notify.ts'
import { GENERIC_ERROR, LIMITED_ERROR, phoneSignIn } from './handlers/phone-sign-in.ts'
import { CLOSED_BAN_DURATION, deleteAccount } from './handlers/delete-account.ts'
import { reactivateTenant } from './handlers/reactivate-tenant.ts'
import {
  LANDLORD_ID, LEASE_ID, OTHER_TENANT_ID, PAYMENT_ID, TENANT_ID, UNIT_ID, landlord, tenant,
  mockAdminDb, mockAnon, mockCtx, mockUserDb, req, testEnv,
} from './test-helpers.ts'

async function httpError(p: Promise<unknown>): Promise<HttpError> {
  try { await p } catch (e) { if (e instanceof HttpError) return e; throw e }
  throw new Error('expected an HttpError')
}

const details = {
  email: 'new@example.com', fullName: 'Aline', phone: null, unitId: UNIT_ID,
  moveInDate: '2026-12-01', monthlyRent: 300000, depositAmount: 300000, leaseEnd: null,
}

describe('add-tenant', () => {
  it('401 without a user, 403 for a tenant, before touching the admin client', async () => {
    const admin = mockAdminDb()
    expect((await httpError(addTenant(mockCtx({ caller: null, admin }), details))).status).toBe(401)
    expect((await httpError(addTenant(mockCtx({ caller: tenant, admin }), details))).status).toBe(403)
    expect(admin.findUserIdByEmail).not.toHaveBeenCalled()
    expect(admin.createUser).not.toHaveBeenCalled()
  })
  it('400 on bad input, before the admin client', async () => {
    const admin = mockAdminDb()
    const e = await httpError(addTenant(mockCtx({ admin }), { ...details, monthlyRent: -5 }))
    expect(e.status).toBe(400)
    expect(admin.findUserIdByEmail).not.toHaveBeenCalled()
  })
  it('creates the login, attaches as the landlord (RLS client), returns ids', async () => {
    const user = mockUserDb()
    const ctx = mockCtx({ user })
    const r = await addTenant(ctx, details)
    expect(r).toEqual({ ok: true, leaseId: LEASE_ID, tenantId: 'new-user', created: true })
    expect(user.rpc).toHaveBeenCalledWith('attach_tenant', expect.objectContaining({ p_tenant: 'new-user', p_unit: UNIT_ID, p_rent: 300000 }))
    expect(ctx.admin.updateUser).not.toHaveBeenCalled()
  })
  it('keeps (never deletes) a new login when the database refuses', async () => {
    const user = mockUserDb({ rpc: vi.fn(async () => ({ data: null, error: { code: 'P0001', message: 'This unit already has an active tenant' } })) as never })
    const ctx = mockCtx({ user })
    const e = await httpError(addTenant(ctx, details))
    expect(e.status).toBe(409)
    expect(e.message).toBe('This unit already has an active tenant')
    expect(ctx.log).toHaveBeenCalledWith(expect.stringMatching(/kept without a profile/))
  })
  it('re-enables a returning tenant and never deletes their login on failure', async () => {
    const admin = mockAdminDb({ findUserIdByEmail: vi.fn(async () => ({ data: OTHER_TENANT_ID, error: null })) })
    const r = await addTenant(mockCtx({ admin }), details)
    expect(r.created).toBe(false)
    expect(admin.updateUser).toHaveBeenCalledWith(OTHER_TENANT_ID, { ban_duration: 'none' })

    const failing = mockUserDb({ rpc: vi.fn(async () => ({ data: null, error: { code: '42501', message: 'Not authorized' } })) as never })
    const admin2 = mockAdminDb({ findUserIdByEmail: vi.fn(async () => ({ data: OTHER_TENANT_ID, error: null })) })
    expect((await httpError(addTenant(mockCtx({ admin: admin2, user: failing }), details))).status).toBe(403)
  })
  it("refuses the landlord's own email", async () => {
    const admin = mockAdminDb({ findUserIdByEmail: vi.fn(async () => ({ data: LANDLORD_ID, error: null })) })
    expect((await httpError(addTenant(mockCtx({ admin }), details))).status).toBe(409)
  })
})

describe('end-tenancy / replace-tenancy', () => {
  it('ends the lease and notifies the tenant', async () => {
    const ctx = mockCtx()
    const r = await endTenancy(ctx, { leaseId: LEASE_ID, moveOutDate: '2026-11-30' })
    expect(r).toEqual({ ok: true })
    expect(ctx.user.rpc).toHaveBeenCalledWith('end_tenancy', { p_lease: LEASE_ID, p_move_out: '2026-11-30' })
    expect(ctx.user.insertNotifications).toHaveBeenCalledWith([expect.objectContaining({ user_id: TENANT_ID, type: 'tenancy_ended' })])
  })
  it('404 for an unknown lease, 409 for an ended one', async () => {
    expect((await httpError(endTenancy(mockCtx({ user: mockUserDb({ getLease: vi.fn(async () => null) }) }), { leaseId: LEASE_ID, moveOutDate: '2026-11-30' }))).status).toBe(404)
    const ended = mockUserDb({ getLease: vi.fn(async () => ({ id: LEASE_ID, tenant_id: TENANT_ID, unit_id: UNIT_ID, status: 'ended' as const })) })
    expect((await httpError(endTenancy(mockCtx({ user: ended }), { leaseId: LEASE_ID, moveOutDate: '2026-11-30' }))).status).toBe(409)
  })
  it('the notification failing is a warning, not an error', async () => {
    const user = mockUserDb({ insertNotifications: vi.fn(async () => ({ message: 'x' })) })
    const r = await endTenancy(mockCtx({ user }), { leaseId: LEASE_ID, moveOutDate: '2026-11-30' })
    expect(r.warning).toMatch(/alert could not be sent/)
  })
  it('replace: checks the outgoing lease belongs to that tenant and unit', async () => {
    const body = { outgoing: { tenantId: OTHER_TENANT_ID, leaseId: LEASE_ID, unitId: UNIT_ID, moveOutDate: '2026-11-30' }, incoming: details }
    expect((await httpError(replaceTenancy(mockCtx(), body))).status).toBe(409)
  })
  it('replace: refuses the same person; a refused attach changes nothing', async () => {
    const same = mockAdminDb({ findUserIdByEmail: vi.fn(async () => ({ data: TENANT_ID, error: null })) })
    const body = { outgoing: { tenantId: TENANT_ID, leaseId: LEASE_ID, unitId: UNIT_ID, moveOutDate: '2026-11-30' }, incoming: details }
    expect((await httpError(replaceTenancy(mockCtx({ admin: same }), body))).message).toMatch(/same person/)

    const user = mockUserDb({ rpc: vi.fn(async () => ({ data: null, error: { code: 'P0001', message: 'The outgoing lease is not on this unit' } })) as never })
    const ctx = mockCtx({ user })
    expect((await httpError(replaceTenancy(ctx, body))).status).toBe(409)
  })
  it('replace: success notifies the outgoing tenant', async () => {
    const body = { outgoing: { tenantId: TENANT_ID, leaseId: LEASE_ID, unitId: UNIT_ID, moveOutDate: '2026-11-30' }, incoming: details }
    const ctx = mockCtx()
    const r = await replaceTenancy(ctx, body)
    expect(r.ok).toBe(true)
    expect(ctx.user.rpc).toHaveBeenCalledWith('replace_tenancy', expect.objectContaining({ p_old_lease: LEASE_ID, p_tenant: 'new-user' }))
    expect(ctx.user.insertNotifications).toHaveBeenCalledWith([expect.objectContaining({ user_id: TENANT_ID })])
  })
})

describe('confirm-payment / reject-payment', () => {
  it('tenant cannot review', async () => {
    expect((await httpError(confirmPayment(mockCtx({ caller: tenant }), { paymentId: PAYMENT_ID }))).status).toBe(403)
  })
  it('confirms as the landlord and notifies', async () => {
    const ctx = mockCtx()
    expect(await confirmPayment(ctx, { paymentId: PAYMENT_ID })).toEqual({ ok: true, paymentId: PAYMENT_ID, status: 'confirmed' })
    expect(ctx.user.reviewPayment).toHaveBeenCalledWith(PAYMENT_ID, 'confirmed', null, LANDLORD_ID, undefined)
    expect(ctx.user.insertNotifications).toHaveBeenCalledWith([expect.objectContaining({ title: 'Payment confirmed' })])
  })
  it('reject carries the note to the tenant', async () => {
    const ctx = mockCtx()
    await rejectPayment(ctx, { paymentId: PAYMENT_ID, note: 'Blurry photo' })
    expect(ctx.user.insertNotifications).toHaveBeenCalledWith([expect.objectContaining({ body: 'Your payment for 2026-11 was rejected. Note: Blurry photo' })])
  })
  it('the landlord can record how it was paid (momo, bank, cash only)', async () => {
    const ctx = mockCtx()
    await confirmPayment(ctx, { paymentId: PAYMENT_ID, method: 'momo' })
    expect(ctx.user.reviewPayment).toHaveBeenCalledWith(PAYMENT_ID, 'confirmed', null, LANDLORD_ID, 'momo')
    expect((await httpError(confirmPayment(mockCtx(), { paymentId: PAYMENT_ID, method: 'airtel' }))).status).toBe(400)
  })
  it('409 when already reviewed', async () => {
    const user = mockUserDb({ reviewPayment: vi.fn(async () => ({ data: null, error: null })) })
    expect((await httpError(confirmPayment(mockCtx({ user }), { paymentId: PAYMENT_ID }))).status).toBe(409)
  })
})

describe('reset-tenant-password', () => {
  it('never targets the landlord', async () => {
    const e = await httpError(resetTenantPassword(mockCtx(), { tenantId: LANDLORD_ID, mode: 'set', newPassword: 'longenough' }))
    expect(e.status).toBe(404)
  })
  it('set mode updates the password', async () => {
    const ctx = mockCtx()
    await resetTenantPassword(ctx, { tenantId: TENANT_ID, mode: 'set', newPassword: 'longenough' })
    expect(ctx.admin.updateUser).toHaveBeenCalledWith(TENANT_ID, { password: 'longenough' })
  })
  it('email mode needs Brevo, then sends the recovery link', async () => {
    expect((await httpError(resetTenantPassword(mockCtx(), { tenantId: TENANT_ID }))).message).toBe('Email is not set up yet')
    const ctx = mockCtx({ env: testEnv({ BREVO_API_KEY: 'k', EMAIL_FROM: 'f@example.test', TENANT_APP_URL: 'https://tenant.test' }) })
    expect(await resetTenantPassword(ctx, { tenantId: TENANT_ID })).toEqual({ ok: true, mode: 'email' })
    const fetch = ctx.fetch as unknown as { calls: { body: unknown }[] }
    expect(JSON.stringify(fetch.calls[0].body)).toContain('https://tenant.test/auth/confirm?token_hash=hashed-token')
  })
})

describe('broadcast', () => {
  it('saves the message and notifies each current tenant', async () => {
    const ctx = mockCtx()
    const r = await broadcast(ctx, { body: 'Water off on Friday' })
    expect(r).toEqual({ ok: true, messageId: 'msg-1', notified: 2 })
    expect(ctx.user.insertBroadcast).toHaveBeenCalledWith(LANDLORD_ID, 'Water off on Friday')
  })
  it('tenants cannot broadcast; empty is refused', async () => {
    expect((await httpError(broadcast(mockCtx({ caller: tenant }), { body: 'hi' }))).status).toBe(403)
    expect((await httpError(broadcast(mockCtx(), { body: '   ' }))).status).toBe(400)
  })
})

describe('notify', () => {
  const toLandlord = { userId: LANDLORD_ID, type: 'payment_submitted', title: 'New payment receipt', body: 'x', link: '/landlord/rent' }
  it('tenant -> landlord with an allowed type', async () => {
    const ctx = mockCtx({ caller: tenant })
    const r = await notify(ctx, toLandlord, req())
    expect(r.ok).toBe(true)
    expect(ctx.user.insertNotifications).toHaveBeenCalledOnce()
  })
  it('tenant -> tenant, or a fake landlord-only type, is refused before inserting', async () => {
    const ctx = mockCtx({ caller: tenant })
    expect((await httpError(notify(ctx, { ...toLandlord, userId: OTHER_TENANT_ID, type: 'new_message' }, req()))).status).toBe(403)
    expect((await httpError(notify(ctx, { ...toLandlord, type: 'payment_reviewed' }, req()))).status).toBe(403)
    expect(ctx.user.insertNotifications).not.toHaveBeenCalled()
  })
  it('signed-out callers get 401', async () => {
    expect((await httpError(notify(mockCtx({ caller: null }), toLandlord, req()))).status).toBe(401)
  })
  it('does not deliver itself when the webhook does', async () => {
    const ctx = mockCtx({ env: testEnv({ NOTIFY_WEBHOOK_ENABLED: 'true' }) })
    expect(await notify(ctx, toLandlord, req())).toEqual({ ok: true, delivered: null })
    expect(ctx.admin.getProfile).not.toHaveBeenCalled()
  })
  const payload = { type: 'INSERT', table: 'notifications', record: { user_id: TENANT_ID, type: 'broadcast', title: 'T', body: 'B', link: '//evil' } }
  it('webhook: wrong or missing secret -> 401', async () => {
    const ctx = mockCtx({ env: testEnv({ NOTIFY_WEBHOOK_SECRET: 'right', NOTIFY_WEBHOOK_ENABLED: 'true' }) })
    expect((await httpError(notify(ctx, payload, req({ 'x-webhook-secret': 'wrong' })))).status).toBe(401)
    const noSecret = mockCtx({ env: testEnv({ NOTIFY_WEBHOOK_ENABLED: 'true' }) })
    expect((await httpError(notify(noSecret, payload, req({ 'x-webhook-secret': '' })))).status).toBe(401)
  })
  it('webhook: delivers when enabled, skips when not', async () => {
    const on = mockCtx({ caller: null, env: testEnv({ NOTIFY_WEBHOOK_SECRET: 'right', NOTIFY_WEBHOOK_ENABLED: 'true' }) })
    const r = await notify(on, payload, req({ 'x-webhook-secret': 'right' }))
    expect('delivered' in r && r.delivered?.recipients).toBe(1)
    const off = mockCtx({ env: testEnv({ NOTIFY_WEBHOOK_SECRET: 'right' }) })
    expect(await notify(off, payload, req({ 'x-webhook-secret': 'right' }))).toMatchObject({ skipped: expect.any(String) })
  })
  it('webhook record: an outside link is dropped', () => {
    expect(parseWebhookRecord(payload)?.link).toBeNull()
    expect(parseWebhookRecord({ ...payload, table: 'payments' })).toBeNull()
  })
})

describe('phone-sign-in', () => {
  const lookup = (row: { email: string | null; limited: boolean }) =>
    mockAdminDb({ rpc: vi.fn(async () => ({ data: [row], error: null })) as never })
  const noPad = { padMs: () => 0 }

  it('passes a peppered IP hash, never the IP', async () => {
    const admin = lookup({ email: 'a@b.c', limited: false })
    await phoneSignIn(mockCtx({ admin, caller: null }), { phone: '0788', password: 'pw' }, undefined, noPad)
    const args = (admin.rpc as ReturnType<typeof vi.fn>).mock.calls[0][1]
    expect(args.p_client_key).toMatch(/^[0-9a-f]{64}$/)
    expect(JSON.stringify(args)).not.toContain('203.0.113.7')
  })
  it('unknown number and wrong password look the same', async () => {
    const unknown = await httpError(phoneSignIn(mockCtx({ admin: lookup({ email: null, limited: false }) }), { phone: '0788', password: 'pw' }, undefined, noPad))
    const wrong = await httpError(phoneSignIn(mockCtx({ admin: lookup({ email: 'a@b.c', limited: false }), anon: mockAnon(false) }), { phone: '0788', password: 'pw' }, undefined, noPad))
    expect([unknown.status, unknown.message]).toEqual([401, GENERIC_ERROR])
    expect([wrong.status, wrong.message]).toEqual([401, GENERIC_ERROR])
  })
  it('limited -> 429 without calling Auth', async () => {
    const ctx = mockCtx({ admin: lookup({ email: null, limited: true }) })
    const e = await httpError(phoneSignIn(ctx, { phone: '0788', password: 'pw' }, undefined, noPad))
    expect([e.status, e.message]).toEqual([429, LIMITED_ERROR])
    expect(ctx.anon.signInWithPassword).not.toHaveBeenCalled()
  })
  it('success returns only the session (no email)', async () => {
    const r = await phoneSignIn(mockCtx({ admin: lookup({ email: 'secret@b.c', limited: false }) }), { phone: '0788', password: 'pw' }, undefined, noPad)
    expect(r.session.access_token).toBe('at')
    expect(JSON.stringify(r)).not.toContain('secret@b.c')
  })
  it('without the pepper the function refuses to run', async () => {
    const env = { ...testEnv(), phoneLookupPepper: null }
    expect((await httpError(phoneSignIn(mockCtx({ env }), { phone: '0788', password: 'pw' }, undefined, noPad))).status).toBe(503)
  })
})

describe('delete-account (closes the account: block login only)', () => {
  const sql = (over: Partial<{ had_active_lease: boolean; already_closed: boolean }> = {}) =>
    vi.fn(async () => ({ data: { mode: 'closed', already_closed: false, landlord_id: LANDLORD_ID, unit_label: 'A1', had_active_lease: false, ...over }, error: null }))
  const banCalls = (admin: ReturnType<typeof mockAdminDb>) => (admin.updateUser as ReturnType<typeof vi.fn>).mock.calls

  it('the landlord is refused, nothing changes', async () => {
    const ctx = mockCtx({ caller: landlord })
    expect((await httpError(deleteAccount(ctx, { confirm: 'DELETE', password: 'pw' }))).status).toBe(403)
    expect(ctx.admin.updateUser).not.toHaveBeenCalled()
  })
  it('needs DELETE and the right password', async () => {
    expect((await httpError(deleteAccount(mockCtx({ caller: tenant }), { password: 'pw' }))).status).toBe(400)
    expect((await httpError(deleteAccount(mockCtx({ caller: tenant }), { confirm: 'DELETE' }))).status).toBe(400)
    const ctx = mockCtx({ caller: tenant, anon: mockAnon(false) })
    expect((await httpError(deleteAccount(ctx, { confirm: 'DELETE', password: 'bad' }))).status).toBe(401)
    expect(ctx.admin.updateUser).not.toHaveBeenCalled()
  })
  it('Google-only login must have signed in recently', async () => {
    const admin = mockAdminDb({ getAuthUser: vi.fn(async (id: string) => ({ id, email: 'g@x.y', bannedUntil: null, providers: ['google'] })) })
    const old = mockCtx({ caller: tenant, admin, tokenIssuedAt: Date.parse('2026-11-24T11:00:00Z') / 1000 })
    expect((await httpError(deleteAccount(old, { confirm: 'DELETE' }))).status).toBe(403)
  })
  it('a closed account cannot sign in: banned, every session revoked, tokens + deleted_at in SQL, nothing deleted', async () => {
    const admin = mockAdminDb({ rpc: sql() as never })
    const ctx = mockCtx({ caller: tenant, admin })
    const r = await deleteAccount(ctx, { confirm: 'DELETE', password: 'pw' })
    expect(r).toEqual({ ok: true, mode: 'closed', warnings: [] })
    expect(banCalls(admin)).toEqual([[TENANT_ID, { ban_duration: CLOSED_BAN_DURATION }]])
    expect(CLOSED_BAN_DURATION).toBe('876000h')
    expect(admin.signOutEverywhere).toHaveBeenCalledWith(ctx.jwt)
    expect(admin.rpc).toHaveBeenCalledWith('delete_account', { p_user: TENANT_ID })
    // Block login only: no Auth delete exists any more, no files touched, no password scrub.
    expect('deleteUser' in admin).toBe(false)
    expect('removeUserFolder' in admin).toBe(false)
    expect(admin.insertNotifications).not.toHaveBeenCalled()
  })
  it('active lease -> the landlord is alerted once', async () => {
    const admin = mockAdminDb({ rpc: sql({ had_active_lease: true }) as never })
    await deleteAccount(mockCtx({ caller: tenant, admin }), { confirm: 'DELETE', password: 'pw' })
    expect(admin.insertNotifications).toHaveBeenCalledWith([expect.objectContaining({ user_id: LANDLORD_ID, type: 'tenant_deleted_account', title: 'A tenant closed their account' })])
    const again = mockAdminDb({ rpc: sql({ had_active_lease: true, already_closed: true }) as never })
    await deleteAccount(mockCtx({ caller: tenant, admin: again }), { confirm: 'DELETE', password: 'pw' })
    expect(again.insertNotifications).not.toHaveBeenCalled()
  })
  it('ban failing stops everything', async () => {
    const admin = mockAdminDb({ updateUser: vi.fn(async () => ({ message: 'down' })), rpc: sql() as never })
    expect((await httpError(deleteAccount(mockCtx({ caller: tenant, admin }), { confirm: 'DELETE', password: 'pw' }))).status).toBe(503)
    expect(admin.signOutEverywhere).not.toHaveBeenCalled()
    expect(admin.rpc).not.toHaveBeenCalled()
  })
  it('sign-out failing lifts the ban again (retry possible)', async () => {
    const admin = mockAdminDb({ signOutEverywhere: vi.fn(async () => ({ message: 'x' })), rpc: sql() as never })
    expect((await httpError(deleteAccount(mockCtx({ caller: tenant, admin }), { confirm: 'DELETE', password: 'pw' }))).status).toBe(503)
    expect(banCalls(admin)).toEqual([[TENANT_ID, { ban_duration: CLOSED_BAN_DURATION }], [TENANT_ID, { ban_duration: 'none' }]])
    expect(admin.rpc).not.toHaveBeenCalled()
  })
  it('delete_account() failing lifts the ban again (QA fix kept)', async () => {
    const admin = mockAdminDb({ rpc: vi.fn(async () => ({ data: null, error: { code: '57014', message: 'timeout' } })) as never })
    expect((await httpError(deleteAccount(mockCtx({ caller: tenant, admin }), { confirm: 'DELETE', password: 'pw' }))).status).toBe(503)
    expect(banCalls(admin)[1]).toEqual([TENANT_ID, { ban_duration: 'none' }])
  })
  it('an already-closed caller is refused (their token is only good until it expires)', async () => {
    expect((await httpError(deleteAccount(mockCtx({ caller: { ...tenant, deletedAt: '2026-11-25' } }), { confirm: 'DELETE', password: 'pw' }))).status).toBe(403)
  })
})

describe('phone-sign-in for a closed account', () => {
  it('the lookup returns no email for a closed profile -> the generic 401, no Auth call', async () => {
    // phone_sign_in_lookup() filters deleted_at in SQL (17_checks 7h); here: what the function does with that answer.
    const admin = mockAdminDb({ rpc: vi.fn(async () => ({ data: [{ email: null, limited: false }], error: null })) as never })
    const ctx = mockCtx({ caller: null, admin })
    const e = await httpError(phoneSignIn(ctx, { phone: '0788000555', password: 'pw' }, undefined, { padMs: () => 0 }))
    expect([e.status, e.message]).toEqual([401, GENERIC_ERROR])
    expect(ctx.anon.signInWithPassword).not.toHaveBeenCalled()
  })
})

describe('reactivate-tenant', () => {
  const closed = (over: Record<string, unknown> = {}) => mockAdminDb({
    getProfile: vi.fn(async (id: string) => ({ id, role: 'tenant' as const, full_name: 'T', unit_id: UNIT_ID, email_notifications: true, deleted_at: '2026-11-25T00:00:00Z', ...over })),
    rpc: vi.fn(async () => ({ data: true, error: null })) as never,
  })
  it('landlord only', async () => {
    expect((await httpError(reactivateTenant(mockCtx({ caller: tenant, admin: closed() }), { tenantId: TENANT_ID }))).status).toBe(403)
    expect((await httpError(reactivateTenant(mockCtx({ caller: null, admin: closed() }), { tenantId: TENANT_ID }))).status).toBe(401)
  })
  it('restores sign-in: lifts the ban and clears deleted_at', async () => {
    const admin = closed()
    expect(await reactivateTenant(mockCtx({ admin }), { tenantId: TENANT_ID })).toEqual({ ok: true, tenantId: TENANT_ID })
    expect(admin.updateUser).toHaveBeenCalledWith(TENANT_ID, { ban_duration: 'none' })
    expect(admin.rpc).toHaveBeenCalledWith('reactivate_account', { p_user: TENANT_ID })
  })
  it('only the landlord\'s own tenants (a lease here), only closed accounts, never the landlord', async () => {
    const user = mockUserDb({ countLeasesForTenant: vi.fn(async () => 0) })
    expect((await httpError(reactivateTenant(mockCtx({ user, admin: closed() }), { tenantId: TENANT_ID }))).status).toBe(404)
    const archivedOnly = closed({ deleted_at: null })
    expect((await httpError(reactivateTenant(mockCtx({ admin: archivedOnly }), { tenantId: TENANT_ID }))).status).toBe(409)
    expect(archivedOnly.updateUser).not.toHaveBeenCalled()
    expect((await httpError(reactivateTenant(mockCtx({ admin: closed({ role: 'landlord' }) }), { tenantId: LANDLORD_ID }))).status).toBe(404)
  })
  it('SQL failing puts the ban back', async () => {
    const admin = closed()
    ;(admin as { rpc: unknown }).rpc = vi.fn(async () => ({ data: null, error: { message: 'x' } }))
    expect((await httpError(reactivateTenant(mockCtx({ admin }), { tenantId: TENANT_ID }))).status).toBe(503)
    expect((admin.updateUser as ReturnType<typeof vi.fn>).mock.calls[1]).toEqual([TENANT_ID, { ban_duration: CLOSED_BAN_DURATION }])
  })
})
