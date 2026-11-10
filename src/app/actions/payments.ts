'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { currentPeriodMonth } from '@/lib/rent-utils'
import { getLandlordId } from '@/lib/landlord'
import { notify } from '@/lib/notify'
import { parseAmountInput } from '@/lib/currency'

// Used by the old /tenant pages in this app. Each submission is a new row:
// a month can be paid in several parts, and a rejected receipt stays in the
// history while the resubmission is reviewed on its own.
export async function submitPayment(formData: FormData) {
  if (process.env.NEXT_PUBLIC_DEMO_MODE === 'true') return { success: true }
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const file = formData.get('receipt') as File | null
  const amount = parseAmountInput(formData.get('amount') as string)
  const leaseId = formData.get('lease_id') as string
  const periodMonth = (formData.get('period_month') as string) || currentPeriodMonth()
  if (!(amount > 0)) return { error: 'Enter the amount you paid.' }

  let receiptPath: string | null = null
  if (file && file.size > 0) {
    const ext = (file.name.split('.').pop() ?? 'jpg').replace(/[^a-z0-9]/gi, '').slice(0, 5) || 'jpg'
    const path = `${user.id}/${periodMonth}-${Date.now()}.${ext}`
    const { error: uploadError } = await supabase.storage.from('receipts').upload(path, file)
    if (uploadError) return { error: uploadError.message }
    receiptPath = path
  }

  const { error } = await supabase.from('payments').insert({
    lease_id: leaseId,
    tenant_id: user.id,
    period_month: periodMonth,
    amount,
    receipt_file_url: receiptPath,
    status: 'pending_review',
  })
  if (error) return { error: error.message }

  const landlordId = await getLandlordId(supabase)
  if (landlordId) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('full_name, units(label)')
      .eq('id', user.id)
      .single()
    const unitLabel = (profile?.units as { label: string } | null)?.label ?? 'a unit'
    await notify(supabase, {
      user_id: landlordId,
      type: 'payment_submitted',
      title: 'New payment receipt',
      body: `${profile?.full_name ?? 'A tenant'} (${unitLabel}) submitted a receipt for ${periodMonth}.`,
      link: '/landlord/rent',
    })
  }

  revalidatePath('/tenant')
  return { success: true }
}

export async function reviewPayment(
  paymentId: string,
  status: 'confirmed' | 'rejected',
  notes?: string
) {
  if (process.env.NEXT_PUBLIC_DEMO_MODE === 'true') return { success: true }
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const { data: payment, error: fetchError } = await supabase
    .from('payments')
    .update({
      status,
      reviewed_by: user.id,
      reviewed_at: new Date().toISOString(),
      landlord_notes: notes ?? null,
    })
    .eq('id', paymentId)
    .select('tenant_id, period_month, amount')
    .single()

  if (fetchError) return { error: fetchError.message }

  await notify(supabase, {
    user_id: payment.tenant_id,
    type: 'payment_reviewed',
    title: status === 'confirmed' ? 'Payment confirmed' : 'Payment rejected',
    body: status === 'confirmed'
      ? `Your payment for ${payment.period_month} has been confirmed.`
      : `Your payment for ${payment.period_month} was rejected. ${notes ? `Note: ${notes}` : 'Please upload the receipt again.'}`,
    link: '/',
  })

  revalidatePath('/landlord', 'layout')
  return { success: true }
}

// Landlord-only correction tool for a mistaken entry — e.g. wrong amount or
// month typed in by the tenant.
export async function updatePaymentRecord(
  paymentId: string,
  data: { amount: number; periodMonth: string }
) {
  if (process.env.NEXT_PUBLIC_DEMO_MODE === 'true') return { success: true }
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const { data: profile } = await supabase
    .from('profiles').select('role').eq('id', user.id).single()
  if (profile?.role !== 'landlord') return { error: 'Not authorized' }

  const { error } = await supabase
    .from('payments')
    .update({ amount: data.amount, period_month: data.periodMonth })
    .eq('id', paymentId)
  if (error) return { error: error.message }

  revalidatePath('/landlord', 'layout')
  return { success: true }
}

export async function deletePaymentRecord(paymentId: string) {
  if (process.env.NEXT_PUBLIC_DEMO_MODE === 'true') return { success: true }
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const { data: profile } = await supabase
    .from('profiles').select('role').eq('id', user.id).single()
  if (profile?.role !== 'landlord') return { error: 'Not authorized' }

  const { error } = await supabase.from('payments').delete().eq('id', paymentId)
  if (error) return { error: error.message }

  revalidatePath('/landlord', 'layout')
  return { success: true }
}
