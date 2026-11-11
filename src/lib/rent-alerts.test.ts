// Kept identical in apartment-manager and apartment-manager-tenant.
// The same scenarios as supabase/tests/three_year_sim.py, against the
// TypeScript copy of the alert rules in migration 13.
import { describe, expect, it } from 'vitest'
import { addDays, format, parseISO } from 'date-fns'
import { computeLedger, type LedgerPayment } from './rent-ledger'
import { addMonths, getDueDate, monthsBetween } from './rent-utils'
import {
  DEFAULT_ALERT_SETTINGS as D, alertLevel, alertMessage, leaseLimitState, monthLimitState, planStatus,
  renderTemplate, rentAlertKey, rentAlertsForDay, sendsOn, shouldRunAt, vacateMoveOutDate, type AlertSettings,
} from './rent-alerts'
import { isOpenStatus, nextStatuses, validateStatusChange } from './maintenance'

type P = { month: string; amount: number; submitted: string; confirmed?: string; rejected?: string }
function asOf(day: string, list: P[]): LedgerPayment[] {
  return list.filter(p => p.submitted <= day).map(p => ({
    period_month: p.month, amount: p.amount,
    status: p.rejected && p.rejected <= day ? 'rejected' : p.confirmed && p.confirmed <= day ? 'confirmed' : 'pending_review',
  }))
}
const iso = (d: Date) => format(d, 'yyyy-MM-dd')
/** Run the job once a day from `from` to `to`; returns every alert with its date. */
function simulate(lease: Parameters<typeof computeLedger>[0], payments: P[], from: string, to: string,
  settings: (day: string) => AlertSettings = () => D, extra: (day: string) => Parameters<typeof rentAlertsForDay>[3] = () => ({})) {
  const out: { day: string; month: string; offset: number; level: string; amount: number }[] = []
  for (let d = parseISO(from); d <= parseISO(to); d = addDays(d, 1)) {
    const day = iso(d)
    const rows = computeLedger(lease, asOf(day, payments), [], day, { to: format(addDays(d, 31), 'yyyy-MM') })
    for (const a of rentAlertsForDay(rows, day, settings(day), extra(day))) {
      out.push({ day, month: a.period_month, offset: a.offset, level: a.level, amount: a.amount })
    }
  }
  return out
}

describe('Alice: due on the 5th, always pays on the 4th', () => {
  const lease = { move_in_date: '2026-11-05', lease_end: null, rent_due_day: 5, monthly_rent: 350000 }
  const payments = monthsBetween('2026-11', '2028-12').map(m => ({ month: m, amount: 350000, submitted: `${m}-04`, confirmed: `${m}-05` }))
  const alerts = simulate(lease, payments, '2026-11-01', '2028-11-30')

  it('gets only the 5-day reminder each month, never the 1-day one or a warning', () => {
    expect(alerts.every(a => a.level === 'before' && a.offset === -5)).toBe(true)
    expect(new Set(alerts.map(a => a.month)).size).toBe(alerts.length)
    expect(alerts.length).toBe(25) // Dec 2026 .. Dec 2028 (Nov 2026's reminder was before the lease)
  })

  it('switches to the new days from the next run when before_due_days changes to {7, 2}', () => {
    const changed = simulate(lease, payments, '2027-06-01', '2027-08-31',
      day => (day >= '2027-07-01' ? { ...D, before_due_days: [7, 2] } : D))
    expect(changed.filter(a => a.day < '2027-07-01').map(a => a.offset)).toEqual([-5])
    expect(new Set(changed.filter(a => a.day >= '2027-07-01').map(a => a.offset))).toEqual(new Set([-7, -2]))
  })

  it('a paused tenant gets nothing', () => {
    expect(simulate(lease, [], '2027-01-01', '2027-03-31', () => D, () => ({ override: { enabled: false, before_due_days: null, after_due_days: null } }))).toEqual([])
  })
})

