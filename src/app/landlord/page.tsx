import { redirect } from 'next/navigation'
import { createClient, createAdminClient, getVerifiedUserId } from '@/lib/supabase/server'
import Link from 'next/link'
import { format, parseISO, subMonths, startOfMonth } from 'date-fns'
import { currentPeriodMonth, formatPeriodMonth } from '@/lib/rent-utils'
import {
  CheckCircle2, Clock, AlertCircle, Wrench, Users, MessageSquare,
  X, DollarSign, TrendingDown, Hammer, Mail, Phone, History, CalendarDays,
  Megaphone, TrendingUp, Wallet, Home,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { demoUnits, demoCurrentPayments, demoMaintenanceRequests } from '@/lib/demo-data'
import { EXPENSE_CATEGORIES, categoryLabel } from '@/lib/categories'
import { UnitAddTenantDialog } from './units/[unitId]/unit-add-tenant-dialog'
import { EditRentDialog } from './units/[unitId]/edit-rent-dialog'
import { EditTenantDialog } from './units/[unitId]/edit-tenant-dialog'
import { formatRWF } from '@/lib/currency'
import { Greeting } from './greeting'

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
          unreadMsgCount: 0,
          rentDueDay: (u.leases as any)[0]?.rent_due_day ?? null,
        }))}
        stats={{
          income: demoCurrentPayments.filter(p => p.status === 'confirmed').reduce((s, p) => s + ((p as any).amount ?? 0), 0),
          expenses: 0,
          openRequests: demoMaintenanceRequests.filter(r => r.status !== 'resolved').length,
        }}
        selectedUnitId={selectedUnitId}
        unitDetail={null as any}
      />
    )
  }

  const userId = await getVerifiedUserId()
  if (!userId) redirect('/login')

  const supabase = await createClient()

  const period = currentPeriodMonth()
  const chartStart = format(startOfMonth(subMonths(new Date(), 11)), 'yyyy-MM-dd')

  const [
    { data: unitsRaw },
    { data: payments },
    { data: maintenanceAll },
    { data: unreadMessages },
    { data: monthExpenses },
  ] = await Promise.all([
    supabase.from('units').select(`
      id, label, bedroom_count, monthly_rent, status,
      profiles!profiles_unit_id_fkey(id, full_name, phone),
      leases!leases_unit_id_fkey(id, status, monthly_rent, tenant_id, rent_due_day, move_in_date, lease_start, lease_end, deposit_amount)
    `).order('label'),
    supabase.from('payments').select('tenant_id, status, period_month, amount').eq('period_month', period),
    supabase.from('maintenance_requests').select('unit_id, status').neq('status', 'resolved'),
    supabase.from('messages').select('sender_id').eq('recipient_id', userId).is('read_at', null),
    supabase.from('expenses').select('amount')
      .gte('expense_date', format(startOfMonth(new Date()), 'yyyy-MM-dd'))
      .lte('expense_date', format(new Date(), 'yyyy-MM-dd')),
  ])

  const paymentMap = new Map(payments?.map(p => [p.tenant_id, p.status]) ?? [])
  const maintenanceCountMap = new Map<string, number>()
  for (const m of maintenanceAll ?? []) {
    maintenanceCountMap.set(m.unit_id, (maintenanceCountMap.get(m.unit_id) ?? 0) + 1)
  }
  const unreadCountMap = new Map<string, number>()
  for (const m of unreadMessages ?? []) {
    unreadCountMap.set(m.sender_id, (unreadCountMap.get(m.sender_id) ?? 0) + 1)
  }

  type UnitCard = {
    id: string; label: string; bedroom_count: number; monthly_rent: number; status: string
    tenant: { id: string; full_name: string; phone: string | null } | null
    payStatus: string | undefined
    openMaint: number; rentDuePassed: boolean; unreadMsgCount: number
    rentDueDay: number | null
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
      unreadMsgCount: tenant?.id ? (unreadCountMap.get(tenant.id) ?? 0) : 0,
      rentDueDay: activeLease?.rent_due_day ?? null,
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

      const adminClient = await createAdminClient()

      const [
        { data: unitPayments },
        { data: unitExpenses },
        { data: unitMaintenance },
        { data: pastLeases },
        tenantAuthData,
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
        supabase.from('leases')
          .select('id, status, monthly_rent, move_in_date, lease_start, lease_end, profiles!leases_tenant_id_fkey(full_name)')
          .eq('unit_id', selectedUnitId)
          .order('move_in_date', { ascending: false })
          .limit(10),
        tenantId
          ? adminClient.auth.admin.getUserById(tenantId)
          : Promise.resolve({ data: { user: null } }),
      ])

      unitDetail = {
        unit: selectedUnit,
        tenantEmail: (tenantAuthData as any)?.data?.user?.email ?? null,
        tenantPhone: selectedUnit.tenant?.phone ?? null,
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
      stats={{
        income: (payments ?? []).filter(p => p.status === 'confirmed').reduce((s, p) => s + Number(p.amount ?? 0), 0),
        expenses: (monthExpenses ?? []).reduce((s, e) => s + Number(e.amount ?? 0), 0),
        openRequests: maintenanceAll?.length ?? 0,
      }}
      selectedUnitId={selectedUnitId}
      unitDetail={unitDetail}
    />
  )
}

