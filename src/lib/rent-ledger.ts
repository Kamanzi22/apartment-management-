// Kept identical in apartment-manager and apartment-manager-tenant.
//
// The rent ledger lives in the database (public.rent_ledger / tenant_balance,
// migration 09) so both apps show the same numbers. This file holds the types,
// the RPC helpers, and computeLedger(): a line-by-line TypeScript copy of the
// SQL used only for demo mode and the unit tests.
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, LedgerRow, LedgerStatus } from '@/lib/supabase/database.types'
import { addMonths, getDueDate, kigaliDateString, monthsBetween } from '@/lib/rent-utils'

export type { LedgerRow, LedgerStatus }
export type LeaseLedgerRow = LedgerRow & { lease_id: string }

type Client = SupabaseClient<Database>

// ── RPC helpers ────────────────────────────────────────────────────────────

function toRow<T extends LedgerRow>(r: T): T {
  return {
    ...r,
    expected: Number(r.expected),
    confirmed_paid: Number(r.confirmed_paid),
    pending_paid: Number(r.pending_paid),
    balance: Number(r.balance),
  }
}

/** Ledger rows for one lease, move-in month to min(lease end, this month). */
export async function fetchLedger(supabase: Client, leaseId: string): Promise<LedgerRow[]> {
  const { data, error } = await supabase.rpc('rent_ledger', { p_lease: leaseId })
  if (error) throw new Error(`rent_ledger: ${error.message}`)
  return (data ?? []).map(toRow)
}

/** Ledger rows for several leases, grouped by lease id. */
export async function fetchLedgers(supabase: Client, leaseIds: string[]): Promise<Map<string, LedgerRow[]>> {
  const map = new Map<string, LedgerRow[]>()
  const ids = [...new Set(leaseIds)]
  if (!ids.length) return map
  const { data, error } = await supabase.rpc('rent_ledger_many', { p_leases: ids })
  if (error) throw new Error(`rent_ledger_many: ${error.message}`)
  for (const r of data ?? []) {
    const row = toRow(r)
    if (!map.has(row.lease_id)) map.set(row.lease_id, [])
    map.get(row.lease_id)!.push(row)
  }
  for (const id of ids) if (!map.has(id)) map.set(id, [])
  return map
}

/** The next `months` months after this one (for paying ahead). */
export async function fetchUpcoming(supabase: Client, leaseId: string, months = 6): Promise<LedgerRow[]> {
  const { data, error } = await supabase.rpc('rent_upcoming', { p_lease: leaseId, p_months: months })
  if (error) throw new Error(`rent_upcoming: ${error.message}`)
  return (data ?? []).map(toRow)
}

export async function fetchTenantBalance(supabase: Client, tenantId: string): Promise<number> {
  const { data, error } = await supabase.rpc('tenant_balance', { p_tenant: tenantId })
  if (error) throw new Error(`tenant_balance: ${error.message}`)
  return Number(data ?? 0)
}

// ── Summaries ──────────────────────────────────────────────────────────────

/** What is still unpaid for a month once receipts under review are counted. */
export function owedAfterPending(row: LedgerRow): number {
  return Math.max(row.balance - row.pending_paid, 0)
}

export interface LedgerSummary {
  /** Sum of balances (confirmed payments only) for months already due. */
  arrears: number
  /** Arrears not yet covered by a receipt under review. */
  unpaid: number
  /** Amount in receipts waiting for the landlord. */
  underReview: number
  /** Months already due that still have a balance, oldest first. */
  owedMonths: LedgerRow[]
  /** One word for a badge. */
  status: 'paid' | 'pending' | 'overdue' | 'partial' | 'not_due' | 'none'
}

