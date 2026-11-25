// Denial paths of EVERY Edge Function handler, table-driven (docs/edge-functions-audit.md).
// For each: no/forged JWT (caller null) -> 401, wrong role -> 403, closed account -> 403,
// bad input -> 400, all BEFORE the secret-key client or any write is touched; and the
// error bodies never carry keys, emails or internal ids.
import { describe, expect, it, vi } from 'vitest'
import { HttpError, errorResponse } from './http.ts'
import { addTenant, endTenancy, replaceTenancy } from './handlers/tenancy.ts'
import { confirmPayment, rejectPayment } from './handlers/payments.ts'
import { resetTenantPassword } from './handlers/reset-tenant-password.ts'
import { broadcast } from './handlers/broadcast.ts'
import { reactivateTenant } from './handlers/reactivate-tenant.ts'
import { notify } from './handlers/notify.ts'
import { deleteAccount } from './handlers/delete-account.ts'
import { phoneSignIn, GENERIC_ERROR } from './handlers/phone-sign-in.ts'
import type { Caller } from './authz.ts'
import type { Ctx } from './ports.ts'
import { LANDLORD_ID, OTHER_TENANT_ID, TENANT_ID, mockAdminDb, mockCtx, mockUserDb, req, tenant, landlord } from './test-helpers.ts'

type Fn = (ctx: Ctx, body: Record<string, unknown>) => Promise<unknown>

async function status(p: Promise<unknown>): Promise<HttpError> {
  try { await p } catch (e) { if (e instanceof HttpError) return e; throw e }
  throw new Error('expected an HttpError')
}

const closedLandlord: Caller = { ...landlord, deletedAt: '2026-11-01T00:00:00Z' }
const closedTenant: Caller = { ...tenant, deletedAt: '2026-11-01T00:00:00Z' }
const noRole: Caller = { id: TENANT_ID, email: 'x@example.test', role: null, deletedAt: null }

// Landlord-only functions with an EMPTY body (invalid input for all of them).
const LANDLORD_ONLY: [string, Fn][] = [
  ['add-tenant', addTenant], ['end-tenancy', endTenancy], ['replace-tenancy', replaceTenancy],
  ['confirm-payment', confirmPayment], ['reject-payment', rejectPayment],
  ['reset-tenant-password', resetTenantPassword], ['broadcast', broadcast], ['reactivate-tenant', reactivateTenant],
]

function untouched(ctx: Ctx) {
  const a = ctx.admin as unknown as Record<string, { mock: { calls: unknown[] } }>
  const u = ctx.user as unknown as Record<string, { mock: { calls: unknown[] } }>
  for (const k of Object.keys(a)) expect(a[k].mock.calls, `admin.${k}`).toHaveLength(0)
  for (const k of ['rpc', 'insertNotifications', 'insertBroadcast', 'reviewPayment']) expect(u[k].mock.calls, `user.${k}`).toHaveLength(0)
}

describe.each(LANDLORD_ONLY)('%s denials', (_name, fn) => {
  it('no or forged JWT -> 401 and nothing touched', async () => {
    const ctx = mockCtx({ caller: null })
    expect((await status(fn(ctx, {}))).status).toBe(401)
    untouched(ctx)
  })
  it('a tenant, a user without a profile role, or a closed landlord -> 403 and nothing touched', async () => {
    for (const caller of [tenant, closedTenant, noRole, closedLandlord]) {
      const ctx = mockCtx({ caller })
      expect((await status(fn(ctx, {}))).status, JSON.stringify(caller.role)).toBe(403)
      untouched(ctx)
    }
  })
  it('a role or user id smuggled in the body changes nothing', async () => {
    const ctx = mockCtx({ caller: tenant })
    const e = await status(fn(ctx, { role: 'landlord', callerId: LANDLORD_ID, user_id: LANDLORD_ID, actorId: LANDLORD_ID }))
    expect(e.status).toBe(403)
    untouched(ctx)
  })
  it('landlord with bad input -> 400 before the secret-key client', async () => {
    const ctx = mockCtx({ caller: landlord })
    expect((await status(fn(ctx, {}))).status).toBe(400)
    untouched(ctx)
  })
})

