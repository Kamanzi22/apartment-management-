// Kept identical in apartment-manager and apartment-manager-tenant.
// Same tenants and dates as supabase/tests/three_year_sim.py, against the
// TypeScript copy of public.rent_ledger.
import { describe, expect, it } from 'vitest'
import { format, addDays, parseISO } from 'date-fns'
import {
  computeLedger, computeUpcoming, leasesForMonth, owedAfterPending, summarizeLedger,
  type LedgerPayment, type LedgerRow,
} from './rent-ledger'
import { getDueDate, monthsBetween } from './rent-utils'

const total = (rows: LedgerRow[]) => rows.reduce((s, r) => s + r.balance, 0)
const row = (rows: LedgerRow[], month: string) => rows.find(r => r.period_month === month)!

/** Payments as the ledger sees them on `day`: confirmed once the confirm date has passed. */
function asOf(day: string, list: { month: string; amount: number; submitted: string; confirmed?: string; rejected?: string }[]): LedgerPayment[] {
  return list.filter(p => p.submitted <= day).map(p => ({
    period_month: p.month,
    amount: p.amount,
    status: p.rejected && p.rejected <= day ? 'rejected' : p.confirmed && p.confirmed <= day ? 'confirmed' : 'pending_review',
  }))
}

describe('Alice: always pays on time, raised to 380,000 from Nov 2027', () => {
  const lease = { move_in_date: '2026-11-05', lease_end: null, rent_due_day: 5, monthly_rent: 380000 }
  const schedule = [{ effective_month: '2026-11', monthly_rent: 350000 }, { effective_month: '2027-11', monthly_rent: 380000 }]
  const payments = monthsBetween('2026-11', '2029-11').map(m => ({
    month: m, amount: m >= '2027-11' ? 380000 : 350000, submitted: `${m}-03`, confirmed: `${m}-04`,
  }))

  it('has a balance of 0 on every day from Nov 2026 to Nov 2029', () => {
    for (let d = parseISO('2026-11-01'); d <= parseISO('2029-11-30'); d = addDays(d, 1)) {
      const day = format(d, 'yyyy-MM-dd')
      expect(total(computeLedger(lease, asOf(day, payments), schedule, day)), day).toBe(0)
    }
  })

  it('keeps 350,000 for months before the raise (no re-pricing of the past)', () => {
    const rows = computeLedger(lease, asOf('2028-01-31', payments), schedule, '2028-01-31')
    expect(row(rows, '2027-10').expected).toBe(350000)
    expect(row(rows, '2027-11').expected).toBe(380000)
    // The old code priced every month at the new rent and showed 360,000 owed.
    expect(total(rows)).toBe(0)
  })
})

describe('Bob: due on the 31st, part-pays June 2027, skips Feb 2028, leaves 15 Mar 2028', () => {
  const lease = { move_in_date: '2027-01-31', lease_end: '2028-03-15', rent_due_day: 31, monthly_rent: 300000 }
  const schedule = [{ effective_month: '2027-01', monthly_rent: 300000 }]
  // Pays two days after each due date, confirmed the next day.
  const payments = monthsBetween('2027-01', '2028-01').map(m => {
    const due = getDueDate(31, m)
    return {
      month: m, amount: m === '2027-06' ? 200000 : 300000,
      submitted: format(addDays(due, 2), 'yyyy-MM-dd'), confirmed: format(addDays(due, 3), 'yyyy-MM-dd'),
    }
  })

  it('is overdue on 28 Feb 2027 and 30 Apr 2027 (the due date in a short month)', () => {
    expect(row(computeLedger(lease, asOf('2027-02-28', payments), schedule, '2027-02-28'), '2027-02').status).toBe('overdue')
    expect(row(computeLedger(lease, asOf('2027-02-27', payments), schedule, '2027-02-27'), '2027-02').status).toBe('not_due')
    expect(row(computeLedger(lease, asOf('2027-04-30', payments), schedule, '2027-04-30'), '2027-04').status).toBe('overdue')
  })

  it('owes 100,000 for June 2027 until topped up', () => {
    for (const day of ['2027-07-03', '2027-12-01', '2028-03-01']) {
      const jun = row(computeLedger(lease, asOf(day, payments), schedule, day), '2027-06')
      expect(jun.balance).toBe(100000)
      expect(jun.status).toBe('partial')
    }
    const topped = [...payments, { month: '2027-06', amount: 100000, submitted: '2029-06-10', confirmed: '2029-06-11' }]
    expect(row(computeLedger(lease, asOf('2029-06-11', topped), schedule, '2029-06-11'), '2027-06').status).toBe('paid')
  })

  it('owes 700,000 after moving out (June balance + Feb + Mar)', () => {
    const rows = computeLedger(lease, asOf('2028-03-15', payments), schedule, '2028-03-15')
    expect(total(rows)).toBe(700000)
    expect(row(rows, '2028-03').due_date).toBe('2028-03-15')
    expect(row(rows, '2028-02').due_date).toBe('2028-02-29')
    // Still 700,000 a year later; the ledger stops at the lease end.
    const later = computeLedger(lease, asOf('2029-02-01', payments), schedule, '2029-02-01')
    expect(total(later)).toBe(700000)
    expect(later.at(-1)!.period_month).toBe('2028-03')
  })
})

