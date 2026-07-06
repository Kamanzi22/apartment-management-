'use client'

import { useState, useMemo } from 'react'
import { format, startOfMonth, endOfMonth, subMonths } from 'date-fns'
import { X, Building2, ChevronRight, DollarSign, TrendingDown } from 'lucide-react'
import { AddExpenseDialog } from './add-expense-dialog'
import { EXPENSE_CATEGORIES, categoryLabel } from '@/lib/categories'
import { cn } from '@/lib/utils'
import type { ExpenseWithUnit } from './page'

const SENTINEL_LABELS: Record<string, string> = {
  '__monthly_cleaning__': 'Cleaning (Monthly)',
  '__electricity_bill__': 'Electricity Bill',
  '__water_bill__':       'Water Bill',
}
function expenseLabel(expense: ExpenseWithUnit | { category: string; description: string }): string {
  const d = (expense as any).description
  return d ? (SENTINEL_LABELS[d] ?? categoryLabel(expense.category, EXPENSE_CATEGORIES)) : categoryLabel(expense.category, EXPENSE_CATEGORIES)
}

type Period = 'month' | 'quarter' | 'half' | 'year'

const PERIODS: { key: Period; label: string; months: number }[] = [
  { key: 'month',   label: 'Month',     months: 1  },
  { key: 'quarter', label: 'Quarter',   months: 3  },
  { key: 'half',    label: 'Half Year', months: 6  },
  { key: 'year',    label: 'Full Year', months: 12 },
]

function getPeriodRange(period: Period) {
  const now = new Date()
  const months = PERIODS.find(p => p.key === period)!.months
  const start = startOfMonth(subMonths(now, months - 1))
  const end = endOfMonth(now)
  return {
    dateFrom: format(start, 'yyyy-MM-dd'),
    dateTo:   format(end,   'yyyy-MM-dd'),
    monthStrings: Array.from({ length: months }, (_, i) =>
      format(subMonths(now, months - 1 - i), 'yyyy-MM')
    ),
  }
}

interface Unit          { id: string; label: string; monthly_rent: number; status: string }
interface Lease         { id: string; unit_id: string; tenant_id: string; monthly_rent: number }
interface Payment       { id: string; tenant_id: string; period_month: string; amount: number; status: string; lease_id: string }
interface TenantProfile { id: string; full_name: string }
interface MaintenanceRequest { id: string; unit_id: string; category: string; description: string; created_at: string }

interface Props {
  units: Unit[]
  activeLeases: Lease[]
  allPayments: Payment[]
  allExpenses: ExpenseWithUnit[]
  maintenanceRequests: MaintenanceRequest[]
  tenantProfiles: TenantProfile[]
  securityMonthly?: number
  // kept for compat but unused
  currentMonthStart?: string
  currentMonthEnd?: string
  yearStart?: string
  chartStart?: string
  currentMonth?: string
}