describe('target ownership / existence (landlord-only actions)', () => {
  it('reset-tenant-password: landlord, closed, missing and non-tenant targets all look the same', async () => {
    const mk = (profile: unknown) => mockCtx({ admin: mockAdminDb({ getProfile: async () => profile as never }) })
    const base = { id: OTHER_TENANT_ID, full_name: 'x', unit_id: null, email_notifications: true }
    const errs = await Promise.all([
      status(resetTenantPassword(mk(null), { tenantId: OTHER_TENANT_ID })),
      status(resetTenantPassword(mk({ ...base, role: 'landlord', deleted_at: null }), { tenantId: OTHER_TENANT_ID })),
      status(resetTenantPassword(mk({ ...base, role: 'tenant', deleted_at: '2026-01-01' }), { tenantId: OTHER_TENANT_ID })),
    ])
    expect(new Set(errs.map(e => `${e.status}:${e.message}`)).size).toBe(1)
    expect(errs[0].status).toBe(404)
  })
  it('reactivate-tenant: unknown id and "no lease here" give the same answer', async () => {
    const unknown = mockCtx({ admin: mockAdminDb({ getProfile: async () => null }) })
    const noLease = mockCtx({ user: mockUserDb({ countLeasesForTenant: async () => 0 }) })
    const a = await status(reactivateTenant(unknown, { tenantId: OTHER_TENANT_ID }))
    const b = await status(reactivateTenant(noLease, { tenantId: OTHER_TENANT_ID }))
    expect([a.status, a.message]).toEqual([b.status, b.message])
    expect(noLease.admin.updateUser).not.toHaveBeenCalled()
  })
  it('end-tenancy: a lease the landlord client cannot see is a plain 404', async () => {
    const ctx = mockCtx({ user: mockUserDb({ getLease: async () => null }) })
    const e = await status(endTenancy(ctx, { leaseId: '00000000-0000-4000-8000-0000000000c9', moveOutDate: '2026-12-01' }))
    expect(e.status).toBe(404)
    expect(ctx.user.rpc).not.toHaveBeenCalled()
  })
  it('confirm-payment: a payment that is not there / already reviewed is a conflict, nothing notified', async () => {
    const ctx = mockCtx({ user: mockUserDb({ reviewPayment: async () => ({ data: null, error: null }) }) })
    const e = await status(confirmPayment(ctx, { paymentId: '00000000-0000-4000-8000-0000000000d9' }))
    expect(e.status).toBe(409)
    expect(ctx.user.insertNotifications).not.toHaveBeenCalled()
  })
  it('RLS refusal (42501) from the database is a generic 403', async () => {
    const ctx = mockCtx({ user: mockUserDb({ reviewPayment: async () => ({ data: null, error: { code: '42501', message: 'new row violates row-level security policy for table "payments"' } }) }) })
    const e = await status(confirmPayment(ctx, { paymentId: '00000000-0000-4000-8000-0000000000d9' }))
    expect([e.status, e.message]).toEqual([403, 'Not authorized'])
  })
})

describe('notify denials', () => {
  const ok = { userId: LANDLORD_ID, type: 'payment_submitted', title: 'T', body: 'B' }
  it('no JWT 401; closed tenant 403; bad input 400; tenant -> tenant/unknown 404 (RLS hides them)', async () => {
    expect((await status(notify(mockCtx({ caller: null }), ok, req()))).status).toBe(401)
    expect((await status(notify(mockCtx({ caller: closedTenant }), ok, req()))).status).toBe(403)
    expect((await status(notify(mockCtx({ caller: tenant }), { ...ok, title: '' }, req()))).status).toBe(400)
    const hidden = mockCtx({ caller: tenant, user: mockUserDb({ getProfile: async () => null }) })
    const e = await status(notify(hidden, { ...ok, userId: OTHER_TENANT_ID }, req()))
    expect(e.status).toBe(404)
    expect(hidden.user.insertNotifications).not.toHaveBeenCalled()
  })
  it('a body userId cannot make a tenant act as someone else: the row goes to the validated recipient only', async () => {
    const ctx = mockCtx({ caller: tenant })
    await notify(ctx, { ...ok, senderId: LANDLORD_ID, actorId: LANDLORD_ID }, req())
    const rows = (ctx.user.insertNotifications as unknown as { mock: { calls: unknown[][] } }).mock.calls[0][0] as Record<string, unknown>[]
    expect(rows).toHaveLength(1)
    expect(Object.keys(rows[0]).sort()).toEqual(['body', 'link', 'title', 'type', 'user_id'])
  })
  it('a webhook secret header can never be satisfied by the publishable/secret key or an empty secret', async () => {
    const ctx = mockCtx({ caller: null })
    for (const h of ['sb_secret_test', 'sb_publishable_test', '', ' ']) {
      expect((await status(notify(ctx, { type: 'INSERT', table: 'notifications', record: {} }, req({ 'x-webhook-secret': h })))).status).toBe(401)
    }
  })
})