// ── Types ──────────────────────────────────────────────────────────────────
interface UnitDetail {
  unit: { id: string; label: string; monthly_rent: number; status: string; tenant: { id: string; full_name: string } | null }
  tenantEmail: string | null
  tenantPhone: string | null
  activeLease: {
    id: string; monthly_rent: number; move_in_date: string; rent_due_day: number
    lease_start: string; lease_end: string | null; deposit_amount: number
  } | null
  payments: Array<{ id: string; period_month: string; amount: number; status: string; submitted_at: string; profiles: { full_name: string } | null }>
  expenses: Array<{ id: string; category: string; amount: number; expense_date: string; description: string }>
  maintenance: Array<{ id: string; category: string; description: string; status: string; urgency: string; created_at: string; profiles: { full_name: string } | null }>
  leaseHistory: Array<{ id: string; status: string; monthly_rent: number; move_in_date: string; lease_start: string; lease_end: string | null; profiles: { full_name: string } | null }>
}

type OverviewUnit = {
  id: string; label: string; bedroom_count: number; monthly_rent: number; status: string
  tenant: { id: string; full_name: string } | null
  payStatus?: string; openMaint: number; rentDuePassed: boolean; unreadMsgCount: number
  rentDueDay: number | null
}

function ordinal(n: number) {
  const s = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0])
}

function listNames(parts: string[]) {
  if (parts.length <= 1) return parts.join('')
  return parts.slice(0, -1).join(', ') + ' and ' + parts[parts.length - 1]
}

function OccupancyRing({ percent }: { percent: number }) {
  const r = 34
  const c = 2 * Math.PI * r
  return (
    <div className="relative h-24 w-24 shrink-0" role="img" aria-label={`${percent}% occupied`}>
      <svg viewBox="0 0 80 80" className="h-full w-full -rotate-90">
        <circle cx="40" cy="40" r={r} fill="none" stroke="rgba(255,255,255,0.18)" strokeWidth="7" />
        <circle
          cx="40" cy="40" r={r} fill="none" stroke="var(--metal)" strokeWidth="7" strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={c * (1 - percent / 100)}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center leading-none">
        <span className="text-xl font-semibold">{percent}%</span>
        <span className="text-[10px] uppercase tracking-wider mt-1 opacity-90">occupied</span>
      </div>
    </div>
  )
}

