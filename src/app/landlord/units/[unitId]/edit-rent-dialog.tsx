'use client'

import { useState } from 'react'
import { updateUnitRent } from '@/app/actions/admin'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Pencil } from 'lucide-react'
import { toast } from 'sonner'
import { parseAmountInput } from '@/lib/currency'
import { currentPeriodMonth } from '@/lib/rent-utils'

export function EditRentDialog({ unitId, currentRent }: { unitId: string; currentRent: number }) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.SyntheticEvent<HTMLFormElement>) {
    e.preventDefault()
    setLoading(true)
    const fd = new FormData(e.currentTarget)
    const newRent = parseAmountInput(fd.get('rent') as string)
    const effectiveMonth = (fd.get('effective_month') as string) || currentPeriodMonth()
    const result = await updateUnitRent(unitId, newRent, effectiveMonth)
    setLoading(false)
    if (result?.error) {
      toast.error(result.error)
    } else {
      toast.success('Rent updated')
      setOpen(false)
    }
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="h-9 w-9 inline-flex items-center justify-center rounded-full text-slate-400 hover:text-slate-700 transition-colors"
        title="Edit monthly rent"
        aria-label="Edit monthly rent"
      >
        <Pencil className="h-3.5 w-3.5" />
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-xs">
          <DialogHeader>
            <DialogTitle>Update Monthly Rent</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4 pt-2">
            <div className="space-y-1.5">
              <Label htmlFor={`rent-${unitId}`}>New monthly rent (RWF) *</Label>
              <Input
                id={`rent-${unitId}`}
                name="rent"
                type="text"
                inputMode="numeric"
                placeholder="e.g. 1,000,000"
                defaultValue={currentRent}
                required
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`effective-${unitId}`}>Effective from month *</Label>
              <Input
                id={`effective-${unitId}`}
                name="effective_month"
                type="month"
                defaultValue={currentPeriodMonth()}
                required
              />
              <p className="text-xs text-slate-400">
                Months before this keep the old rent, so past balances do not change.
              </p>
            </div>
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? 'Saving…' : 'Save'}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}
