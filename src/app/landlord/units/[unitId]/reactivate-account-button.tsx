'use client'

import { useTransition } from 'react'
import { RotateCcw } from 'lucide-react'
import { toast } from 'sonner'
import { reactivateTenantAccount } from '@/app/actions/admin'

/** Re-opens a tenant account closed from the phone app (their data was never removed). */
export function ReactivateAccountButton({ tenantId, tenantName }: { tenantId: string; tenantName: string }) {
  const [pending, startTransition] = useTransition()

  function handleClick() {
    if (!window.confirm(`Reactivate ${tenantName}'s account? They will be able to sign in again.`)) return
    startTransition(async () => {
      const result = await reactivateTenantAccount(tenantId)
      if ('error' in result) toast.error(result.error)
      else toast.success(`${tenantName} can sign in again.`)
    })
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={pending}
      className="inline-flex items-center gap-1.5 min-h-9 text-xs text-slate-500 hover:text-slate-800 border border-slate-200 rounded-md px-2 py-1 hover:bg-slate-50 disabled:opacity-60"
    >
      <RotateCcw className="h-3 w-3" /> {pending ? 'Reactivating…' : 'Reactivate account'}
    </button>
  )
}
