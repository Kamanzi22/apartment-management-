'use client'

import { useState } from 'react'
import { updateLeaseInfo } from '@/app/actions/admin'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Pencil } from 'lucide-react'
import { toast } from 'sonner'
import { parseAmountInput } from '@/lib/currency'

interface Props {
  leaseId: string
  currentMoveIn: string
  currentLeaseStart: string
  currentLeaseEnd: string | null
  currentRentDueDay: number
  currentDeposit: number
}

export function EditLeaseDialog({
  leaseId,
  currentMoveIn,
  currentLeaseStart,
  currentLeaseEnd,
  currentRentDueDay,
  currentDeposit,
}: Props) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.SyntheticEvent<HTMLFormElement>) {
    e.preventDefault()
    setLoading(true)
    const fd = new FormData(e.currentTarget)
    const result = await updateLeaseInfo(leaseId, {
      moveInDate:    fd.get('move_in_date') as string,
      leaseStart:    fd.get('lease_start') as string,
      leaseEnd:      (fd.get('lease_end') as string) || null,
      rentDueDay:    parseInt(fd.get('rent_due_day') as string, 10),
      depositAmount: parseAmountInput(fd.get('deposit_amount') as string),
    })
    setLoading(false)
    if (result?.error) {
      toast.error(result.error)
    } else {
      toast.success('Lease updated')
      setOpen(false)
    }
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="text-slate-400 hover:text-slate-700 transition-colors"
        title="Edit lease details"
      >
        <Pencil className="h-3.5 w-3.5" />
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Edit Lease Details</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4 pt-2">
            <div className="space-y-1.5">
              <Label>Move-in date *</Label>
              <Input
                name="move_in_date"
                type="date"
                defaultValue={currentMoveIn.slice(0, 10)}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label>Lease start *</Label>
              <Input
                name="lease_start"
                type="date"
                defaultValue={currentLeaseStart.slice(0, 10)}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label>
                Lease end{' '}
                <span className="text-slate-400 font-normal">(leave blank for month-to-month)</span>
              </Label>
              <Input
                name="lease_end"
                type="date"
                defaultValue={currentLeaseEnd?.slice(0, 10) ?? ''}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Rent due day (1–28) *</Label>
              <Input
                name="rent_due_day"
                type="number"
                min={1}
                max={28}
                defaultValue={currentRentDueDay}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label>Security deposit (RWF) *</Label>
              <Input
                name="deposit_amount"
                type="text"
                inputMode="decimal"
                placeholder="e.g. 500,000"
                defaultValue={currentDeposit}
                required
              />
            </div>
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? 'Saving…' : 'Save changes'}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}
