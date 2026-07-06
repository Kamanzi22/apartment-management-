'use client'

import React, { useState, useTransition } from 'react'
import { ShieldCheck, Sparkles, Zap, Droplets, Pencil, Check, X } from 'lucide-react'
import { upsertSecurityRate, upsertMonthlyBill } from '@/app/actions/building-config'
import { toast } from 'sonner'
import { format } from 'date-fns'
import type { ExpenseWithUnit } from './page'

type BillKey = 'cleaning' | 'electricity_bill' | 'water_bill'

const BILL_ROWS: { key: BillKey; label: string; Icon: React.ElementType; color: string }[] = [
  { key: 'cleaning',        label: 'Cleaning',    Icon: Sparkles, color: 'text-purple-500' },
  { key: 'electricity_bill', label: 'Electricity', Icon: Zap,      color: 'text-yellow-500' },
  { key: 'water_bill',       label: 'Water',       Icon: Droplets, color: 'text-blue-500'   },
]

const BILL_DESCRIPTIONS: Record<BillKey, string> = {
  cleaning:        '__monthly_cleaning__',
  electricity_bill:'__electricity_bill__',
  water_bill:      '__water_bill__',
}

interface Props {
  securityMonthly: number
  currentMonth: string
  allExpenses: ExpenseWithUnit[]
}

export function BuildingCostsSection({ securityMonthly: initialSecurity, currentMonth, allExpenses }: Props) {
  const [securityRate, setSecurityRate] = useState(initialSecurity)
  const [editingSecurity, setEditingSecurity] = useState(false)
  const [securityInput, setSecurityInput] = useState(String(initialSecurity || ''))

  const [editingBill, setEditingBill] = useState<string | null>(null)
  const [billInput, setBillInput] = useState('')

  const [pending, startTransition] = useTransition()

  const monthLabel = format(new Date(currentMonth + '-02'), 'MMM yyyy')

  // Current month's amounts from expenses already loaded on the page
  const monthStart = `${currentMonth}-01`
  const [y, mo] = currentMonth.split('-').map(Number)
  const monthEnd = `${currentMonth}-${new Date(y, mo, 0).getDate()}`

  function getBillAmount(key: BillKey): number | null {
    const desc = BILL_DESCRIPTIONS[key]
    const entry = allExpenses.find(e =>
      !e.unit_id && e.description === desc &&
      e.expense_date >= monthStart && e.expense_date <= monthEnd
    )
    return entry ? entry.amount : null
  }

  function saveSecurityRate() {
    const val = parseFloat(securityInput)
    if (isNaN(val) || val < 0) { toast.error('Enter a valid amount'); return }
    startTransition(async () => {
      const res = await upsertSecurityRate(val)
      if (res?.error) { toast.error(res.error); return }
      setSecurityRate(val)
      setEditingSecurity(false)
      toast.success('Security rate saved')
    })
  }

  function startEditBill(key: BillKey) {
    const cur = getBillAmount(key)
    setBillInput(cur != null ? String(cur) : '')
    setEditingBill(key)
  }

  function saveBill(key: BillKey) {
    const val = parseFloat(billInput)
    if (isNaN(val) || val < 0) { toast.error('Enter a valid amount'); return }
    startTransition(async () => {
      const res = await upsertMonthlyBill(key, val, currentMonth)
      if (res?.error) { toast.error(res.error); return }
      setEditingBill(null)
      toast.success('Bill saved')
    })
  }

  return (
    <section className="bg-white rounded-xl border shadow-sm overflow-hidden">
      <div className="px-4 py-2.5 border-b bg-slate-50 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-slate-400" />
          <h2 className="font-semibold text-slate-700 text-sm">Standard Building Costs</h2>
        </div>
        <span className="text-xs text-slate-400">{monthLabel}</span>
      </div>

      <div className="divide-y">
        {/* Security — fixed monthly rate */}
        <div className="flex items-center px-4 py-3 gap-3">
          <ShieldCheck className="h-4 w-4 text-slate-400 shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-slate-800">Security</p>
            <p className="text-xs text-slate-400">Fixed every month</p>
          </div>
          {editingSecurity ? (
            <div className="flex items-center gap-1.5">
              <span className="text-sm text-slate-500">$</span>
              <input
                type="number" min="0" step="0.01"
                value={securityInput}
                onChange={e => setSecurityInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') saveSecurityRate(); if (e.key === 'Escape') setEditingSecurity(false) }}
                className="w-24 text-sm border rounded-lg px-2 py-1 text-slate-700 focus:outline-none focus:ring-2 focus:ring-slate-300"
                autoFocus
              />
              <button onClick={saveSecurityRate} disabled={pending} className="p-1 text-green-600 hover:text-green-700">
                <Check className="h-4 w-4" />
              </button>
              <button onClick={() => setEditingSecurity(false)} className="p-1 text-slate-400 hover:text-slate-600">
                <X className="h-4 w-4" />
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <span className={`text-sm font-semibold ${securityRate > 0 ? 'text-red-600' : 'text-slate-300'}`}>
                {securityRate > 0 ? `$${securityRate.toFixed(2)}/mo` : 'Not set'}
              </span>
              <button
                onClick={() => { setSecurityInput(String(securityRate || '')); setEditingSecurity(true) }}
                className="p-1 text-slate-400 hover:text-slate-600"
              >
                <Pencil className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
        </div>

        {/* Variable monthly bills */}
        {BILL_ROWS.map(({ key, label, Icon, color }) => {
          const amount = getBillAmount(key)
          return (
            <div key={key} className="flex items-center px-4 py-3 gap-3">
              <Icon className={`h-4 w-4 ${color} shrink-0`} />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-slate-800">{label}</p>
                <p className="text-xs text-slate-400">Changes monthly</p>
              </div>
              {editingBill === key ? (
                <div className="flex items-center gap-1.5">
                  <span className="text-sm text-slate-500">$</span>
                  <input
                    type="number" min="0" step="0.01"
                    value={billInput}
                    onChange={e => setBillInput(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') saveBill(key); if (e.key === 'Escape') setEditingBill(null) }}
                    className="w-24 text-sm border rounded-lg px-2 py-1 text-slate-700 focus:outline-none focus:ring-2 focus:ring-slate-300"
                    autoFocus
                  />
                  <button onClick={() => saveBill(key)} disabled={pending} className="p-1 text-green-600 hover:text-green-700">
                    <Check className="h-4 w-4" />
                  </button>
                  <button onClick={() => setEditingBill(null)} className="p-1 text-slate-400 hover:text-slate-600">
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <span className={`text-sm font-semibold ${amount != null ? 'text-red-600' : 'text-slate-300'}`}>
                    {amount != null ? `$${amount.toFixed(2)}` : '—'}
                  </span>
                  <button onClick={() => startEditBill(key)} className="p-1 text-slate-400 hover:text-slate-600">
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </section>
  )
}
