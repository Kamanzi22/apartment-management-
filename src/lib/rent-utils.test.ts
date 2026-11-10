// Kept identical in apartment-manager and apartment-manager-tenant.
import { describe, expect, it } from 'vitest'
import { format } from 'date-fns'
import {
  addMonths, currentPeriodMonth, getDueDate, kigaliDateString, monthsBetween, ordinal,
} from './rent-utils'

const ymd = (d: Date) => format(d, 'yyyy-MM-dd')

describe('Kigali time (Render runs in UTC)', () => {
  it('files a payment made at 00:30 Kigali on the 1st under the new month', () => {
    // 22:30 UTC on 30 Nov = 00:30 on 1 Dec in Kigali
    expect(currentPeriodMonth(new Date('2026-11-30T22:30:00Z'))).toBe('2026-12')
    expect(currentPeriodMonth(new Date('2026-11-30T21:59:59Z'))).toBe('2026-11')
    expect(currentPeriodMonth(new Date('2026-12-01T00:30:00Z'))).toBe('2026-12')
  })

  it('rolls the date over at midnight Kigali time', () => {
    expect(kigaliDateString(new Date('2028-02-29T21:59:00Z'))).toBe('2028-02-29')
    expect(kigaliDateString(new Date('2028-02-29T22:00:00Z'))).toBe('2028-03-01')
    expect(kigaliDateString(new Date('2029-12-31T22:00:00Z'))).toBe('2030-01-01')
  })
})

describe('getDueDate', () => {
  it('uses the last day of short months for a due day of 31', () => {
    expect(ymd(getDueDate(31, '2027-02'))).toBe('2027-02-28')
    expect(ymd(getDueDate(31, '2028-02'))).toBe('2028-02-29')
    expect(ymd(getDueDate(31, '2027-04'))).toBe('2027-04-30')
    expect(ymd(getDueDate(31, '2027-01'))).toBe('2027-01-31')
  })

  it('never falls after the lease end', () => {
    expect(ymd(getDueDate(31, '2028-03', '2028-03-15'))).toBe('2028-03-15')
    expect(ymd(getDueDate(10, '2028-06', '2028-06-30'))).toBe('2028-06-10')
  })

  it('accepts a Date for the month', () => {
    expect(ymd(getDueDate(5, new Date(2027, 10, 1)))).toBe('2027-11-05')
  })
})

describe('month helpers', () => {
  it('adds months across years', () => {
    expect(addMonths('2026-11', 2)).toBe('2027-01')
    expect(addMonths('2029-01', 6)).toBe('2029-07')
    expect(addMonths('2027-01', -1)).toBe('2026-12')
  })

  it('lists months inclusive', () => {
    expect(monthsBetween('2026-11', '2027-02')).toEqual(['2026-11', '2026-12', '2027-01', '2027-02'])
    expect(monthsBetween('2027-03', '2027-02')).toEqual([])
  })

  it('formats ordinals', () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 31].map(ordinal)).toEqual(
      ['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd', '31st'])
  })
})
