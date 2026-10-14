'use client'

import { useState, useMemo } from 'react'
import { Search, CheckCircle2, Clock, AlertCircle, X } from 'lucide-react'
import { format, differenceInMonths } from 'date-fns'
import { formatRWF } from '@/lib/currency'

interface Lease {
  id: string
  unit_id: string
  unit_label: string
  tenant_id: string
  tenant_name: string
  monthly_rent: number
  rent_due_day: number
  move_in_date: string
  lease_end: string | null
  status: string
}

interface Payment {
  lease_id: string
  period_month: string
  amount: number
  status: string
}

interface Props {
  leases: Lease[]
  payments: Payment[]
}

function monthsBetween(startStr: string, endStr: string): string[] {
  const result: string[] = []
  const [sy, sm] = startStr.split('-').map(Number)
  const [ey, em] = endStr.split('-').map(Number)
  let y = sy, m = sm
  while (y < ey || (y === ey && m <= em)) {
    result.push(`${y}-${String(m).padStart(2, '0')}`)
    m++
    if (m > 12) { m = 1; y++ }
  }
  return result
}

function formatMonthLabel(ym: string) {
  const [y, m] = ym.split('-').map(Number)
  return format(new Date(y, m - 1), 'MMM yyyy')
}

function durationLabel(start: string, end: string | null): string {
  const s = new Date(start)
  const e = end ? new Date(end) : new Date()
  const months = differenceInMonths(e, s)
  if (months < 1) return 'Less than a month'
  if (months === 1) return '1 month'
  if (months < 12) return `${months} months`
  const years = Math.floor(months / 12)
  const rem = months % 12
  return rem === 0 ? `${years} year${years > 1 ? 's' : ''}` : `${years}y ${rem}m`
}