export function FinancialDashboard({
  units, activeLeases, allPayments, allExpenses, maintenanceRequests,
  tenantProfiles, securityMonthly = 0,
  currentMonthStart: _cms, currentMonthEnd: _cme, yearStart: _ys, chartStart: _cs, currentMonth: _cm,
}: Props) {
  const [period, setPeriod] = useState<Period>('month')
  const [selectedUnitId, setSelectedUnitId] = useState<string | null>(null)

  const { dateFrom, dateTo, monthStrings } = useMemo(() => getPeriodRange(period), [period])

  const leaseByUnitId  = useMemo(() => new Map(activeLeases.map(l  => [l.unit_id,  l])), [activeLeases])
  const tenantById     = useMemo(() => new Map(tenantProfiles.map(t => [t.id, t])),       [tenantProfiles])

  const tableRows = useMemo(() => units.map(unit => {
    const lease   = leaseByUnitId.get(unit.id)
    const tIncome = lease
      ? allPayments.filter(p => p.lease_id === lease.id && monthStrings.includes(p.period_month) && p.status === 'confirmed').reduce((s, p) => s + p.amount, 0)
      : 0
    const tExp = allExpenses
      .filter(e => e.unit_id === unit.id && e.expense_date >= dateFrom && e.expense_date <= dateTo)
      .reduce((s, e) => s + e.amount, 0)
    return { unit, lease, tIncome, tExp, tNet: tIncome - tExp }
  }), [units, leaseByUnitId, allPayments, allExpenses, monthStrings, dateFrom, dateTo])

  const tBuildingExp = useMemo(
    () => allExpenses.filter(e => !e.unit_id && e.expense_date >= dateFrom && e.expense_date <= dateTo).reduce((s, e) => s + e.amount, 0),
    [allExpenses, dateFrom, dateTo]
  )
  const tSecurityCost = securityMonthly * monthStrings.length
  const tTotalIncome = tableRows.reduce((s, r) => s + r.tIncome, 0)
  const tTotalExp    = tableRows.reduce((s, r) => s + r.tExp, 0) + tBuildingExp + tSecurityCost
  const tTotalNet    = tTotalIncome - tTotalExp

  // ── Unit detail slide-over ─────────────────────────────────────────────
  const selectedUnit      = selectedUnitId ? units.find(u => u.id === selectedUnitId) : null
  const selectedLease     = selectedUnitId ? leaseByUnitId.get(selectedUnitId) : undefined
  const selectedTenant    = selectedLease  ? tenantById.get(selectedLease.tenant_id) : undefined
  const modalPayments     = selectedLease  ? allPayments.filter(p => p.lease_id === selectedLease.id && monthStrings.includes(p.period_month)) : []
  const modalExpenses     = selectedUnitId ? allExpenses.filter(e => e.unit_id === selectedUnitId && e.expense_date >= dateFrom && e.expense_date <= dateTo) : []
  const modalIncome       = modalPayments.filter(p => p.status === 'confirmed').reduce((s, p) => s + p.amount, 0)
  const modalExpenseTotal = modalExpenses.reduce((s, e) => s + e.amount, 0)
  const modalNet          = modalIncome - modalExpenseTotal

  const periodLabel = PERIODS.find(p => p.key === period)!.label

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Financials</h1>
          <p className="text-sm text-slate-500 mt-0.5">Income and expenses for your building</p>
        </div>
        <AddExpenseDialog units={units} maintenanceRequests={maintenanceRequests} />
      </div>

      {/* Unified period selector */}
      <div className="flex gap-1 p-1 bg-slate-100 rounded-xl w-fit">
        {PERIODS.map(p => (
          <button
            key={p.key}
            onClick={() => setPeriod(p.key)}
            className={cn(
              'text-sm font-medium px-4 py-1.5 rounded-lg transition-all',
              period === p.key ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
            )}
          >
            {p.label}
          </button>
        ))}
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-white rounded-xl border p-3 shadow-sm">
          <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide mb-1">Income</p>
          <p className="text-xl font-bold text-green-600">${tTotalIncome.toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
        </div>
        <div className="bg-white rounded-xl border p-3 shadow-sm">
          <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide mb-1">Expenses</p>
          <p className="text-xl font-bold text-red-500">${tTotalExp.toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
        </div>
        <div className={cn('rounded-xl border p-3 shadow-sm', tTotalNet >= 0 ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200')}>
          <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide mb-1">{tTotalNet >= 0 ? 'Profit' : 'Loss'}</p>
          <p className={cn('text-xl font-bold', tTotalNet >= 0 ? 'text-green-700' : 'text-red-700')}>
            {tTotalNet < 0 ? '-' : ''}${Math.abs(tTotalNet).toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </p>
        </div>
      </div>

      {/* Breakdown table */}
      <section className="bg-white rounded-xl border shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-slate-50">
                <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Unit</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Rent/mo</th>
                <th className="text-center px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">{periodLabel}</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-green-600 uppercase tracking-wide">Income</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-red-500 uppercase tracking-wide">Expenses</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Net</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {tableRows.map(({ unit, lease, tIncome, tExp, tNet }) => (
                <tr
                  key={unit.id}
                  onClick={() => setSelectedUnitId(unit.id)}
                  className="hover:bg-slate-50 cursor-pointer group"
                >
                  <td className="px-4 py-3 font-medium text-slate-800">
                    <span className="flex items-center gap-1">
                      {unit.label}
                      <ChevronRight className="h-3 w-3 text-slate-300 group-hover:text-slate-500 transition-colors" />
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right text-slate-500">${unit.monthly_rent.toFixed(0)}</td>
                  <td className="px-4 py-3 text-center">
                    {!lease
                      ? <span className="text-[11px] bg-slate-100 text-slate-400 px-2 py-0.5 rounded-full">Vacant</span>
                      : tIncome > 0
                        ? <span className="text-[11px] bg-green-100 text-green-700 px-2 py-0.5 rounded-full">Paid</span>
                        : <span className="text-[11px] bg-red-100 text-red-600 px-2 py-0.5 rounded-full">Unpaid</span>
                    }
                  </td>
                  <td className="px-4 py-3 text-right font-medium text-green-700">{tIncome > 0 ? `$${tIncome.toFixed(2)}` : '—'}</td>
                  <td className="px-4 py-3 text-right text-red-500">{tExp > 0 ? `$${tExp.toFixed(2)}` : '—'}</td>
                  <td className={cn('px-4 py-3 text-right font-semibold', tNet >= 0 ? 'text-blue-700' : 'text-red-600')}>
                    {tIncome === 0 && tExp === 0 ? '—' : `${tNet < 0 ? '-' : ''}$${Math.abs(tNet).toFixed(2)}`}
                  </td>
                </tr>
              ))}

              {/* Apartment row — building-wide costs */}
              <tr className="bg-slate-50/70 border-t">
                <td className="px-4 py-3 font-medium text-slate-600">
                  <span className="flex items-center gap-1.5">
                    <Building2 className="h-3.5 w-3.5 text-slate-400" />
                    Apartment
                  </span>
                </td>
                <td className="px-4 py-3 text-right text-slate-300">—</td>
                <td />
                <td className="px-4 py-3 text-right text-slate-300">—</td>
                <td className="px-4 py-3 text-right text-red-500">
                  {tBuildingExp + tSecurityCost > 0 ? `$${(tBuildingExp + tSecurityCost).toFixed(2)}` : '—'}
                </td>
                <td className={cn('px-4 py-3 text-right font-semibold', 'text-red-600')}>
                  {tBuildingExp + tSecurityCost > 0 ? `-$${(tBuildingExp + tSecurityCost).toFixed(2)}` : '—'}
                </td>
              </tr>

              {/* Total row */}
              <tr className="border-t bg-slate-50 font-semibold">
                <td className="px-4 py-3 text-slate-700" colSpan={3}>Total</td>
                <td className="px-4 py-3 text-right text-green-700">${tTotalIncome.toFixed(2)}</td>
                <td className="px-4 py-3 text-right text-red-500">${tTotalExp.toFixed(2)}</td>
                <td className={cn('px-4 py-3 text-right', tTotalNet >= 0 ? 'text-blue-700' : 'text-red-600')}>
                  {tTotalNet < 0 ? '-' : ''}${Math.abs(tTotalNet).toFixed(2)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      {/* Unit detail slide-over */}
      {selectedUnit && (
        <div className="fixed inset-0 z-50" aria-modal="true">
          <div
            className="absolute inset-0 bg-black/40 transition-opacity"
            onClick={() => setSelectedUnitId(null)}
          />
          <div className="absolute right-0 top-0 h-full w-full max-w-sm bg-white shadow-2xl flex flex-col">
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b shrink-0">
              <div>
                <p className="font-bold text-slate-900 text-lg">{selectedUnit.label}</p>
                <p className="text-sm text-slate-500">
                  {selectedTenant ? selectedTenant.full_name : 'Vacant'} · {periodLabel}
                </p>
              </div>
              <button onClick={() => setSelectedUnitId(null)} className="p-1.5 rounded-lg hover:bg-slate-100">
                <X className="h-4 w-4 text-slate-500" />
              </button>
            </div>

            {/* Summary strip */}
            <div className="grid grid-cols-3 border-b shrink-0">
              <div className="px-4 py-3 text-center border-r">
                <p className="text-[10px] text-slate-400 uppercase font-semibold">Income</p>
                <p className="text-base font-bold text-green-600 mt-0.5">${modalIncome.toFixed(2)}</p>
              </div>
              <div className="px-4 py-3 text-center border-r">
                <p className="text-[10px] text-slate-400 uppercase font-semibold">Expenses</p>
                <p className="text-base font-bold text-red-500 mt-0.5">${modalExpenseTotal.toFixed(2)}</p>
              </div>
              <div className="px-4 py-3 text-center">
                <p className="text-[10px] text-slate-400 uppercase font-semibold">Net</p>
                <p className={cn('text-base font-bold mt-0.5', modalNet >= 0 ? 'text-blue-700' : 'text-red-600')}>
                  {modalNet < 0 ? '-' : ''}${Math.abs(modalNet).toFixed(2)}
                </p>
              </div>
            </div>

            {/* Scrollable content */}
            <div className="flex-1 overflow-y-auto divide-y">
              {/* Income */}
              <div className="px-5 py-4">
                <div className="flex items-center gap-2 mb-3">
                  <DollarSign className="h-3.5 w-3.5 text-green-500" />
                  <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Rent Payments</p>
                </div>
                {modalPayments.length === 0 ? (
                  <p className="text-sm text-slate-400">No payments in this period</p>
                ) : (
                  <div className="space-y-2">
                    {modalPayments.map(p => (
                      <div key={p.id} className="flex items-center justify-between py-1.5">
                        <div>
                          <p className="text-sm font-medium text-slate-700">
                            {p.period_month.replace('-', ' / ')}
                          </p>
                          <p className="text-xs text-slate-400 mt-0.5">
                            {p.status === 'confirmed' ? 'Confirmed' : 'Pending review'}
                          </p>
                        </div>
                        <span className={cn('text-sm font-semibold', p.status === 'confirmed' ? 'text-green-600' : 'text-amber-500')}>
                          ${p.amount.toFixed(2)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Expenses */}
              <div className="px-5 py-4">
                <div className="flex items-center gap-2 mb-3">
                  <TrendingDown className="h-3.5 w-3.5 text-red-400" />
                  <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Expenses</p>
                </div>
                {modalExpenses.length === 0 ? (
                  <p className="text-sm text-slate-400">No expenses in this period</p>
                ) : (
                  <div className="space-y-2">
                    {modalExpenses.map(e => (
                      <div key={e.id} className="flex items-center justify-between py-1.5">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-slate-700">{expenseLabel(e)}</p>
                          {e.description && !SENTINEL_LABELS[e.description] && (
                            <p className="text-xs text-slate-400 line-clamp-1">{e.description}</p>
                          )}
                          <p className="text-xs text-slate-300">{format(new Date(e.expense_date), 'MMM d, yyyy')}</p>
                        </div>
                        <span className="text-sm font-semibold text-red-500 shrink-0 ml-3">${e.amount.toFixed(2)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