describe('Bob: never pays Feb 2028 (due 29 Feb, the last day of the month)', () => {
  const lease = { move_in_date: '2027-01-31', lease_end: null, rent_due_day: 31, monthly_rent: 300000 }
  const payments = monthsBetween('2027-01', '2028-01').map(m => {
    const due = getDueDate(31, m)
    return { month: m, amount: m === '2027-06' ? 200000 : 300000, submitted: iso(addDays(due, 2)), confirmed: iso(addDays(due, 3)) }
  })
  const feb = simulate(lease, payments, '2028-02-01', '2028-04-30').filter(a => a.month === '2028-02' && a.offset > 0)

  it('gets overdue at 1 day, warnings at 5 and 10, and the final warning at 15', () => {
    expect(feb.map(a => [a.day, a.offset, a.level])).toEqual([
      ['2028-03-01', 1, 'overdue'], ['2028-03-05', 5, 'warning'], ['2028-03-10', 10, 'warning'], ['2028-03-15', 15, 'final_warning'],
    ])
  })

  it('asks for the 100,000 still owed on the partly paid June 2027', () => {
    const jun = simulate(lease, payments, '2027-07-01', '2027-07-20').filter(a => a.month === '2027-06')
    expect(jun.find(a => a.offset === 1)!.amount).toBe(300000) // before his part payment
    expect(jun.filter(a => a.offset >= 5).map(a => a.amount)).toEqual([100000, 100000, 100000])
    const five = jun.find(a => a.offset === 5)!
    const msg = alertMessage({ period_month: five.month, offset: five.offset, level: 'warning', amount: five.amount }, D,
      { tenantName: 'Bob', unit: 'Unit 2', landlordName: 'Grace', dueDate: '2027-06-30' })
    expect(msg).toContain('100,000 RWF')
    expect(msg).toContain('5 days late')
  })

  it('shows Feb 2028 as Due until 5 Mar, Late after, and Over limit from 31 Mar', () => {
    const row = (day: string) => computeLedger(lease, asOf(day, payments), [], day).find(r => r.period_month === '2028-02')!
    expect(monthLimitState(row('2028-03-05'), '2028-03-05', D)).toBe('due')
    expect(monthLimitState(row('2028-03-06'), '2028-03-06', D)).toBe('late')
    expect(monthLimitState(row('2028-03-30'), '2028-03-30', D)).toBe('late')
    expect(monthLimitState(row('2028-03-31'), '2028-03-31', D)).toBe('over_limit')
  })

  it('max_unpaid_days = 60 removes the badge until day 61', () => {
    const s60 = { ...D, max_unpaid_days: 60 }
    const onlyFeb = (day: string) => computeLedger(lease, asOf(day, payments), [], day).filter(r => r.period_month >= '2028-02')
    expect(leaseLimitState(onlyFeb('2028-04-29'), '2028-04-29', s60).state).toBe('late')
    expect(leaseLimitState(onlyFeb('2028-04-30'), '2028-04-30', s60).state).toBe('over_limit')
  })
})

describe('Chidi: March 2027 receipt waits for review, then is rejected', () => {
  const lease = { move_in_date: '2026-12-10', lease_end: null, rent_due_day: 10, monthly_rent: 400000 }
  const payments: P[] = [
    { month: '2027-03', amount: 400000, submitted: '2027-03-08', rejected: '2027-03-10' },
    { month: '2027-03', amount: 400000, submitted: '2027-03-11', confirmed: '2027-03-12' },
  ]
  it('gets nothing while a receipt is pending, and alerts resume after the rejection', () => {
    const mar = simulate(lease, payments, '2027-03-01', '2027-03-31').filter(a => a.month === '2027-03')
    expect(mar.map(a => [a.day, a.offset])).toEqual([['2027-03-05', -5], ['2027-03-10', 0]])
  })
})

describe('job timing and dedupe', () => {
  it('only runs in the landlord send hour (Kigali time)', () => {
    const s18 = { ...D, send_hour: 18 }
    expect(shouldRunAt(new Date('2027-01-05T07:00:00Z'), s18)).toBe(false) // 09:00 Kigali
    expect(shouldRunAt(new Date('2027-01-05T16:00:00Z'), s18)).toBe(true)  // 18:00 Kigali
    expect(shouldRunAt(new Date('2027-01-05T07:00:00Z'), D)).toBe(true)
  })
  it('gives the same key for the same alert, so a second run is a no-op', () => {
    expect(rentAlertKey('L1', '2028-02', 5, 'email')).toBe(rentAlertKey('L1', '2028-02', 5, 'email'))
    expect(rentAlertKey('L1', '2028-02', 5, 'email')).not.toBe(rentAlertKey('L1', '2028-02', 5, 'in_app'))
  })
  it('levels and offsets follow the settings', () => {
    expect([-5, 0, 1, 4, 5, 14, 15, 40].map(o => alertLevel(o, D)))
      .toEqual(['before', 'due_today', 'overdue', 'overdue', 'warning', 'warning', 'final_warning', 'final_warning'])
    expect([1, 2, 5, 10, 15, 16].filter(o => sendsOn(o, D))).toEqual([1, 5, 10, 15])
    expect(sendsOn(-5, D, null, false)).toBe(false) // no "before" reminders for a former tenant
    // Warnings never start inside the grace period.
    expect(alertLevel(5, { ...D, warning_after_days: 2, grace_days: 5 })).toBe('warning')
    expect(alertLevel(4, { ...D, warning_after_days: 2, grace_days: 5 })).toBe('overdue')
  })
  it('fills in placeholders', () => {
    expect(renderTemplate('Hi {tenant_name}, {amount} for {month}', { tenant_name: 'Alice', amount: '350,000 RWF', month: 'June 2027' }))
      .toBe('Hi Alice, 350,000 RWF for June 2027')
  })
})

