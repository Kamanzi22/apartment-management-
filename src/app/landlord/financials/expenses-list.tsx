'use client'

import { useState, useTransition } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { deleteExpense } from '@/app/actions/expenses'
import { EXPENSE_CATEGORIES, categoryLabel } from '@/lib/categories'
import { Receipt, Trash2, ExternalLink } from 'lucide-react'
import { toast } from 'sonner'
import type { ExpenseWithUnit } from './page'
import { formatRWF } from '@/lib/currency'

interface Unit { id: string; label: string }

export function ExpensesList({ expenses, units }: { expenses: ExpenseWithUnit[]; units: Unit[] }) {
  const [filterUnit, setFilterUnit] = useState('all')
  const [filterCategory, setFilterCategory] = useState('all')
  const [pending, startTransition] = useTransition()

  const filtered = expenses.filter(e => {
    if (filterUnit !== 'all' && e.unit_id !== filterUnit && !(filterUnit === 'building' && !e.unit_id)) return false
    if (filterCategory !== 'all' && e.category !== filterCategory) return false
    return true
  })

  function handleDelete(id: string) {
    if (!confirm('Delete this expense?')) return
    startTransition(async () => {
      const result = await deleteExpense(id)
      if (result?.error) toast.error(result.error)
      else toast.success('Expense deleted')
    })
  }

  return (
    <Card className="shadow-sm">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Expenses</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Filters */}
        <div className="flex flex-wrap gap-2">
          <select
            value={filterUnit}
            onChange={e => setFilterUnit(e.target.value)}
            className="text-sm border rounded-lg px-3 py-1.5 bg-white text-slate-700"
          >
            <option value="all">All units</option>
            <option value="building">Building-wide</option>
            {units.map(u => <option key={u.id} value={u.id}>{u.label}</option>)}
          </select>
          <select
            value={filterCategory}
            onChange={e => setFilterCategory(e.target.value)}
            className="text-sm border rounded-lg px-3 py-1.5 bg-white text-slate-700"
          >
            <option value="all">All categories</option>
            {EXPENSE_CATEGORIES.map(c => (
              <option key={c.value} value={c.value}>{c.label}</option>
            ))}
          </select>
        </div>

        {filtered.length === 0 ? (
          <div className="text-center py-10 text-slate-400">
            <Receipt className="h-7 w-7 mx-auto mb-2 opacity-40" />
            <p className="text-sm">No expenses in this range</p>
          </div>
        ) : (
          <div className="rounded-xl border divide-y overflow-hidden">
            {filtered.map(expense => (
              <div key={expense.id} className="flex items-center gap-3 px-4 py-3 hover:bg-slate-50">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-sm text-slate-800">
                      {categoryLabel(expense.category, EXPENSE_CATEGORIES)}
                    </span>
                    {expense.units?.label && (
                      <span className="text-xs bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded">
                        {expense.units.label}
                      </span>
                    )}
                    {!expense.unit_id && (
                      <span className="text-xs bg-blue-50 text-blue-500 px-1.5 py-0.5 rounded">Building</span>
                    )}
                  </div>
                  <p className="text-sm text-slate-500 mt-0.5 truncate">{expense.description}</p>
                  <p className="text-xs text-slate-400 mt-0.5">{expense.expense_date}</p>
                </div>
                <div className="text-right shrink-0">
                  <p className="font-semibold text-sm text-red-600">{formatRWF(expense.amount)}</p>
                  <div className="flex items-center gap-1 mt-1 justify-end">
                    {expense.receipt_file_url && (
                      <a
                        href={expense.receipt_file_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-slate-400 hover:text-slate-600 transition-colors"
                        title="View receipt"
                      >
                        <ExternalLink className="h-3.5 w-3.5" />
                      </a>
                    )}
                    <button
                      onClick={() => handleDelete(expense.id)}
                      disabled={pending}
                      className="text-slate-300 hover:text-red-500 transition-colors"
                      title="Delete expense"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
