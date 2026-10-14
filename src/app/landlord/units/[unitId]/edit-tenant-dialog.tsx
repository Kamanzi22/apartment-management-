'use client'

import { useState } from 'react'
import { updateTenantDetails } from '@/app/actions/admin'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Pencil } from 'lucide-react'
import { toast } from 'sonner'
import { parseAmountInput } from '@/lib/currency'

export interface EditableLease {
  id: string
  move_in_date: string
  lease_start: string
  lease_end: string | null
  rent_due_day: number
  monthly_rent: number
  deposit_amount: number
}

interface Props {
  tenantId: string
  currentName: string
  currentEmail: string | null
  currentPhone: string | null
  lease: EditableLease | null
  /** Show "Edit" text next to the pencil icon. */
  withLabel?: boolean
}

// One place to edit everything entered when the tenant was created:
// name, email, phone, and the active lease's dates and amounts.
export function EditTenantDialog({ tenantId, currentName, currentEmail, currentPhone, lease, withLabel }: Props) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.SyntheticEvent<HTMLFormElement>) {
    e.preventDefault()
    setLoading(true)
    const fd = new FormData(e.currentTarget)
    const moveInDate = (fd.get('move_in_date') as string | null) ?? ''
    const result = await updateTenantDetails(tenantId, lease?.id ?? null, {
      fullName:      (fd.get('full_name') as string).trim(),
      email:         ((fd.get('email') as string | null) ?? '').trim(),
      phone:         ((fd.get('phone') as string).trim()) || null,
      moveInDate,
      leaseStart:    (fd.get('lease_start') as string | null) || moveInDate,
      leaseEnd:      (fd.get('lease_end') as string | null) || null,
      rentDueDay:    parseInt((fd.get('rent_due_day') as string | null) ?? '1', 10),
      monthlyRent:   parseAmountInput(fd.get('monthly_rent') as string | null),
      depositAmount: parseAmountInput(fd.get('deposit_amount') as string | null),
    })
    setLoading(false)
    if (result?.error) {
      toast.error(result.error)
    } else {
      toast.success('Tenant details updated')
      setOpen(false)
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1 text-xs font-medium text-slate-400 hover:text-slate-700 transition-colors"
        title="Edit tenant details"
      >
        <Pencil className="h-3.5 w-3.5" />
        {withLabel && 'Edit'}
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit Tenant Details</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4 pt-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5 col-span-2">
                <Label>Full name *</Label>
                <Input name="full_name" defaultValue={currentName} required />
                <p className="text-xs text-slate-400">To change who lives here, use "Replace Tenant" instead.</p>
              </div>
              <div className="space-y-1.5 col-span-2">
                <Label>Email *</Label>
                <Input name="email" type="email" defaultValue={currentEmail ?? ''} required={!!currentEmail} />
                <p className="text-xs text-slate-400">This is also the tenant's login email.</p>
              </div>
              <div className="space-y-1.5 col-span-2">
                <Label>Phone</Label>
                <Input name="phone" type="tel" defaultValue={currentPhone ?? ''} placeholder="+250 7XX XXX XXX" />
              </div>
            </div>

            {lease && (
              <div className="border-t pt-3 space-y-3">
                <p className="text-sm font-semibold text-slate-700">Lease Details</p>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label>Move-in date *</Label>
                    <Input name="move_in_date" type="date" defaultValue={lease.move_in_date.slice(0, 10)} required />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Lease start *</Label>
                    <Input name="lease_start" type="date" defaultValue={lease.lease_start.slice(0, 10)} required />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Lease end</Label>
                    <Input name="lease_end" type="date" defaultValue={lease.lease_end?.slice(0, 10) ?? ''} />
                    <p className="text-xs text-slate-400">Blank = month-to-month</p>
                  </div>
                  <div className="space-y-1.5">
                    <Label>Rent due day *</Label>
                    <Input name="rent_due_day" type="number" min={1} max={31} defaultValue={lease.rent_due_day} required />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Monthly rent (RWF) *</Label>
                    <Input
                      name="monthly_rent"
                      type="text"
                      inputMode="decimal"
                      placeholder="e.g. 1,000,000"
                      defaultValue={lease.monthly_rent}
                      required
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Security deposit (RWF)</Label>
                    <Input
                      name="deposit_amount"
                      type="text"
                      inputMode="decimal"
                      placeholder="e.g. 500,000"
                      defaultValue={lease.deposit_amount}
                    />
                  </div>
                </div>
              </div>
            )}

            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? 'Saving…' : 'Save changes'}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}
