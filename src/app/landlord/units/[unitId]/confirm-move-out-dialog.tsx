'use client'

import { useState } from 'react'
import { confirmTenantMoveOut } from '@/app/actions/admin'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { LogOut, AlertTriangle } from 'lucide-react'
import { toast } from 'sonner'

interface Props {
  tenantId: string
  tenantName: string
  unitId: string
  unitLabel: string
  leaseId: string
}

export function ConfirmMoveOutDialog({ tenantId, tenantName, unitId, unitLabel, leaseId }: Props) {
  const [open, setOpen] = useState(false)
  const [moveOutDate, setMoveOutDate] = useState(() => new Date().toISOString().split('T')[0])
  const [loading, setLoading] = useState(false)

  async function handleConfirm() {
    setLoading(true)
    const result = await confirmTenantMoveOut(tenantId, unitId, leaseId, moveOutDate)
    setLoading(false)
    if (result?.error) {
      toast.error(result.error)
    } else {
      toast.success(`${tenantName} moved out. Unit ${unitLabel} is now vacant.`)
      setOpen(false)
    }
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 text-xs text-red-500 hover:text-red-700 transition-colors border border-red-200 rounded-md px-2 py-1 hover:border-red-400 hover:bg-red-50"
        title="Confirm tenant has moved out"
      >
        <LogOut className="h-3 w-3" />
        Move Out
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-500" />
              Confirm Move-Out
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 pt-1">
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm text-amber-800 space-y-1">
              <p className="font-medium">{tenantName} · Unit {unitLabel}</p>
              <p>This will:</p>
              <ul className="list-disc list-inside text-xs space-y-0.5 text-amber-700">
                <li>End the active lease</li>
                <li>Mark the unit as vacant</li>
                <li>Disable the tenant's portal login</li>
                <li>All history (payments, maintenance, messages) is kept</li>
              </ul>
            </div>

            <div className="space-y-1.5">
              <Label>Move-out date</Label>
              <input
                type="date"
                value={moveOutDate}
                onChange={e => setMoveOutDate(e.target.value)}
                max={new Date().toISOString().split('T')[0]}
                className="w-full border rounded-lg px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-500"
              />
            </div>

            <div className="flex gap-2 pt-1">
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => setOpen(false)}
                disabled={loading}
              >
                Cancel
              </Button>
              <Button
                className="flex-1 bg-red-600 hover:bg-red-700 text-white"
                onClick={handleConfirm}
                disabled={loading}
              >
                {loading ? 'Processing…' : 'Confirm Move-Out'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