describe('Chidi: March 2027 rejected then confirmed, never pays December 2027', () => {
  const lease = { move_in_date: '2026-12-10', lease_end: null, rent_due_day: 10, monthly_rent: 400000 }
  const payments = [
    ...monthsBetween('2026-12', '2028-01').filter(m => m !== '2027-12' && m !== '2027-03')
      .map(m => ({ month: m, amount: 400000, submitted: `${m}-08`, confirmed: `${m}-09` })),
    { month: '2027-03', amount: 400000, submitted: '2027-03-08', rejected: '2027-03-09' },
    { month: '2027-03', amount: 400000, submitted: '2027-03-10', confirmed: '2027-03-11' },
  ]

  it('shows 400,000 overdue for December 2027 on 15 Jan 2028, not "all paid"', () => {
    const rows = computeLedger(lease, asOf('2028-01-15', payments), [], '2028-01-15')
    expect(row(rows, '2027-12')).toMatchObject({ status: 'overdue', balance: 400000 })
    expect(row(rows, '2027-03').status).toBe('paid')
    const summary = summarizeLedger(rows)
    expect(summary.status).toBe('overdue')
    expect(summary.arrears).toBe(400000)
  })

  it('treats a rejected receipt as unpaid', () => {
    const rows = computeLedger(lease, asOf('2027-03-09', payments), [], '2027-03-09')
    expect(row(rows, '2027-03')).toMatchObject({ status: 'not_due', confirmed_paid: 0, pending_paid: 0 })
    const after = computeLedger(lease, asOf('2027-03-10', payments), [], '2027-03-10')
    expect(row(after, '2027-03').status).toBe('pending')
  })
})

describe('turnover month: Bob leaves 15 Mar 2028, Diane arrives 20 Mar 2028', () => {
  const leases = [
    { id: 'diane', move_in_date: '2028-03-20', lease_end: null },
    { id: 'bob', move_in_date: '2027-01-31', lease_end: '2028-03-15' },
  ]
  it('shows both tenants in March 2028', () => {
    expect(leasesForMonth(leases, '2028-03').map(l => l.id)).toEqual(['bob', 'diane'])
    expect(leasesForMonth(leases, '2028-02').map(l => l.id)).toEqual(['bob'])
    expect(leasesForMonth(leases, '2028-04').map(l => l.id)).toEqual(['diane'])
  })

  it('bills each of them for March in full, with their own due date', () => {
    const diane = computeLedger({ move_in_date: '2028-03-20', lease_end: null, rent_due_day: 20, monthly_rent: 320000 }, [], [], '2028-03-25')
    expect(diane).toHaveLength(1)
    expect(diane[0]).toMatchObject({ period_month: '2028-03', due_date: '2028-03-20', expected: 320000, balance: 320000 })
  })
})

describe('pay ahead and receipts in review', () => {
  const lease = { move_in_date: '2028-03-20', lease_end: null, rent_due_day: 20, monthly_rent: 320000 }
  it('lists the next 6 months and marks prepaid ones paid', () => {
    const prepaid = ['2029-02', '2029-03', '2029-04', '2029-05', '2029-06', '2029-07']
      .map(m => ({ period_month: m, amount: 320000, status: 'confirmed' }))
    const upcoming = computeUpcoming(lease, prepaid, [], '2029-01-18')
    expect(upcoming.map(r => r.period_month)).toEqual(['2029-02', '2029-03', '2029-04', '2029-05', '2029-06', '2029-07'])
    expect(upcoming.every(r => r.status === 'paid' && r.balance === 0)).toBe(true)
  })

  it('does not count a receipt under review as owed, but keeps it in the balance', () => {
    const rows = computeLedger(lease, [{ period_month: '2028-03', amount: 320000, status: 'pending_review' }], [], '2028-03-21')
    expect(rows[0].status).toBe('pending')
    expect(rows[0].balance).toBe(320000)
    expect(owedAfterPending(rows[0])).toBe(0)
  })

  it('stops upcoming months at the lease end', () => {
    const ending = { ...lease, lease_end: '2029-03-31' }
    expect(computeUpcoming(ending, [], [], '2029-01-18').map(r => r.period_month)).toEqual(['2029-02', '2029-03'])
  })
})
