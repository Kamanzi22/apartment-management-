import { redirect } from 'next/navigation'
import { createClient, getVerifiedUserId } from '@/lib/supabase/server'
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

  const userId = await getVerifiedUserId()
  if (!userId) redirect('/login')

  const supabase = await createClient()

  const [{ data: securityRecord }, { data: buildingExpenses }] = await Promise.all([
    supabase
      .from('expenses')
      .select('amount')
      .is('unit_id', null)
      .eq('category', 'security')
      .eq('description', '__security_rate__')
      .eq('created_by', userId)
      .maybeSingle(),
    supabase
      .from('expenses')
      .select('id, category, amount, expense_date, description, created_at')
      .is('unit_id', null)
      .eq('created_by', userId)
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
