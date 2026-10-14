import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { createClient, getVerifiedUserId } from '@/lib/supabase/server'
import { UnitActivityTable, type ActivityRow } from './unit-activity-table'

export default async function UnitActivityPage({
  params,
}: {
  params: Promise<{ unitId: string }>
}) {
  const { unitId } = await params
  const userId = await getVerifiedUserId()
  if (!userId) redirect('/login')

  const supabase = await createClient()

  const { data: unit } = await supabase.from('units').select('id, label').eq('id', unitId).single()
  if (!unit) notFound()

  const [{ data: payments }, { data: expenses }] = await Promise.all([
    supabase
      .from('payments')
      .select('id, amount, period_month, submitted_at, status, tenant_id, profiles!payments_tenant_id_fkey(full_name), leases!inner(unit_id)')
      .eq('leases.unit_id', unitId)
      .order('submitted_at', { ascending: false }),
    supabase
      .from('expenses')
      .select('id, amount, category, description, expense_date, created_at')
      .eq('unit_id', unitId)
      .order('expense_date', { ascending: false }),
  ])

  const incomeRows: ActivityRow[] = (payments ?? []).map(p => ({
    id: p.id,
    kind: 'in',
    date: p.submitted_at,
    periodMonth: p.period_month,
    tenantName: (p.profiles as { full_name: string } | null)?.full_name ?? 'Unknown tenant',
    status: p.status,
    amount: p.amount,
  }))

  const expenseRows: ActivityRow[] = (expenses ?? []).map(e => ({
    id: e.id,
    kind: 'out',
    date: e.expense_date,
    category: e.category,
    description: e.description,
    amount: e.amount,
  }))

  const allRows = [...incomeRows, ...expenseRows].sort((a, b) => b.date.localeCompare(a.date))

  const totalIn = incomeRows.filter(r => r.status === 'confirmed').reduce((s, r) => s + r.amount, 0)
  const totalOut = expenseRows.reduce((s, r) => s + r.amount, 0)

  return (
    <div className="space-y-4">
      <div>
        <Link
          href="/landlord/financials"
          className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 mb-3"
        >
          <ArrowLeft className="h-4 w-4" /> Financials
        </Link>
        <h1 className="text-2xl font-bold text-slate-900">{unit.label} — Full Activity</h1>
        <p className="text-sm text-slate-500 mt-0.5">
          Every payment received and every expense logged for this unit, across all tenants
        </p>
      </div>

      <UnitActivityTable rows={allRows} totalIn={totalIn} totalOut={totalOut} />
    </div>
  )
}
