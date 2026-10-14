'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import type { ExpenseCategory } from '@/lib/categories'
import { parseAmountInput } from '@/lib/currency'

export async function createExpense(formData: FormData) {
  if (process.env.NEXT_PUBLIC_DEMO_MODE === 'true') return { success: true }
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const file = formData.get('receipt') as File | null
  let receiptUrl: string | null = null

  if (file && file.size > 0) {
    const ext = file.name.split('.').pop()
    const path = `${user.id}/${Date.now()}.${ext}`
    const { error: uploadError } = await supabase.storage
      .from('expense-receipts')
      .upload(path, file, { upsert: true })
    if (uploadError) return { error: uploadError.message }
    const { data: { publicUrl } } = supabase.storage.from('expense-receipts').getPublicUrl(path)
    receiptUrl = publicUrl
  }

  const unitIdRaw = formData.get('unit_id') as string | null
  const linkedMrRaw = formData.get('linked_maintenance_request_id') as string | null

  const { error } = await supabase.from('expenses').insert({
    unit_id: unitIdRaw || null,
    category: formData.get('category') as ExpenseCategory,
    amount: parseAmountInput(formData.get('amount') as string),
    expense_date: formData.get('expense_date') as string,
    description: formData.get('description') as string,
    receipt_file_url: receiptUrl,
    linked_maintenance_request_id: linkedMrRaw || null,
    created_by: user.id,
  })

  if (error) return { error: error.message }

  revalidatePath('/landlord/financials')
  return { success: true }
}

export async function updateExpense(
  id: string,
  data: { category: ExpenseCategory; amount: number; expenseDate: string; description: string }
) {
  if (process.env.NEXT_PUBLIC_DEMO_MODE === 'true') return { success: true }
  const supabase = await createClient()
  const { error } = await supabase
    .from('expenses')
    .update({
      category: data.category,
      amount: data.amount,
      expense_date: data.expenseDate,
      description: data.description,
    })
    .eq('id', id)
  if (error) return { error: error.message }
  revalidatePath('/landlord', 'layout')
  return { success: true }
}

export async function deleteExpense(id: string) {
  if (process.env.NEXT_PUBLIC_DEMO_MODE === 'true') return { success: true }
  const supabase = await createClient()
  const { error } = await supabase.from('expenses').delete().eq('id', id)
  if (error) return { error: error.message }
  revalidatePath('/landlord', 'layout')
  return { success: true }
}