export function summarizeLedger(rows: LedgerRow[]): LedgerSummary {
  const owedMonths = rows.filter(r => r.balance > 0)
  const arrears = owedMonths.reduce((s, r) => s + r.balance, 0)
  const unpaid = owedMonths.reduce((s, r) => s + owedAfterPending(r), 0)
  const underReview = rows.reduce((s, r) => s + r.pending_paid, 0)
  let status: LedgerSummary['status']
  if (!rows.length) status = 'none'
  else if (owedMonths.some(r => r.status === 'overdue')) status = 'overdue'
  else if (owedMonths.some(r => r.status === 'partial')) status = 'partial'
  else if (owedMonths.length || rows.some(r => r.status === 'pending')) status = 'pending'
  else if (rows.every(r => r.status === 'paid')) status = 'paid'
  else status = 'not_due'
  return { arrears, unpaid, underReview, owedMonths, status }
}

export function ledgerRow(rows: LedgerRow[], month: string): LedgerRow | undefined {
  return rows.find(r => r.period_month === month)
}

// ── Leases in a month (turnover) ───────────────────────────────────────────

export interface LeaseSpan {
  id: string
  move_in_date: string
  lease_end: string | null
}

/** Every lease that covered at least one day of `month`, earliest move-in first. */
export function leasesForMonth<T extends LeaseSpan>(leases: T[], month: string): T[] {
  return leases
    .filter(l => l.move_in_date.slice(0, 7) <= month && (!l.lease_end || l.lease_end.slice(0, 7) >= month))
    .sort((a, b) => a.move_in_date.localeCompare(b.move_in_date))
}

// ── TypeScript copy of public.rent_ledger_range (demo mode + tests) ────────

export interface LedgerLease {
  move_in_date: string
  lease_end: string | null
  rent_due_day: number
  monthly_rent: number
}
export interface LedgerPayment {
  period_month: string
  amount: number
  status: string
}
export interface ScheduleEntry {
  effective_month: string
  monthly_rent: number
}

export function computeLedger(
  lease: LedgerLease,
  payments: LedgerPayment[],
  schedule: ScheduleEntry[] = [],
  today: string = kigaliDateString(),
  range: { from?: string; to?: string } = {},
): LedgerRow[] {
  const todayMonth = today.slice(0, 7)
  const from = [lease.move_in_date.slice(0, 7), range.from ?? '0001-01'].sort().at(-1)!
  const toCandidates = [range.to ?? todayMonth]
  if (lease.lease_end) toCandidates.push(lease.lease_end.slice(0, 7))
  const to = toCandidates.sort()[0]
  const sorted = [...schedule].sort((a, b) => a.effective_month.localeCompare(b.effective_month))

  return monthsBetween(from, to).map(month => {
    const due = getDueDate(lease.rent_due_day, month, lease.lease_end)
    const dueIso = `${due.getFullYear()}-${String(due.getMonth() + 1).padStart(2, '0')}-${String(due.getDate()).padStart(2, '0')}`
    const inForce = sorted.filter(s => s.effective_month <= month).at(-1) ?? sorted[0]
    const expected = Number(inForce?.monthly_rent ?? lease.monthly_rent)
    const sum = (status: string) => payments
      .filter(p => p.period_month === month && p.status === status)
      .reduce((s, p) => s + Number(p.amount), 0)
    const cp = sum('confirmed')
    const pp = sum('pending_review')
    const reached = today >= dueIso
    const status: LedgerStatus =
      cp >= expected ? 'paid'
        : pp > 0 && cp + pp >= expected ? 'pending'
        : !reached ? 'not_due'
        : cp + pp > 0 ? 'partial'
        : 'overdue'
    return {
      period_month: month,
      due_date: dueIso,
      expected,
      confirmed_paid: cp,
      pending_paid: pp,
      balance: reached ? Math.max(expected - cp, 0) : 0,
      status,
    }
  })
}

/** TypeScript copy of public.rent_upcoming. */
export function computeUpcoming(
  lease: LedgerLease, payments: LedgerPayment[], schedule: ScheduleEntry[] = [],
  today: string = kigaliDateString(), months = 6,
): LedgerRow[] {
  if (months <= 0) return []
  const thisMonth = today.slice(0, 7)
  return computeLedger(lease, payments, schedule, today, { from: addMonths(thisMonth, 1), to: addMonths(thisMonth, months) })
}
