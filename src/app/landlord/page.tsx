import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import Link from 'next/link'
import { format, subMonths, startOfMonth } from 'date-fns'
import { currentPeriodMonth, formatPeriodMonth } from '@/lib/rent-utils'
import {
  CheckCircle2, Clock, AlertCircle, Wrench, Users, MessageSquare,
  X, DollarSign, TrendingDown, Hammer,
} from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { demoUnits, demoCurrentPayments, demoMaintenanceRequests } from '@/lib/demo-data'
import { EXPENSE_CATEGORIES, categoryLabel } from '@/lib/categories'

const SENTINEL_LABELS: Record<string, string> = {
  '__monthly_cleaning__': 'Cleaning (Monthly)',
  '__electricity_bill__': 'Electricity Bill',
  '__water_bill__':       'Water Bill',
}

export default async function LandlordOverviewPage({
  searchParams,
}: {
  searchParams: Promise<{ unit?: string }>
}) {
  const { unit: selectedUnitId } = await searchParams

  if (process.env.NEXT_PUBLIC_DEMO_MODE === 'true') {
    const paymentMap = new Map(demoCurrentPayments.map(p => [p.tenant_id, p.status]))
    const maintenanceCountMap = new Map<string, number>()
    for (const m of demoMaintenanceRequests.filter(r => r.status !== 'resolved')) {
      maintenanceCountMap.set(m.unit_id, (maintenanceCountMap.get(m.unit_id) ?? 0) + 1)
    }
    return (
      <OverviewShell
        units={demoUnits.map(u => ({
          id: u.id, label: u.label, bedroom_count: u.bedroom_count, monthly_rent: u.monthly_rent,
          status: u.status,
          tenant: (u.profiles as { id: string; full_name: string }[])[0] ?? null,
          payStatus: ((u.leases as { tenant_id?: string }[])[0]?.tenant_id ? paymentMap.get((u.leases as any)[0].tenant_id) : undefined),
          openMaint: maintenanceCountMap.get(u.id) ?? 0,
          rentDuePassed: new Date().getDate() >= ((u.leases as any)[0]?.rent_due_day ?? 1),
          hasUnreadMsg: false,
        }))}
        selectedUnitId={selectedUnitId}
        unitDetail={null}
      />
    )
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const period = currentPeriodMonth()
  const chartStart = format(startOfMonth(subMonths(new Date(), 11)), 'yyyy-MM-dd')

  const [
    { data: unitsRaw },
    { data: payments },
    { data: maintenanceAll },
    { data: unreadMessages },
  ] = await Promise.all([
    supabase.from('units').select(`
      id, label, bedroom_count, monthly_rent, status,
      profiles!profiles_unit_id_fkey(id, full_name),
      leases!leases_unit_id_fkey(id, status, monthly_rent, tenant_id, rent_due_day)
    `).order('label'),
    supabase.from('payments').select('tenant_id, status, period_month').eq('period_month', period),
    supabase.from('maintenance_requests').select('unit_id, status').neq('status', 'resolved'),
    supabase.from('messages').select('sender_id').eq('recipient_id', user.id).is('read_at', null),
  ])

  const paymentMap = new Map(payments?.map(p => [p.tenant_id, p.status]) ?? [])
  const maintenanceCountMap = new Map<string, number>()
  for (const m of maintenanceAll ?? []) {
    maintenanceCountMap.set(m.unit_id, (maintenanceCountMap.get(m.unit_id) ?? 0) + 1)
  }
  const unreadSenders = new Set(unreadMessages?.map(m => m.sender_id) ?? [])

  type UnitCard = {
    id: string; label: string; bedroom_count: number; monthly_rent: number; status: string
    tenant: { id: string; full_name: string } | null
    payStatus: string | undefined
    openMaint: number; rentDuePassed: boolean; hasUnreadMsg: boolean
  }

  const units: UnitCard[] = (unitsRaw ?? []).map(unit => {
    const activeLease = (unit.leases as any[])?.find((l: any) => l.status === 'active')
    const tenant = (unit.profiles as any[])?.[0] ?? null
    return {
      id: unit.id, label: unit.label, bedroom_count: unit.bedroom_count,
      monthly_rent: unit.monthly_rent, status: unit.status, tenant,
      payStatus: activeLease?.tenant_id ? paymentMap.get(activeLease.tenant_id) : undefined,
      openMaint: maintenanceCountMap.get(unit.id) ?? 0,
      rentDuePassed: new Date().getDate() >= (activeLease?.rent_due_day ?? 1),
      hasUnreadMsg: tenant?.id ? unreadSenders.has(tenant.id) : false,
    }
  })

  // ── Unit detail data (when ?unit= is set) ─────────────────────────────
  let unitDetail: UnitDetail | null = null

  if (selectedUnitId) {
    const selectedUnit = units.find(u => u.id === selectedUnitId)
    if (selectedUnit) {
      const unitRaw = (unitsRaw ?? []).find(u => u.id === selectedUnitId)
      const activeLease = (unitRaw?.leases as any[])?.find((l: any) => l.status === 'active') ?? null
      const tenantId = selectedUnit.tenant?.id ?? null

      const [
        { data: unitPayments },
        { data: unitExpenses },
        { data: unitMaintenance },
        { data: pastLeases },
      ] = await Promise.all([
        tenantId
          ? supabase.from('payments')
              .select('id, period_month, amount, status, submitted_at, tenant_id, profiles!payments_tenant_id_fkey(full_name)')
              .eq('tenant_id', tenantId)
              .gte('submitted_at', chartStart)
              .order('period_month', { ascending: false })
              .limit(24)
          : Promise.resolve({ data: [] }),
        supabase.from('expenses')
          .select('id, category, amount, expense_date, description')
          .eq('unit_id', selectedUnitId)
          .gte('expense_date', chartStart)
          .order('expense_date', { ascending: false }),
        supabase.from('maintenance_requests')
          .select('id, category, description, status, urgency, created_at, profiles!maintenance_requests_tenant_id_fkey(full_name)')
          .eq('unit_id', selectedUnitId)
          .order('created_at', { ascending: false })
          .limit(20),
        // past tenants for context
        supabase.from('leases')
          .select('id, status, monthly_rent, move_in_date, profiles!leases_tenant_id_fkey(full_name)')
          .eq('unit_id', selectedUnitId)
          .order('move_in_date', { ascending: false })
          .limit(10),
      ])

      unitDetail = {
        unit: selectedUnit,
        activeLease,
        payments: (unitPayments ?? []) as any[],
        expenses: (unitExpenses ?? []) as any[],
        maintenance: (unitMaintenance ?? []) as any[],
        leaseHistory: (pastLeases ?? []) as any[],
      }
    }
  }

  return (
    <OverviewShell
      units={units}
      selectedUnitId={selectedUnitId}
      unitDetail={unitDetail}
    />
  )
}

// ── Types ──────────────────────────────────────────────────────────────────
interface UnitDetail {
  unit: { id: string; label: string; monthly_rent: number; status: string; tenant: { id: string; full_name: string } | null }
  activeLease: { monthly_rent: number; move_in_date: string; rent_due_day: number } | null
  payments: Array<{ id: string; period_month: string; amount: number; status: string; submitted_at: string; profiles: { full_name: string } | null }>
  expenses: Array<{ id: string; category: string; amount: number; expense_date: string; description: string }>
  maintenance: Array<{ id: string; category: string; description: string; status: string; urgency: string; created_at: string; profiles: { full_name: string } | null }>
  leaseHistory: Array<{ id: string; status: string; monthly_rent: number; move_in_date: string; profiles: { full_name: string } | null }>
}

// ── Server-side rendered shell ─────────────────────────────────────────────
function OverviewShell({
  units, selectedUnitId, unitDetail,
}: {
  units: Array<{ id: string; label: string; bedroom_count: number; monthly_rent: number; status: string; tenant: { id: string; full_name: string } | null; payStatus?: string; openMaint: number; rentDuePassed: boolean; hasUnreadMsg: boolean }>
  selectedUnitId?: string
  unitDetail: UnitDetail | null
}) {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Overview</h1>
        <p className="text-sm text-slate-500 mt-1">{new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}</p>
      </div>

      <div>
        <h2 className="text-base font-semibold text-slate-800 mb-3">Units</h2>
        <div className="grid sm:grid-cols-2 gap-3">
          {units.map(unit => (
            <Link key={unit.id} href={`/landlord?unit=${unit.id}`} className="block">
              <Card className={cn('shadow-sm hover:shadow-md transition-shadow cursor-pointer', selectedUnitId === unit.id && 'ring-2 ring-slate-400')}>
                <CardContent className="pt-4 pb-4">
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="font-semibold text-slate-900">{unit.label}</p>
                      <p className="text-xs text-slate-500">{unit.bedroom_count}BR · ${unit.monthly_rent.toFixed(0)}/mo</p>
                    </div>
                    <RentStatusBadge status={unit.payStatus} isOccupied={unit.status === 'occupied' && !!unit.tenant} rentDuePassed={unit.rentDuePassed} />
                  </div>
                  <div className="mt-3 flex items-center justify-between">
                    <div className="flex items-center gap-1.5 text-slate-600">
                      <Users className="h-3.5 w-3.5" />
                      <span className="text-xs">{unit.tenant?.full_name ?? 'Vacant'}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      {unit.openMaint > 0 && (
                        <div className="flex items-center gap-1 text-xs text-orange-600">
                          <Wrench className="h-3.5 w-3.5" />{unit.openMaint} open
                        </div>
                      )}
                      {unit.hasUnreadMsg && (
                        <div className="flex items-center gap-1 text-xs text-blue-600">
                          <MessageSquare className="h-3.5 w-3.5" />msg
                        </div>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      </div>

      {/* Unit detail slide-over (server-rendered) */}
      {unitDetail && (
        <div className="fixed inset-0 z-50">
          <Link href="/landlord" className="absolute inset-0 bg-black/40" aria-label="Close" />
          <div className="absolute right-0 top-0 h-full w-full max-w-sm bg-white shadow-2xl flex flex-col">
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b shrink-0">
              <div>
                <p className="font-bold text-slate-900 text-lg">{unitDetail.unit.label}</p>
                <p className="text-sm text-slate-500">
                  {unitDetail.unit.tenant?.full_name ?? 'Vacant'}
                  {unitDetail.activeLease && ` · $${unitDetail.activeLease.monthly_rent.toFixed(0)}/mo`}
                </p>
              </div>
              <Link href="/landlord" className="p-1.5 rounded-lg hover:bg-slate-100">
                <X className="h-4 w-4 text-slate-500" />
              </Link>
            </div>

            <div className="flex-1 overflow-y-auto divide-y">
              {/* Rent Payments */}
              <div className="px-5 py-4">
                <div className="flex items-center gap-2 mb-3">
                  <DollarSign className="h-3.5 w-3.5 text-green-500" />
                  <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Rent Payments</p>
                </div>
                {unitDetail.payments.length === 0 ? (
                  <p className="text-sm text-slate-400">No payment records</p>
                ) : (
                  <div className="space-y-2">
                    {unitDetail.payments.map(p => (
                      <div key={p.id} className="flex items-center justify-between py-1.5 border-b last:border-0">
                        <div>
                          <div className="flex items-center gap-2">
                            <p className="text-sm font-medium text-slate-700">{formatPeriodMonth(p.period_month)}</p>
                            {p.profiles?.full_name && (
                              <span className="text-xs text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded-full">{p.profiles.full_name}</span>
                            )}
                          </div>
                          <p className="text-xs text-slate-400 mt-0.5">
                            {p.status === 'confirmed' ? 'Confirmed' : 'Pending review'} · {format(new Date(p.submitted_at), 'MMM d, yyyy')}
                          </p>
                        </div>
                        <span className={cn('text-sm font-semibold shrink-0 ml-2', p.status === 'confirmed' ? 'text-green-600' : 'text-amber-500')}>
                          ${p.amount.toFixed(2)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Expenses */}
              <div className="px-5 py-4">
                <div className="flex items-center gap-2 mb-3">
                  <TrendingDown className="h-3.5 w-3.5 text-red-400" />
                  <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Expenses</p>
                </div>
                {unitDetail.expenses.length === 0 ? (
                  <p className="text-sm text-slate-400">No recorded expenses</p>
                ) : (
                  <div className="space-y-2">
                    {unitDetail.expenses.map(e => (
                      <div key={e.id} className="flex items-center justify-between py-1.5 border-b last:border-0">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-slate-700">
                            {SENTINEL_LABELS[e.description] ?? categoryLabel(e.category, EXPENSE_CATEGORIES)}
                          </p>
                          {e.description && !SENTINEL_LABELS[e.description] && (
                            <p className="text-xs text-slate-400 line-clamp-1">{e.description}</p>
                          )}
                          <p className="text-xs text-slate-300">{format(new Date(e.expense_date), 'MMM d, yyyy')}</p>
                        </div>
                        <span className="text-sm font-semibold text-red-500 shrink-0 ml-2">${e.amount.toFixed(2)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Maintenance */}
              <div className="px-5 py-4">
                <div className="flex items-center gap-2 mb-3">
                  <Hammer className="h-3.5 w-3.5 text-orange-400" />
                  <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Maintenance</p>
                </div>
                {unitDetail.maintenance.length === 0 ? (
                  <p className="text-sm text-slate-400">No maintenance requests</p>
                ) : (
                  <div className="space-y-2">
                    {unitDetail.maintenance.map(m => (
                      <div key={m.id} className="py-1.5 border-b last:border-0">
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-slate-700 line-clamp-1">{m.description}</p>
                            <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                              {m.profiles?.full_name && (
                                <span className="text-xs text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded-full">{m.profiles.full_name}</span>
                              )}
                              <span className="text-xs text-slate-300">{format(new Date(m.created_at), 'MMM d, yyyy')}</span>
                            </div>
                          </div>
                          <span className={cn('text-[10px] font-semibold px-1.5 py-0.5 rounded-full shrink-0',
                            m.status === 'resolved' ? 'bg-green-100 text-green-700' :
                            m.status === 'in_progress' ? 'bg-blue-100 text-blue-700' :
                            'bg-amber-100 text-amber-700'
                          )}>
                            {m.status.replace('_', ' ')}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Tenant history */}
              {unitDetail.leaseHistory.length > 0 && (
                <div className="px-5 py-4">
                  <div className="flex items-center gap-2 mb-3">
                    <Users className="h-3.5 w-3.5 text-slate-400" />
                    <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Tenant History</p>
                  </div>
                  <div className="space-y-2">
                    {unitDetail.leaseHistory.map(l => (
                      <div key={l.id} className="flex items-center justify-between py-1 border-b last:border-0">
                        <div>
                          <p className="text-sm font-medium text-slate-700">{(l.profiles as any)?.full_name ?? 'Unknown'}</p>
                          <p className="text-xs text-slate-400">From {format(new Date(l.move_in_date), 'MMM yyyy')} · ${l.monthly_rent}/mo</p>
                        </div>
                        <span className={cn('text-[10px] px-1.5 py-0.5 rounded-full font-semibold',
                          l.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'
                        )}>
                          {l.status}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
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
