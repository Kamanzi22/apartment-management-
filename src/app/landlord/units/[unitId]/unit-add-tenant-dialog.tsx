'use client'

import { useState } from 'react'
import { createTenantAccount } from '@/app/actions/admin'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { UserPlus } from 'lucide-react'
import { toast } from 'sonner'

interface Unit {
  id: string
  label: string
  monthly_rent: number
  status: string
}

export function UnitAddTenantDialog({ unit }: { unit: Unit }) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setLoading(true)
    const fd = new FormData(e.currentTarget)
    fd.set('unit_id', unit.id)

    const result = await createTenantAccount(fd)
    setLoading(false)

    if (result?.error) {
      toast.error(result.error)
    } else {
      toast.success('Tenant account created!')
      setOpen(false)
    }
  }

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        <UserPlus className="h-4 w-4 mr-2" />
        Add Tenant
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Add Tenant — {unit.label}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4 pt-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5 col-span-2">
                <Label>Full name *</Label>
                <Input name="full_name" placeholder="Jane Doe" required />
              </div>
              <div className="space-y-1.5 col-span-2">
                <Label>Email *</Label>
                <Input name="email" type="email" placeholder="jane@example.com" required />
                <p className="text-xs text-slate-400">The tenant will use "Forgot Password" to set their own password.</p>
              </div>
              <div className="space-y-1.5 col-span-2">
                <Label>Phone</Label>
                <Input name="phone" type="tel" placeholder="+1 555 000 0000" />
              </div>
            </div>

            <div className="border-t pt-3 space-y-3">
              <p className="text-sm font-semibold text-slate-700">Lease Details</p>
              <div className="grid grid-cols-2 gap-3">
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
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Monthly rent *</Label>
                  <Input
                    name="monthly_rent"
                    type="number"
                    step="0.01"
                    defaultValue={unit.monthly_rent}
                    required
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Security deposit</Label>
                  <Input name="deposit_amount" type="number" step="0.01" defaultValue="0" />
                </div>
              </div>
            </div>

            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? 'Creating…' : 'Create Tenant Account'}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}
