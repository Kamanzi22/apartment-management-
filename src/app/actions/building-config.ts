'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'

type BillKey = 'cleaning' | 'electricity_bill' | 'water_bill'

const BILL_DB: Record<BillKey, { category: 'cleaning' | 'other'; description: string }> = {
  cleaning:        { category: 'cleaning', description: '__monthly_cleaning__' },
  electricity_bill:{ category: 'other',    description: '__electricity_bill__' },
  water_bill:      { category: 'other',    description: '__water_bill__' },
}

const SECURITY_SENTINEL = { category: 'security' as const, description: '__security_rate__', date: '2099-12-31' }

export async function upsertSecurityRate(amount: number) {
  if (process.env.NEXT_PUBLIC_DEMO_MODE === 'true') return { success: true }
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  await supabase.from('expenses')
    .delete()
    .is('unit_id', null)
    .eq('category', SECURITY_SENTINEL.category)
    .eq('description', SECURITY_SENTINEL.description)
    .eq('created_by', user.id)

  if (amount > 0) {
    const { error } = await supabase.from('expenses').insert({
      unit_id: null,
      category: SECURITY_SENTINEL.category,
      amount,
      expense_date: SECURITY_SENTINEL.date,
      description: SECURITY_SENTINEL.description,
      created_by: user.id,
    })
    if (error) return { error: error.message }
  }

  revalidatePath('/landlord/financials')
  return { success: true }
}

export async function upsertMonthlyBill(key: BillKey, amount: number, month: string) {
  if (process.env.NEXT_PUBLIC_DEMO_MODE === 'true') return { success: true }
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const { category, description } = BILL_DB[key]
  const [y, m] = month.split('-').map(Number)
  const monthStart = `${month}-01`
  const monthEnd   = `${month}-${new Date(y, m, 0).getDate()}`

  await supabase.from('expenses')
    .delete()
    .is('unit_id', null)
    .eq('category', category)
    .eq('description', description)
    .gte('expense_date', monthStart)
    .lte('expense_date', monthEnd)
    .eq('created_by', user.id)

  if (amount > 0) {
    const { error } = await supabase.from('expenses').insert({
      unit_id: null,
      category,
      amount,
      expense_date: monthStart,
      description,
      created_by: user.id,
    })
    if (error) return { error: error.message }
  }

  revalidatePath('/landlord/financials')
  return { success: true }
}
