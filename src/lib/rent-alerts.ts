// Kept identical in apartment-manager and apartment-manager-tenant.
//
// Rent alert rules. The hourly job uses the SQL in migration 13
// (public.due_alerts / rent_limit_status); this is the same logic in
// TypeScript for the settings page preview, the badges and the unit tests.
import { addDays, differenceInCalendarDays, format, parseISO } from 'date-fns'
import type { LedgerRow } from '@/lib/supabase/database.types'
import { formatRWF } from '@/lib/currency'
import { formatPeriodMonth, TIME_ZONE } from '@/lib/rent-utils'

export type AlertLevel = 'before' | 'due_today' | 'overdue' | 'warning' | 'final_warning'
export type AlertChannel = 'in_app' | 'email' | 'sms'

export interface AlertSettings {
  enabled: boolean
  before_due_days: number[]
  on_due_day: boolean
  after_due_days: number[]
  warning_after_days: number
  final_warning_after_days: number
  notify_landlord_after_days: number
  send_hour: number
  channels: AlertChannel[]
  tpl_before: string
  tpl_due_today: string
  tpl_overdue: string
  tpl_warning: string
  tpl_final_warning: string
  tpl_over_limit: string
  lease_ending_days: number
  receipt_waiting_days: number
  repair_open_days: number
  grace_days: number
  max_unpaid_days: number
  notice_period_days: number
}

/** Same defaults as the alert_settings table. */
export const DEFAULT_ALERT_SETTINGS: AlertSettings = {
  enabled: true,
  before_due_days: [5, 1],
  on_due_day: true,
  after_due_days: [1, 5, 10],
  warning_after_days: 5,
  final_warning_after_days: 15,
  notify_landlord_after_days: 3,
  send_hour: 9,
  channels: ['in_app', 'email'],
  tpl_before: 'Hello {tenant_name}, a friendly reminder that your rent of {amount} for {month} ({unit}) is due on {due_date}. Thank you. {landlord_name}',
  tpl_due_today: 'Hello {tenant_name}, your rent of {amount} for {month} ({unit}) is due today, {due_date}. Thank you. {landlord_name}',
  tpl_overdue: 'Hello {tenant_name}, your rent for {month} ({unit}) was due on {due_date} and is now {days_late} day(s) late. {amount} is still to pay. Please pay when you can, or reply if you would like to talk. {landlord_name}',
  tpl_warning: 'Hello {tenant_name}, your rent for {month} ({unit}) is {days_late} days late and {amount} is still owed. Please pay as soon as possible. {landlord_name}',
  tpl_final_warning: 'Hello {tenant_name}, this is a final warning: your rent for {month} ({unit}) is {days_late} days late and {amount} is still owed. Please pay now or contact me today. {landlord_name}',
  tpl_over_limit: 'Hello {tenant_name}, your unpaid rent is now past the agreed limit. You owe {amount} in total. Please pay by {due_date}, or contact me to agree a payment plan. {landlord_name}',
  lease_ending_days: 30,
  receipt_waiting_days: 3,
  repair_open_days: 7,
  grace_days: 5,
  max_unpaid_days: 30,
  notice_period_days: 30,
}

export const PLACEHOLDERS = ['tenant_name', 'unit', 'amount', 'month', 'due_date', 'days_late', 'landlord_name'] as const
export type TemplateVars = Partial<Record<(typeof PLACEHOLDERS)[number], string | number>>

export const LEVELS: { level: AlertLevel | 'over_limit'; field: keyof AlertSettings; label: string; title: string }[] = [
  { level: 'before', field: 'tpl_before', label: 'Before the due date', title: 'Rent reminder' },
  { level: 'due_today', field: 'tpl_due_today', label: 'On the due day', title: 'Rent due today' },
  { level: 'overdue', field: 'tpl_overdue', label: 'Overdue', title: 'Rent overdue' },
  { level: 'warning', field: 'tpl_warning', label: 'Warning', title: 'Rent warning' },
  { level: 'final_warning', field: 'tpl_final_warning', label: 'Final warning', title: 'Final warning: rent overdue' },
  { level: 'over_limit', field: 'tpl_over_limit', label: 'Over the unpaid limit (final notice)', title: 'Final notice: unpaid rent' },
]

