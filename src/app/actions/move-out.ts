'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { getLandlordId } from '@/lib/landlord'
import { notify } from '@/lib/notify'

// Used by the old /tenant pages in this app.
export async function submitMoveOutNotice(formData: FormData) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const { data: lease } = await supabase
    .from('leases')
    .select('id, unit_id')
    .eq('tenant_id', user.id)
    .eq('status', 'active')
    .maybeSingle()

  if (!lease) return { error: 'No active lease found' }

  const { error } = await supabase.from('move_out_notices').insert({
    lease_id: lease.id,
    tenant_id: user.id,
    intended_move_out_date: formData.get('move_out_date') as string,
    reason: (formData.get('reason') as string) || null,
    status: 'submitted',
  })

  if (error) return { error: error.message }

  const { data: profile } = await supabase
    .from('profiles')
    .select('full_name, units(label)')
    .eq('id', user.id)
    .single()

  const landlordId = await getLandlordId(supabase)
  if (landlordId) {
    const unitLabel = (profile?.units as { label: string } | null)?.label ?? 'a unit'
    await notify(supabase, {
      user_id: landlordId,
      type: 'move_out_notice',
      title: 'Move-out notice received',
      body: `${profile?.full_name ?? 'A tenant'} (${unitLabel}) plans to move out on ${formData.get('move_out_date')}.`,
      link: `/landlord/units/${lease.unit_id}`,
    })
  }

  revalidatePath('/tenant/move-out')
  return { success: true }
}

export async function acknowledgeMoveOut(noticeId: string) {
  if (process.env.NEXT_PUBLIC_DEMO_MODE === 'true') return { success: true }
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }
  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  if (profile?.role !== 'landlord') return { error: 'Not authorized' }

  const { data: notice, error } = await supabase
    .from('move_out_notices')
    .update({ status: 'acknowledged' })
    .eq('id', noticeId)
    .select('tenant_id, intended_move_out_date')
    .single()

  if (error) return { error: error.message }

  await notify(supabase, {
    user_id: notice.tenant_id,
    type: 'move_out_acknowledged',
    title: 'Move-out notice acknowledged',
    body: `Your move-out notice for ${notice.intended_move_out_date} has been acknowledged.`,
    link: '/move-out',
  })

  revalidatePath('/landlord', 'layout')
  return { success: true }
}
