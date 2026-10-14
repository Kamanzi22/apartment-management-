'use client'

import { useState, useMemo } from 'react'
import Link from 'next/link'
import { format, endOfMonth, addMonths } from 'date-fns'
import { X, Building2, ChevronRight, DollarSign, TrendingDown } from 'lucide-react'
import { EXPENSE_CATEGORIES, categoryLabel } from '@/lib/categories'
import { cn } from '@/lib/utils'
import type { ExpenseWithUnit } from './page'
import { formatRWF } from '@/lib/currency'

const SENTINEL_LABELS: Record<string, string> = {
  '__monthly_cleaning__': 'Cleaning (Monthly)',
  '__electricity_bill__': 'Electricity Bill',
  '__water_bill__':       'Water Bill',
}
function expenseLabel(e: { category: string; description?: string }): string {
  return e.description
    ? (SENTINEL_LABELS[e.description] ?? categoryLabel(e.category, EXPENSE_CATEGORIES))
    : categoryLabel(e.category, EXPENSE_CATEGORIES)
}

const MONTH_NAMES = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December',
]
const NOW       = new Date()
const THIS_YEAR = NOW.getFullYear()
const CUR_MONTH = NOW.getMonth() + 1
const YEARS     = [THIS_YEAR - 2, THIS_YEAR - 1, THIS_YEAR]

function singleMonthRange(month: number, year: number) {
  const mm    = String(month).padStart(2, '0')
  const start = new Date(year, month - 1, 1)
  return {
    dateFrom:     `${year}-${mm}-01`,
    dateTo:       format(endOfMonth(start), 'yyyy-MM-dd'),
    monthStrings: [`${year}-${mm}`],
    label:        `${MONTH_NAMES[month - 1]} ${year}`,
  }
}

function ytdRange() {
  return {
    dateFrom:     `${THIS_YEAR}-01-01`,
    dateTo:       format(NOW, 'yyyy-MM-dd'),
    monthStrings: Array.from({ length: CUR_MONTH }, (_, i) =>
      `${THIS_YEAR}-${String(i + 1).padStart(2, '0')}`
    ),
    label: `Jan – ${MONTH_NAMES[CUR_MONTH - 1]} ${THIS_YEAR}`,
  }
}

function fullYearRange(year: number) {
  return {
    dateFrom:     `${year}-01-01`,
    dateTo:       `${year}-12-31`,
    monthStrings: Array.from({ length: 12 }, (_, i) =>
      `${year}-${String(i + 1).padStart(2, '0')}`
    ),
    label: `Full Year ${year}`,
  }
}

// unused but kept for completeness
function _customRange(fromMonth: number, fromYear: number, toMonth: number, toYear: number) {
  const start = new Date(fromYear, fromMonth - 1, 1)
  const end   = endOfMonth(new Date(toYear, toMonth - 1, 1))
  const months: string[] = []
  let cur = start
  while (cur <= end) { months.push(format(cur, 'yyyy-MM')); cur = addMonths(cur, 1) }
  return { dateFrom: format(start, 'yyyy-MM-dd'), dateTo: format(end, 'yyyy-MM-dd'), monthStrings: months }
}

interface Unit               { id: string; label: string; monthly_rent: number; status: string }
interface Lease              { id: string; unit_id: string; tenant_id: string; monthly_rent: number }
interface Payment            { id: string; tenant_id: string; period_month: string; amount: number; status: string; lease_id: string }
interface TenantProfile      { id: string; full_name: string }
interface MaintenanceRequest { id: string; unit_id: string; category: string; description: string; created_at: string }

interface Props {
  units: Unit[]
  activeLeases: Lease[]
  allPayments: Payment[]
  allExpenses: ExpenseWithUnit[]
  maintenanceRequests: MaintenanceRequest[]
  tenantProfiles: TenantProfile[]
  securityMonthly?: number
  currentMonthStart?: string; currentMonthEnd?: string
  yearStart?: string; chartStart?: string; currentMonth?: string
}