/** Fills {placeholders}; unknown ones are left as typed. Same as public.render_alert_template. */
export function renderTemplate(template: string, vars: TemplateVars): string {
  let out = template ?? ''
  for (const [key, value] of Object.entries(vars)) {
    out = out.split(`{${key}}`).join(value === undefined || value === null ? '' : String(value))
  }
  return out
}

export function fmtDay(iso: string): string {
  return format(parseISO(iso), 'd MMMM yyyy')
}

export interface AlertOverride {
  enabled: boolean
  before_due_days: number[] | null
  after_due_days: number[] | null
}

const warnAt = (s: AlertSettings) => Math.max(s.warning_after_days, s.grace_days)
const finalAt = (s: AlertSettings) => Math.max(s.final_warning_after_days, s.grace_days, s.warning_after_days)

/** Level for a month `offset` days from its due date (negative = before). */
export function alertLevel(offset: number, s: AlertSettings): AlertLevel {
  if (offset < 0) return 'before'
  if (offset === 0) return 'due_today'
  if (offset >= finalAt(s)) return 'final_warning'
  if (offset >= warnAt(s)) return 'warning'
  return 'overdue'
}

/** Whether an alert goes out `offset` days from the due date. */
export function sendsOn(offset: number, s: AlertSettings, o?: AlertOverride | null, leaseActive = true): boolean {
  const before = o?.before_due_days ?? s.before_due_days
  const after = o?.after_due_days ?? s.after_due_days
  if (offset < 0) return leaseActive && before.includes(-offset)
  if (offset === 0) return leaseActive && s.on_due_day
  return after.includes(offset) || offset === warnAt(s) || offset === finalAt(s)
}

export interface PlannedAlert {
  period_month: string
  offset: number
  level: AlertLevel
  /** What is still to pay for the month (a part payment is taken off). */
  amount: number
}

/**
 * Rent alerts for one lease on `today`. `rows` must reach at least a month
 * past today (computeLedger with range.to). A month is skipped once it is
 * paid or while a receipt for it waits for review.
 */
export function rentAlertsForDay(
  rows: LedgerRow[], today: string, s: AlertSettings,
  opts: { override?: AlertOverride | null; leaseActive?: boolean; onPlan?: boolean } = {},
): PlannedAlert[] {
  if (!s.enabled || opts.override?.enabled === false) return []
  const out: PlannedAlert[] = []
  for (const r of rows) {
    const remaining = r.expected - r.confirmed_paid
    if (remaining <= 0 || r.pending_paid > 0) continue
    const offset = differenceInCalendarDays(parseISO(today), parseISO(r.due_date))
    if (offset > 0 && opts.onPlan) continue
    if (!sendsOn(offset, s, opts.override, opts.leaseActive ?? true)) continue
    out.push({ period_month: r.period_month, offset, level: alertLevel(offset, s), amount: remaining })
  }
  return out
}

/** The message a tenant would get for an alert. */
export function alertMessage(
  a: PlannedAlert, s: AlertSettings, ctx: { tenantName: string; unit: string; landlordName: string; dueDate: string },
): string {
  const field = LEVELS.find(l => l.level === a.level)!.field
  return renderTemplate(String(s[field]), {
    tenant_name: ctx.tenantName, unit: ctx.unit, amount: formatRWF(a.amount),
    month: formatPeriodMonth(a.period_month), due_date: fmtDay(ctx.dueDate),
    days_late: Math.max(a.offset, 0), landlord_name: ctx.landlordName,
  })
}

/** The Kigali hour of `now`; the job only sends when it equals send_hour. */
export function kigaliHour(now: Date = new Date()): number {
  return Number(new Intl.DateTimeFormat('en-GB', { timeZone: TIME_ZONE, hour: '2-digit', hour12: false }).format(now)) % 24
}

export function shouldRunAt(now: Date, s: AlertSettings): boolean {
  return kigaliHour(now) === s.send_hour
}

/** sent_alerts key for a rent alert: lease + month + offset + channel. */
export function rentAlertKey(leaseId: string, month: string, offset: number, channel: AlertChannel): string {
  return `rent:${leaseId}:${month}:${offset}:${channel}`
}

// ── Unpaid-rent limit ───────────────────────────────────────────────────────

export type MonthLimitState = 'paid' | 'pending' | 'not_due' | 'due' | 'late' | 'over_limit'
export type LeaseLimitState = 'ok' | 'due' | 'late' | 'over_limit' | 'plan' | 'more_time'

