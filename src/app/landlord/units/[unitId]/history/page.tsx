import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { format, parseISO, subMonths, startOfMonth, endOfMonth } from 'date-fns'
import { ArrowLeft, Users, TrendingDown, DollarSign, Clock } from 'lucide-react'
import { createClient, getVerifiedUserId } from '@/lib/supabase/server'
import { Card, CardContent } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import { formatRWF } from '@/lib/currency'
import { formatPeriodMonth } from '@/lib/rent-utils'
import { EXPENSE_CATEGORIES, categoryLabel } from '@/lib/categories'

const SENTINEL_LABELS: Record<string, string> = {
  '__monthly_cleaning__': 'Cleaning (Monthly)',
  '__electricity_bill__': 'Electricity Bill',
  '__water_bill__':       'Water Bill',
}

const RANGES = [
  { key: '1m',  label: 'This month', months: 1 },
  { key: '6m',  label: '6 months',   months: 6 },
  { key: '12m', label: '12 months',  months: 12 },
] as const

type RangeKey = typeof RANGES[number]['key'] | 'year'

interface LeaseRow {
  id: string
  status: string
  monthly_rent: number
  lease_start: string
  lease_end: string | null
  profiles: { full_name: string } | null
}
interface PaymentRow {
  id: string
  period_month: string
  amount: number
  status: string
  submitted_at: string
  profiles: { full_name: string } | null
}
interface ExpenseRow {
  id: string
  category: string
  amount: number
  expense_date: string
  description: string
}

// Returns "yyyy-MM" periods, newest first.
function periodsFor(range: RangeKey, year: number): string[] {
  const now = new Date()
  if (range === 'year') {
    const lastMonth = year === now.getFullYear() ? now.getMonth() : 11
    const out: string[] = []
    for (let m = lastMonth; m >= 0; m--) out.push(format(new Date(year, m, 1), 'yyyy-MM'))
    return out
  }
  const count = RANGES.find(r => r.key === range)!.months
  return Array.from({ length: count }, (_, i) => format(subMonths(now, i), 'yyyy-MM'))
}

function expenseLabel(e: ExpenseRow) {
  return SENTINEL_LABELS[e.description] ?? categoryLabel(e.category, EXPENSE_CATEGORIES)
}

