'use client'

import { useState, useMemo } from 'react'
import { format, startOfMonth, endOfMonth, subMonths } from 'date-fns'
import { TrendingUp, TrendingDown, Building2, Home, Wrench } from 'lucide-react'
import { AddExpenseDialog } from './add-expense-dialog'
import { BuildingCostsSection } from './building-costs-section'
import { EXPENSE_CATEGORIES, categoryLabel } from '@/lib/categories'

const SENTINEL_LABELS: Record<string, string> = {
  '__monthly_cleaning__': 'Cleaning (Monthly)',
  '__electricity_bill__': 'Electricity Bill',
  '__water_bill__':       'Water Bill',
}
function expenseLabel(expense: ExpenseWithUnit): string {
  return expense.description ? (SENTINEL_LABELS[expense.description] ?? categoryLabel(expense.category, EXPENSE_CATEGORIES)) : categoryLabel(expense.category, EXPENSE_CATEGORIES)
}
function expenseNote(expense: ExpenseWithUnit): string | null {
  if (expense.description && SENTINEL_LABELS[expense.description]) return null
  return expense.description || null
}
import { cn } from '@/lib/utils'
import type { ExpenseWithUnit } from './page'

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
    dateTo: format(end, 'yyyy-MM-dd'),
    monthStrings: Array.from({ length: months }, (_, i) =>
      format(subMonths(now, months - 1 - i), 'yyyy-MM')
    ),
  }
}

interface Unit { id: string; label: string; monthly_rent: number; status: string }
interface Lease { id: string; unit_id: string; tenant_id: string; monthly_rent: number }
interface Payment { id: string; tenant_id: string; period_month: string; amount: number; status: string; lease_id: string }
interface MaintenanceRequest { id: string; unit_id: string; category: string; description: string; created_at: string }

interface Props {
  units: Unit[]
  activeLeases: Lease[]
  allPayments: Payment[]
  allExpenses: ExpenseWithUnit[]
  maintenanceRequests: MaintenanceRequest[]
  currentMonthStart: string
  currentMonthEnd: string
  yearStart: string
  chartStart: string
  currentMonth: string
  securityMonthly?: number
}