/** "Due" for the grace days after the due date, then "Late", then "Over limit". */
export function monthLimitState(row: LedgerRow, today: string, s: Pick<AlertSettings, 'grace_days' | 'max_unpaid_days'>): MonthLimitState {
  const unpaid = Math.max(row.balance - row.pending_paid, 0)
  if (row.status === 'paid') return 'paid'
  const days = differenceInCalendarDays(parseISO(today), parseISO(row.due_date))
  if (days < 0) return row.status === 'pending' ? 'pending' : 'not_due'
  if (unpaid === 0) return 'pending'
  if (days <= s.grace_days) return 'due'
  if (days <= s.max_unpaid_days) return 'late'
  return 'over_limit'
}

/** Lease-level state from its oldest unpaid month. Same as public.rent_limit_status. */
export function leaseLimitState(
  rows: LedgerRow[], today: string, s: Pick<AlertSettings, 'grace_days' | 'max_unpaid_days'>,
  opts: { planKept?: boolean; moreTimeUntil?: string | null } = {},
): { state: LeaseLimitState; daysLate: number; owed: number; oldestMonth: string | null } {
  const unpaid = rows.filter(r => r.balance - r.pending_paid > 0)
  const owed = unpaid.reduce((sum, r) => sum + r.balance - r.pending_paid, 0)
  if (!unpaid.length) return { state: 'ok', daysLate: 0, owed: 0, oldestMonth: null }
  const oldest = unpaid.reduce((a, b) => (a.due_date <= b.due_date ? a : b))
  const days = differenceInCalendarDays(parseISO(today), parseISO(oldest.due_date))
  let state: LeaseLimitState
  if (days < 0) state = 'ok'
  else if (days <= s.grace_days) state = 'due'
  else if (days <= s.max_unpaid_days) state = 'late'
  else if (opts.moreTimeUntil && opts.moreTimeUntil >= today) state = 'more_time'
  else if (opts.planKept) state = 'plan'
  else state = 'over_limit'
  return { state, daysLate: Math.max(days, 0), owed, oldestMonth: oldest.period_month }
}

export interface PaymentPlan {
  /** Kigali date the plan was agreed. */
  start: string
  end: string
  amountPerMonth: number
}

/**
 * Installments fall due monthly from one month after the plan starts. Only
 * payments made since the start, for months before the start month, count.
 * Same as public.rent_plan_state.
 */
export function planStatus(
  plan: PaymentPlan,
  payments: { period_month: string; amount: number; status: string; submitted_on: string }[],
  today: string,
): { active: boolean; kept: boolean; required: number; paid: number; missedOn: string | null } {
  const active = today >= plan.start && today <= plan.end
  const installments: string[] = []
  for (let k = 1; ; k++) {
    const d = format(addMonthsIso(plan.start, k), 'yyyy-MM-dd')
    if (d > plan.end) break
    installments.push(d)
  }
  const due = installments.filter(d => d < today)
  const required = due.length * plan.amountPerMonth
  const startMonth = plan.start.slice(0, 7)
  const paid = payments
    .filter(p => (p.status === 'confirmed' || p.status === 'pending_review') && p.period_month < startMonth && p.submitted_on >= plan.start)
    .reduce((sum, p) => sum + p.amount, 0)
  const kept = paid >= required
  return { active, kept, required, paid, missedOn: !kept && due.length ? due[due.length - 1] : null }
}

function addMonthsIso(iso: string, n: number): Date {
  const d = parseISO(iso)
  const target = new Date(d.getFullYear(), d.getMonth() + n, 1)
  const last = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate()
  return new Date(target.getFullYear(), target.getMonth(), Math.min(d.getDate(), last))
}

/** Move-out date on a notice to vacate issued today. */
export function vacateMoveOutDate(today: string, s: Pick<AlertSettings, 'notice_period_days'>): string {
  return format(addDays(parseISO(today), s.notice_period_days), 'yyyy-MM-dd')
}

export const LIMIT_LABELS: Record<LeaseLimitState | MonthLimitState, string> = {
  ok: 'Up to date', paid: 'Paid', pending: 'In review', not_due: 'Not due',
  due: 'Due', late: 'Late', over_limit: 'Over limit', plan: 'Payment plan', more_time: 'More time given',
}
