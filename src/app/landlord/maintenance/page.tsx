import { redirect } from 'next/navigation'
import { createClient, getAuthedUser } from '@/lib/supabase/server'
import { MaintenanceBoard } from './maintenance-board'
import { demoMaintenanceRequests } from '@/lib/demo-data'

export default async function LandlordMaintenancePage() {
  if (process.env.NEXT_PUBLIC_DEMO_MODE === 'true') {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Maintenance</h1>
          <p className="text-sm text-slate-500 mt-1">All repair requests across units</p>
        </div>
        <MaintenanceBoard requests={demoMaintenanceRequests as any} />
      </div>
    )
  }

  const user = await getAuthedUser()
  if (!user) redirect('/login')

  const supabase = await createClient()

  const { data: requests } = await supabase
    .from('maintenance_requests')
    .select(`
      *,
      profiles!maintenance_requests_tenant_id_fkey(full_name),
      units!maintenance_requests_unit_id_fkey(label)
    `)
    .order('created_at', { ascending: false })

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Maintenance</h1>
        <p className="text-sm text-slate-500 mt-1">All repair requests across units</p>
      </div>
      <MaintenanceBoard requests={requests ?? []} />
    </div>
  )
}