describe('delete-account denials', () => {
  it('no JWT 401, closed 403, landlord 403 (nothing changed), bad confirm 400', async () => {
    expect((await status(deleteAccount(mockCtx({ caller: null }), { confirm: 'DELETE', password: 'x' }))).status).toBe(401)
    expect((await status(deleteAccount(mockCtx({ caller: closedTenant }), { confirm: 'DELETE', password: 'x' }))).status).toBe(403)
    const l = mockCtx({ caller: landlord })
    expect((await status(deleteAccount(l, { confirm: 'DELETE', password: 'x' }))).status).toBe(403)
    expect(l.admin.updateUser).not.toHaveBeenCalled()
    const t = mockCtx({ caller: tenant })
    expect((await status(deleteAccount(t, { confirm: 'yes' }))).status).toBe(400)
    expect(t.admin.updateUser).not.toHaveBeenCalled()
  })
  it('the account closed is the JWT user, whatever userId/tenantId the body names', async () => {
    const sqlOk = async () => ({ data: { mode: 'closed', already_closed: false, landlord_id: null, unit_label: null, had_active_lease: false }, error: null })
    const ctx = mockCtx({ caller: tenant, admin: mockAdminDb({ rpc: vi.fn(sqlOk) as never }) })
    await deleteAccount(ctx, { confirm: 'DELETE', password: 'pw', userId: OTHER_TENANT_ID, tenantId: OTHER_TENANT_ID, id: LANDLORD_ID })
    const seen = (ctx.admin.updateUser as unknown as { mock: { calls: unknown[][] } }).mock.calls.map(c => c[0])
    expect(new Set(seen)).toEqual(new Set([TENANT_ID]))
    expect((ctx.admin.rpc as unknown as { mock: { calls: unknown[][] } }).mock.calls[0][1]).toEqual({ p_user: TENANT_ID })
  })
})

describe('phone-sign-in denials', () => {
  it('bad input is the same generic 401 as a wrong password (no format hints), and no lookup runs', async () => {
    const ctx = mockCtx({ caller: null })
    for (const body of [{}, { phone: 5, password: 'x' }, { phone: '0788', password: '' }]) {
      const e = await status(phoneSignIn(ctx, body, undefined, { padMs: () => 0 }))
      expect([e.status, e.message]).toEqual([401, GENERIC_ERROR])
    }
    expect(ctx.admin.rpc).not.toHaveBeenCalled()
  })
})

describe('error bodies leak nothing', () => {
  it('every error code serialises to { error, code } with no key, email or id', async () => {
    const samples: [string, string][] = [
      ['unauthorized', 'Please sign in again.'], ['forbidden', 'Not authorized'], ['not_found', 'Tenant not found.'],
      ['internal', 'The database refused the change. Please try again.'],
    ]
    for (const [code, msg] of samples) {
      const text = await errorResponse(code as never, msg).text()
      expect(Object.keys(JSON.parse(text)).sort()).toEqual(['code', 'error'])
      expect(text).not.toMatch(/sb_secret|sb_publishable|@|eyJ|[0-9a-f]{8}-[0-9a-f]{4}-/i)
    }
  })
})
