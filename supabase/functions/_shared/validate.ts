// Input validation for every Edge Function, hand-rolled (no dependency).
// Each parser takes the raw JSON body and returns a typed value or the first
// problem as a message the phone can show as is.

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string }

const ok = <T>(value: T): Parsed<T> => ({ ok: true, value })
const fail = <T = never>(error: string): Parsed<T> => ({ ok: false, error })

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/
export const EXPO_TOKEN_RE = /^(ExponentPushToken|ExpoPushToken)\[[A-Za-z0-9_-]{10,200}\]$/
/** Same rule as the web: whole RWF, at most one billion. */
export const MAX_RWF = 1_000_000_000

export function isUuid(v: unknown): v is string {
  return typeof v === 'string' && UUID_RE.test(v)
}

/** A real calendar date in YYYY-MM-DD (2026-02-30 is refused). */
export function isIsoDate(v: unknown): v is string {
  if (typeof v !== 'string') return false
  const m = DATE_RE.exec(v)
  if (!m) return false
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const dt = new Date(Date.UTC(y, mo - 1, d))
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d
}

export function isRwf(v: unknown, { allowZero = false } = {}): v is number {
  return typeof v === 'number' && Number.isSafeInteger(v) && v <= MAX_RWF && (allowZero ? v >= 0 : v > 0)
}

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : ''
}

function optStr(v: unknown): string | null {
  const s = str(v)
  return s ? s : null
}

export function normaliseEmail(v: unknown): string {
  return str(v).toLowerCase()
}

export function isEmail(v: string): boolean {
  return v.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)
}

/** In-app links are app paths only ("/landlord/rent"), never another site. */
export function isAppPath(v: unknown): v is string {
  return typeof v === 'string' && v.length <= 200 && /^\/(?!\/)[A-Za-z0-9/_\-?=&.%]*$/.test(v)
}

// ── add-tenant / replace-tenancy ─────────────────────────────

export interface TenantDetails {
  email: string
  fullName: string
  phone: string | null
  unitId: string
  moveInDate: string
  monthlyRent: number
  depositAmount: number
  leaseEnd: string | null
}

/** Same rules as validateAttach() in the landlord web app, plus type checks. */
export function parseTenantDetails(b: Record<string, unknown>): Parsed<TenantDetails> {
  const email = normaliseEmail(b.email)
  const fullName = str(b.fullName)
  const phone = optStr(b.phone)
  const leaseEnd = b.leaseEnd == null || b.leaseEnd === '' ? null : b.leaseEnd
  const deposit = b.depositAmount == null ? 0 : b.depositAmount
  if (!isEmail(email)) return fail('A valid email is required.')
  if (!fullName) return fail('Full name is required.')
  if (fullName.length > 120) return fail('Full name is too long.')
  if (phone && (phone.length > 30 || !/^[0-9+\-() .]+$/.test(phone))) return fail('Phone number has invalid characters.')
  if (!isUuid(b.unitId)) return fail('Choose a unit.')
  if (!isIsoDate(b.moveInDate)) return fail('Move-in date is required.')
  if (!isRwf(b.monthlyRent)) return fail('Monthly rent must be a whole number of RWF more than zero.')
  if (!isRwf(deposit, { allowZero: true })) return fail('Deposit must be a whole number of RWF.')
  if (leaseEnd !== null && !isIsoDate(leaseEnd)) return fail('Lease end must be a date.')
  if (leaseEnd !== null && (leaseEnd as string) < (b.moveInDate as string)) return fail('Lease end cannot be before move-in.')
  return ok({
    email, fullName, phone, unitId: b.unitId, moveInDate: b.moveInDate,
    monthlyRent: b.monthlyRent, depositAmount: deposit as number, leaseEnd: leaseEnd as string | null,
  })
}

export type AddTenantInput = TenantDetails
export const parseAddTenant = parseTenantDetails

export interface EndTenancyInput { leaseId: string; moveOutDate: string }

export function parseEndTenancy(b: Record<string, unknown>): Parsed<EndTenancyInput> {
  if (!isUuid(b.leaseId)) return fail('Lease id is missing.')
  if (!isIsoDate(b.moveOutDate)) return fail('Choose the move-out date.')
  return ok({ leaseId: b.leaseId, moveOutDate: b.moveOutDate })
}

export interface ReplaceTenancyInput {
  outgoing: { tenantId: string; leaseId: string; unitId: string; moveOutDate: string }
  incoming: TenantDetails
}

