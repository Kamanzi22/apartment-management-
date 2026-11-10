'use client'

import { useState, useMemo } from 'react'
import { CheckCircle2, Clock, AlertCircle, ChevronRight, ArrowLeft, Search, X } from 'lucide-react'
import { format, differenceInMonths, parseISO } from 'date-fns'
import { formatRWF } from '@/lib/currency'
import { kigaliToday, monthStart, ordinal } from '@/lib/rent-utils'
import { leasesForMonth, ledgerRow, summarizeLedger, type LedgerRow } from '@/lib/rent-ledger'
import type { LeaseInfo, TenantArrears } from '../rent-data'

interface Unit {
  id: string
  label: string
  status: string
  monthly_rent: number
}

interface Props {
  unit: Unit
  /** Every lease this unit has had, oldest first. */
  leases: LeaseInfo[]
  /** rent_ledger rows by lease id (move-in to this month). */
  ledgers: Record<string, LedgerRow[]>
  /** Arrears by tenant id, across all of that tenant's leases. */
  arrears: Record<string, TenantArrears>
  year: number
  currentMonth: string
}

function durationLabel(start: string, end: string | null): string {
  const months = differenceInMonths(end ? parseISO(end) : kigaliToday(), parseISO(start))
  if (months < 1) return 'Less than a month'
  if (months < 12) return `${months} month${months > 1 ? 's' : ''}`
  const y = Math.floor(months / 12), r = months % 12
  return r === 0 ? `${y} year${y > 1 ? 's' : ''}` : `${y}y ${r}m`
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

type CardStatus = 'all-paid' | 'pending' | 'owes' | 'not-due' | null

export function RentUnitCard({ unit, leases, ledgers, arrears, year, currentMonth }: Props) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<LeaseInfo | null>(null)

  const activeLease = leases.find(l => l.status === 'active') ?? null
  const tenantName = activeLease?.tenant_name ?? null
  const tenantArrears = activeLease ? arrears[activeLease.tenant_id] : undefined

  // Card badge: everything the current tenant owes (all months, all years, all
  // their leases). A part-paid month is owed, and a rejected receipt is unpaid.
  let cardStatus: CardStatus = null
  if (activeLease) {
    const rows = ledgers[activeLease.id] ?? []
    const summary = summarizeLedger(rows)
    if ((tenantArrears?.total ?? 0) > (tenantArrears?.underReview ?? 0)) cardStatus = 'owes'
    else if ((tenantArrears?.total ?? 0) > 0 || summary.status === 'pending') cardStatus = 'pending'
    else if (rows.some(r => r.status === 'paid')) cardStatus = 'all-paid'
    else cardStatus = 'not-due'
  }

  // Year rows: every lease that covered part of the month gets its own line,
  // so a turnover month shows the outgoing and the incoming tenant.
  const monthRows = MONTH_NAMES.map((label, i) => {
    const monthStr = `${year}-${String(i + 1).padStart(2, '0')}`
    const isFuture = monthStr > currentMonth
    const entries = leasesForMonth(leases, monthStr).map(lease => ({
      lease,
      row: ledgerRow(ledgers[lease.id] ?? [], monthStr) ?? null,
    }))
    return { label, monthStr, isFuture, entries }
  })

  const totalCollected = leases.reduce((sum, l) =>
    sum + (ledgers[l.id] ?? []).filter(r => r.period_month.startsWith(`${year}-`)).reduce((s, r) => s + r.confirmed_paid, 0), 0)

  // ── Tenant search (within this unit) ──────────────────────────────────────
  const searchMatches = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return []
    return leases.filter(l => l.tenant_name.toLowerCase().includes(q))
  }, [query, leases])

  const tenantRows = selected ? [...(ledgers[selected.id] ?? [])].reverse() : []
  const tenantTotalPaid = tenantRows.reduce((s, r) => s + r.confirmed_paid, 0)
  const tenantOwedRows = tenantRows.filter(r => r.balance > 0)
  const tenantOwed = tenantOwedRows.reduce((s, r) => s + r.balance, 0)
  const tenantPendingCount = tenantRows.filter(r => r.pending_paid > 0).length

  function closeDetail() { setOpen(false); setQuery(''); setSelected(null) }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="w-full text-left glass lift px-4 py-3.5"
      >
        <div className="flex items-center justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-0.5 flex-wrap">
              <p className="font-semibold text-slate-900">{unit.label}</p>
              <span className={`text-xs px-2.5 py-0.5 rounded-full font-bold ${activeLease ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'}`}>
                {activeLease ? 'Occupied' : 'Vacant'}
              </span>
            </div>
            {activeLease
              ? <p className="text-xs text-slate-500">{tenantName} · Rent due on the {ordinal(activeLease.rent_due_day)}</p>
              : <p className="text-xs text-slate-400">No active tenant</p>}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {cardStatus === 'all-paid' && <span className="flex items-center gap-1 text-xs text-green-700 bg-green-100 px-2.5 py-0.5 rounded-full font-bold"><CheckCircle2 className="h-3 w-3" />All paid</span>}
            {cardStatus === 'pending' && <span className="flex items-center gap-1 text-xs text-amber-700 bg-amber-100 px-2.5 py-0.5 rounded-full font-bold"><Clock className="h-3 w-3" />Pending</span>}
            {cardStatus === 'owes' && (
              <span className="flex items-center gap-1 text-xs text-red-700 bg-red-100 px-2.5 py-0.5 rounded-full font-bold">
                <AlertCircle className="h-3 w-3" />Owes {formatRWF(tenantArrears?.total ?? 0)}
              </span>
            )}
            {cardStatus === 'not-due' && <span className="text-[11px] text-slate-400">Not due yet</span>}
            <ChevronRight className="h-4 w-4 text-slate-400" />
          </div>
        </div>
        {tenantArrears && tenantArrears.total > 0 && (
          <p className="text-xs text-red-600 mt-1.5">
            {tenantArrears.lines.map(line =>
              `${line.unitLabel}${line.active ? '' : ' (previous lease)'}: ${line.months.map(m => format(monthStart(m.period_month), 'MMM yyyy')).join(', ')}`
            ).join(' · ')}
          </p>
        )}
      </button>

      {/* ── Full-screen detail ── */}
      {open && (
        <div className="fixed inset-0 z-50 bg-[rgba(244,248,250,0.92)] backdrop-blur-2xl flex flex-col overflow-hidden">

          {/* Header */}
          <div className="flex items-center gap-3 px-4 py-3 bg-gradient-to-br from-[var(--accent)] to-[var(--accent-2)] text-white shrink-0">
            <button onClick={closeDetail} aria-label="Back" className="h-11 w-11 shrink-0 inline-flex items-center justify-center rounded-full hover:bg-white/15 transition-colors">
              <ArrowLeft className="h-5 w-5" />
            </button>
            <div className="flex-1 min-w-0">
              <p className="font-semibold">{unit.label}</p>
              <p className="text-xs text-[var(--metal)]">Rent history · {year}</p>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto">

            {/* ── Tenant search ── */}
            <div className="px-4 pt-4 pb-3 border-b">
              <label htmlFor={`search-${unit.id}`} className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Search tenant</label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                <input
                  id={`search-${unit.id}`}
                  type="text"
                  value={query}
                  onChange={e => { setQuery(e.target.value); setSelected(null) }}
                  placeholder="Type tenant name…"
                  className="w-full text-sm border border-white/85 rounded-[14px] pl-9 pr-9 min-h-11 text-slate-700 placeholder:text-slate-400 focus:outline-none focus:ring-3 focus:ring-[var(--accent)]/40 bg-white/70"
                />
                {query && (
                  <button aria-label="Clear search" onClick={() => { setQuery(''); setSelected(null) }} className="absolute right-1 top-1/2 -translate-y-1/2 h-9 w-9 inline-flex items-center justify-center text-slate-400 hover:text-slate-500">
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>

              {searchMatches.length > 0 && !selected && (
                <div className="mt-2 rounded-xl border divide-y shadow-sm">
                  {searchMatches.map(l => (
                    <button key={l.id} onClick={() => { setSelected(l); setQuery(l.tenant_name) }}
                      className="w-full text-left px-4 py-2.5 hover:bg-slate-50 transition-colors">
                      <p className="text-sm font-medium text-slate-800">{l.tenant_name}</p>
                      <p className="text-xs text-slate-400">
                        {l.status === 'active' ? 'Current tenant' : `Moved out ${l.lease_end ? format(parseISO(l.lease_end), 'MMM d, yyyy') : ''}`}
                        {' · '}{durationLabel(l.move_in_date, l.lease_end)}
                      </p>
                    </button>
                  ))}
                </div>
              )}
              {query && searchMatches.length === 0 && !selected && (
                <p className="text-sm text-slate-400 text-center py-2 mt-1">No tenant found</p>
              )}

              {selected && (
                <div className="mt-3 space-y-3">
                  <div className="bg-slate-50 rounded-xl px-4 py-3">
                    <div className="flex items-center justify-between mb-0.5">
                      <p className="font-semibold text-slate-900">{selected.tenant_name}</p>
                      <span className={`text-xs px-2.5 py-0.5 rounded-full font-bold ${selected.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'}`}>
                        {selected.status === 'active' ? 'Current' : 'Past'}
                      </span>
                    </div>
                    <p className="text-xs text-slate-500">
                      Moved in {format(parseISO(selected.move_in_date), 'MMM d, yyyy')}
                      {selected.lease_end ? ` · Left ${format(parseISO(selected.lease_end), 'MMM d, yyyy')}` : ' · Still here'}
                      {' · '}<span className="font-medium text-slate-700">{durationLabel(selected.move_in_date, selected.lease_end)}</span>
                    </p>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <div className="text-center py-2 rounded-lg bg-green-50">
                      <p className="text-[11px] text-slate-500 mb-0.5">Total paid</p>
                      <p className="font-bold text-green-700 text-sm">{formatRWF(tenantTotalPaid)}</p>
                    </div>
                    <div className="text-center py-2 rounded-lg bg-amber-50">
                      <p className="text-[11px] text-slate-500 mb-0.5">In review</p>
                      <p className="font-bold text-amber-600 text-sm">{tenantPendingCount}</p>
                    </div>
                    <div className="text-center py-2 rounded-lg bg-red-50">
                      <p className="text-[11px] text-slate-500 mb-0.5">Owed ({tenantOwedRows.length} mo)</p>
                      <p className="font-bold text-red-600 text-sm">{formatRWF(tenantOwed)}</p>
                    </div>
                  </div>
                  <div className="rounded-xl border divide-y overflow-hidden">
                    {tenantRows.map(r => (
                      <div key={r.period_month} className="flex items-center px-4 py-2 gap-3">
                        <p className="text-sm text-slate-600 w-20 shrink-0">{format(monthStart(r.period_month), 'MMM yyyy')}</p>
                        <div className="flex-1" />
                        <LedgerBadge row={r} isFuture={false} />
                        <p className="text-sm font-semibold text-slate-700 w-28 text-right shrink-0">{formatRWF(r.confirmed_paid)}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* ── Year history ── */}
            <div className="px-4 pt-4">
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">{year} — Month by month</p>
              <div className="rounded-xl border divide-y overflow-hidden">
                {monthRows.map(row => (
                  <div key={row.monthStr} className={`px-4 py-2.5 ${row.isFuture ? 'opacity-35' : ''}`}>
                    {row.entries.length === 0 ? (
                      <div className="flex items-center gap-3">
                        <p className="w-24 text-sm text-slate-600 shrink-0 font-medium">{row.label}</p>
                        <span className="text-xs text-slate-400 bg-slate-100 px-2.5 py-0.5 rounded-full font-bold">Vacant</span>
                      </div>
                    ) : row.entries.map(({ lease, row: led }, idx) => (
                      <div key={lease.id} className="flex items-center gap-3 py-0.5">
                        <p className="w-24 text-sm text-slate-600 shrink-0 font-medium">{idx === 0 ? row.label : ''}</p>
                        <p className="flex-1 text-sm text-slate-700 truncate">{lease.tenant_name}</p>
                        {led ? <LedgerBadge row={led} isFuture={row.isFuture} /> : <span className="text-xs text-slate-400 shrink-0">—</span>}
                        <p className="text-sm font-semibold text-green-700 w-28 text-right shrink-0">
                          {led && led.confirmed_paid > 0 ? formatRWF(led.confirmed_paid) : ''}
                        </p>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </div>

            <div className="px-4 py-4">
              <div className="flex items-center justify-between bg-slate-50 rounded-xl px-4 py-3">
                <p className="text-sm font-semibold text-slate-700">Total collected {year}</p>
                <p className="text-base font-bold text-green-700">{formatRWF(totalCollected)}</p>
              </div>
            </div>

          </div>
        </div>
      )}
    </>
  )
}

function LedgerBadge({ row, isFuture }: { row: LedgerRow; isFuture: boolean }) {
  if (isFuture) return <span className="text-xs text-slate-400 shrink-0">—</span>
  const base = 'flex items-center gap-1 text-xs px-2.5 py-0.5 rounded-full font-bold shrink-0'
  switch (row.status) {
    case 'paid':
      return <span className={`${base} text-green-700 bg-green-100`}><CheckCircle2 className="h-3 w-3" />Paid</span>
    case 'pending':
      return <span className={`${base} text-amber-700 bg-amber-100`}><Clock className="h-3 w-3" />Pending</span>
    case 'partial':
      return <span className={`${base} text-red-600 bg-red-50`}>Owes {formatRWF(row.balance || row.expected - row.confirmed_paid)}</span>
    case 'overdue':
      return <span className={`${base} text-red-600 bg-red-50`}>Unpaid {formatRWF(row.balance)}</span>
    default:
      return <span className={`${base} text-slate-500 bg-slate-100`}>Not due</span>
  }
}
