'use client'

import { useState, useTransition, useRef } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { createExpense } from '@/app/actions/expenses'
import { EXPENSE_CATEGORIES } from '@/lib/categories'
import { PlusCircle } from 'lucide-react'
import { toast } from 'sonner'
import { format } from 'date-fns'

interface Unit { id: string; label: string }
interface MR { id: string; category: string; description: string; unit_id: string; units?: { label: string } | null }

interface Props {
  units: Unit[]
  maintenanceRequests: MR[]
}

export function AddExpenseDialog({ units, maintenanceRequests }: Props) {
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()
  const formRef = useRef<HTMLFormElement>(null)

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    startTransition(async () => {
      const result = await createExpense(fd)
      if (result?.error) {
        toast.error(result.error)
      } else {
        toast.success('Expense added')
        setOpen(false)
        formRef.current?.reset()
      }
    })
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 text-sm font-medium px-3 py-2 bg-slate-900 text-white rounded-lg hover:bg-slate-700 transition-colors"
      >
        <PlusCircle className="h-4 w-4" />
        Add Expense
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Add Expense</DialogTitle>
          </DialogHeader>
          <form ref={formRef} onSubmit={handleSubmit} className="space-y-3">
            {/* Category */}
            <div className="space-y-1">
              <label className="text-sm font-medium text-slate-700">Category</label>
              <select name="category" required className="w-full text-sm border rounded-lg px-3 py-2 bg-white text-slate-700">
                {EXPENSE_CATEGORIES.map(c => (
                  <option key={c.value} value={c.value}>{c.label}</option>
                ))}
              </select>
            </div>

            {/* Amount */}
            <div className="space-y-1">
              <label className="text-sm font-medium text-slate-700">Amount (RWF)</label>
              <input
                name="amount"
                type="text"
                inputMode="decimal"
                required
                placeholder="e.g. 50,000"
                className="w-full text-sm border rounded-lg px-3 py-2 text-slate-700"
              />
            </div>

            {/* Date */}
            <div className="space-y-1">
              <label className="text-sm font-medium text-slate-700">Date</label>
              <input
                name="expense_date"
                type="date"
                required
                defaultValue={format(new Date(), 'yyyy-MM-dd')}
                className="w-full text-sm border rounded-lg px-3 py-2 text-slate-700"
              />
            </div>

            {/* Description */}
            <div className="space-y-1">
              <label className="text-sm font-medium text-slate-700">Description</label>
              <Textarea
                name="description"
                required
                placeholder="Brief description of the expense"
                className="resize-none h-20"
              />
            </div>

            {/* Unit (optional) */}
            <div className="space-y-1">
              <label className="text-sm font-medium text-slate-700">Unit (optional)</label>
              <select name="unit_id" className="w-full text-sm border rounded-lg px-3 py-2 bg-white text-slate-700">
                <option value="">Building-wide</option>
                {units.map(u => <option key={u.id} value={u.id}>{u.label}</option>)}
              </select>
            </div>

            {/* Link to maintenance request (optional) */}
            {maintenanceRequests.length > 0 && (
              <div className="space-y-1">
                <label className="text-sm font-medium text-slate-700">Linked maintenance request (optional)</label>
                <select name="linked_maintenance_request_id" className="w-full text-sm border rounded-lg px-3 py-2 bg-white text-slate-700">
                  <option value="">None</option>
                  {maintenanceRequests.map(mr => (
                    <option key={mr.id} value={mr.id}>
                      {mr.category} — {mr.description.slice(0, 50)}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Receipt */}
            <div className="space-y-1">
              <label className="text-sm font-medium text-slate-700">Receipt (optional)</label>
              <input
                name="receipt"
                type="file"
                accept="image/*,.pdf"
                className="w-full text-sm text-slate-600 file:mr-2 file:py-1 file:px-2 file:border-0 file:text-xs file:bg-slate-100 file:rounded file:cursor-pointer"
              />
            </div>

            <div className="flex gap-2 pt-1">
              <Button type="submit" disabled={pending}>
                {pending ? 'Saving…' : 'Add Expense'}
              </Button>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}