export function parseReplaceTenancy(b: Record<string, unknown>): Parsed<ReplaceTenancyInput> {
  const out = (b.outgoing && typeof b.outgoing === 'object' ? b.outgoing : {}) as Record<string, unknown>
  const inc = (b.incoming && typeof b.incoming === 'object' ? b.incoming : {}) as Record<string, unknown>
  if (!isUuid(out.tenantId) || !isUuid(out.leaseId) || !isUuid(out.unitId)) return fail('The outgoing tenancy is missing.')
  if (!isIsoDate(out.moveOutDate)) return fail('Choose the move-out date.')
  const incoming = parseTenantDetails(inc)
  if (!incoming.ok) return incoming
  if (incoming.value.unitId !== out.unitId) return fail('The new tenant must move into the same unit.')
  return ok({
    outgoing: { tenantId: out.tenantId, leaseId: out.leaseId, unitId: out.unitId, moveOutDate: out.moveOutDate },
    incoming: incoming.value,
  })
}

// ── payments ─────────────────────────────────────────────────

export interface ReviewPaymentInput { paymentId: string; note: string | null }

export function parseReviewPayment(b: Record<string, unknown>, { noteRequired = false } = {}): Parsed<ReviewPaymentInput> {
  if (!isUuid(b.paymentId)) return fail('Payment id is missing.')
  if (b.note != null && typeof b.note !== 'string') return fail('Note must be text.')
  const note = optStr(b.note)
  if (note && note.length > 500) return fail('Note is too long (500 characters at most).')
  if (noteRequired && !note) return fail('Tell the tenant why the receipt was rejected.')
  return ok({ paymentId: b.paymentId, note })
}

// ── reset-tenant-password ────────────────────────────────────

export type ResetTenantPasswordInput =
  | { tenantId: string; mode: 'email' }
  | { tenantId: string; mode: 'set'; newPassword: string }

export function parseResetTenantPassword(b: Record<string, unknown>): Parsed<ResetTenantPasswordInput> {
  if (!isUuid(b.tenantId)) return fail('Tenant id is missing.')
  const mode = b.mode ?? 'email'
  if (mode === 'email') return ok({ tenantId: b.tenantId, mode: 'email' })
  if (mode !== 'set') return fail("mode must be 'email' or 'set'.")
  if (typeof b.newPassword !== 'string' || b.newPassword.length < 8) return fail('Password must be at least 8 characters.')
  if (b.newPassword.length > 72) return fail('Password is too long (72 characters at most).')
  return ok({ tenantId: b.tenantId, mode: 'set', newPassword: b.newPassword })
}

// ── broadcast ────────────────────────────────────────────────

export interface BroadcastInput { body: string }

export function parseBroadcast(b: Record<string, unknown>): Parsed<BroadcastInput> {
  const body = str(b.body)
  if (!body) return fail('Message cannot be empty')
  if (body.length > 4000) return fail('Message is too long (4000 characters at most).')
  return ok({ body })
}

// ── notify ───────────────────────────────────────────────────

export interface NotifyInput { userId: string; type: string; title: string; body: string; link: string | null }

export function parseNotify(b: Record<string, unknown>): Parsed<NotifyInput> {
  if (!isUuid(b.userId)) return fail('Recipient is missing.')
  const type = str(b.type)
  if (!/^[a-z][a-z_]{1,39}$/.test(type)) return fail('Unknown notification type.')
  const title = str(b.title), body = str(b.body)
  if (!title || title.length > 120) return fail('Title must be 1 to 120 characters.')
  if (!body || body.length > 1000) return fail('Body must be 1 to 1000 characters.')
  const link = b.link == null || b.link === '' ? null : b.link
  if (link !== null && !isAppPath(link)) return fail('Link must be a path in the app, like /rent.')
  return ok({ userId: b.userId, type, title, body, link: link as string | null })
}

// ── phone-sign-in ────────────────────────────────────────────

export interface PhoneSignInInput { phone: string; password: string }

export function parsePhoneSignIn(b: Record<string, unknown>): Parsed<PhoneSignInInput> {
  const phone = str(b.phone)
  if (!phone || phone.length > 40 || typeof b.password !== 'string' || !b.password || b.password.length > 200) {
    // One generic message: nothing here may hint at what was wrong.
    return fail('Invalid credentials. Check your email/phone and password.')
  }
  return ok({ phone, password: b.password })
}

// ── delete-account ───────────────────────────────────────────

export interface DeleteAccountInput { password: string | null; confirm: 'DELETE' }

export function parseDeleteAccount(b: Record<string, unknown>): Parsed<DeleteAccountInput> {
  if (b.confirm !== 'DELETE') return fail("Type DELETE to confirm.")
  if (b.password != null && (typeof b.password !== 'string' || b.password.length > 200)) return fail('Password must be text.')
  return ok({ password: typeof b.password === 'string' && b.password ? b.password : null, confirm: 'DELETE' })
}

// ── register-expo-push-token (RPC, validated here for the phone's wrapper too)

export function parseExpoToken(b: Record<string, unknown>): Parsed<{ token: string; platform: 'ios' | 'android' }> {
  if (typeof b.token !== 'string' || !EXPO_TOKEN_RE.test(b.token)) return fail('Invalid Expo push token')
  if (b.platform !== 'ios' && b.platform !== 'android') return fail('Platform must be ios or android')
  return ok({ token: b.token, platform: b.platform })
}
