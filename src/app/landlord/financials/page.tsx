import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { FinancialDashboard } from './financial-dashboard'
import { format, startOfYear, endOfMonth, subMonths, startOfMonth } from 'date-fns'
import { demoUnitsSimple, demoActiveLeases, demoPayments, demoExpenses, demoMaintenanceRequests } from '@/lib/demo-data'

export default async function FinancialsPage() {
  if (process.env.NEXT_PUBLIC_DEMO_MODE === 'true') {
    const now = new Date()
    const currentMonthStart = format(startOfMonth(now), 'yyyy-MM-dd')
    const currentMonthEnd   = format(endOfMonth(now), 'yyyy-MM-dd')
    const yearStart         = format(startOfYear(now), 'yyyy-MM-dd')
    const chartStart        = format(startOfMonth(subMonths(now, 11)), 'yyyy-MM-dd')
    return (
      <FinancialDashboard
        units={demoUnitsSimple}
        activeLeases={demoActiveLeases}
        allPayments={demoPayments as any}
        allExpenses={demoExpenses as any}
        maintenanceRequests={demoMaintenanceRequests.filter(r => r.status !== 'resolved') as any}
        currentMonthStart={currentMonthStart}
        currentMonthEnd={currentMonthEnd}
        yearStart={yearStart}
        chartStart={chartStart}
        currentMonth={format(now, 'yyyy-MM')}
        securityMonthly={0}
      />
    )
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // Date ranges
  const now = new Date()
  const currentMonthStart = format(startOfMonth(now), 'yyyy-MM-dd')
  const currentMonthEnd = format(endOfMonth(now), 'yyyy-MM-dd')
  const yearStart = format(startOfYear(now), 'yyyy-MM-dd')
  // 12 months back for the chart
  const chartStart = format(startOfMonth(subMonths(now, 11)), 'yyyy-MM-dd')

  const [
    { data: units },
    { data: activeLeases },
    { data: allPayments },
    { data: allExpenses },
    { data: maintenanceRequests },
  ] = await Promise.all([
    supabase.from('units').select('id, label, monthly_rent, status').order('label'),
    supabase.from('leases').select('id, unit_id, tenant_id, monthly_rent').eq('status', 'active'),
    supabase.from('payments')
      .select('id, tenant_id, period_month, amount, status, lease_id')
      .gte('submitted_at', chartStart)
      .order('period_month', { ascending: false }),
    supabase.from('expenses')
      .select(`
        id, unit_id, category, amount, expense_date, description,
        receipt_file_url, linked_maintenance_request_id, created_at,
        units(label)
      `)
      .gte('expense_date', chartStart)
      .order('expense_date', { ascending: false }),
    supabase.from('maintenance_requests')
      .select('id, unit_id, category, description, created_at')
      .order('created_at', { ascending: false }),
  ])

  const { data: securityRecord } = await supabase
    .from('expenses')
    .select('amount')
    .is('unit_id', null)
    .eq('category', 'security')
    .eq('description', '__security_rate__')
    .eq('created_by', user.id)
    .maybeSingle()

  return (
    <FinancialDashboard
      units={units ?? []}
      activeLeases={activeLeases ?? []}
      allPayments={allPayments ?? []}
      allExpenses={(allExpenses ?? []) as ExpenseWithUnit[]}
      maintenanceRequests={maintenanceRequests ?? []}
      currentMonthStart={currentMonthStart}
      currentMonthEnd={currentMonthEnd}
      yearStart={yearStart}
      chartStart={chartStart}
      currentMonth={format(now, 'yyyy-MM')}
      securityMonthly={securityRecord?.amount ?? 0}
    />
  )
}

export interface ExpenseWithUnit {
  id: string
  unit_id: string | null
  category: string
  amount: number
  expense_date: string
  description: string
  receipt_file_url: string | null
  linked_maintenance_request_id: string | null
  created_at: string
  units: { label: string } | null
}
