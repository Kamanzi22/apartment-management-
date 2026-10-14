'use client'

import { useState, useMemo } from 'react'
import { CheckCircle2, Clock, AlertCircle, ChevronRight, ArrowLeft, Search, X } from 'lucide-react'
import { format, differenceInMonths } from 'date-fns'
import { formatRWF } from '@/lib/currency'

interface Lease {
  id: string
  unit_id: string
  tenant_id: string
  monthly_rent: number
  rent_due_day: number
  move_in_date: string
  lease_start: string
  lease_end: string | null
  status: string
  profiles: { full_name: string } | null
}

interface Payment {
  id?: string
  lease_id: string
  period_month: string
  amount: number
  status: string
}

interface Unit {
  id: string
  label: string
  status: string
  monthly_rent: number
}

interface Props {
  unit: Unit
  leases: Lease[]
  payments: Payment[]      // current year payments (year history section)
  allPayments: Payment[]   // all-time payments (tenant search section)
  currentYear: number
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function ordinal(n: number): string {
  if (n >= 11 && n <= 13) return 'th'
  switch (n % 10) { case 1: return 'st'; case 2: return 'nd'; case 3: return 'rd'; default: return 'th' }
}

function leaseForMonth(leases: Lease[], year: number, month: number): Lease | null {
  const monthStart = new Date(year, month - 1, 1)
  const monthEnd   = new Date(year, month, 0)
  return leases.find(l => {
    const start = new Date(l.move_in_date)
    const end   = l.lease_end ? new Date(l.lease_end) : new Date(9999, 0)
    return start <= monthEnd && end >= monthStart
  }) ?? null
}

function monthsBetween(startStr: string, endStr: string): string[] {
  const result: string[] = []
  const [sy, sm] = startStr.split('-').map(Number)
  const [ey, em] = endStr.split('-').map(Number)
  let y = sy, m = sm
  while (y < ey || (y === ey && m <= em)) {
    result.push(`${y}-${String(m).padStart(2, '0')}`)
    m++; if (m > 12) { m = 1; y++ }
  }
  return result
}

function durationLabel(start: string, end: string | null): string {
  const months = differenceInMonths(end ? new Date(end) : new Date(), new Date(start))
  if (months < 1) return 'Less than a month'
  if (months < 12) return `${months} month${months > 1 ? 's' : ''}`
  const y = Math.floor(months / 12), r = months % 12
  return r === 0 ? `${y} year${y > 1 ? 's' : ''}` : `${y}y ${r}m`
}

const MONTH_NAMES = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December',
]

// ── Main component ────────────────────────────────────────────────────────────