export function TenantSearch({ leases, payments }: Props) {
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<Lease | null>(null)

  const now = new Date()
  const todayStr = format(now, 'yyyy-MM')

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return []
    return leases.filter(l => l.tenant_name.toLowerCase().includes(q))
  }, [query, leases])

  function selectLease(lease: Lease) {
    setSelected(lease)
    setQuery(lease.tenant_name)
  }

  function clear() {
    setQuery('')
    setSelected(null)
  }

  // Build payment rows for selected lease
  const paymentRows = useMemo(() => {
    if (!selected) return []
    const endMonth = selected.lease_end
      ? format(new Date(selected.lease_end), 'yyyy-MM')
      : todayStr
    const startMonth = format(new Date(selected.move_in_date), 'yyyy-MM')
    const months = monthsBetween(startMonth, endMonth)
    return months.map(mo => {
      const payment = payments.find(p => p.lease_id === selected.id && p.period_month === mo)
      return { month: mo, payment: payment ?? null }
    })
  }, [selected, payments, todayStr])

  const totalPaid = paymentRows
    .filter(r => r.payment?.status === 'confirmed')
    .reduce((s, r) => s + (r.payment?.amount ?? 0), 0)

  const unpaidMonths = paymentRows.filter(r => !r.payment || r.payment.status === 'unpaid').length
  const pendingMonths = paymentRows.filter(r => r.payment?.status === 'pending_review').length

  return (
    <div className="bg-white rounded-xl border shadow-sm overflow-hidden">
      <div className="px-4 py-3 border-b bg-slate-50 flex items-center gap-2">
        <Search className="h-4 w-4 text-slate-400" />
        <h2 className="font-semibold text-slate-700 text-sm">Search Tenant</h2>
      </div>

      <div className="p-4 space-y-3">
        {/* Search input */}
        <div className="relative">
          <input
            type="text"
            value={query}
            onChange={e => { setQuery(e.target.value); setSelected(null) }}
            placeholder="Type tenant name…"
            className="w-full text-sm border rounded-xl px-4 py-2.5 pr-9 text-slate-700 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-300"
          />
          {query && (
            <button onClick={clear} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-300 hover:text-slate-500">
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        {/* Autocomplete dropdown */}
        {matches.length > 0 && !selected && (
          <div className="rounded-xl border divide-y shadow-sm">
            {matches.map(l => (
              <button
                key={l.id}
                onClick={() => selectLease(l)}
                className="w-full text-left px-4 py-2.5 hover:bg-slate-50 transition-colors"
              >
                <p className="text-sm font-medium text-slate-800">{l.tenant_name}</p>
                <p className="text-xs text-slate-400">{l.unit_label} · {l.status === 'active' ? 'Current tenant' : `Moved out ${l.lease_end ? format(new Date(l.lease_end), 'MMM d, yyyy') : ''}`}</p>
              </button>
            ))}
          </div>
        )}

        {query && matches.length === 0 && !selected && (
          <p className="text-sm text-slate-400 text-center py-2">No tenant found</p>
        )}

        {/* Tenant detail */}
        {selected && (
          <div className="space-y-4">
            {/* Summary header */}
            <div className="bg-slate-50 rounded-xl px-4 py-3 space-y-1">
              <div className="flex items-center justify-between">
                <p className="font-semibold text-slate-900">{selected.tenant_name}</p>
                <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${selected.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'}`}>
                  {selected.status === 'active' ? 'Current' : 'Past'}
                </span>
              </div>
              <p className="text-xs text-slate-500">{selected.unit_label} · {formatRWF(selected.monthly_rent)}/mo</p>
              <p className="text-xs text-slate-500">
                Moved in {format(new Date(selected.move_in_date), 'MMM d, yyyy')}
                {selected.lease_end ? ` · Moved out ${format(new Date(selected.lease_end), 'MMM d, yyyy')}` : ' · Still here'}
                {' · '}<span className="font-medium text-slate-700">{durationLabel(selected.move_in_date, selected.lease_end)}</span>
              </p>
            </div>

            {/* Stats */}
            <div className="grid grid-cols-3 gap-2">
              <div className="text-center py-2 px-1 rounded-lg bg-green-50">
                <p className="text-xs text-slate-500 mb-0.5">Paid</p>
                <p className="font-bold text-green-700">{formatRWF(totalPaid)}</p>
              </div>
              <div className="text-center py-2 px-1 rounded-lg bg-amber-50">
                <p className="text-xs text-slate-500 mb-0.5">Pending</p>
                <p className="font-bold text-amber-600">{pendingMonths}</p>
              </div>
              <div className="text-center py-2 px-1 rounded-lg bg-red-50">
                <p className="text-xs text-slate-500 mb-0.5">Unpaid</p>
                <p className="font-bold text-red-600">{unpaidMonths}</p>
              </div>
            </div>

            {/* Month-by-month */}
            <div className="rounded-xl border divide-y overflow-hidden">
              {paymentRows.map(({ month, payment }) => (
                <div key={month} className="flex items-center px-4 py-2 gap-3">
                  <p className="text-sm text-slate-600 w-20 shrink-0">{formatMonthLabel(month)}</p>
                  <div className="flex-1" />
                  {!payment ? (
                    <span className="text-xs text-red-600 bg-red-50 px-2 py-0.5 rounded-full flex items-center gap-1">
                      <AlertCircle className="h-3 w-3" />Unpaid
                    </span>
                  ) : payment.status === 'confirmed' ? (
                    <>
                      <span className="text-xs text-green-700 bg-green-100 px-2 py-0.5 rounded-full flex items-center gap-1">
                        <CheckCircle2 className="h-3 w-3" />Paid
                      </span>
                      <p className="text-sm font-semibold text-green-700 w-16 text-right">{formatRWF(payment.amount)}</p>
                    </>
                  ) : payment.status === 'pending_review' ? (
                    <>
                      <span className="text-xs text-amber-700 bg-amber-100 px-2 py-0.5 rounded-full flex items-center gap-1">
                        <Clock className="h-3 w-3" />Pending
                      </span>
                      <p className="text-sm font-semibold text-amber-600 w-16 text-right">{formatRWF(payment.amount)}</p>
                    </>
                  ) : (
                    <span className="text-xs text-red-600 bg-red-50 px-2 py-0.5 rounded-full flex items-center gap-1">
                      <AlertCircle className="h-3 w-3" />Unpaid
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
