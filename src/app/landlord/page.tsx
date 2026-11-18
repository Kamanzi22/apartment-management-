import { redirect } from 'next/navigation'
import { createClient, createAdminClient, getVerifiedUserId } from '@/lib/supabase/server'
import Link from 'next/link'
import { format, parseISO, subMonths, startOfMonth } from 'date-fns'
import {
  currentPeriodMonth, formatPeriodMonth, getDueDate, kigaliDateString, kigaliToday, ordinal,
} from '@/lib/rent-utils'
import { ledgerRow, type LedgerStatus } from '@/lib/rent-ledger'
import { loadOpenNotices, loadRentState, type TenantArrears } from './rent-data'
import { ArrearsList } from './arrears-list'
import { MoveOutNotices, type MoveOutNotice } from './move-out-notices'
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
  const todayIso = kigaliDateString()
  const period = currentPeriodMonth()

  if (process.env.NEXT_PUBLIC_DEMO_MODE === 'true') {
    const paymentMap = new Map(demoCurrentPayments.map(p => [p.tenant_id, p.status]))
    const maintenanceCountMap = new Map<string, number>()
    for (const m of demoMaintenanceRequests.filter(r => r.status !== 'resolved')) {
      maintenanceCountMap.set(m.unit_id, (maintenanceCountMap.get(m.unit_id) ?? 0) + 1)
    }
    return (
      <OverviewShell
        units={demoUnits.map(u => {
          const lease = (u.leases as { tenant_id?: string; rent_due_day?: number }[])[0]
          const paid = lease?.tenant_id ? paymentMap.get(lease.tenant_id) : undefined
          const due = lease?.rent_due_day ? getDueDate(lease.rent_due_day, period) : null
          const dueIso = due ? format(due, 'yyyy-MM-dd') : null
          const rentStatus: LedgerStatus | null = !lease ? null
            : paid === 'confirmed' ? 'paid'
            : paid === 'pending_review' ? 'pending'
            : dueIso && todayIso >= dueIso ? 'overdue' : 'not_due'
          return {
            id: u.id, label: u.label, bedroom_count: u.bedroom_count, monthly_rent: u.monthly_rent,
            status: u.status,
            tenant: (u.profiles as { id: string; full_name: string }[])[0] ?? null,
            rentStatus, dueDate: dueIso, arrears: 0,
            openMaint: maintenanceCountMap.get(u.id) ?? 0,
            unreadMsgCount: 0,
            rentDueDay: lease?.rent_due_day ?? null,
          }
        })}
        stats={{
          income: demoCurrentPayments.filter(p => p.status === 'confirmed').reduce((s, p) => s + ((p as { amount?: number }).amount ?? 0), 0),
          expenses: 0,
          openRequests: demoMaintenanceRequests.filter(r => r.status !== 'resolved').length,
        }}
        selectedUnitId={selectedUnitId}
        unitDetail={null}
        notices={[]}
        arrears={[]}
      />
    )
  }

  const userId = await getVerifiedUserId()
  if (!userId) redirect('/login')

  const supabase = await createClient()
  const chartStart = format(startOfMonth(subMonths(kigaliToday(), 11)), 'yyyy-MM-dd')

  const [
    { data: unitsRaw },
    { data: payments },
    { data: maintenanceAll },
    { data: unreadMessages },
    { data: monthExpenses },
    rent,
    notices,
  ] = await Promise.all([
    supabase.from('units').select(`
      id, label, bedroom_count, monthly_rent, status,
      profiles!profiles_unit_id_fkey(id, full_name, phone)
    `).order('label'),
    supabase.from('payments').select('tenant_id, status, period_month, amount').eq('period_month', period),
    supabase.from('maintenance_requests').select('unit_id, status').not('status', 'in', '(resolved,closed)'),
    supabase.from('messages').select('sender_id').eq('recipient_id', userId).is('read_at', null),
    supabase.from('expenses').select('amount')
      .gte('expense_date', `${period}-01`)
      .lte('expense_date', todayIso),
    loadRentState(supabase),
    loadOpenNotices(supabase),
  ])

  const maintenanceCountMap = new Map<string, number>()
  for (const m of maintenanceAll ?? []) {
    maintenanceCountMap.set(m.unit_id, (maintenanceCountMap.get(m.unit_id) ?? 0) + 1)
  }
  const unreadCountMap = new Map<string, number>()
  for (const m of unreadMessages ?? []) {
    unreadCountMap.set(m.sender_id, (unreadCountMap.get(m.sender_id) ?? 0) + 1)
  }

  const units: OverviewUnit[] = (unitsRaw ?? []).map(unit => {
    const activeLease = rent.leases.find(l => l.unit_id === unit.id && l.status === 'active') ?? null
    const tenant = (unit.profiles as { id: string; full_name: string; phone: string | null }[] | null)?.[0] ?? null
    const row = activeLease ? ledgerRow(rent.ledgers.get(activeLease.id) ?? [], period) : undefined
    return {
      id: unit.id, label: unit.label, bedroom_count: unit.bedroom_count,
      monthly_rent: Number(unit.monthly_rent), status: unit.status, tenant,
      rentStatus: row?.status ?? null,
      dueDate: row?.due_date ?? null,
      arrears: activeLease ? rent.arrears.get(activeLease.tenant_id)?.total ?? 0 : 0,
      limitState: activeLease ? rent.limits.get(activeLease.id)?.state ?? null : null,
      openMaint: maintenanceCountMap.get(unit.id) ?? 0,
      unreadMsgCount: tenant?.id ? (unreadCountMap.get(tenant.id) ?? 0) : 0,
      rentDueDay: activeLease?.rent_due_day ?? null,
    }
  })

  // ── Unit detail data (when ?unit= is set) ─────────────────────────────
  let unitDetail: UnitDetail | null = null

  if (selectedUnitId) {
    const selectedUnit = units.find(u => u.id === selectedUnitId)
    if (selectedUnit) {
      const unitLeases = rent.leases.filter(l => l.unit_id === selectedUnitId)
      const activeLease = unitLeases.find(l => l.status === 'active') ?? null
      const tenantId = selectedUnit.tenant?.id ?? null

      const adminClient = await createAdminClient()

      const [
        { data: unitPayments },
        { data: unitExpenses },
        { data: unitMaintenance },
        tenantAuthData,
        { data: leaseExtra },
      ] = await Promise.all([
        unitLeases.length
          ? supabase.from('payments')
              .select('id, period_month, amount, status, submitted_at, tenant_id, profiles!payments_tenant_id_fkey(full_name)')
              .in('lease_id', unitLeases.map(l => l.id))
              .gte('submitted_at', chartStart)
              .order('period_month', { ascending: false })
              .order('submitted_at', { ascending: false })
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
        tenantId
          ? adminClient.auth.admin.getUserById(tenantId)
          : Promise.resolve({ data: { user: null } }),
        activeLease
          ? supabase.from('leases').select('deposit_amount').eq('id', activeLease.id).single()
          : Promise.resolve({ data: null }),
      ])

      const tenantArrears = tenantId ? rent.arrears.get(tenantId) ?? null : null
      unitDetail = {
        unit: selectedUnit,
        tenantEmail: (tenantAuthData as { data?: { user?: { email?: string } | null } })?.data?.user?.email ?? null,
        tenantPhone: selectedUnit.tenant?.phone ?? null,
        activeLease: activeLease ? {
          id: activeLease.id, monthly_rent: activeLease.monthly_rent, move_in_date: activeLease.move_in_date,
          rent_due_day: activeLease.rent_due_day, lease_start: activeLease.lease_start, lease_end: activeLease.lease_end,
          deposit_amount: Number((leaseExtra as { deposit_amount?: number } | null)?.deposit_amount ?? 0),
        } : null,
        arrears: tenantArrears?.total ?? 0,
        previousBalance: tenantArrears?.previous ?? 0,
        payments: (unitPayments ?? []) as unknown as UnitDetail['payments'],
        expenses: (unitExpenses ?? []) as unknown as UnitDetail['expenses'],
        maintenance: (unitMaintenance ?? []) as unknown as UnitDetail['maintenance'],
        leaseHistory: [...unitLeases].reverse().slice(0, 10).map(l => ({
          id: l.id, status: l.status, monthly_rent: l.monthly_rent, move_in_date: l.move_in_date,
          lease_start: l.lease_start, lease_end: l.lease_end, profiles: { full_name: l.tenant_name },
        })),
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
      notices={notices}
      arrears={[...rent.arrears.values()]}
      overLimit={[...rent.limits.values()].filter(l => l.state === 'over_limit').map(l => l.tenant_id)}
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
  arrears: number
  previousBalance: number
  payments: Array<{ id: string; period_month: string; amount: number; status: string; submitted_at: string; profiles: { full_name: string } | null }>
  expenses: Array<{ id: string; category: string; amount: number; expense_date: string; description: string }>
  maintenance: Array<{ id: string; category: string; description: string; status: string; urgency: string; created_at: string; profiles: { full_name: string } | null }>
  leaseHistory: Array<{ id: string; status: string; monthly_rent: number; move_in_date: string; lease_start: string; lease_end: string | null; profiles: { full_name: string } | null }>
}

type OverviewUnit = {
  id: string; label: string; bedroom_count: number; monthly_rent: number; status: string
  tenant: { id: string; full_name: string; phone?: string | null } | null
  /** This month's ledger status for the active lease. */
  rentStatus: LedgerStatus | null
  /** This month's due date (ISO), from the ledger. */
  dueDate: string | null
  /** Everything the current tenant owes, across all their leases and years. */
  arrears: number
  /** rent_limit_status state of the active lease. */
  limitState?: string | null
  openMaint: number; unreadMsgCount: number
  rentDueDay: number | null
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
  units, stats, selectedUnitId, unitDetail, notices, arrears, overLimit = [],
}: {
  units: OverviewUnit[]
  stats: { income: number; expenses: number; openRequests: number }
  selectedUnitId?: string
  unitDetail: UnitDetail | null
  notices: MoveOutNotice[]
  arrears: TenantArrears[]
  overLimit?: string[]
}) {
  const today = kigaliToday()
  const occupiedUnits = units.filter(u => u.status === 'occupied' && !!u.tenant)
  const occupancy = units.length ? Math.round((occupiedUnits.length / units.length) * 100) : 0
  const dueUnits = occupiedUnits.filter(u => u.rentStatus !== 'paid')
  const profit = stats.income - stats.expenses

  const dueSentence = dueUnits.length
    ? listNames(dueUnits.map(u => `${u.tenant!.full_name.split(' ')[0]}${u.rentDueDay ? ` on the ${ordinal(u.rentDueDay)}` : ''}`)) + '.'
    : 'Everyone has paid this month. All clear.'

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

      {/* Hero */}
      <div>
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

      </div>

      <MoveOutNotices notices={notices} />

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
                    <RentStatusBadge status={unit.rentStatus} isOccupied={unit.status === 'occupied' && !!unit.tenant} />
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
                    <div className="flex items-center gap-1.5 shrink-0 flex-wrap justify-end">
                      {unit.limitState === 'over_limit' && <span className="chip chip-danger">Over limit</span>}
                      {unit.limitState === 'plan' && <span className="chip chip-warning">Payment plan</span>}
                      {unit.arrears > 0 && (
                        <span className="chip chip-danger">Owes {formatRWF(unit.arrears)}</span>
                      )}
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

      <ArrearsList tenants={arrears} title="Arrears (all tenants, all years)" overLimit={overLimit} />

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
              {(unitDetail.arrears > 0 || unitDetail.previousBalance > 0) && (
                <div className="px-5 py-3 space-y-1">
                  {unitDetail.arrears > 0 && (
                    <p className="text-sm font-semibold text-red-600">Owes {formatRWF(unitDetail.arrears)} in total</p>
                  )}
                  {unitDetail.previousBalance > 0 && (
                    <p className="text-xs text-slate-500">Includes a previous balance of {formatRWF(unitDetail.previousBalance)} from an earlier lease</p>
                  )}
                </div>
              )}
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
                              <span className="text-xs text-slate-400 bg-slate-100 px-2.5 py-0.5 rounded-full font-bold">{p.profiles.full_name}</span>
                            )}
                          </div>
                          <p className="text-xs text-slate-400 mt-0.5">
                            {p.status === 'confirmed' ? 'Confirmed' : p.status === 'rejected' ? 'Rejected' : 'Pending review'} · {format(new Date(p.submitted_at), 'MMM d, yyyy')}
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
                          <p className="text-xs text-slate-400">{format(new Date(e.expense_date), 'MMM d, yyyy')}</p>
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
                                <span className="text-xs text-slate-400 bg-slate-100 px-2.5 py-0.5 rounded-full font-bold">{m.profiles.full_name}</span>
                              )}
                              <span className="text-xs text-slate-400">{format(new Date(m.created_at), 'MMM d, yyyy')}</span>
                            </div>
                          </div>
                          <span className={cn('text-xs px-2.5 py-0.5 rounded-full font-bold shrink-0',
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
                        <span className={cn('text-xs px-2.5 py-0.5 rounded-full font-bold font-semibold',
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

function RentStatusBadge({ status, isOccupied }: { status: LedgerStatus | null; isOccupied: boolean }) {
  if (!isOccupied) return <span className="chip chip-neutral">Vacant</span>
  if (status === 'paid') return <span className="chip chip-success"><CheckCircle2 className="h-3 w-3" />Paid</span>
  if (status === 'pending') return <span className="chip chip-warning"><Clock className="h-3 w-3" />Pending</span>
  if (status === 'partial') return <span className="chip chip-danger"><AlertCircle className="h-3 w-3" />Part paid</span>
  if (status === 'overdue') return <span className="chip chip-danger"><AlertCircle className="h-3 w-3" />Unpaid</span>
  return <span className="chip chip-neutral">Not due yet</span>
}