export default async function UnitHistoryPage({
  params,
  searchParams,
}: {
  params: Promise<{ unitId: string }>
  searchParams: Promise<{ range?: string; year?: string }>
}) {
  const [{ unitId }, sp] = await Promise.all([params, searchParams])
  const userId = await getVerifiedUserId()
  if (!userId) redirect('/login')

  const currentYear = new Date().getFullYear()
  const range: RangeKey = sp.range === 'year' || RANGES.some(r => r.key === sp.range)
    ? (sp.range as RangeKey)
    : '12m'
  const year = Number(sp.year) || currentYear

  const supabase = await createClient()

  const [{ data: unit }, { data: leasesRaw }, { data: paymentsRaw }, { data: expensesRaw }] = await Promise.all([
    supabase.from('units').select('id, label, bedroom_count, monthly_rent').eq('id', unitId).single(),
    supabase.from('leases')
      .select('id, status, monthly_rent, lease_start, lease_end, profiles!leases_tenant_id_fkey(full_name)')
      .eq('unit_id', unitId)
      .order('lease_start', { ascending: false }),
    supabase.from('payments')
      .select('id, period_month, amount, status, submitted_at, profiles!payments_tenant_id_fkey(full_name), leases!inner(unit_id)')
      .eq('leases.unit_id', unitId)
      .neq('status', 'rejected')
      .order('period_month', { ascending: false }),
    supabase.from('expenses')
      .select('id, category, amount, expense_date, description')
      .eq('unit_id', unitId)
      .order('expense_date', { ascending: false }),
  ])
  if (!unit) notFound()

  const leases = (leasesRaw ?? []) as unknown as LeaseRow[]
  const payments = (paymentsRaw ?? []) as unknown as PaymentRow[]
  const expenses = (expensesRaw ?? []) as unknown as ExpenseRow[]

  // Years that have any activity, so the year picker only offers useful options.
  const years = new Set<number>([currentYear])
  for (const l of leases) years.add(parseISO(l.lease_start).getFullYear())
  for (const p of payments) years.add(Number(p.period_month.slice(0, 4)))
  for (const e of expenses) years.add(Number(e.expense_date.slice(0, 4)))
  const minYear = Math.min(...years)
  const yearOptions = Array.from({ length: currentYear - minYear + 1 }, (_, i) => currentYear - i)

  const periods = periodsFor(range, year)

  const months = periods.map(period => {
    const [y, m] = period.split('-').map(Number)
    const monthStart = format(startOfMonth(new Date(y, m - 1)), 'yyyy-MM-dd')
    const monthEnd = format(endOfMonth(new Date(y, m - 1)), 'yyyy-MM-dd')

    const tenants = leases.filter(l =>
      l.lease_start <= monthEnd && (!l.lease_end || l.lease_end >= monthStart)
    )
    const monthPayments = payments.filter(p => p.period_month === period)
    const monthExpenses = expenses.filter(e => e.expense_date >= monthStart && e.expense_date <= monthEnd)

    const rentPaid = monthPayments.filter(p => p.status === 'confirmed').reduce((s, p) => s + p.amount, 0)
    const rentPending = monthPayments.filter(p => p.status === 'pending_review').reduce((s, p) => s + p.amount, 0)
    const rentExpected = tenants.reduce((s, l) => s + l.monthly_rent, 0)
    const expenseTotal = monthExpenses.reduce((s, e) => s + e.amount, 0)

    return { period, tenants, monthPayments, monthExpenses, rentPaid, rentPending, rentExpected, expenseTotal }
  })

  const totalPaid = months.reduce((s, m) => s + m.rentPaid, 0)
  const totalPending = months.reduce((s, m) => s + m.rentPending, 0)
  const totalExpenses = months.reduce((s, m) => s + m.expenseTotal, 0)
  const net = totalPaid - totalExpenses

  const rangeTitle = range === 'year'
    ? `${year}`
    : RANGES.find(r => r.key === range)!.label

  return (
    <div className="space-y-6">
      <div>
        <Link
          href={`/landlord?unit=${unit.id}`}
          className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 mb-3"
        >
          <ArrowLeft className="h-4 w-4" /> Overview
        </Link>
        <h1 className="text-2xl font-bold text-slate-900">{unit.label} — Unit History</h1>
        <p className="text-sm text-slate-500 mt-0.5">
          Tenant, rent paid and expenses for every month
        </p>
      </div>

      {/* Range picker */}
      <div className="space-y-2">
        <div className="flex flex-wrap gap-2">
          {RANGES.map(r => (
            <Link
              key={r.key}
              href={`/landlord/units/${unit.id}/history?range=${r.key}`}
              className={cn(
                'px-3 py-1.5 rounded-full text-sm font-medium border transition-colors',
                range === r.key
                  ? 'bg-slate-900 text-white border-slate-900'
                  : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
              )}
            >
              {r.label}
            </Link>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold text-slate-400 uppercase tracking-wide mr-1">By year</span>
          {yearOptions.map(y => (
            <Link
              key={y}
              href={`/landlord/units/${unit.id}/history?range=year&year=${y}`}
              className={cn(
                'px-3 py-1 rounded-full text-sm font-medium border transition-colors',
                range === 'year' && year === y
                  ? 'bg-slate-900 text-white border-slate-900'
                  : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
              )}
            >
              {y}
            </Link>
          ))}
        </div>
      </div>

      {/* Totals */}
      <div>
        <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">Totals · {rangeTitle}</p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="bg-white rounded-xl border shadow-sm p-3">
            <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide">Rent paid</p>
            <p className="text-lg font-bold text-green-600 mt-0.5">{formatRWF(totalPaid)}</p>
          </div>
          <div className="bg-white rounded-xl border shadow-sm p-3">
            <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide">Pending</p>
            <p className="text-lg font-bold text-amber-500 mt-0.5">{formatRWF(totalPending)}</p>
          </div>
          <div className="bg-white rounded-xl border shadow-sm p-3">
            <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide">Expenses</p>
            <p className="text-lg font-bold text-red-500 mt-0.5">{formatRWF(totalExpenses)}</p>
          </div>
          <div className="bg-white rounded-xl border shadow-sm p-3">
            <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide">Net</p>
            <p className={cn('text-lg font-bold mt-0.5', net >= 0 ? 'text-slate-900' : 'text-red-600')}>{formatRWF(net)}</p>
          </div>
        </div>
      </div>

      {/* Month by month */}
      <div className="space-y-3">
        {months.map(m => (
          <Card key={m.period} className="shadow-sm">
            <CardContent className="pt-4 pb-4 space-y-3">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div>
                  <p className="font-semibold text-slate-900">{formatPeriodMonth(m.period)}</p>
                  <div className="flex items-center gap-1.5 text-sm text-slate-600 mt-0.5">
                    <Users className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                    {m.tenants.length === 0
                      ? <span className="text-slate-400 italic">Vacant</span>
                      : m.tenants.map(t => t.profiles?.full_name ?? 'Unknown').join(', ')}
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide">Net</p>
                  <p className={cn('text-sm font-bold', m.rentPaid - m.expenseTotal >= 0 ? 'text-slate-900' : 'text-red-600')}>
                    {formatRWF(m.rentPaid - m.expenseTotal)}
                  </p>
                </div>
              </div>

              <div className="grid sm:grid-cols-2 gap-3">
                {/* Rent */}
                <div className="rounded-lg bg-slate-50 p-3">
                  <div className="flex items-center justify-between mb-1.5">
                    <p className="flex items-center gap-1.5 text-xs font-semibold text-slate-500 uppercase tracking-wide">
                      <DollarSign className="h-3.5 w-3.5 text-green-500" /> Rent paid
                    </p>
                    <p className="text-sm font-semibold text-green-600">{formatRWF(m.rentPaid)}</p>
                  </div>
                  {m.rentExpected > 0 && (
                    <p className="text-xs text-slate-400">Expected {formatRWF(m.rentExpected)}</p>
                  )}
                  {m.monthPayments.length === 0 ? (
                    <p className="text-xs text-slate-400 mt-1">
                      {m.tenants.length > 0 ? 'No payment recorded' : '—'}
                    </p>
                  ) : (
                    <ul className="mt-1.5 space-y-1">
                      {m.monthPayments.map(p => (
                        <li key={p.id} className="flex items-center justify-between gap-2 text-xs">
                          <span className="text-slate-600 truncate">
                            {p.profiles?.full_name ?? 'Unknown'} · {format(parseISO(p.submitted_at), 'MMM d, yyyy')}
                          </span>
                          <span className={cn('font-medium shrink-0 inline-flex items-center gap-1', p.status === 'confirmed' ? 'text-green-600' : 'text-amber-500')}>
                            {p.status !== 'confirmed' && <Clock className="h-3 w-3" />}
                            {formatRWF(p.amount)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                {/* Expenses */}
                <div className="rounded-lg bg-slate-50 p-3">
                  <div className="flex items-center justify-between mb-1.5">
                    <p className="flex items-center gap-1.5 text-xs font-semibold text-slate-500 uppercase tracking-wide">
                      <TrendingDown className="h-3.5 w-3.5 text-red-400" /> Expenses
                    </p>
                    <p className="text-sm font-semibold text-red-500">{formatRWF(m.expenseTotal)}</p>
                  </div>
                  {m.monthExpenses.length === 0 ? (
                    <p className="text-xs text-slate-400">No expenses</p>
                  ) : (
                    <ul className="space-y-1">
                      {m.monthExpenses.map(e => (
                        <li key={e.id} className="flex items-center justify-between gap-2 text-xs">
                          <span className="text-slate-600 truncate">
                            {expenseLabel(e)}
                            {e.description && !SENTINEL_LABELS[e.description] && (
                              <span className="text-slate-400"> · {e.description}</span>
                            )}
                            <span className="text-slate-400"> · {format(parseISO(e.expense_date), 'MMM d')}</span>
                          </span>
                          <span className="font-medium text-red-500 shrink-0">{formatRWF(e.amount)}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* All tenants who have lived here */}
      {leases.length > 0 && (
        <div>
          <h2 className="text-base font-semibold text-slate-800 mb-3">All Tenants</h2>
          <Card className="shadow-sm">
            <CardContent className="pt-2 pb-2 divide-y">
              {leases.map(l => (
                <div key={l.id} className="flex items-center justify-between py-2.5 gap-2">
                  <div>
                    <p className="text-sm font-medium text-slate-800">{l.profiles?.full_name ?? 'Unknown'}</p>
                    <p className="text-xs text-slate-500">
                      {format(parseISO(l.lease_start), 'MMMM d, yyyy')} – {l.lease_end ? format(parseISO(l.lease_end), 'MMMM d, yyyy') : 'present'}
                      {' · '}{formatRWF(l.monthly_rent)}/mo
                    </p>
                  </div>
                  <span className={cn('text-[10px] px-1.5 py-0.5 rounded-full font-semibold shrink-0',
                    l.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'
                  )}>
                    {l.status}
                  </span>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  )
}
