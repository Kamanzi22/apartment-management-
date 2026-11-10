'use client'

import { useTransition } from 'react'
import Link from 'next/link'
import { format, parseISO } from 'date-fns'
import { CalendarClock, CheckCircle2 } from 'lucide-react'
import { toast } from 'sonner'
import { acknowledgeMoveOut } from '@/app/actions/move-out'
import { ConfirmMoveOutDialog } from './units/[unitId]/confirm-move-out-dialog'

export interface MoveOutNotice {
  id: string
  lease_id: string
  tenant_id: string
  tenant_name: string
  unit_id: string
  unit_label: string
  intended_move_out_date: string
  reason: string | null
  status: 'submitted' | 'acknowledged'
}

/** Open move-out notices: acknowledge them, or confirm the move-out (prefilled with the date). */
export function MoveOutNotices({ notices, showUnitLink = true }: { notices: MoveOutNotice[]; showUnitLink?: boolean }) {
  const [pending, startTransition] = useTransition()
  if (!notices.length) return null

  function acknowledge(id: string) {
    startTransition(async () => {
      const result = await acknowledgeMoveOut(id)
      if (result?.error) toast.error(result.error)
      else toast.success('Notice acknowledged. The tenant has been told.')
    })
  }

  return (
    <section className="glass p-5 md:p-6" aria-labelledby="move-out-title">
      <div className="flex items-center justify-between gap-3 mb-3">
        <h2 id="move-out-title" className="text-lg font-semibold flex items-center gap-2">
          <CalendarClock className="h-5 w-5" /> Move-out notices
        </h2>
        <span className="chip chip-warning">{notices.length} open</span>
      </div>
      <ul className="space-y-2">
        {notices.map(n => (
          <li key={n.id} className="glass-row px-4 py-3 flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-semibold">
                {n.tenant_name} ·{' '}
                {showUnitLink
                  ? <Link href={`/landlord/units/${n.unit_id}`} className="underline underline-offset-2">{n.unit_label}</Link>
                  : n.unit_label}
              </p>
              <p className="text-xs text-[var(--muted)] mt-0.5">
                Moving out {format(parseISO(n.intended_move_out_date), 'EEEE, MMMM d, yyyy')}
                {n.reason ? ` · ${n.reason}` : ''}
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {n.status === 'submitted' ? (
                <button
                  type="button"
                  onClick={() => acknowledge(n.id)}
                  disabled={pending}
                  className="inline-flex items-center gap-1.5 min-h-11 px-4 rounded-full text-xs font-semibold bg-white/90 border border-white hover:bg-white disabled:opacity-60"
                >
                  <CheckCircle2 className="h-3.5 w-3.5" /> Acknowledge
                </button>
              ) : (
                <span className="chip chip-success">Acknowledged</span>
              )}
              <ConfirmMoveOutDialog
                tenantId={n.tenant_id}
                tenantName={n.tenant_name}
                unitId={n.unit_id}
                unitLabel={n.unit_label}
                leaseId={n.lease_id}
                defaultDate={n.intended_move_out_date}
                label="Confirm move-out"
              />
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}