export function FinancialDashboard({
  units, activeLeases, allPayments, allExpenses,
  maintenanceRequests: _mr,
  tenantProfiles, securityMonthly = 0,
  currentMonthStart: _a, currentMonthEnd: _b, yearStart: _c, chartStart: _d, currentMonth: _e,
}: Props) {
  // ── Summary cards selector ────────────────────────────────────────────────
  const [selMonth,    setSelMonth]    = useState(CUR_MONTH)
  const [selYear,     setSelYear]     = useState(THIS_YEAR)
  const [isCurrently, setIsCurrently] = useState(false)

  // ── Table column selector ─────────────────────────────────────────────────
  const [tableMonth, setTableMonth] = useState(CUR_MONTH)
  const [tableYear,  setTableYear]  = useState(THIS_YEAR)

  // ── Unit slide-over ───────────────────────────────────────────────────────
  const [selectedUnitId, setSelectedUnitId] = useState<string | null>(null)
  const [unitMode,       setUnitMode]       = useState<'month' | 'currently' | 'year'>('month')
  const [unitMonth,      setUnitMonth]      = useState(CUR_MONTH)
  const [unitYear,       setUnitYear]       = useState(THIS_YEAR)

  function openUnit(unitId: string) {
    setUnitMode('month')
    setUnitMonth(tableMonth)
    setUnitYear(tableYear)
    setSelectedUnitId(unitId)
  }

  // ── Ranges ────────────────────────────────────────────────────────────────
  const summaryRng = useMemo(
    () => isCurrently ? ytdRange() : singleMonthRange(selMonth, selYear),
    [isCurrently, selMonth, selYear]
  )
  const tableRng = useMemo(() => singleMonthRange(tableMonth, tableYear), [tableMonth, tableYear])
  const unitRng  = useMemo(() => {
    if (unitMode === 'currently') return ytdRange()
    if (unitMode === 'year')      return fullYearRange(unitYear)
    return singleMonthRange(unitMonth, unitYear)
  }, [unitMode, unitMonth, unitYear])

  const { dateFrom: sDF, dateTo: sDT, monthStrings: sMS } = summaryRng
  const { dateFrom: tDF, dateTo: tDT, monthStrings: tMS } = tableRng
  const { dateFrom: uDF, dateTo: uDT, monthStrings: uMS } = unitRng

  // ── Lookups ───────────────────────────────────────────────────────────────
  const leaseByUnitId = useMemo(() => new Map(activeLeases.map(l => [l.unit_id, l])), [activeLeases])
  const tenantById    = useMemo(() => new Map(tenantProfiles.map(t => [t.id, t])),    [tenantProfiles])

  // ── Summary card totals ───────────────────────────────────────────────────
  const sTotalIncome = useMemo(() => units.reduce((tot, unit) => {
    const lease = leaseByUnitId.get(unit.id)
    if (!lease) return tot
    return tot + allPayments.filter(p => p.lease_id === lease.id && sMS.includes(p.period_month) && p.status === 'confirmed').reduce((s, p) => s + p.amount, 0)
  }, 0), [units, leaseByUnitId, allPayments, sMS])

  const sTotalExp = useMemo(() => {
    const unitExp = units.reduce((tot, unit) => tot + allExpenses.filter(e => e.unit_id === unit.id && e.expense_date >= sDF && e.expense_date <= sDT).reduce((s, e) => s + e.amount, 0), 0)
    const bldgExp = allExpenses.filter(e => !e.unit_id && e.expense_date >= sDF && e.expense_date <= sDT).reduce((s, e) => s + e.amount, 0)
    return unitExp + bldgExp + securityMonthly * sMS.length
  }, [units, allExpenses, sDF, sDT, sMS, securityMonthly])

  const sTotalNet = sTotalIncome - sTotalExp

  // ── Table rows ────────────────────────────────────────────────────────────
  const tableRows = useMemo(() => units.map(unit => {
    const lease   = leaseByUnitId.get(unit.id)
    const tIncome = lease
      ? allPayments.filter(p => p.lease_id === lease.id && tMS.includes(p.period_month) && p.status === 'confirmed').reduce((s, p) => s + p.amount, 0)
      : 0
    const tExp = allExpenses.filter(e => e.unit_id === unit.id && e.expense_date >= tDF && e.expense_date <= tDT).reduce((s, e) => s + e.amount, 0)
    return { unit, lease, tIncome, tExp, tNet: tIncome - tExp }
  }), [units, leaseByUnitId, allPayments, allExpenses, tMS, tDF, tDT])

  const tBldgExp     = useMemo(() => allExpenses.filter(e => !e.unit_id && e.expense_date >= tDF && e.expense_date <= tDT).reduce((s, e) => s + e.amount, 0), [allExpenses, tDF, tDT])
  const tSecCost     = securityMonthly * tMS.length
  const tTotalIncome = tableRows.reduce((s, r) => s + r.tIncome, 0)
  const tTotalExp    = tableRows.reduce((s, r) => s + r.tExp, 0) + tBldgExp + tSecCost

  // ── Unit slide-over data ──────────────────────────────────────────────────
  const selectedUnit   = selectedUnitId ? units.find(u => u.id === selectedUnitId) : null
  const selectedLease  = selectedUnitId ? leaseByUnitId.get(selectedUnitId) : undefined
  const selectedTenant = selectedLease  ? tenantById.get(selectedLease.tenant_id) : undefined

  const modalPayments = useMemo(() =>
    selectedLease
      ? allPayments.filter(p => p.lease_id === selectedLease.id && uMS.includes(p.period_month)).sort((a, b) => b.period_month.localeCompare(a.period_month))
      : [],
    [selectedLease, allPayments, uMS]
  )
  const modalExpenses = useMemo(() =>
    selectedUnitId
      ? allExpenses.filter(e => e.unit_id === selectedUnitId && e.expense_date >= uDF && e.expense_date <= uDT).sort((a, b) => b.expense_date.localeCompare(a.expense_date))
      : [],
    [selectedUnitId, allExpenses, uDF, uDT]
  )
  const modalIncome       = modalPayments.filter(p => p.status === 'confirmed').reduce((s, p) => s + p.amount, 0)
  const modalExpenseTotal = modalExpenses.reduce((s, e) => s + e.amount, 0)
  const modalNet          = modalIncome - modalExpenseTotal

  // ── Year breakdown (month-by-month) ──────────────────────────────────────
  const yearBreakdown = useMemo(() => {
    if (unitMode !== 'year' || !selectedUnitId) return []
    return Array.from({ length: 12 }, (_, i) => {
      const mn  = i + 1
      const mm  = String(mn).padStart(2, '0')
      const ms  = `${unitYear}-${mm}`
      const mS  = `${unitYear}-${mm}-01`
      const mE  = format(endOfMonth(new Date(unitYear, i, 1)), 'yyyy-MM-dd')
      const inc = selectedLease
        ? allPayments.filter(p => p.lease_id === selectedLease.id && p.period_month === ms && p.status === 'confirmed').reduce((s, p) => s + p.amount, 0)
        : 0
      const exp = allExpenses.filter(e => e.unit_id === selectedUnitId && e.expense_date >= mS && e.expense_date <= mE).reduce((s, e) => s + e.amount, 0)
      return { name: MONTH_NAMES[i].slice(0, 3), inc, exp, net: inc - exp }
    })
  }, [unitMode, unitYear, selectedUnitId, selectedLease, allPayments, allExpenses])

  const selSty = 'text-sm border rounded-lg px-2 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-slate-300'

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Financials</h1>
          <p className="text-sm text-slate-500 mt-0.5">Income and expenses for your building</p>
        </div>
      </div>

      {/* Summary selector */}
      <div className="flex items-center gap-3 flex-wrap">
        <select value={selMonth} onChange={e => { setSelMonth(Number(e.target.value)); setIsCurrently(false) }} className={selSty}>
          {MONTH_NAMES.map((n, i) => <option key={i+1} value={i+1}>{n}</option>)}
        </select>
        <select value={selYear} onChange={e => { setSelYear(Number(e.target.value)); setIsCurrently(false) }} className={selSty}>
          {YEARS.map(y => <option key={y} value={y}>{y}</option>)}
        </select>
        <button
          onClick={() => setIsCurrently(v => !v)}
          className={cn('px-4 py-1.5 rounded-lg text-sm font-semibold border transition-all',
            isCurrently ? 'bg-slate-800 text-white border-slate-800' : 'bg-white text-slate-600 border-slate-300 hover:border-slate-500'
          )}
        >
          Currently
        </button>
        {isCurrently && (
          <span className="text-xs text-slate-400">Jan – {MONTH_NAMES[CUR_MONTH - 1]} {THIS_YEAR}</span>
        )}
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: 'Income',   value: sTotalIncome, color: 'text-green-600', bg: '' },
          { label: 'Expenses', value: sTotalExp,    color: 'text-red-500',   bg: '' },
          { label: sTotalNet >= 0 ? 'Profit' : 'Loss', value: sTotalNet, color: sTotalNet >= 0 ? 'text-green-700' : 'text-red-700', bg: sTotalNet >= 0 ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200' },
        ].map(({ label, value, color, bg }) => (
          <div key={label} className={cn('rounded-xl border p-3 shadow-sm', bg || 'bg-white')}>
            <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide mb-0.5">{label}</p>
            <p className="text-[10px] text-slate-300 mb-1">{summaryRng.label}</p>
            <p className={cn('text-xl font-bold', color)}>
              {formatRWF(value)}
            </p>
          </div>
        ))}
      </div>

      {/* Breakdown table */}
      <section className="bg-white rounded-xl border shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-slate-50">
                <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Unit</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Rent/mo</th>
                <th className="text-center px-3 py-2">
                  <div className="flex items-center justify-center gap-1">
                    <select value={tableMonth} onChange={e => setTableMonth(Number(e.target.value))}
                      className="text-xs font-semibold text-slate-500 bg-slate-100 border-0 rounded px-1.5 py-1 focus:outline-none focus:ring-1 focus:ring-slate-300 cursor-pointer">
                      {MONTH_NAMES.map((n, i) => <option key={i+1} value={i+1}>{n.slice(0,3)}</option>)}
                    </select>
                    <select value={tableYear} onChange={e => setTableYear(Number(e.target.value))}
                      className="text-xs font-semibold text-slate-500 bg-slate-100 border-0 rounded px-1.5 py-1 focus:outline-none focus:ring-1 focus:ring-slate-300 cursor-pointer">
                      {YEARS.map(y => <option key={y} value={y}>{y}</option>)}
                    </select>
                  </div>
                </th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-green-600 uppercase tracking-wide">Income</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-red-500 uppercase tracking-wide">Expenses</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Net</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {tableRows.map(({ unit, lease, tIncome, tExp, tNet }) => (
                <tr key={unit.id} onClick={() => openUnit(unit.id)} className="hover:bg-slate-50 cursor-pointer group">
                  <td className="px-4 py-3 font-medium text-slate-800">
                    <span className="flex items-center gap-1">
                      {unit.label}
                      <ChevronRight className="h-3 w-3 text-slate-300 group-hover:text-slate-500 transition-colors" />
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right text-slate-500">{formatRWF(unit.monthly_rent)}</td>
                  <td className="px-4 py-3 text-center">
                    {!lease
                      ? <span className="text-[11px] bg-slate-100 text-slate-400 px-2 py-0.5 rounded-full">Vacant</span>
                      : tIncome > 0
                        ? <span className="text-[11px] bg-green-100 text-green-700 px-2 py-0.5 rounded-full">Paid</span>
                        : <span className="text-[11px] bg-red-100 text-red-600 px-2 py-0.5 rounded-full">Unpaid</span>
                    }
                  </td>
                  <td className="px-4 py-3 text-right font-medium text-green-700">{tIncome > 0 ? formatRWF(tIncome) : '—'}</td>
                  <td className="px-4 py-3 text-right text-red-500">{tExp > 0 ? formatRWF(tExp) : '—'}</td>
                  <td className={cn('px-4 py-3 text-right font-semibold', tNet >= 0 ? 'text-blue-700' : 'text-red-600')}>
                    {tIncome === 0 && tExp === 0 ? '—' : formatRWF(tNet)}
                  </td>
                </tr>
              ))}
              <tr className="bg-slate-50/70 border-t">
                <td className="px-4 py-3 font-medium text-slate-600">
                  <span className="flex items-center gap-1.5"><Building2 className="h-3.5 w-3.5 text-slate-400" />Apartment</span>
                </td>
                <td className="px-4 py-3 text-right text-slate-300">—</td>
                <td />
                <td className="px-4 py-3 text-right text-slate-300">—</td>
                <td className="px-4 py-3 text-right text-red-500">{tBldgExp + tSecCost > 0 ? formatRWF(tBldgExp + tSecCost) : '—'}</td>
                <td className="px-4 py-3 text-right font-semibold text-red-600">{tBldgExp + tSecCost > 0 ? formatRWF(-(tBldgExp + tSecCost)) : '—'}</td>
              </tr>
              <tr className="border-t bg-slate-50 font-semibold">
                <td className="px-4 py-3 text-slate-700" colSpan={3}>Total</td>
                <td className="px-4 py-3 text-right text-green-700">{formatRWF(tTotalIncome)}</td>
                <td className="px-4 py-3 text-right text-red-500">{formatRWF(tTotalExp)}</td>
                <td className={cn('px-4 py-3 text-right', (tTotalIncome - tTotalExp) >= 0 ? 'text-blue-700' : 'text-red-600')}>
                  {formatRWF(tTotalIncome - tTotalExp)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      {/* Unit slide-over */}
      {selectedUnit && (
        <div className="fixed inset-0 z-50" aria-modal="true">
          <div className="absolute inset-0 bg-black/40" onClick={() => setSelectedUnitId(null)} />
          <div className="absolute right-0 top-0 h-full w-full max-w-sm bg-white shadow-2xl flex flex-col">

            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b shrink-0">
              <div>
                <p className="font-bold text-slate-900 text-lg">{selectedUnit.label}</p>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <span className={cn('text-[10px] font-semibold px-1.5 py-0.5 rounded-full',
                    selectedTenant ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-400'
                  )}>
                    {selectedTenant ? 'Occupied' : 'Vacant'}
                  </span>
                  {selectedTenant && (
                    <p className="text-sm font-medium text-slate-700">{selectedTenant.full_name}</p>
                  )}
                </div>
                <Link
                  href={`/landlord/financials/unit/${selectedUnit.id}`}
                  className="text-xs font-medium text-slate-500 hover:text-slate-800 underline-offset-2 hover:underline mt-1 inline-block"
                >
                  Full activity (all time) →
                </Link>
              </div>
              <button onClick={() => setSelectedUnitId(null)} className="p-1.5 rounded-lg hover:bg-slate-100">
                <X className="h-4 w-4 text-slate-500" />
              </button>
            </div>

            {/* Period picker */}
            <div className="px-5 py-3 border-b bg-slate-50 shrink-0 space-y-2">
              {/* Mode tabs */}
              <div className="flex gap-1.5">
                {(['month', 'currently', 'year'] as const).map(mode => (
                  <button
                    key={mode}
                    onClick={() => setUnitMode(mode)}
                    className={cn(
                      'text-xs px-3 py-1.5 rounded-lg font-semibold border transition-all',
                      unitMode === mode
                        ? 'bg-slate-800 text-white border-slate-800'
                        : 'bg-white text-slate-500 border-slate-200 hover:border-slate-400'
                    )}
                  >
                    {mode === 'month'     ? 'Month'
                    : mode === 'currently' ? `Currently (${CUR_MONTH} months)`
                    : 'Year'}
                  </button>
                ))}
              </div>

              {/* Month mode: month + year dropdowns */}
              {unitMode === 'month' && (
                <div className="flex gap-2">
                  <select value={unitMonth} onChange={e => setUnitMonth(Number(e.target.value))}
                    className="text-sm border rounded-lg px-2 py-1 bg-white focus:outline-none focus:ring-1 focus:ring-slate-300">
                    {MONTH_NAMES.map((n, i) => <option key={i+1} value={i+1}>{n}</option>)}
                  </select>
                  <select value={unitYear} onChange={e => setUnitYear(Number(e.target.value))}
                    className="text-sm border rounded-lg px-2 py-1 bg-white focus:outline-none focus:ring-1 focus:ring-slate-300">
                    {YEARS.map(y => <option key={y} value={y}>{y}</option>)}
                  </select>
                </div>
              )}

              {/* Currently: just show the range */}
              {unitMode === 'currently' && (
                <p className="text-xs text-slate-400">Jan – {MONTH_NAMES[CUR_MONTH - 1]} {THIS_YEAR}</p>
              )}

              {/* Year mode: year dropdown */}
              {unitMode === 'year' && (
                <select value={unitYear} onChange={e => setUnitYear(Number(e.target.value))}
                  className="text-sm border rounded-lg px-2 py-1 bg-white focus:outline-none focus:ring-1 focus:ring-slate-300">
                  {YEARS.map(y => <option key={y} value={y}>{y}</option>)}
                </select>
              )}
            </div>

            {/* Summary strip */}
            <div className="grid grid-cols-3 border-b shrink-0">
              <div className="px-4 py-3 text-center border-r">
                <p className="text-[10px] text-slate-400 uppercase font-semibold">Income</p>
                <p className="text-base font-bold text-green-600 mt-0.5">{formatRWF(modalIncome)}</p>
              </div>
              <div className="px-4 py-3 text-center border-r">
                <p className="text-[10px] text-slate-400 uppercase font-semibold">Expenses</p>
                <p className="text-base font-bold text-red-500 mt-0.5">{formatRWF(modalExpenseTotal)}</p>
              </div>
              <div className="px-4 py-3 text-center">
                <p className="text-[10px] text-slate-400 uppercase font-semibold">Net</p>
                <p className={cn('text-base font-bold mt-0.5', modalNet >= 0 ? 'text-blue-700' : 'text-red-600')}>
                  {formatRWF(modalNet)}
                </p>
              </div>
            </div>

            {/* Scrollable content */}
            <div className="flex-1 overflow-y-auto">

              {/* Year mode: month-by-month table */}
              {unitMode === 'year' ? (
                <div className="px-5 py-4">
                  <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-3">Monthly Breakdown — {unitYear}</p>
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b">
                        <th className="text-left pb-2 text-xs font-semibold text-slate-400">Month</th>
                        <th className="text-right pb-2 text-xs font-semibold text-green-600">Income</th>
                        <th className="text-right pb-2 text-xs font-semibold text-red-500">Expenses</th>
                        <th className="text-right pb-2 text-xs font-semibold text-slate-500">Net</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-50">
                      {yearBreakdown.map(({ name, inc, exp, net }) => (
                        <tr key={name} className="hover:bg-slate-50">
                          <td className="py-2 text-slate-700 font-medium">{name}</td>
                          <td className="py-2 text-right text-green-600">{inc > 0 ? formatRWF(inc) : '—'}</td>
                          <td className="py-2 text-right text-red-500">{exp > 0 ? formatRWF(exp) : '—'}</td>
                          <td className={cn('py-2 text-right font-semibold', net > 0 ? 'text-blue-700' : net < 0 ? 'text-red-600' : 'text-slate-300')}>
                            {inc === 0 && exp === 0 ? '—' : formatRWF(net)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot className="border-t-2 border-slate-200">
                      <tr>
                        <td className="pt-2 text-xs font-bold text-slate-600">Total</td>
                        <td className="pt-2 text-right text-xs font-bold text-green-600">{formatRWF(modalIncome)}</td>
                        <td className="pt-2 text-right text-xs font-bold text-red-500">{formatRWF(modalExpenseTotal)}</td>
                        <td className={cn('pt-2 text-right text-xs font-bold', modalNet >= 0 ? 'text-blue-700' : 'text-red-600')}>
                          {formatRWF(modalNet)}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              ) : (
                /* Month / Currently mode: payments + expenses lists */
                <div className="divide-y">
                  <div className="px-5 py-4">
                    <div className="flex items-center gap-2 mb-3">
                      <DollarSign className="h-3.5 w-3.5 text-green-500" />
                      <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Rent Payments</p>
                      {modalPayments.length > 0 && (
                        <span className="ml-auto text-xs font-semibold text-green-600">
                          {formatRWF(modalPayments.filter(p => p.status === 'confirmed').reduce((s, p) => s + p.amount, 0))} collected
                        </span>
                      )}
                    </div>
                    {modalPayments.length === 0
                      ? <p className="text-sm text-slate-400">No payments in this period</p>
                      : (
                        <div className="space-y-1">
                          {modalPayments.map(p => {
                            const [yr, mn] = p.period_month.split('-').map(Number)
                            const payer = tenantById.get(p.tenant_id)
                            return (
                              <div key={p.id} className="flex items-center justify-between py-1.5 border-b border-slate-50 last:border-0">
                                <div>
                                  <p className="text-sm font-medium text-slate-700">{MONTH_NAMES[mn - 1]} {yr}</p>
                                  {payer && (
                                    <p className="text-xs text-slate-500 mb-0.5">Paid by {payer.full_name}</p>
                                  )}
                                  <span className={cn('text-[10px] font-semibold px-1.5 py-0.5 rounded-full',
                                    p.status === 'confirmed' ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-600'
                                  )}>
                                    {p.status === 'confirmed' ? 'Confirmed' : 'Pending'}
                                  </span>
                                </div>
                                <span className={cn('text-sm font-semibold', p.status === 'confirmed' ? 'text-green-600' : 'text-amber-500')}>
                                  {formatRWF(p.amount)}
                                </span>
                              </div>
                            )
                          })}
                        </div>
                      )
                    }
                  </div>
                  <div className="px-5 py-4">
                    <div className="flex items-center gap-2 mb-3">
                      <TrendingDown className="h-3.5 w-3.5 text-red-400" />
                      <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Expenses</p>
                      {modalExpenses.length > 0 && (
                        <span className="ml-auto text-xs font-semibold text-red-500">{formatRWF(modalExpenseTotal)} total</span>
                      )}
                    </div>
                    {modalExpenses.length === 0
                      ? <p className="text-sm text-slate-400">No expenses in this period</p>
                      : (
                        <div className="space-y-1">
                          {modalExpenses.map(e => (
                            <div key={e.id} className="flex items-center justify-between py-1.5 border-b border-slate-50 last:border-0">
                              <div className="flex-1 min-w-0 pr-3">
                                <p className="text-sm font-medium text-slate-700">{expenseLabel(e)}</p>
                                {e.description && !SENTINEL_LABELS[e.description] && (
                                  <p className="text-xs text-slate-400 line-clamp-1">{e.description}</p>
                                )}
                                <p className="text-xs text-slate-300">{format(new Date(e.expense_date), 'MMM d, yyyy')}</p>
                              </div>
                              <span className="text-sm font-semibold text-red-500 shrink-0">{formatRWF(e.amount)}</span>
                            </div>
                          ))}
                        </div>
                      )
                    }
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