export function RentUnitCard({ unit, leases, payments, allPayments, currentYear }: Props) {
  const [open, setOpen]       = useState(false)
  const [query, setQuery]     = useState('')
  const [selected, setSelected] = useState<Lease | null>(null)

  const now          = new Date()
  const currentMonth = now.getMonth() + 1
  const todayDay     = now.getDate()

  const activeLease  = leases.find(l => l.status === 'active') ?? null
  const tenantName   = activeLease?.profiles?.full_name ?? null

  // ── "Paid all so far" badge ────────────────────────────────────────────────
  let paidStatus: 'all-paid' | 'pending' | 'unpaid' | 'not-due' | null = null
  if (activeLease) {
    const leaseStart   = new Date(activeLease.move_in_date)
    const startMonth   = leaseStart.getFullYear() < currentYear ? 1 : leaseStart.getMonth() + 1
    const duePassed    = todayDay >= activeLease.rent_due_day
    const lastCheck    = duePassed ? currentMonth : currentMonth - 1
    const checkMonths  = Array.from({ length: Math.max(0, lastCheck - startMonth + 1) }, (_, i) =>
      `${currentYear}-${String(startMonth + i).padStart(2, '0')}`)
    if (!checkMonths.length) {
      paidStatus = 'not-due'
    } else {
      const allOk  = checkMonths.every(mo => payments.some(p => p.lease_id === activeLease.id && p.period_month === mo && p.status === 'confirmed'))
      const anyPending = checkMonths.some(mo => payments.some(p => p.lease_id === activeLease.id && p.period_month === mo && p.status === 'pending_review'))
      paidStatus = allOk ? 'all-paid' : anyPending ? 'pending' : 'unpaid'
    }
  }

  // ── Year history rows (Jan–Dec) ────────────────────────────────────────────
  const monthRows = MONTH_NAMES.map((label, i) => {
    const month    = i + 1
    const monthStr = `${currentYear}-${String(month).padStart(2, '0')}`
    const isFuture = month > currentMonth
    const lease    = leaseForMonth(leases, currentYear, month)
    if (!lease) return { label, monthStr, isFuture, occupied: false, tenantName: null, payment: null }
    const payment  = payments.find(p => p.lease_id === lease.id && p.period_month === monthStr) ?? null
    return { label, monthStr, isFuture, occupied: true, tenantName: lease.profiles?.full_name ?? 'Tenant', payment }
  })

  const totalCollected = payments.filter(p => p.status === 'confirmed').reduce((s, p) => s + p.amount, 0)

  // ── Tenant search (within this unit) ──────────────────────────────────────
  const unitTenants = useMemo(() => {
    const seen = new Set<string>()
    return leases.filter(l => {
      const name = l.profiles?.full_name
      if (!name || seen.has(l.id)) return false
      seen.add(l.id)
      return true
    })
  }, [leases])

  const searchMatches = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return []
    return unitTenants.filter(l => l.profiles?.full_name?.toLowerCase().includes(q))
  }, [query, unitTenants])

  const tenantRows = useMemo(() => {
    if (!selected) return []
    const endMonth   = selected.lease_end ? format(new Date(selected.lease_end), 'yyyy-MM') : format(now, 'yyyy-MM')
    const startMonth = format(new Date(selected.move_in_date), 'yyyy-MM')
    return monthsBetween(startMonth, endMonth).map(mo => ({
      month: mo,
      label: (() => { const [y, m] = mo.split('-').map(Number); return format(new Date(y, m - 1), 'MMM yyyy') })(),
      payment: allPayments.find(p => p.lease_id === selected.id && p.period_month === mo) ?? null,
    }))
  }, [selected, allPayments])

  const tenantTotalPaid    = tenantRows.filter(r => r.payment?.status === 'confirmed').reduce((s, r) => s + (r.payment?.amount ?? 0), 0)
  const tenantUnpaidCount  = tenantRows.filter(r => !r.payment || r.payment.status === 'unpaid').length
  const tenantPendingCount = tenantRows.filter(r => r.payment?.status === 'pending_review').length

  function closeDetail() { setOpen(false); setQuery(''); setSelected(null) }

  // ── Card (list item) ───────────────────────────────────────────────────────
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="w-full text-left bg-white rounded-xl border shadow-sm hover:shadow-md transition-shadow px-4 py-3.5"
      >
        <div className="flex items-center justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-0.5 flex-wrap">
              <p className="font-semibold text-slate-900">{unit.label}</p>
              <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${activeLease ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'}`}>
                {activeLease ? 'Occupied' : 'Vacant'}
              </span>
            </div>
            {activeLease
              ? <p className="text-xs text-slate-500">{tenantName} · Rent due on {activeLease.rent_due_day}{ordinal(activeLease.rent_due_day)}</p>
              : <p className="text-xs text-slate-400">No active tenant</p>}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {paidStatus === 'all-paid' && <span className="flex items-center gap-1 text-[11px] text-green-700 bg-green-100 px-2 py-0.5 rounded-full"><CheckCircle2 className="h-3 w-3" />All paid</span>}
            {paidStatus === 'pending'  && <span className="flex items-center gap-1 text-[11px] text-amber-700 bg-amber-100 px-2 py-0.5 rounded-full"><Clock className="h-3 w-3" />Pending</span>}
            {paidStatus === 'unpaid'   && <span className="flex items-center gap-1 text-[11px] text-red-700 bg-red-100 px-2 py-0.5 rounded-full"><AlertCircle className="h-3 w-3" />Unpaid</span>}
            {paidStatus === 'not-due'  && <span className="text-[11px] text-slate-400">Not due yet</span>}
            <ChevronRight className="h-4 w-4 text-slate-300" />
          </div>
        </div>
      </button>

      {/* ── Full-screen detail ── */}
      {open && (
        <div className="fixed inset-0 z-50 bg-white flex flex-col overflow-hidden">

          {/* Header */}
          <div className="flex items-center gap-3 px-4 py-3 border-b bg-slate-900 text-white shrink-0">
            <button onClick={closeDetail} className="p-1 rounded-lg hover:bg-slate-700 transition-colors">
              <ArrowLeft className="h-5 w-5" />
            </button>
            <div className="flex-1 min-w-0">
              <p className="font-semibold">{unit.label}</p>
              <p className="text-xs text-slate-400">Rent history</p>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto">

            {/* ── Tenant search ── */}
            <div className="px-4 pt-4 pb-3 border-b">
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Search tenant</p>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                <input
                  type="text"
                  value={query}
                  onChange={e => { setQuery(e.target.value); setSelected(null) }}
                  placeholder="Type tenant name…"
                  className="w-full text-sm border rounded-xl pl-9 pr-9 py-2.5 text-slate-700 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-300 bg-white"
                />
                {query && (
                  <button onClick={() => { setQuery(''); setSelected(null) }} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-300 hover:text-slate-500">
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>

              {/* Dropdown matches */}
              {searchMatches.length > 0 && !selected && (
                <div className="mt-2 rounded-xl border divide-y shadow-sm">
                  {searchMatches.map(l => (
                    <button key={l.id} onClick={() => { setSelected(l); setQuery(l.profiles?.full_name ?? '') }}
                      className="w-full text-left px-4 py-2.5 hover:bg-slate-50 transition-colors">
                      <p className="text-sm font-medium text-slate-800">{l.profiles?.full_name}</p>
                      <p className="text-xs text-slate-400">
                        {l.status === 'active' ? 'Current tenant' : `Moved out ${l.lease_end ? format(new Date(l.lease_end), 'MMM d, yyyy') : ''}`}
                        {' · '}{durationLabel(l.move_in_date, l.lease_end)}
                      </p>
                    </button>
                  ))}
                </div>
              )}
              {query && searchMatches.length === 0 && !selected && (
                <p className="text-sm text-slate-400 text-center py-2 mt-1">No tenant found</p>
              )}

              {/* Selected tenant detail */}
              {selected && (
                <div className="mt-3 space-y-3">
                  <div className="bg-slate-50 rounded-xl px-4 py-3">
                    <div className="flex items-center justify-between mb-0.5">
                      <p className="font-semibold text-slate-900">{selected.profiles?.full_name}</p>
                      <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${selected.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'}`}>
                        {selected.status === 'active' ? 'Current' : 'Past'}
                      </span>
                    </div>
                    <p className="text-xs text-slate-500">
                      Moved in {format(new Date(selected.move_in_date), 'MMM d, yyyy')}
                      {selected.lease_end ? ` · Left ${format(new Date(selected.lease_end), 'MMM d, yyyy')}` : ' · Still here'}
                      {' · '}<span className="font-medium text-slate-700">{durationLabel(selected.move_in_date, selected.lease_end)}</span>
                    </p>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <div className="text-center py-2 rounded-lg bg-green-50">
                      <p className="text-[11px] text-slate-500 mb-0.5">Total paid</p>
                      <p className="font-bold text-green-700 text-sm">{formatRWF(tenantTotalPaid)}</p>
                    </div>
                    <div className="text-center py-2 rounded-lg bg-amber-50">
                      <p className="text-[11px] text-slate-500 mb-0.5">Pending</p>
                      <p className="font-bold text-amber-600 text-sm">{tenantPendingCount}</p>
                    </div>
                    <div className="text-center py-2 rounded-lg bg-red-50">
                      <p className="text-[11px] text-slate-500 mb-0.5">Unpaid</p>
                      <p className="font-bold text-red-600 text-sm">{tenantUnpaidCount}</p>
                    </div>
                  </div>
                  <div className="rounded-xl border divide-y overflow-hidden">
                    {tenantRows.map(({ month, label, payment }) => (
                      <div key={month} className="flex items-center px-4 py-2 gap-3">
                        <p className="text-sm text-slate-600 w-20 shrink-0">{label}</p>
                        <div className="flex-1" />
                        <PaymentBadge payment={payment} isFuture={false} />
                        {payment?.status === 'confirmed' && (
                          <p className="text-sm font-semibold text-green-700 w-16 text-right shrink-0">{formatRWF(payment.amount)}</p>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* ── Year history ── */}
            <div className="px-4 pt-4">
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">{currentYear} — Month by month</p>
              <div className="rounded-xl border divide-y overflow-hidden">
                {monthRows.map(row => (
                  <div key={row.monthStr} className={`flex items-center px-4 py-2.5 gap-3 ${row.isFuture ? 'opacity-35' : ''}`}>
                    <p className="w-24 text-sm text-slate-600 shrink-0 font-medium">{row.label}</p>
                    {!row.occupied
                      ? <span className="text-xs text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full">Vacant</span>
                      : <>
                          <p className="flex-1 text-sm text-slate-700 truncate">{row.tenantName}</p>
                          <PaymentBadge payment={row.payment} isFuture={row.isFuture} />
                          {row.payment?.status === 'confirmed' && (
                            <p className="text-sm font-semibold text-green-700 w-16 text-right shrink-0">{formatRWF(row.payment.amount)}</p>
                          )}
                        </>
                    }
                  </div>
                ))}
              </div>
            </div>

            {/* Total */}
            <div className="px-4 py-4">
              <div className="flex items-center justify-between bg-slate-50 rounded-xl px-4 py-3">
                <p className="text-sm font-semibold text-slate-700">Total collected {currentYear}</p>
                <p className="text-base font-bold text-green-700">{formatRWF(totalCollected)}</p>
              </div>
            </div>

          </div>
        </div>
      )}
    </>
  )
}

function PaymentBadge({ payment, isFuture }: { payment: Payment | null; isFuture: boolean }) {
  if (isFuture) return <span className="text-xs text-slate-300 shrink-0">—</span>
  if (!payment) return <span className="text-xs text-red-600 bg-red-50 px-2 py-0.5 rounded-full shrink-0">Unpaid</span>
  if (payment.status === 'confirmed') return <span className="flex items-center gap-1 text-xs text-green-700 bg-green-100 px-2 py-0.5 rounded-full shrink-0"><CheckCircle2 className="h-3 w-3" />Paid</span>
  if (payment.status === 'pending_review') return <span className="flex items-center gap-1 text-xs text-amber-700 bg-amber-100 px-2 py-0.5 rounded-full shrink-0"><Clock className="h-3 w-3" />Pending</span>
  return <span className="text-xs text-red-600 bg-red-50 px-2 py-0.5 rounded-full shrink-0">Unpaid</span>
}
