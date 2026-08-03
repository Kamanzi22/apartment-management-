import { redirect } from 'next/navigation'
import { createClient, getVerifiedUserId } from '@/lib/supabase/server'
import { MaintenanceForm } from './maintenance-form'
import { Wrench } from 'lucide-react'

const statusLabels: Record<string, { label: string; cls: string }> = {
  submitted: { label: 'Submitted', cls: 'bg-slate-100 text-slate-700' },
  acknowledged: { label: 'Acknowledged', cls: 'bg-blue-100 text-blue-700' },
  in_progress: { label: 'In progress', cls: 'bg-amber-100 text-amber-700' },
  resolved: { label: 'Resolved', cls: 'bg-green-100 text-green-700' },
}

const urgencyColors: Record<string, string> = {
  low: 'text-slate-500',
  medium: 'text-amber-600',
  high: 'text-red-600',
}

export default async function TenantMaintenancePage() {
  const userId = await getVerifiedUserId()
  if (!userId) redirect('/login')

  const supabase = await createClient()

  const { data: requests } = await supabase
    .from('maintenance_requests')
    .select('*')
    .eq('tenant_id', userId)
    .order('created_at', { ascending: false })

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Maintenance</h1>
        <p className="text-sm text-slate-500 mt-1">Submit repair requests to your landlord</p>
      </div>

      <MaintenanceForm />

      {requests && requests.length > 0 && (
        <div>
          <h2 className="text-base font-semibold text-slate-800 mb-3">Your Requests</h2>
          <div className="rounded-xl border bg-white divide-y shadow-sm">
            {requests.map(r => (
              <div key={r.id} className="p-4 space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Wrench className="h-4 w-4 text-slate-400" />
                    <span className="font-medium text-sm text-slate-900 capitalize">{r.category}</span>
                    <span className={`text-xs font-medium capitalize ${urgencyColors[r.urgency]}`}>
                      · {r.urgency}
                    </span>
                  </div>
                  <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${statusLabels[r.status]?.cls}`}>
                    {statusLabels[r.status]?.label ?? r.status}
                  </span>
                </div>
                <p className="text-sm text-slate-600 pl-6">{r.description}</p>
                {r.landlord_comment && (
                  <p className="text-xs text-slate-500 pl-6 italic">Landlord: {r.landlord_comment}</p>
                )}
                {r.photo_urls?.length > 0 && (
                  <div className="pl-6 flex gap-2 flex-wrap mt-1">
                    {r.photo_urls.map((url: string, i: number) => (
                      <a key={i} href={url} target="_blank" rel="noopener noreferrer">
                        <img src={url} alt="" className="h-12 w-12 rounded object-cover border" />
                      </a>
                    ))}
                  </div>
                )}
                <p className="text-xs text-slate-400 pl-6">
                  {new Date(r.created_at).toLocaleDateString()}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
