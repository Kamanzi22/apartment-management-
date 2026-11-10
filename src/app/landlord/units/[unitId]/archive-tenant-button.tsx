'use client'

import { useTransition } from 'react'
import { Archive } from 'lucide-react'
import { toast } from 'sonner'
import { archiveTenant } from '@/app/actions/admin'

/** Disables a former tenant's login (their history is kept). */
export function ArchiveTenantButton({ tenantId, tenantName }: { tenantId: string; tenantName: string }) {
  const [pending, startTransition] = useTransition()

  function handleClick() {
    if (!window.confirm(`Archive ${tenantName}? Their login will be disabled. Payments, messages and repairs stay in the history.`)) return
    startTransition(async () => {
      const result = await archiveTenant(tenantId)
      if ('error' in result) toast.error(result.error)
      else toast.success(`${tenantName} archived. Their login is disabled.`)
    })
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={pending}
      className="inline-flex items-center gap-1.5 min-h-9 text-xs text-slate-500 hover:text-slate-800 border border-slate-200 rounded-md px-2 py-1 hover:bg-slate-50 disabled:opacity-60"
    >
      <Archive className="h-3 w-3" /> {pending ? 'Archiving…' : 'Archive tenant'}
    </button>
  )
}