export function FinancialDashboard({ units, activeLeases, allPayments, allExpenses, maintenanceRequests, currentMonth, securityMonthly = 0 }: Props) {
  const [period, setPeriod] = useState<Period>('month')
  const [tablePeriod, setTablePeriod] = useState<Period>('month')

  const { dateFrom, dateTo, monthStrings } = useMemo(() => getPeriodRange(period), [period])

  const periodPayments = useMemo(
    () => allPayments.filter(p => monthStrings.includes(p.period_month)),
    [allPayments, monthStrings]
  )

  const periodExpenses = useMemo(
    () => allExpenses.filter(e => e.expense_date >= dateFrom && e.expense_date <= dateTo),
    [allExpenses, dateFrom, dateTo]
  )

  const leaseByUnitId = useMemo(() => new Map(activeLeases.map(l => [l.unit_id, l])), [activeLeases])
  const mrById = useMemo(() => new Map(maintenanceRequests.map(m => [m.id, m])), [maintenanceRequests])

  // ── Income per unit ──────────────────────────────────────────────────────
  const unitIncome = units.map(unit => {
    const lease = leaseByUnitId.get(unit.id)
    const payments = lease ? periodPayments.filter(p => p.lease_id === lease.id) : []
    const collected = payments.filter(p => p.status === 'confirmed').reduce((s, p) => s + p.amount, 0)
    const hasPending = payments.some(p => p.status === 'pending_review')
    return { unit, lease, collected, hasPending }
  })

  const totalIncome = unitIncome.reduce((s, r) => s + r.collected, 0)

  // ── Expenses: per unit then building-wide ────────────────────────────────
  const unitExpenses = units
    .map(unit => ({
      unit,
      expenses: periodExpenses.filter(e => e.unit_id === unit.id),
    }))
    .filter(r => r.expenses.length > 0)

  const buildingExpenses = periodExpenses.filter(e => !e.unit_id)
  const securityCost = securityMonthly * monthStrings.length
  const totalExpenses = periodExpenses.reduce((s, e) => s + e.amount, 0) + securityCost

  const net = totalIncome - totalExpenses

  // ── Per-unit breakdown table (own period) ────────────────────────────────
  const { dateFrom: tDateFrom, dateTo: tDateTo, monthStrings: tMonths } = useMemo(
    () => getPeriodRange(tablePeriod), [tablePeriod]
  )
  const tableRows = useMemo(() => units.map(unit => {
    const lease = leaseByUnitId.get(unit.id)
    const tIncome = lease
      ? allPayments
          .filter(p => p.lease_id === lease.id && tMonths.includes(p.period_month) && p.status === 'confirmed')
          .reduce((s, p) => s + p.amount, 0)
      : 0
    const tExp = allExpenses
      .filter(e => e.unit_id === unit.id && e.expense_date >= tDateFrom && e.expense_date <= tDateTo)
      .reduce((s, e) => s + e.amount, 0)
    return { unit, lease, tIncome, tExp, tNet: tIncome - tExp }
  }), [units, leaseByUnitId, allPayments, allExpenses, tMonths, tDateFrom, tDateTo])

  const tBuildingExp = useMemo(
    () => allExpenses.filter(e => !e.unit_id && e.expense_date >= tDateFrom && e.expense_date <= tDateTo)
      .reduce((s, e) => s + e.amount, 0),
    [allExpenses, tDateFrom, tDateTo]
  )
  const tSecurityCost = securityMonthly * tMonths.length
  const tTotalIncome = tableRows.reduce((s, r) => s + r.tIncome, 0)
  const tTotalExp = tableRows.reduce((s, r) => s + r.tExp, 0) + tBuildingExp + tSecurityCost
  const tTotalNet = tTotalIncome - tTotalExp

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

      {/* Period selector */}
      <div className="flex gap-1 p-1 bg-slate-100 rounded-xl w-fit">
        {PERIODS.map(p => (
          <button
            key={p.key}
            onClick={() => setPeriod(p.key)}
            className={cn(
              'text-sm font-medium px-4 py-1.5 rounded-lg transition-all',
              period === p.key
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-500 hover:text-slate-700'
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
          <p className="text-xl font-bold text-green-600">${totalIncome.toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
        </div>
        <div className="bg-white rounded-xl border p-3 shadow-sm">
          <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide mb-1">Expenses</p>
          <p className="text-xl font-bold text-red-500">${totalExpenses.toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
        </div>
        <div className={cn('rounded-xl border p-3 shadow-sm', net >= 0 ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200')}>
          <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide mb-1">{net >= 0 ? 'Profit' : 'Loss'}</p>
          <p className={cn('text-xl font-bold', net >= 0 ? 'text-green-700' : 'text-red-700')}>
            {net < 0 ? '-' : ''}${Math.abs(net).toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </p>
        </div>
      </div>

      {/* ── Standard Building Costs ── */}
      <BuildingCostsSection
        securityMonthly={securityMonthly}
        currentMonth={currentMonth}
        allExpenses={allExpenses}
      />

      {/* ── Per-unit breakdown table ── */}
      <section className="bg-white rounded-xl border shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-slate-50">
                <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Unit</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Rent/mo</th>
                <th className="px-4 py-3">
                  <select
                    value={tablePeriod}
                    onChange={e => setTablePeriod(e.target.value as Period)}
                    className="text-xs font-semibold text-slate-500 uppercase tracking-wide bg-white border rounded-lg px-2 py-1 w-full"
                  >
                    {PERIODS.map(p => <option key={p.key} value={p.key}>{p.label}</option>)}
                  </select>
                </th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-green-600 uppercase tracking-wide">Income</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-red-500 uppercase tracking-wide">Expenses</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Net</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {tableRows.map(({ unit, lease, tIncome, tExp, tNet }) => (
                <tr key={unit.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-medium text-slate-800">{unit.label}</td>
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
              {(tBuildingExp > 0 || tSecurityCost > 0) && (
                <tr className="bg-slate-50/60">
                  <td className="px-4 py-3 text-slate-500 italic" colSpan={2}>Building-wide</td>
                  <td />
                  <td className="px-4 py-3 text-right text-slate-300">—</td>
                  <td className="px-4 py-3 text-right text-red-500">${(tBuildingExp + tSecurityCost).toFixed(2)}</td>
                  <td className="px-4 py-3 text-right font-semibold text-red-600">-${(tBuildingExp + tSecurityCost).toFixed(2)}</td>
                </tr>
              )}
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

      {/* ── Income section ── */}
      <section className="bg-white rounded-xl border shadow-sm overflow-hidden">
        <div className="px-4 py-2.5 border-b bg-slate-50 flex items-center gap-2">
          <TrendingUp className="h-4 w-4 text-green-500" />
          <h2 className="font-semibold text-slate-700 text-sm">Income</h2>
        </div>
        <div className="divide-y">
          {unitIncome.map(({ unit, lease, collected, hasPending }) => {
            let statusEl: React.ReactNode
            if (!lease) {
              statusEl = <span className="text-[11px] text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full">Vacant</span>
            } else if (hasPending) {
              statusEl = <span className="text-[11px] text-amber-700 bg-amber-100 px-2 py-0.5 rounded-full">Pending</span>
            } else if (collected > 0) {
              statusEl = <span className="text-[11px] text-green-700 bg-green-100 px-2 py-0.5 rounded-full">Paid</span>
            } else {
              statusEl = <span className="text-[11px] text-red-700 bg-red-100 px-2 py-0.5 rounded-full">Unpaid</span>
            }
            return (
              <div key={unit.id} className="flex items-center px-4 py-3 gap-3">
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-slate-800 text-sm">{unit.label}</p>
                  <p className="text-xs text-slate-400">{lease ? `$${lease.monthly_rent.toFixed(0)}/mo` : 'No tenant'}</p>
                </div>
                {statusEl}
                <p className={cn('text-sm font-semibold w-20 text-right shrink-0', collected > 0 ? 'text-green-700' : 'text-slate-300')}>
                  {collected > 0 ? `$${collected.toFixed(2)}` : '—'}
                </p>
              </div>
            )
          })}
          <div className="flex items-center px-4 py-3 bg-slate-50">
            <p className="flex-1 text-sm font-semibold text-slate-600">Total Income</p>
            <p className="font-bold text-green-700">${totalIncome.toFixed(2)}</p>
          </div>
        </div>
      </section>

      {/* ── Expenses section ── */}
      <section className="bg-white rounded-xl border shadow-sm overflow-hidden">
        <div className="px-4 py-2.5 border-b bg-slate-50 flex items-center gap-2">
          <TrendingDown className="h-4 w-4 text-red-400" />
          <h2 className="font-semibold text-slate-700 text-sm">Expenses</h2>
        </div>

        {unitExpenses.length === 0 && buildingExpenses.length === 0 && securityCost === 0 ? (
          <p className="text-center py-10 text-slate-400 text-sm">No expenses in this period</p>
        ) : (
          <>
            {/* Per-unit expenses */}
            {unitExpenses.map(({ unit, expenses }) => (
              <div key={unit.id}>
                <div className="px-4 py-2 bg-slate-50/70 border-b flex items-center gap-2">
                  <Home className="h-3.5 w-3.5 text-slate-400" />
                  <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">{unit.label}</span>
                  <span className="ml-auto text-xs text-slate-400 font-medium">
                    ${expenses.reduce((s, e) => s + e.amount, 0).toFixed(2)}
                  </span>
                </div>
                <div className="divide-y">
                  {expenses.map(expense => {
                    const linkedMR = expense.linked_maintenance_request_id
                      ? mrById.get(expense.linked_maintenance_request_id)
                      : null
                    return (
                      <div key={expense.id} className="flex items-start px-4 py-2.5 gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5">
                            {linkedMR && <Wrench className="h-3 w-3 text-orange-400 shrink-0" />}
                            <span className="text-sm text-slate-700 font-medium">
                              {expenseLabel(expense)}
                            </span>
                          </div>
                          {linkedMR && (
                            <p className="text-xs text-orange-600 mt-0.5 line-clamp-1">
                              Issue: {linkedMR.description}
                            </p>
                          )}
                          {expenseNote(expense) && (
                            <p className="text-xs text-slate-400 mt-0.5 line-clamp-1">{expenseNote(expense)}</p>
                          )}
                          <p className="text-xs text-slate-300 mt-0.5">
                            {format(new Date(expense.expense_date), 'MMM d, yyyy')}
                          </p>
                        </div>
                        <p className="text-sm font-semibold text-red-600 shrink-0">${expense.amount.toFixed(2)}</p>
                      </div>
                    )
                  })}
                </div>
              </div>
            ))}

            {/* Building-wide expenses */}
            {(buildingExpenses.length > 0 || securityCost > 0) && (
              <div>
                <div className="px-4 py-2 bg-slate-50/70 border-t border-b flex items-center gap-2">
                  <Building2 className="h-3.5 w-3.5 text-slate-400" />
                  <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Building-wide</span>
                  <span className="ml-auto text-xs text-slate-400 font-medium">
                    ${(buildingExpenses.reduce((s, e) => s + e.amount, 0) + securityCost).toFixed(2)}
                  </span>
                </div>
                <div className="divide-y">
                  {/* Security — virtual line from config */}
                  {securityCost > 0 && (
                    <div className="flex items-start px-4 py-2.5 gap-3">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-slate-700 font-medium">Security</p>
                        <p className="text-xs text-slate-400">
                          ${securityMonthly.toFixed(2)}/mo × {monthStrings.length} month{monthStrings.length > 1 ? 's' : ''}
                        </p>
                      </div>
                      <p className="text-sm font-semibold text-red-600 shrink-0">${securityCost.toFixed(2)}</p>
                    </div>
                  )}
                  {buildingExpenses.map(expense => (
                    <div key={expense.id} className="flex items-start px-4 py-2.5 gap-3">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-slate-700 font-medium">
                          {expenseLabel(expense)}
                        </p>
                        {expenseNote(expense) && (
                          <p className="text-xs text-slate-400 mt-0.5 line-clamp-1">{expenseNote(expense)}</p>
                        )}
                        <p className="text-xs text-slate-300 mt-0.5">
                          {format(new Date(expense.expense_date), 'MMM d, yyyy')}
                        </p>
                      </div>
                      <p className="text-sm font-semibold text-red-600 shrink-0">${expense.amount.toFixed(2)}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Total expenses row */}
            <div className="flex items-center px-4 py-3 bg-slate-50 border-t">
              <p className="flex-1 text-sm font-semibold text-slate-600">Total Expenses</p>
              <p className="font-bold text-red-600">${totalExpenses.toFixed(2)}</p>
            </div>
          </>
        )}
      </section>

      {/* ── Net summary ── */}
      <div className={cn('rounded-xl border p-4', net >= 0 ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200')}>
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <p className="text-sm text-slate-500">Total Income</p>
            <p className="text-sm font-medium text-green-700">+${totalIncome.toFixed(2)}</p>
          </div>
          <div className="flex items-center justify-between">
            <p className="text-sm text-slate-500">Total Expenses</p>
            <p className="text-sm font-medium text-red-600">−${totalExpenses.toFixed(2)}</p>
          </div>
          <div className="h-px bg-slate-200 my-1" />
          <div className="flex items-center justify-between">
            <p className="text-sm font-bold text-slate-700">{net >= 0 ? 'Profit' : 'Loss'}</p>
            <p className={cn('text-lg font-bold', net >= 0 ? 'text-green-700' : 'text-red-700')}>
              {net < 0 ? '−' : '+'}${Math.abs(net).toFixed(2)}
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
