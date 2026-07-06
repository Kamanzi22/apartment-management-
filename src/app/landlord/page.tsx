import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import Link from 'next/link'
import { currentPeriodMonth } from '@/lib/rent-utils'
import { CheckCircle2, Clock, AlertCircle, Wrench, Users, MessageSquare } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { demoUnits, demoCurrentPayments, demoMaintenanceRequests } from '@/lib/demo-data'

export default async function LandlordOverviewPage() {
  if (process.env.NEXT_PUBLIC_DEMO_MODE === 'true') {
    const paymentMap = new Map(demoCurrentPayments.map(p => [p.tenant_id, p.status]))
    const maintenanceCountMap = new Map<string, number>()
    for (const m of demoMaintenanceRequests.filter(r => r.status !== 'resolved')) {
      maintenanceCountMap.set(m.unit_id, (maintenanceCountMap.get(m.unit_id) ?? 0) + 1)
    }
    const units = demoUnits
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Overview</h1>
          <p className="text-sm text-slate-500 mt-1">{new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}</p>
        </div>
        <div>
          <h2 className="text-base font-semibold text-slate-800 mb-3">Units</h2>
          <div className="grid sm:grid-cols-2 gap-3">
            {units.map(unit => {
              const activeLease = (unit.leases as { id: string; status: string; monthly_rent: number; tenant_id: string; rent_due_day?: number }[]).find(l => l.status === 'active')
              const tenant = (unit.profiles as { id: string; full_name: string }[])[0]
              const payStatus = activeLease?.tenant_id ? paymentMap.get(activeLease.tenant_id) : undefined
              const openMaint = maintenanceCountMap.get(unit.id) ?? 0
              const demoTodayDay = new Date().getDate()
              const demoDuePassed = demoTodayDay >= (activeLease?.rent_due_day ?? 1)
              return (
                <Link key={unit.id} href={`/landlord/units/${unit.id}`} className="block">
                  <Card className="shadow-sm hover:shadow-md transition-shadow cursor-pointer">
                    <CardContent className="pt-4 pb-4">
                      <div className="flex items-start justify-between">
                        <div>
                          <p className="font-semibold text-slate-900">{unit.label}</p>
                          <p className="text-xs text-slate-500">{unit.bedroom_count}BR · ${unit.monthly_rent.toFixed(0)}/mo</p>
                        </div>
                        <RentStatusBadge status={payStatus} isOccupied={unit.status === 'occupied' && !!tenant} rentDuePassed={demoDuePassed} />
                      </div>
                      <div className="mt-3 flex items-center justify-between">
                        <div className="flex items-center gap-1.5 text-slate-600">
                          <Users className="h-3.5 w-3.5" />
                          <span className="text-xs">{tenant?.full_name ?? 'Vacant'}</span>
                        </div>
                        {openMaint > 0 && (
                          <div className="flex items-center gap-1 text-xs text-orange-600">
                            <Wrench className="h-3.5 w-3.5" />{openMaint} open
                          </div>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                </Link>
              )
            })}
          </div>
        </div>
      </div>
    )
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const period = currentPeriodMonth()

  const { data: units } = await supabase
    .from('units')
    .select(`
      *,
      profiles!profiles_unit_id_fkey(id, full_name),
      leases!leases_unit_id_fkey(id, status, monthly_rent, tenant_id, rent_due_day)
    `)
    .order('label')

  const { data: payments } = await supabase
    .from('payments')
    .select('tenant_id, status, period_month')
    .eq('period_month', period)

  const [{ data: maintenanceAll }, { data: unreadMessages }] = await Promise.all([
    supabase.from('maintenance_requests').select('unit_id, status').neq('status', 'resolved'),
    supabase.from('messages').select('sender_id').eq('recipient_id', user.id).is('read_at', null),
  ])

  const paymentMap = new Map(payments?.map(p => [p.tenant_id, p.status]) ?? [])
  const maintenanceCountMap = new Map<string, number>()
  for (const m of maintenanceAll ?? []) {
    maintenanceCountMap.set(m.unit_id, (maintenanceCountMap.get(m.unit_id) ?? 0) + 1)
  }
  const unreadSenders = new Set(unreadMessages?.map(m => m.sender_id) ?? [])

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Overview</h1>
        <p className="text-sm text-slate-500 mt-1">
          {new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
        </p>
      </div>

      {/* Units grid */}
      <div>
        <h2 className="text-base font-semibold text-slate-800 mb-3">Units</h2>
        <div className="grid sm:grid-cols-2 gap-3">
          {units?.map(unit => {
            const activeLease = (unit.leases as { id: string; status: string; monthly_rent: number; tenant_id: string; rent_due_day: number }[] | null)
              ?.find(l => l.status === 'active')
            const tenant = (unit.profiles as { id: string; full_name: string }[] | null)?.[0]
            const payStatus = activeLease?.tenant_id ? paymentMap.get(activeLease.tenant_id) : undefined
            const openMaint = maintenanceCountMap.get(unit.id) ?? 0
            const todayDay = new Date().getDate()
            const rentDuePassed = todayDay >= (activeLease?.rent_due_day ?? 1)
            const hasUnreadMsg = tenant?.id ? unreadSenders.has(tenant.id) : false

            return (
              <Link key={unit.id} href={`/landlord/units/${unit.id}`} className="block">
                <Card className="shadow-sm hover:shadow-md transition-shadow cursor-pointer">
                  <CardContent className="pt-4 pb-4">
                    <div className="flex items-start justify-between">
                      <div>
                        <p className="font-semibold text-slate-900">{unit.label}</p>
                        <p className="text-xs text-slate-500">{unit.bedroom_count}BR · ${unit.monthly_rent.toFixed(0)}/mo</p>
                      </div>
                      <RentStatusBadge status={payStatus} isOccupied={unit.status === 'occupied' && !!tenant} rentDuePassed={rentDuePassed} />
                    </div>
                    <div className="mt-3 flex items-center justify-between">
                      <div className="flex items-center gap-1.5 text-slate-600">
                        <Users className="h-3.5 w-3.5" />
                        <span className="text-xs">{tenant?.full_name ?? 'Vacant'}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        {openMaint > 0 && (
                          <div className="flex items-center gap-1 text-xs text-orange-600">
                            <Wrench className="h-3.5 w-3.5" />
                            {openMaint} open
                          </div>
                        )}
                        {hasUnreadMsg && (
                          <div className="flex items-center gap-1 text-xs text-blue-600">
                            <MessageSquare className="h-3.5 w-3.5" />msg
                          </div>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            )
          })}
        </div>
      </div>

    </div>
  )
}

function RentStatusBadge({ status, isOccupied, rentDuePassed }: { status?: string; isOccupied: boolean; rentDuePassed: boolean }) {
  if (!isOccupied) return <Badge variant="secondary" className="text-xs">Vacant</Badge>
  if (status === 'confirmed') return <Badge className="bg-green-100 text-green-800 text-xs border-0"><CheckCircle2 className="h-3 w-3 mr-1" />Paid</Badge>
  if (status === 'pending_review') return <Badge className="bg-amber-100 text-amber-800 text-xs border-0"><Clock className="h-3 w-3 mr-1" />Pending</Badge>
  if (!rentDuePassed) return <Badge variant="secondary" className="text-xs">Not due yet</Badge>
  return <Badge className="bg-red-100 text-red-800 text-xs border-0"><AlertCircle className="h-3 w-3 mr-1" />Unpaid</Badge>
}