// ── Server-side rendered shell ─────────────────────────────────────────────
function OverviewShell({
  units, stats, selectedUnitId, unitDetail,
}: {
  units: OverviewUnit[]
  stats: { income: number; expenses: number; openRequests: number }
  selectedUnitId?: string
  unitDetail: UnitDetail | null
}) {
  const today = new Date()
  const todayDay = today.getDate()
  const occupiedUnits = units.filter(u => u.status === 'occupied' && !!u.tenant)
  const occupancy = units.length ? Math.round((occupiedUnits.length / units.length) * 100) : 0
  const dueUnits = occupiedUnits.filter(u => u.payStatus !== 'confirmed')
  const dueDays = new Set(occupiedUnits.map(u => u.rentDueDay).filter((d): d is number => d != null))
  const profit = stats.income - stats.expenses

  const dueSentence = dueUnits.length
    ? listNames(dueUnits.map(u => `${u.tenant!.full_name.split(' ')[0]}${u.rentDueDay ? ` on the ${ordinal(u.rentDueDay)}` : ''}`)) + '.'
    : 'Everyone has paid this month. All clear.'

  // 7-day strip: the current week, Sunday to Saturday
  const weekStart = new Date(today.getFullYear(), today.getMonth(), todayDay - today.getDay())
  const week = Array.from({ length: 7 }, (_, i) => new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() + i))

  const upcoming = occupiedUnits
    .filter(u => u.rentDueDay != null)
    .map(u => {
      const late = u.payStatus !== 'confirmed' && u.payStatus !== 'pending_review' && u.rentDuePassed
      const nextMonth = u.payStatus === 'confirmed' && u.rentDuePassed
      const date = new Date(today.getFullYear(), today.getMonth() + (nextMonth ? 1 : 0), u.rentDueDay!)
      return { u, date, late }
    })
    .sort((a, b) => a.date.getTime() - b.date.getTime())

  const statCards = [
    { label: 'Income', value: formatRWF(stats.income), hint: 'Confirmed this month', icon: TrendingUp },
    { label: 'Expenses', value: formatRWF(stats.expenses), hint: 'Recorded this month', icon: TrendingDown },
    { label: 'Profit', value: formatRWF(profit), hint: 'Income minus expenses', icon: Wallet },
    { label: 'Occupancy', value: `${occupiedUnits.length}/${units.length}`, hint: `${occupancy}% of units`, icon: Home },
    { label: 'Open requests', value: String(stats.openRequests), hint: 'Maintenance', icon: Wrench },
  ]

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <Greeting />
        <div className="flex items-center gap-2">
          <span className="glass rounded-full! px-4 min-h-11 inline-flex items-center gap-2 text-sm font-semibold">
            <CalendarDays className="h-4 w-4" />
            {format(today, 'MMMM yyyy')}
          </span>
          <Link href="/landlord/messages" className="btn-primary">
            <Megaphone className="h-4 w-4" /> Broadcast all
          </Link>
        </div>
      </div>

      {/* Hero + calendar */}
      <div className="grid gap-4 lg:grid-cols-[1.35fr_1fr]">
        <section className="hero-card p-6 md:p-7 flex flex-col justify-between gap-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-[var(--metal)]">This month</p>
              <h2 className="text-2xl md:text-[28px] font-semibold leading-tight mt-1">
                Rent is <span className="accent-word text-[1.15em]">due</span> from {dueUnits.length} {dueUnits.length === 1 ? 'tenant' : 'tenants'} this month
              </h2>
              <p className="text-sm text-white/90 mt-3 max-w-md">{dueSentence}</p>
            </div>
            <OccupancyRing percent={occupancy} />
          </div>
          <div className="flex flex-wrap gap-2">
            <Link href="/landlord/rent" className="btn-hero">Review rent</Link>
            <Link href="/landlord/messages" className="btn-ghost-light">Send reminder</Link>
          </div>
        </section>

        <section className="glass p-5 md:p-6" aria-label="Rent calendar">
          <div className="flex items-end justify-between">
            <div>
              <p className="text-5xl font-semibold leading-none tracking-tight">{todayDay}</p>
              <p className="text-sm text-[var(--muted)] mt-1">{format(today, 'EEEE, MMMM')}</p>
            </div>
            <span className="chip chip-neutral">{upcoming.length} due dates</span>
          </div>
          <div className="grid grid-cols-7 gap-1.5 mt-4">
            {week.map(d => {
              const isToday = d.toDateString() === today.toDateString()
              const isDue = d.getMonth() === today.getMonth() && dueDays.has(d.getDate())
              return (
                <div
                  key={d.toISOString()}
                  className={cn(
                    'flex flex-col items-center rounded-2xl py-2 text-xs',
                    isToday ? 'bg-[var(--ink)] text-[var(--on-dark)]'
                      : isDue ? 'bg-[var(--accent)] text-white'
                      : 'bg-white/55 text-[var(--muted-2)]'
                  )}
                >
                  <span className="opacity-90">{format(d, 'EEEEE')}</span>
                  <span className="text-sm font-semibold mt-0.5">{d.getDate()}</span>
                </div>
              )
            })}
          </div>
          <ul className="mt-4 space-y-2">
            {upcoming.length === 0 && (
              <li className="empty-state py-4"><CalendarDays className="h-5 w-5" />No rent dates set</li>
            )}
            {upcoming.slice(0, 4).map(({ u, date, late }) => (
              <li key={u.id} className="glass-row flex items-center justify-between gap-2 px-3 py-2.5">
                <div className="min-w-0">
                  <p className="text-sm font-semibold truncate">{u.tenant!.full_name}</p>
                  <p className="text-xs text-[var(--muted)]">{u.label} · {format(date, 'MMM d')}</p>
                </div>
                {u.payStatus === 'confirmed' ? <span className="chip chip-success">Paid</span>
                  : u.payStatus === 'pending_review' ? <span className="chip chip-warning">Pending</span>
                  : late ? <span className="chip chip-danger">Late</span>
                  : <span className="chip chip-neutral">Upcoming</span>}
              </li>
            ))}
          </ul>
        </section>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3">
        {statCards.map(({ label, value, hint, icon: Icon }) => (
          <div key={label} className="glass lift p-4">
            <div className="flex items-center justify-between text-[var(--muted)]">
              <p className="text-xs font-semibold uppercase tracking-wide">{label}</p>
              <Icon className="h-4 w-4" />
            </div>
            <p className="text-xl font-semibold mt-2 truncate">{value}</p>
            <p className="text-xs text-[var(--muted)] mt-0.5">{hint}</p>
          </div>
        ))}
      </div>

      {/* Units */}
      <section className="glass p-5 md:p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">Units</h2>
          <span className="chip chip-neutral">{units.length} units</span>
        </div>
        {units.length === 0 ? (
          <div className="empty-state"><Home className="h-5 w-5" />No units yet</div>
        ) : (
          <div className="grid sm:grid-cols-2 gap-3">
            {units.map(unit => (
              <div
                key={unit.id}
                data-selected={selectedUnitId === unit.id}
                className={cn('glass-row lift rounded-[20px]! overflow-hidden', selectedUnitId === unit.id && 'ring-2 ring-[var(--accent)]')}
              >
                <Link href={`/landlord?unit=${unit.id}`} className="block p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-semibold">{unit.label}</p>
                      <p className="text-xs text-[var(--muted)]">{unit.bedroom_count}BR · {formatRWF(unit.monthly_rent)}/mo</p>
                    </div>
                    <RentStatusBadge status={unit.payStatus} isOccupied={unit.status === 'occupied' && !!unit.tenant} rentDuePassed={unit.rentDuePassed} />
                  </div>
                  <div className="mt-4 flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className={cn('h-9 w-9 shrink-0 rounded-full flex items-center justify-center text-sm font-semibold',
                        unit.tenant ? 'bg-[var(--accent)] text-white' : 'bg-white/75 text-[var(--muted-2)]')} aria-hidden>
                        {unit.tenant ? unit.tenant.full_name.trim()[0]?.toUpperCase() : <Users className="h-4 w-4" />}
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">{unit.tenant?.full_name ?? 'Vacant'}</p>
                        {unit.tenant && unit.rentDueDay && (
                          <p className="text-xs text-[var(--muted)]">Rent due on the {ordinal(unit.rentDueDay)}</p>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      {unit.openMaint > 0 && (
                        <span className="chip chip-warning"><Wrench className="h-3 w-3" />{unit.openMaint} open</span>
                      )}
                      {unit.unreadMsgCount > 0 && (
                        <span className="chip chip-neutral" aria-label={`${unit.unreadMsgCount} unread messages`}>
                          <MessageSquare className="h-3 w-3" />{unit.unreadMsgCount}
                        </span>
                      )}
                    </div>
                  </div>
                </Link>
                <div className="border-t border-white/70 px-4 flex justify-end">
                  <Link
                    href={`/landlord/units/${unit.id}/history`}
                    className="inline-flex items-center gap-1 min-h-11 text-xs font-semibold text-[var(--muted-2)] hover:text-[var(--ink)]"
                  >
                    <History className="h-3.5 w-3.5" /> Unit history
                  </Link>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Unit detail slide-over (server-rendered) */}
      {unitDetail && (
        <div className="fixed inset-0 z-50">
          <Link href="/landlord" className="absolute inset-0 bg-[rgba(10,20,30,0.35)] backdrop-blur-[2px]" aria-label="Close" />
          <div className="absolute right-0 top-0 h-full w-full max-w-sm bg-[rgba(244,248,250,0.88)] backdrop-blur-2xl border-l border-white/70 shadow-2xl flex flex-col">
            {/* Header */}
            <div className="flex items-start justify-between px-5 py-4 border-b shrink-0">
              <div className="space-y-0.5 flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="font-bold text-slate-900 text-lg">{unitDetail.unit.label}</p>
                  <EditRentDialog unitId={unitDetail.unit.id} currentRent={unitDetail.unit.monthly_rent} />
                </div>
                {unitDetail.unit.tenant ? (
                  <>
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium text-slate-700">
                        {unitDetail.unit.tenant.full_name}
                        {unitDetail.activeLease && <span className="font-normal text-slate-500"> · {formatRWF(unitDetail.activeLease.monthly_rent)}/mo</span>}
                      </p>
                      <EditTenantDialog
                        tenantId={unitDetail.unit.tenant.id}
                        currentName={unitDetail.unit.tenant.full_name}
                        currentEmail={unitDetail.tenantEmail}
                        currentPhone={unitDetail.tenantPhone}
                        lease={unitDetail.activeLease}
                      />
                    </div>
                    {unitDetail.activeLease && (
                      <div className="flex items-center gap-1.5 text-xs text-slate-500">
                        <CalendarDays className="h-3 w-3 shrink-0" />
                        Lease started {format(parseISO(unitDetail.activeLease.lease_start), 'EEEE, MMMM d, yyyy')}
                      </div>
                    )}
                    {unitDetail.tenantEmail && (
                      <div className="flex items-center gap-1.5 text-xs text-slate-500">
                        <Mail className="h-3 w-3 shrink-0" />
                        {unitDetail.tenantEmail}
                      </div>
                    )}
                    {unitDetail.tenantPhone && (
                      <div className="flex items-center gap-1.5 text-xs text-slate-500">
                        <Phone className="h-3 w-3 shrink-0" />
                        {unitDetail.tenantPhone}
                      </div>
                    )}
                  </>
                ) : (
                  <div className="flex items-center gap-3 mt-1">
                    <p className="text-sm text-slate-400">Vacant</p>
                    <UnitAddTenantDialog unit={{ id: unitDetail.unit.id, label: unitDetail.unit.label, monthly_rent: unitDetail.unit.monthly_rent, status: unitDetail.unit.status }} />
                  </div>
                )}
              </div>
              <Link href="/landlord" aria-label="Close unit details" className="h-11 w-11 flex items-center justify-center rounded-full hover:bg-white/80 shrink-0 ml-2">
                <X className="h-4 w-4 text-slate-500" />
              </Link>
            </div>

            <div className="flex-1 overflow-y-auto divide-y">
              <div className="px-5 py-3">
                <Link
                  href={`/landlord/units/${unitDetail.unit.id}/history`}
                  className="flex items-center justify-center gap-2 rounded-full glass-row min-h-11 text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  <History className="h-4 w-4" /> View full unit history
                </Link>
              </div>

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
                          {formatRWF(p.amount)}
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
                        <span className="text-sm font-semibold text-red-500 shrink-0 ml-2">{formatRWF(e.amount)}</span>
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
                          <p className="text-xs text-slate-400">
                            {format(parseISO(l.lease_start), 'MMM d, yyyy')} – {l.lease_end ? format(parseISO(l.lease_end), 'MMM d, yyyy') : 'present'} · {formatRWF(l.monthly_rent)}/mo
                          </p>
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
  if (!isOccupied) return <span className="chip chip-neutral">Vacant</span>
  if (status === 'confirmed') return <span className="chip chip-success"><CheckCircle2 className="h-3 w-3" />Paid</span>
  if (status === 'pending_review') return <span className="chip chip-warning"><Clock className="h-3 w-3" />Pending</span>
  if (!rentDuePassed) return <span className="chip chip-neutral">Not due yet</span>
  return <span className="chip chip-danger"><AlertCircle className="h-3 w-3" />Unpaid</span>
}
