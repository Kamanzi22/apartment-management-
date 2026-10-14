'use client'

import { useState } from 'react'
import { replaceTenant } from '@/app/actions/admin'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { UserCog, AlertTriangle } from 'lucide-react'
import { toast } from 'sonner'

interface Props {
  unitId: string
  unitLabel: string
  monthlyRent: number
  outgoingTenantId: string
  outgoingTenantName: string
  outgoingLeaseId: string
}

export function ReplaceTenantDialog({
  unitId, unitLabel, monthlyRent,
  outgoingTenantId, outgoingTenantName, outgoingLeaseId,
}: Props) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [moveOutDate, setMoveOutDate] = useState(() => new Date().toISOString().split('T')[0])

  async function handleSubmit(e: React.SyntheticEvent<HTMLFormElement>) {
    e.preventDefault()
    setLoading(true)
    const fd = new FormData(e.currentTarget)
    fd.set('unit_id', unitId)
    const result = await replaceTenant(
      { tenantId: outgoingTenantId, leaseId: outgoingLeaseId, unitId, moveOutDate },
      fd,
    )
    setLoading(false)
    if ('error' in result) {
      toast.error(result.error)
    } else {
      toast.success('Tenant replaced')
      setOpen(false)
    }
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-700 transition-colors border border-slate-200 rounded-md px-2 py-1 hover:border-slate-400 hover:bg-slate-50"
        title="End this tenancy and move a new tenant in"
      >
        <UserCog className="h-3 w-3" />
        Replace
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Replace Tenant — {unitLabel}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4 pt-2">
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm text-amber-800 space-y-1">
              <p className="flex items-center gap-1.5 font-medium">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                Ends {outgoingTenantName}&rsquo;s tenancy
              </p>
              <p className="text-xs text-amber-700">
                Their login is disabled and the unit is vacated before the new tenant moves in.
                All of their history (payments, maintenance, messages) is kept.
              </p>
            </div>

            <div className="space-y-1.5">
              <Label>Move-out date (outgoing tenant) *</Label>
              <input
                type="date"
                value={moveOutDate}
                onChange={e => setMoveOutDate(e.target.value)}
                max={new Date().toISOString().split('T')[0]}
                className="w-full border rounded-lg px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-500"
              />
            </div>

            <div className="border-t pt-3 space-y-3">
              <p className="text-sm font-semibold text-slate-700">New Tenant</p>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5 col-span-2">
                  <Label>Full name *</Label>
                  <Input name="full_name" placeholder="Jane Doe" required />
                </div>
                <div className="space-y-1.5 col-span-2">
                  <Label>Email *</Label>
                  <Input name="email" type="email" placeholder="jane@example.com" required />
                  <p className="text-xs text-slate-400">The tenant will use &quot;Forgot Password&quot; to set their own password.</p>
                </div>
                <div className="space-y-1.5 col-span-2">
                  <Label>Phone</Label>
                  <Input name="phone" type="tel" placeholder="+250 780 000 000" />
                </div>
                <div className="space-y-1.5">
                  <Label>Move-in date *</Label>
                  <Input name="move_in_date" type="date" required />
                  <p className="text-xs text-slate-400">Rent due day = move-in day</p>
                </div>
                <div className="space-y-1.5">
                  <Label>Lease end date</Label>
                  <Input name="lease_end" type="date" />
                  <p className="text-xs text-slate-400">Leave blank for M2M</p>
                </div>
                <div className="space-y-1.5">
                  <Label>Monthly rent (RWF) *</Label>
                  <Input
                    name="monthly_rent"
                    type="text"
                    inputMode="decimal"
                    placeholder="e.g. 1,000,000"
                    defaultValue={monthlyRent}
                    required
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Security deposit (RWF)</Label>
                  <Input name="deposit_amount" type="text" inputMode="decimal" placeholder="e.g. 500,000" defaultValue="0" />
                </div>
              </div>
            </div>

            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? 'Replacing…' : 'End Tenancy & Move In New Tenant'}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}
