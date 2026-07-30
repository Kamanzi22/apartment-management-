import { redirect } from 'next/navigation'
import { createClient, getAuthedUser } from '@/lib/supabase/server'
import { MoveOutForm } from './move-out-form'

export default async function TenantMoveOutPage() {
  const user = await getAuthedUser()
  if (!user) redirect('/login')

  const supabase = await createClient()

  const [{ data: lease }, { data: notices }] = await Promise.all([
    supabase.from('leases').select('id').eq('tenant_id', user.id).eq('status', 'active').single(),
    supabase.from('move_out_notices').select('*').eq('tenant_id', user.id)
      .order('created_at', { ascending: false }),
  ])

  const latestNotice = notices?.[0]

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Move-out Notice</h1>
        <p className="text-sm text-slate-500 mt-1">
          Give your landlord advance notice of your intent to move out
        </p>
      </div>

      {latestNotice ? (
        <div className={`rounded-xl border p-5 ${
          latestNotice.status === 'acknowledged'
            ? 'bg-green-50 border-green-200'
            : 'bg-amber-50 border-amber-200'
        }`}>
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold text-slate-800">Your Move-out Notice</h2>
            <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
              latestNotice.status === 'acknowledged'
                ? 'bg-green-100 text-green-700'
                : 'bg-amber-100 text-amber-700'
            }`}>
              {latestNotice.status === 'acknowledged' ? 'Acknowledged' : 'Awaiting acknowledgment'}
            </span>
          </div>
          <div className="space-y-1 text-sm text-slate-700">
            <p><span className="text-slate-500">Intended move-out date:</span> {new Date(latestNotice.intended_move_out_date).toLocaleDateString('en-US', { dateStyle: 'long' })}</p>
            {latestNotice.reason && (
              <p><span className="text-slate-500">Reason:</span> {latestNotice.reason}</p>
            )}
            <p><span className="text-slate-500">Submitted:</span> {new Date(latestNotice.created_at).toLocaleDateString()}</p>
          </div>
        </div>
      ) : (
        lease && <MoveOutForm />
      )}

      {!lease && !latestNotice && (
        <p className="text-slate-500">No active lease found.</p>
      )}
    </div>
  )
}
