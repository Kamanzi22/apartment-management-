'use client'

import React, { useState, useTransition } from 'react'
import { format, endOfMonth } from 'date-fns'
import {
  ShieldCheck, Sparkles, Wrench, Droplets, MoreHorizontal,
  Pencil, Check, X, Plus, Trash2,
} from 'lucide-react'
import { upsertSecurityRate, addAdditionalExpense, deleteBuildingExpense, addOtherExpense } from '@/app/actions/building-config'
import { EXPENSE_CATEGORIES, MAINTENANCE_CATEGORIES, type ExpenseCategory, type MaintenanceCategory } from '@/lib/categories'
import { toast } from 'sonner'
import { formatRWF, parseAmountInput } from '@/lib/currency'

interface BuildingExpense {
  id: string
  category: string
  amount: number
  expense_date: string
  description: string
  created_at: string
}

const VAR_SECTIONS = [
  { key: 'cleaning'     as const, label: 'Cleaning',     Icon: Sparkles,     iconColor: 'text-purple-500', accent: 'bg-purple-50', dbCategory: 'cleaning'  },
  { key: 'maintenance'  as const, label: 'Maintenance',  Icon: Wrench,       iconColor: 'text-amber-600',  accent: 'bg-amber-50',  dbCategory: 'building_maintenance' },
  { key: 'water'        as const, label: 'Water',        Icon: Droplets,     iconColor: 'text-blue-500',   accent: 'bg-blue-50',   dbCategory: 'plumbing'  },
]

const MAIN_DB_CATEGORIES = new Set(['security', 'cleaning', 'building_maintenance', 'plumbing'])
// Maintenance-type categories are logged under the Maintenance section instead
const MAINT_VALUES       = new Set<string>(MAINTENANCE_CATEGORIES.map(c => c.value).filter(v => v !== 'other'))
const OTHER_CATEGORIES   = EXPENSE_CATEGORIES.filter(c => !MAIN_DB_CATEGORIES.has(c.value) && !MAINT_VALUES.has(c.value))
const ALL_SENTINELS      = new Set(['__security_rate__', '__monthly_cleaning__', '__electricity_bill__', '__water_bill__'])

const MONTH_NAMES = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December',
]
const NOW       = new Date()
const THIS_YEAR = NOW.getFullYear()
const YEARS     = [THIS_YEAR - 2, THIS_YEAR - 1, THIS_YEAR]

interface Props {
  securityMonthly: number
  allBuildingExpenses: BuildingExpense[]
  initialMonth: string
}

