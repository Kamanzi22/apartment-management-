'use client'

import React, { useState, useTransition } from 'react'
import { format, subMonths, addMonths, startOfMonth, isSameMonth } from 'date-fns'
import {
  ShieldCheck, Sparkles, Zap, Droplets,
  Pencil, Check, X, Plus, Trash2, ChevronLeft, ChevronRight,
} from 'lucide-react'
import {
  upsertSecurityRate, upsertMonthlyBill,
  addAdditionalExpense, deleteBuildingExpense,
} from '@/app/actions/building-config'
import { toast } from 'sonner'

interface BuildingExpense {
  id: string
  category: string
  amount: number
  expense_date: string
  description: string
  created_at: string
}

interface SectionDef {
  key: 'security' | 'cleaning' | 'electricity' | 'water'
  label: string
  Icon: React.ElementType
  iconColor: string
  accent: string
  isFixed: boolean
  billKey?: 'cleaning' | 'electricity_bill' | 'water_bill'
  baseSentinel?: string
  additionalCategory: string
}

const SECTIONS: SectionDef[] = [
  {
    key: 'security', label: 'Security',
    Icon: ShieldCheck, iconColor: 'text-slate-500', accent: 'bg-slate-50',
    isFixed: true, additionalCategory: 'security',
  },
  {
    key: 'cleaning', label: 'Cleaning',
    Icon: Sparkles, iconColor: 'text-purple-500', accent: 'bg-purple-50',
    isFixed: false, billKey: 'cleaning', baseSentinel: '__monthly_cleaning__',
    additionalCategory: 'cleaning',
  },
  {
    key: 'electricity', label: 'Electricity',
    Icon: Zap, iconColor: 'text-yellow-500', accent: 'bg-yellow-50',
    isFixed: false, billKey: 'electricity_bill', baseSentinel: '__electricity_bill__',
    additionalCategory: 'electrical',
  },
  {
    key: 'water', label: 'Water',
    Icon: Droplets, iconColor: 'text-blue-500', accent: 'bg-blue-50',
    isFixed: false, billKey: 'water_bill', baseSentinel: '__water_bill__',
    additionalCategory: 'plumbing',
  },
]

const ALL_SENTINELS = new Set(['__security_rate__', '__monthly_cleaning__', '__electricity_bill__', '__water_bill__'])

interface Props {
  securityMonthly: number
  allBuildingExpenses: BuildingExpense[]
  initialMonth: string
}