describe('payment plan, more time, notice to vacate', () => {
  const plan = { start: '2028-05-02', end: '2028-08-31', amountPerMonth: 100000 }
  const paid = [{ period_month: '2028-02', amount: 100000, status: 'confirmed', submitted_on: '2028-06-01' }]
  it('is kept while installments are paid and pauses late notices', () => {
    expect(planStatus(plan, paid, '2028-06-03')).toMatchObject({ active: true, kept: true, required: 100000 })
    const lease = { move_in_date: '2028-01-31', lease_end: null, rent_due_day: 31, monthly_rent: 300000 }
    const rows = computeLedger(lease, [], [], '2028-06-01', { from: '2028-05' })
    expect(rentAlertsForDay(rows, '2028-06-01', D, { onPlan: true }).filter(a => a.offset > 0)).toEqual([])
    expect(rentAlertsForDay(rows, '2028-06-01', D, { onPlan: false }).map(a => a.offset)).toEqual([1])
  })
  it('a missed installment brings the warnings back', () => {
    expect(planStatus(plan, paid, '2028-07-03')).toMatchObject({ kept: false, missedOn: '2028-07-02', required: 200000, paid: 100000 })
  })
  it('more time pauses the limit until the date', () => {
    const rows = computeLedger({ move_in_date: '2028-01-31', lease_end: null, rent_due_day: 31, monthly_rent: 300000 }, [], [], '2028-04-10')
    expect(leaseLimitState(rows, '2028-04-10', D, { moreTimeUntil: '2028-04-30' }).state).toBe('more_time')
    expect(leaseLimitState(rows, '2028-05-01', D, { moreTimeUntil: '2028-04-30' }).state).toBe('over_limit')
    expect(leaseLimitState(rows, '2028-04-10', D, { planKept: true }).state).toBe('plan')
  })
  it('a notice to vacate shows today + the notice period', () => {
    expect(vacateMoveOutDate('2027-10-05', D)).toBe('2027-11-04')
    expect(vacateMoveOutDate('2027-10-05', { notice_period_days: 60 })).toBe('2027-12-04')
  })
  it('installments do not drift at the end of a month', () => {
    const p = { start: '2028-01-31', end: '2028-05-31', amountPerMonth: 1 }
    expect(planStatus(p, [], '2028-03-01').required).toBe(1) // 29 Feb
    expect(planStatus(p, [], '2028-04-01').required).toBe(2) // 31 Mar, not 29 Mar
    expect(addMonths('2028-01', 1)).toBe('2028-02')
  })
})

describe('maintenance statuses (landlord only)', () => {
  it('allows the full workflow and reopening', () => {
    expect(nextStatuses('submitted')).toEqual(['acknowledged', 'scheduled', 'in_progress', 'on_hold', 'resolved', 'closed'])
    expect(nextStatuses('resolved')).toEqual(['acknowledged', 'in_progress'])
    expect(isOpenStatus('closed')).toBe(false)
  })
  it('needs a reason for on hold / closed and a date for scheduled', () => {
    expect(validateStatusChange('acknowledged', 'on_hold', '', null)).toMatch(/reason/)
    expect(validateStatusChange('acknowledged', 'closed', 'Old wiring', null)).toBeNull()
    expect(validateStatusChange('acknowledged', 'scheduled', null, null)).toMatch(/date/)
    expect(validateStatusChange('acknowledged', 'scheduled', null, '2029-12-03')).toBeNull()
    expect(validateStatusChange('resolved', 'closed', 'x', null)).toMatch(/not allowed/)
  })
})
