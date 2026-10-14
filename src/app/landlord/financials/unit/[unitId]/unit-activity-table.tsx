'use client'

import { useState, useTransition } from 'react'
import { format } from 'date-fns'
import { formatRWF, parseAmountInput } from '@/lib/currency'
import { EXPENSE_CATEGORIES, categoryLabel, type ExpenseCategory } from '@/lib/categories'
import { updatePaymentRecord, deletePaymentRecord } from '@/app/actions/payments'
import { updateExpense, deleteExpense } from '@/app/actions/expenses'
import { Pencil, Trash2, ArrowDownCircle, ArrowUpCircle } from 'lucide-react'
import { toast } from 'sonner'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export interface ActivityRow {
  id: string
  kind: 'in' | 'out'
  date: string
  amount: number
  // income rows
  periodMonth?: string
  tenantName?: string
  status?: string
  // expense rows
  category?: string
  description?: string
}

const statusStyles: Record<string, string> = {
  confirmed: 'bg-green-100 text-green-700',
  pending_review: 'bg-amber-100 text-amber-700',
  rejected: 'bg-red-100 text-red-700',
}

const statusLabels: Record<string, string> = {
  confirmed: 'Confirmed',
  pending_review: 'Pending',
  rejected: 'Rejected',
}

export function UnitActivityTable({ rows, totalIn, totalOut }: { rows: ActivityRow[]; totalIn: number; totalOut: number }) {
  const [editRow, setEditRow] = useState<ActivityRow | null>(null)
  const [pending, startTransition] = useTransition()

  function handleDelete(row: ActivityRow) {
    if (!confirm(`Delete this ${row.kind === 'in' ? 'payment' : 'expense'} entry? This cannot be undone.`)) return
    startTransition(async () => {
      const result = row.kind === 'in' ? await deletePaymentRecord(row.id) : await deleteExpense(row.id)
      if (result?.error) toast.error(result.error)
      else toast.success('Deleted')
    })
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-white rounded-xl border shadow-sm p-3">
          <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide">Total In</p>
          <p className="text-lg font-bold text-green-600 mt-0.5">{formatRWF(totalIn)}</p>
        </div>
        <div className="bg-white rounded-xl border shadow-sm p-3">
          <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide">Total Out</p>
          <p className="text-lg font-bold text-red-500 mt-0.5">{formatRWF(totalOut)}</p>
        </div>
        <div className="bg-white rounded-xl border shadow-sm p-3">
          <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide">Net</p>
          <p className={`text-lg font-bold mt-0.5 ${totalIn - totalOut >= 0 ? 'text-blue-700' : 'text-red-600'}`}>
            {formatRWF(totalIn - totalOut)}
          </p>
        </div>
      </div>

      <div className="bg-white rounded-xl border shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-slate-50 text-left">
                <th className="px-4 py-2.5 text-xs font-semibold text-slate-500">Date</th>
                <th className="px-4 py-2.5 text-xs font-semibold text-slate-500">Type</th>
                <th className="px-4 py-2.5 text-xs font-semibold text-slate-500">Details</th>
                <th className="px-4 py-2.5 text-xs font-semibold text-slate-500 text-right">Amount</th>
                <th className="px-4 py-2.5 text-xs font-semibold text-slate-500 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.length === 0 && (
                <tr><td colSpan={5} className="px-4 py-8 text-center text-slate-400">No activity recorded for this unit yet</td></tr>
              )}
              {rows.map(row => (
                <tr key={`${row.kind}-${row.id}`} className="hover:bg-slate-50">
                  <td className="px-4 py-2.5 text-slate-600 whitespace-nowrap">
                    {format(new Date(row.date), 'MMM d, yyyy')}
                  </td>
                  <td className="px-4 py-2.5">
                    {row.kind === 'in'
                      ? <span className="inline-flex items-center gap-1 text-xs font-medium text-green-700"><ArrowDownCircle className="h-3.5 w-3.5" />Money In</span>
                      : <span className="inline-flex items-center gap-1 text-xs font-medium text-red-600"><ArrowUpCircle className="h-3.5 w-3.5" />Money Out</span>
                    }
                  </td>
                  <td className="px-4 py-2.5 text-slate-700">
                    {row.kind === 'in' ? (
                      <div className="flex items-center gap-2 flex-wrap">
                        <span>{row.tenantName} · {row.periodMonth}</span>
                        {row.status && (
                          <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${statusStyles[row.status] ?? 'bg-slate-100 text-slate-600'}`}>
                            {statusLabels[row.status] ?? row.status}
                          </span>
                        )}
                      </div>
                    ) : (
                      <div>
                        <span>{categoryLabel(row.category ?? 'other', EXPENSE_CATEGORIES)}</span>
                        {row.description && <span className="text-slate-400"> · {row.description}</span>}
                      </div>
                    )}
                  </td>
                  <td className={`px-4 py-2.5 text-right font-semibold whitespace-nowrap ${row.kind === 'in' ? 'text-green-600' : 'text-red-500'}`}>
                    {formatRWF(row.amount)}
                  </td>
                  <td className="px-4 py-2.5 text-right whitespace-nowrap">
                    <button onClick={() => setEditRow(row)} className="p-1 text-slate-300 hover:text-slate-600 transition-colors" title="Edit">
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button onClick={() => handleDelete(row)} disabled={pending} className="p-1 text-slate-300 hover:text-red-500 transition-colors disabled:opacity-30" title="Delete / reset">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {editRow && <EditRowDialog row={editRow} onClose={() => setEditRow(null)} />}
    </div>
  )
}

function EditRowDialog({ row, onClose }: { row: ActivityRow; onClose: () => void }) {
  const [loading, setLoading] = useState(false)
  const [amount, setAmount] = useState(String(row.amount))
  const [date, setDate] = useState(row.kind === 'in' ? (row.periodMonth ?? '') : row.date.slice(0, 10))
  const [description, setDescription] = useState(row.description ?? '')
  const [category, setCategory] = useState<ExpenseCategory>((row.category as ExpenseCategory) ?? 'other')

  async function handleSave() {
    setLoading(true)
    const parsedAmount = parseAmountInput(amount)
    const result = row.kind === 'in'
      ? await updatePaymentRecord(row.id, { amount: parsedAmount, periodMonth: date })
      : await updateExpense(row.id, { category, amount: parsedAmount, expenseDate: date, description })
    setLoading(false)
    if (result?.error) {
      toast.error(result.error)
    } else {
      toast.success('Saved')
      onClose()
    }
  }

  return (
    <Dialog open onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Edit {row.kind === 'in' ? 'Payment' : 'Expense'}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 pt-2">
          <div className="space-y-1.5">
            <Label>Amount (RWF) *</Label>
            <Input value={amount} onChange={e => setAmount(e.target.value)} inputMode="decimal" placeholder="e.g. 50,000" />
          </div>

          {row.kind === 'in' ? (
            <div className="space-y-1.5">
              <Label>Period (YYYY-MM) *</Label>
              <Input value={date} onChange={e => setDate(e.target.value)} placeholder="2026-08" />
            </div>
          ) : (
            <>
              <div className="space-y-1.5">
                <Label>Date *</Label>
                <Input type="date" value={date} onChange={e => setDate(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Category *</Label>
                <select
                  value={category}
                  onChange={e => setCategory(e.target.value as ExpenseCategory)}
                  className="w-full text-sm border rounded-lg px-3 py-2 bg-white text-slate-700"
                >
                  {EXPENSE_CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label>Description *</Label>
                <Input value={description} onChange={e => setDescription(e.target.value)} />
              </div>
            </>
          )}

          <div className="flex gap-2 pt-1">
            <Button variant="outline" className="flex-1" onClick={onClose} disabled={loading}>Cancel</Button>
            <Button className="flex-1" onClick={handleSave} disabled={loading}>{loading ? 'Saving…' : 'Save'}</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
