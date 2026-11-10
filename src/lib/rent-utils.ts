// Kept identical in apartment-manager and apartment-manager-tenant.
//
// Every rent date is a Kigali calendar date (Africa/Kigali, UTC+2, no DST).
// Render runs in UTC, so "today" must never come from the server's local
// clock: between 00:00 and 02:00 Kigali time it would still be yesterday.
import { format, getDaysInMonth, parseISO } from 'date-fns'

export const TIME_ZONE = 'Africa/Kigali'

const kigaliDay = new Intl.DateTimeFormat('en-CA', {
  timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
})

/** Today's date in Kigali as 'YYYY-MM-DD'. */
export function kigaliDateString(now: Date = new Date()): string {
  const parts = Object.fromEntries(kigaliDay.formatToParts(now).map(p => [p.type, p.value]))
  return `${parts.year}-${parts.month}-${parts.day}`
}

/** Today's Kigali date as a local Date at midnight (for date-fns formatting). */
export function kigaliToday(now: Date = new Date()): Date {
  return parseISO(kigaliDateString(now))
}

/** The current rent month in Kigali, 'YYYY-MM'. */
export function currentPeriodMonth(now: Date = new Date()): string {
  return kigaliDateString(now).slice(0, 7)
}

/** 'YYYY-MM' -> local Date on the 1st of that month. */
export function monthStart(period: string): Date {
  const [y, m] = period.split('-').map(Number)
  return new Date(y, m - 1, 1)
}

/** Due date for a month: min(rent due day, last day of the month, lease end). */
export function getDueDate(rentDueDay: number, forMonth?: Date | string, leaseEnd?: string | null): Date {
  const base = typeof forMonth === 'string' ? monthStart(forMonth) : forMonth ?? kigaliToday()
  const year = base.getFullYear()
  const month = base.getMonth()
  const day = Math.min(rentDueDay, getDaysInMonth(new Date(year, month)))
  const due = new Date(year, month, day)
  if (leaseEnd) {
    const end = parseISO(leaseEnd)
    if (end < due) return end
  }
  return due
}

export function formatPeriodMonth(period: string): string {
  return format(monthStart(period), 'MMMM yyyy')
}

export function periodMonthFromDate(date: Date): string {
  return format(date, 'yyyy-MM')
}

export function addMonths(period: string, n: number): string {
  const [y, m] = period.split('-').map(Number)
  const total = y * 12 + (m - 1) + n
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}`
}

/** Every "YYYY-MM" from start to end, inclusive. */
export function monthsBetween(start: string, end: string): string[] {
  const result: string[] = []
  for (let mo = start; mo <= end; mo = addMonths(mo, 1)) result.push(mo)
  return result
}

export function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0])
}