export function CostsDashboard({ securityMonthly, allBuildingExpenses, initialMonth }: Props) {
  const [viewMode, setViewMode] = useState<'month' | 'year'>('month')
  const [selMonth, setSelMonth] = useState(() => {
    const [, m] = initialMonth.split('-').map(Number)
    return m
  })
  const [selYear, setSelYear] = useState(() => {
    const [y] = initialMonth.split('-').map(Number)
    return y
  })

  const [editingRate, setEditingRate]   = useState(false)
  const [rateInput,   setRateInput]     = useState('')
  const [addingFor,   setAddingFor]     = useState<string | null>(null)
  const [addAmount,   setAddAmount]     = useState('')
  const [addDesc,     setAddDesc]       = useState('')
  const [addDate,     setAddDate]       = useState('')
  const [addCategory, setAddCategory]   = useState<ExpenseCategory>('other')
  const [maintType,   setMaintType]     = useState<MaintenanceCategory>(MAINTENANCE_CATEGORIES[0].value)
  const [maintOther,  setMaintOther]    = useState('')
  const [pending, startTransition]      = useTransition()

  // ── Date range ─────────────────────────────────────────────────────────────
  const mm           = String(selMonth).padStart(2, '0')
  const periodStart  = viewMode === 'year'
    ? `${selYear}-01-01`
    : `${selYear}-${mm}-01`
  const periodEnd    = viewMode === 'year'
    ? `${selYear}-12-31`
    : format(endOfMonth(new Date(selYear, selMonth - 1, 1)), 'yyyy-MM-dd')

  // For the add-form date cap: don't allow future dates
  const today        = format(NOW, 'yyyy-MM-dd')
  const addDateMax   = periodEnd > today ? today : periodEnd

  const periodLabel  = viewMode === 'year'
    ? `Full Year ${selYear}`
    : `${MONTH_NAMES[selMonth - 1]} ${selYear}`

  // ── Filtering helpers ──────────────────────────────────────────────────────
  function getExpenses(dbCategory: string): BuildingExpense[] {
    return allBuildingExpenses.filter(e =>
      e.category === dbCategory &&
      !ALL_SENTINELS.has(e.description) &&
      e.expense_date >= periodStart && e.expense_date <= periodEnd
    )
  }

  const otherExpenses      = allBuildingExpenses.filter(e =>
    !MAIN_DB_CATEGORIES.has(e.category) &&
    !ALL_SENTINELS.has(e.description) &&
    e.expense_date >= periodStart && e.expense_date <= periodEnd
  )
  const securityAdditionals = getExpenses('security')
  const securityMonthlyCost = viewMode === 'year' ? securityMonthly * 12 : securityMonthly
  const securityTotal        = securityMonthlyCost + securityAdditionals.reduce((s, e) => s + e.amount, 0)

  // ── Actions ────────────────────────────────────────────────────────────────
  function saveRate() {
    const val = parseAmountInput(rateInput)
    if (!rateInput || val < 0) { toast.error('Enter a valid amount'); return }
    startTransition(async () => {
      const res = await upsertSecurityRate(val)
      if (res?.error) { toast.error(res.error); return }
      setEditingRate(false)
      toast.success('Saved')
    })
  }

  function openAdd(key: string) {
    setAddAmount(''); setAddDesc(''); setAddDate(periodStart <= today ? periodStart : today); setAddCategory('other')
    setMaintType(MAINTENANCE_CATEGORIES[0].value); setMaintOther('')
    setAddingFor(key)
  }

  function saveExpense(sectionKey: 'security' | 'cleaning' | 'maintenance' | 'water') {
    const val = parseAmountInput(addAmount)
    if (val <= 0) { toast.error('Enter a valid amount'); return }
    if (!addDesc.trim())        { toast.error('Enter a description'); return }
    let description = addDesc.trim()
    if (sectionKey === 'maintenance') {
      if (maintType === 'other' && !maintOther.trim()) { toast.error('Specify the maintenance type'); return }
      const typeLabel = maintType === 'other'
        ? maintOther.trim()
        : MAINTENANCE_CATEGORIES.find(c => c.value === maintType)?.label ?? maintType
      description = `${typeLabel}: ${description}`
    }
    startTransition(async () => {
      const res = await addAdditionalExpense(sectionKey, val, description, addDate || periodStart)
      if (res?.error) { toast.error(res.error); return }
      setAddingFor(null)
      toast.success('Expense added')
    })
  }

  function saveOtherExpense() {
    const val = parseAmountInput(addAmount)
    if (val <= 0) { toast.error('Enter a valid amount'); return }
    if (!addDesc.trim())        { toast.error('Enter a description'); return }
    startTransition(async () => {
      const res = await addOtherExpense(addCategory, val, addDesc.trim(), addDate || periodStart)
      if (res?.error) { toast.error(res.error); return }
      setAddingFor(null)
      toast.success('Expense added')
    })
  }

  function removeExpense(id: string) {
    startTransition(async () => {
      const res = await deleteBuildingExpense(id)
      if (res?.error) { toast.error(res.error); return }
      toast.success('Deleted')
    })
  }

  const addFormProps = { periodStart, addDateMax, addAmount, setAddAmount, addDesc, setAddDesc, addDate, setAddDate, pending }
  const selSty = 'text-sm border rounded-lg px-2 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-slate-300'

  return (
    <div className="space-y-5">
      {/* Header + selectors */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Expenses</h1>
          <p className="text-sm text-slate-500 mt-0.5">Building expenses — {periodLabel}</p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {/* Month dropdown — dimmed in year mode */}
          <select
            value={selMonth}
            onChange={e => { setSelMonth(Number(e.target.value)); setViewMode('month') }}
            className={selSty + (viewMode === 'year' ? ' opacity-40' : '')}
          >
            {MONTH_NAMES.map((n, i) => <option key={i+1} value={i+1}>{n}</option>)}
          </select>

          {/* Year dropdown */}
          <select
            value={selYear}
            onChange={e => setSelYear(Number(e.target.value))}
            className={selSty}
          >
            {YEARS.map(y => <option key={y} value={y}>{y}</option>)}
          </select>

          {/* Full Year toggle */}
          <button
            onClick={() => setViewMode(v => v === 'year' ? 'month' : 'year')}
            className={
              'px-4 py-1.5 rounded-lg text-sm font-semibold border transition-all ' +
              (viewMode === 'year'
                ? 'bg-slate-800 text-white border-slate-800'
                : 'bg-white text-slate-600 border-slate-300 hover:border-slate-500')
            }
          >
            Full Year
          </button>
        </div>
      </div>

      {/* Security */}
      <div className="bg-white rounded-xl border shadow-sm overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b bg-slate-50">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-slate-500" />
            <h2 className="font-semibold text-slate-800 text-sm">Security</h2>
          </div>
          {securityTotal > 0 && <span className="text-sm font-bold text-red-600">{formatRWF(securityTotal)}</span>}
        </div>

        <div className="px-4 py-3 border-b">
          <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide mb-1.5">
            {viewMode === 'year'
              ? `Monthly rate × 12 months`
              : 'Monthly rate — fixed every month'}
          </p>
          {editingRate ? (
            <div className="flex items-center gap-2">
              <input
                type="text" inputMode="decimal" placeholder="e.g. 50,000"
                value={rateInput}
                onChange={e => setRateInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') saveRate(); if (e.key === 'Escape') setEditingRate(false) }}
                className="w-32 text-sm border rounded-lg px-2 py-1 focus:outline-none focus:ring-2 focus:ring-slate-300"
                autoFocus
              />
              <span className="text-xs text-slate-400">RWF/mo</span>
              <button onClick={saveRate} disabled={pending} className="p-1 text-green-600 hover:text-green-700 disabled:opacity-50"><Check className="h-4 w-4" /></button>
              <button onClick={() => setEditingRate(false)} className="p-1 text-slate-400 hover:text-slate-600"><X className="h-4 w-4" /></button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <span className={`text-xl font-bold ${securityMonthly > 0 ? 'text-slate-800' : 'text-slate-300'}`}>
                {securityMonthly > 0
                  ? viewMode === 'year'
                    ? `${formatRWF(securityMonthly)}/mo × 12 = ${formatRWF(securityMonthlyCost)}`
                    : `${formatRWF(securityMonthly)}/mo`
                  : 'Not set'}
              </span>
              <button
                onClick={() => { setRateInput(securityMonthly > 0 ? String(securityMonthly) : ''); setEditingRate(true) }}
                className="p-1 text-slate-300 hover:text-slate-600 transition-colors"
              >
                <Pencil className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
        </div>

        <div className="px-4 py-3">
          <div className="flex items-center justify-between mb-2">
            <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide">Additional expenses</p>
            {securityAdditionals.length > 0 && (
              <span className="text-xs font-semibold text-slate-500">
                {formatRWF(securityAdditionals.reduce((s, e) => s + e.amount, 0))}
              </span>
            )}
          </div>
          <ExpenseList expenses={securityAdditionals} onRemove={removeExpense} pending={pending} />
          {securityAdditionals.length === 0 && addingFor !== 'security' && (
            <p className="text-xs text-slate-300 mb-2">No additional expenses</p>
          )}
          {addingFor === 'security'
            ? <AddExpenseForm {...addFormProps} onSave={() => saveExpense('security')} onCancel={() => setAddingFor(null)} />
            : <AddButton onClick={() => openAdd('security')} />
          }
        </div>
      </div>

      {/* Cleaning, Maintenance, Water */}
      {VAR_SECTIONS.map(({ key, label, Icon, iconColor, accent, dbCategory }) => {
        const expenses = getExpenses(dbCategory)
        const total    = expenses.reduce((s, e) => s + e.amount, 0)
        return (
          <div key={key} className="bg-white rounded-xl border shadow-sm overflow-hidden">
            <div className={`flex items-center justify-between px-4 py-3 border-b ${accent}`}>
              <div className="flex items-center gap-2">
                <Icon className={`h-4 w-4 ${iconColor}`} />
                <h2 className="font-semibold text-slate-800 text-sm">{label}</h2>
              </div>
              {total > 0 && <span className="text-sm font-bold text-red-600">{formatRWF(total)}</span>}
            </div>
            <div className="px-4 py-3">
              <ExpenseList expenses={expenses} onRemove={removeExpense} pending={pending} />
              {expenses.length === 0 && addingFor !== key && (
                <p className="text-xs text-slate-300 mb-2">
                  {viewMode === 'year' ? `No expenses in ${selYear}` : 'No expenses this month'}
                </p>
              )}
              {addingFor === key
                ? <AddExpenseForm
                    {...addFormProps}
                    onSave={() => saveExpense(key)}
                    onCancel={() => setAddingFor(null)}
                    extra={key === 'maintenance' && (
                      <>
                        <select
                          value={maintType}
                          onChange={e => setMaintType(e.target.value as MaintenanceCategory)}
                          className="text-sm border rounded-lg px-2 py-1 focus:outline-none focus:ring-2 focus:ring-slate-300 bg-white"
                        >
                          {MAINTENANCE_CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                        </select>
                        {maintType === 'other' && (
                          <input
                            type="text" placeholder="Specify maintenance type"
                            value={maintOther}
                            onChange={e => setMaintOther(e.target.value)}
                            className="text-sm border rounded-lg px-2 py-1 focus:outline-none focus:ring-2 focus:ring-slate-300"
                          />
                        )}
                      </>
                    )}
                  />
                : <AddButton onClick={() => openAdd(key)} />
              }
            </div>
          </div>
        )
      })}

      {/* Other Expenses */}
      <div className="bg-white rounded-xl border shadow-sm overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b bg-orange-50">
          <div className="flex items-center gap-2">
            <MoreHorizontal className="h-4 w-4 text-orange-500" />
            <h2 className="font-semibold text-slate-800 text-sm">Other Expenses</h2>
          </div>
          {otherExpenses.length > 0 && (
            <span className="text-sm font-bold text-red-600">
              {formatRWF(otherExpenses.reduce((s, e) => s + e.amount, 0))}
            </span>
          )}
        </div>
        <div className="px-4 py-3">
          {otherExpenses.length > 0 && (
            <div className="space-y-0.5 mb-3">
              {otherExpenses.map(exp => {
                const catLabel = EXPENSE_CATEGORIES.find(c => c.value === exp.category)?.label ?? exp.category
                return (
                  <div key={exp.id} className="flex items-center gap-2 py-1.5 px-2 -mx-2 rounded-lg group hover:bg-slate-50">
                    <div className="flex-1 min-w-0">
                      <span className="text-sm text-slate-700">{exp.description}</span>
                      <span className="text-xs text-slate-400 ml-2">
                        {format(new Date(exp.expense_date + 'T12:00:00'), 'MMM d')}
                      </span>
                      <span className="ml-2 inline-block text-[10px] font-medium bg-slate-100 text-slate-500 rounded px-1.5 py-0.5">{catLabel}</span>
                    </div>
                    <span className="text-sm font-semibold text-red-600 shrink-0">{formatRWF(exp.amount)}</span>
                    <button
                      onClick={() => removeExpense(exp.id)}
                      disabled={pending}
                      className="p-1 text-slate-200 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity disabled:opacity-30"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                )
              })}
            </div>
          )}
          {otherExpenses.length === 0 && addingFor !== 'other' && (
            <p className="text-xs text-slate-300 mb-2">
              {viewMode === 'year' ? `No other expenses in ${selYear}` : 'No other expenses this month'}
            </p>
          )}
          {addingFor === 'other' ? (
            <div className="mt-1 p-3 bg-slate-50 rounded-xl border border-slate-200 space-y-2">
              <div className="flex gap-2">
                <div className="flex items-center gap-1 shrink-0">
                  <input
                    type="text" inputMode="decimal" placeholder="e.g. 50,000"
                    value={addAmount}
                    onChange={e => setAddAmount(e.target.value)}
                    className="w-28 text-sm border rounded-lg px-2 py-1 focus:outline-none focus:ring-2 focus:ring-slate-300"
                    autoFocus
                  />
                  <span className="text-xs text-slate-400">RWF</span>
                </div>
                <input
                  type="text" placeholder="Description"
                  value={addDesc}
                  onChange={e => setAddDesc(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && saveOtherExpense()}
                  className="flex-1 text-sm border rounded-lg px-2 py-1 focus:outline-none focus:ring-2 focus:ring-slate-300"
                />
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <select
                  value={addCategory}
                  onChange={e => setAddCategory(e.target.value as ExpenseCategory)}
                  className="text-sm border rounded-lg px-2 py-1 focus:outline-none focus:ring-2 focus:ring-slate-300 bg-white"
                >
                  {OTHER_CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                </select>
                <input
                  type="date"
                  value={addDate}
                  min={periodStart} max={addDateMax}
                  onChange={e => setAddDate(e.target.value)}
                  className="text-sm border rounded-lg px-2 py-1 focus:outline-none focus:ring-2 focus:ring-slate-300"
                />
                <button onClick={saveOtherExpense} disabled={pending} className="px-3 py-1 bg-slate-800 text-white text-sm rounded-lg hover:bg-slate-700 disabled:opacity-50 transition-colors">Add</button>
                <button onClick={() => setAddingFor(null)} className="px-3 py-1 border text-sm rounded-lg text-slate-500 hover:bg-slate-50 transition-colors">Cancel</button>
              </div>
            </div>
          ) : (
            <AddButton onClick={() => openAdd('other')} />
          )}
        </div>
      </div>
    </div>
  )
}

function ExpenseList({ expenses, onRemove, pending }: {
  expenses: BuildingExpense[]
  onRemove: (id: string) => void
  pending: boolean
}) {
  if (expenses.length === 0) return null
  return (
    <div className="space-y-0.5 mb-3">
      {expenses.map(exp => (
        <div key={exp.id} className="flex items-center gap-2 py-1.5 px-2 -mx-2 rounded-lg group hover:bg-slate-50">
          <div className="flex-1 min-w-0">
            <span className="text-sm text-slate-700">{exp.description}</span>
            <span className="text-xs text-slate-400 ml-2">
              {format(new Date(exp.expense_date + 'T12:00:00'), 'MMM d')}
            </span>
          </div>
          <span className="text-sm font-semibold text-red-600 shrink-0">{formatRWF(exp.amount)}</span>
          <button
            onClick={() => onRemove(exp.id)}
            disabled={pending}
            className="p-1 text-slate-200 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity disabled:opacity-30"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}
    </div>
  )
}

function AddButton({ onClick }: { onClick: () => void }) {
  return (
    <button onClick={onClick} className="flex items-center gap-1.5 text-xs font-medium text-slate-400 hover:text-slate-700 transition-colors mt-1 py-1">
      <Plus className="h-3.5 w-3.5" />Add expense
    </button>
  )
}

function AddExpenseForm({
  periodStart, addDateMax, addAmount, setAddAmount, addDesc, setAddDesc,
  addDate, setAddDate, onSave, onCancel, pending, extra,
}: {
  periodStart: string; addDateMax: string
  addAmount: string; setAddAmount: (v: string) => void
  addDesc: string; setAddDesc: (v: string) => void
  addDate: string; setAddDate: (v: string) => void
  onSave: () => void; onCancel: () => void; pending: boolean
  extra?: React.ReactNode
}) {
  return (
    <div className="mt-1 p-3 bg-slate-50 rounded-xl border border-slate-200 space-y-2">
      <div className="flex gap-2">
        <div className="flex items-center gap-1 shrink-0">
          <input
            type="text" inputMode="decimal" placeholder="e.g. 50,000"
            value={addAmount}
            onChange={e => setAddAmount(e.target.value)}
            className="w-28 text-sm border rounded-lg px-2 py-1 focus:outline-none focus:ring-2 focus:ring-slate-300"
            autoFocus
          />
          <span className="text-xs text-slate-400">RWF</span>
        </div>
        <input
          type="text" placeholder="Description"
          value={addDesc}
          onChange={e => setAddDesc(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && onSave()}
          className="flex-1 text-sm border rounded-lg px-2 py-1 focus:outline-none focus:ring-2 focus:ring-slate-300"
        />
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        {extra}
        <input
          type="date"
          value={addDate}
          min={periodStart} max={addDateMax}
          onChange={e => setAddDate(e.target.value)}
          className="text-sm border rounded-lg px-2 py-1 focus:outline-none focus:ring-2 focus:ring-slate-300"
        />
        <button onClick={onSave} disabled={pending} className="px-3 py-1 bg-slate-800 text-white text-sm rounded-lg hover:bg-slate-700 disabled:opacity-50 transition-colors">Add</button>
        <button onClick={onCancel} className="px-3 py-1 border text-sm rounded-lg text-slate-500 hover:bg-slate-50 transition-colors">Cancel</button>
      </div>
    </div>
  )
}
