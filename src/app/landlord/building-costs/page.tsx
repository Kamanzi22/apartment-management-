import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { CostsDashboard } from './costs-dashboard'
import { format } from 'date-fns'

export default async function BuildingCostsPage() {
  if (process.env.NEXT_PUBLIC_DEMO_MODE === 'true') {
    return (
      <CostsDashboard
        securityMonthly={0}
        allBuildingExpenses={[]}
        initialMonth={format(new Date(), 'yyyy-MM')}
      />
    )
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const [{ data: securityRecord }, { data: buildingExpenses }] = await Promise.all([
    supabase
      .from('expenses')
      .select('amount')
      .is('unit_id', null)
      .eq('category', 'security')
      .eq('description', '__security_rate__')
      .eq('created_by', user.id)
      .maybeSingle(),
    supabase
      .from('expenses')
      .select('id, category, amount, expense_date, description, created_at')
      .is('unit_id', null)
      .eq('created_by', user.id)
      .order('expense_date', { ascending: false }),
  ])

  return (
    <CostsDashboard
      securityMonthly={securityRecord?.amount ?? 0}
      allBuildingExpenses={buildingExpenses ?? []}
      initialMonth={format(new Date(), 'yyyy-MM')}
    />
  )
}