export function CostsDashboard({ securityMonthly, allBuildingExpenses, initialMonth }: Props) {
  const now = new Date()
  const [currentMonthDate, setCurrentMonthDate] = useState(() => {
    const [y, m] = initialMonth.split('-').map(Number)
    return startOfMonth(new Date(y, m - 1))
  })

  const [editingBase, setEditingBase] = useState<string | null>(null)
  const [baseInput, setBaseInput] = useState('')
  const [addingFor, setAddingFor] = useState<string | null>(null)
  const [addAmount, setAddAmount] = useState('')
  const [addDesc, setAddDesc] = useState('')
  const [addDate, setAddDate] = useState('')
  const [pending, startTransition] = useTransition()

  const currentMonth = format(currentMonthDate, 'yyyy-MM')
  const monthStart = `${currentMonth}-01`
  const [y, mo] = currentMonth.split('-').map(Number)
  const monthEnd = `${currentMonth}-${new Date(y, mo, 0).getDate()}`
  const isCurrentMonth = isSameMonth(currentMonthDate, now)

  function getBaseAmount(sec: SectionDef): number | null {
    if (sec.isFixed) return securityMonthly > 0 ? securityMonthly : null
    const entry = allBuildingExpenses.find(e =>
      e.description === sec.baseSentinel &&
      e.expense_date >= monthStart && e.expense_date <= monthEnd
    )
    return entry ? entry.amount : null
  }

  function getAdditionals(sec: SectionDef): BuildingExpense[] {
    return allBuildingExpenses.filter(e =>
      e.category === sec.additionalCategory &&
      !ALL_SENTINELS.has(e.description) &&
      e.expense_date >= monthStart && e.expense_date <= monthEnd
    )
  }

  function startEditBase(sec: SectionDef) {
    const amt = getBaseAmount(sec)
    setBaseInput(amt != null ? String(amt) : '')
    setEditingBase(sec.key)
  }

  function saveBase(sec: SectionDef) {
    const val = parseFloat(baseInput)
    if (isNaN(val) || val < 0) { toast.error('Enter a valid amount'); return }
    startTransition(async () => {
      const res = sec.isFixed
        ? await upsertSecurityRate(val)
        : await upsertMonthlyBill(sec.billKey!, val, currentMonth)
      if (res?.error) { toast.error(res.error); return }
      setEditingBase(null)
      toast.success('Saved')
    })
  }

  function openAddForm(key: string) {
    setAddAmount('')
    setAddDesc('')
    setAddDate(monthStart)
    setAddingFor(key)
  }

  function saveAdditional(sec: SectionDef) {
    const val = parseFloat(addAmount)
    if (isNaN(val) || val <= 0) { toast.error('Enter a valid amount'); return }
    if (!addDesc.trim()) { toast.error('Enter a description'); return }
    startTransition(async () => {
      const res = await addAdditionalExpense(sec.key, val, addDesc.trim(), addDate || monthStart)
      if (res?.error) { toast.error(res.error); return }
      setAddingFor(null)
      toast.success('Expense added')
    })
  }

  function removeExpense(expenseId: string) {
    startTransition(async () => {
      const res = await deleteBuildingExpense(expenseId)
      if (res?.error) { toast.error(res.error); return }
      toast.success('Deleted')
    })
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Building Costs</h1>
          <p className="text-sm text-slate-500 mt-0.5">Standard recurring and additional building expenses</p>
        </div>

        {/* Month picker */}
        <div className="flex items-center gap-1 bg-white border rounded-xl px-2 py-1.5 shadow-sm">
          <button
            onClick={() => setCurrentMonthDate(d => startOfMonth(subMonths(d, 1)))}
            className="p-1 rounded hover:bg-slate-100 text-slate-500"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="text-sm font-semibold text-slate-700 min-w-[76px] text-center select-none">
            {format(currentMonthDate, 'MMM yyyy')}
          </span>
          <button
            onClick={() => setCurrentMonthDate(d => startOfMonth(addMonths(d, 1)))}
            disabled={isCurrentMonth}
            className="p-1 rounded hover:bg-slate-100 text-slate-500 disabled:opacity-30 disabled:cursor-default"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>

      {SECTIONS.map(sec => {
        const { key, label, Icon, iconColor, accent, isFixed } = sec
        const baseAmount = getBaseAmount(sec)
        const additionals = getAdditionals(sec)
        const addTotal = additionals.reduce((s, e) => s + e.amount, 0)
        const sectionTotal = (baseAmount ?? 0) + addTotal
        const isEditingBase = editingBase === key
        const isAddingHere = addingFor === key

        return (
          <div key={key} className="bg-white rounded-xl border shadow-sm overflow-hidden">
            {/* Card header */}
            <div className={`flex items-center justify-between px-4 py-3 border-b ${accent}`}>
              <div className="flex items-center gap-2">
                <Icon className={`h-4 w-4 ${iconColor}`} />
                <h2 className="font-semibold text-slate-800 text-sm">{label}</h2>
              </div>
              {sectionTotal > 0 && (
                <span className="text-sm font-bold text-red-600">${sectionTotal.toFixed(2)}</span>
              )}
            </div>

            {/* Base monthly amount */}
            <div className="px-4 py-3 border-b">
              <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide mb-1.5">
                {isFixed ? 'Monthly rate — fixed every month' : `Monthly bill — ${format(currentMonthDate, 'MMM yyyy')}`}
              </p>

              {isEditingBase ? (
                <div className="flex items-center gap-2">
                  <span className="text-sm text-slate-500">$</span>
                  <input
                    type="number" min="0" step="0.01"
                    value={baseInput}
                    onChange={e => setBaseInput(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') saveBase(sec)
                      if (e.key === 'Escape') setEditingBase(null)
                    }}
                    className="w-32 text-sm border rounded-lg px-2 py-1 focus:outline-none focus:ring-2 focus:ring-slate-300"
                    autoFocus
                  />
                  {isFixed && <span className="text-xs text-slate-400">/mo</span>}
                  <button onClick={() => saveBase(sec)} disabled={pending}
                    className="p-1 text-green-600 hover:text-green-700 disabled:opacity-50">
                    <Check className="h-4 w-4" />
                  </button>
                  <button onClick={() => setEditingBase(null)}
                    className="p-1 text-slate-400 hover:text-slate-600">
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <span className={`text-xl font-bold ${baseAmount != null ? 'text-slate-800' : 'text-slate-300'}`}>
                    {baseAmount != null
                      ? `$${baseAmount.toFixed(2)}${isFixed ? '/mo' : ''}`
                      : 'Not set'}
                  </span>
                  <button onClick={() => startEditBase(sec)}
                    className="p-1 text-slate-300 hover:text-slate-600 transition-colors">
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                </div>
              )}
            </div>

            {/* Additional expenses */}
            <div className="px-4 py-3">
              <div className="flex items-center justify-between mb-2">
                <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide">
                  Additional expenses
                </p>
                {addTotal > 0 && (
                  <span className="text-xs font-semibold text-slate-500">${addTotal.toFixed(2)}</span>
                )}
              </div>

              {/* List */}
              {additionals.length > 0 && (
                <div className="space-y-0.5 mb-3">
                  {additionals.map(exp => (
                    <div key={exp.id}
                      className="flex items-center gap-2 py-1.5 px-2 -mx-2 rounded-lg group hover:bg-slate-50">
                      <div className="flex-1 min-w-0">
                        <span className="text-sm text-slate-700">{exp.description}</span>
                        <span className="text-xs text-slate-400 ml-2">
                          {format(new Date(exp.expense_date + 'T12:00:00'), 'MMM d')}
                        </span>
                      </div>
                      <span className="text-sm font-semibold text-red-600 shrink-0">
                        ${exp.amount.toFixed(2)}
                      </span>
                      <button
                        onClick={() => removeExpense(exp.id)}
                        disabled={pending}
                        className="p-1 text-slate-200 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity disabled:opacity-30"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {additionals.length === 0 && !isAddingHere && (
                <p className="text-xs text-slate-300 mb-2">No additional expenses</p>
              )}

              {/* Inline add form */}
              {isAddingHere ? (
                <div className="mt-1 p-3 bg-slate-50 rounded-xl border border-slate-200 space-y-2">
                  <div className="flex gap-2">
                    <div className="flex items-center gap-1 shrink-0">
                      <span className="text-sm text-slate-400">$</span>
                      <input
                        type="number" min="0.01" step="0.01" placeholder="0.00"
                        value={addAmount}
                        onChange={e => setAddAmount(e.target.value)}
                        className="w-24 text-sm border rounded-lg px-2 py-1 focus:outline-none focus:ring-2 focus:ring-slate-300"
                        autoFocus
                      />
                    </div>
                    <input
                      type="text" placeholder="Description"
                      value={addDesc}
                      onChange={e => setAddDesc(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && saveAdditional(sec)}
                      className="flex-1 text-sm border rounded-lg px-2 py-1 focus:outline-none focus:ring-2 focus:ring-slate-300"
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="date"
                      value={addDate}
                      min={monthStart} max={monthEnd}
                      onChange={e => setAddDate(e.target.value)}
                      className="text-sm border rounded-lg px-2 py-1 focus:outline-none focus:ring-2 focus:ring-slate-300"
                    />
                    <button
                      onClick={() => saveAdditional(sec)}
                      disabled={pending}
                      className="px-3 py-1 bg-slate-800 text-white text-sm rounded-lg hover:bg-slate-700 disabled:opacity-50 transition-colors"
                    >
                      Add
                    </button>
                    <button
                      onClick={() => setAddingFor(null)}
                      className="px-3 py-1 border text-sm rounded-lg text-slate-500 hover:bg-slate-50 transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  onClick={() => openAddForm(key)}
                  className="flex items-center gap-1.5 text-xs font-medium text-slate-400 hover:text-slate-700 transition-colors mt-1 py-1"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Add expense
                </button>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
