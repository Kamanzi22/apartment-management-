'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { getLandlordId } from '@/lib/landlord'
import { notify } from '@/lib/notify'
import { kigaliDateString } from '@/lib/rent-utils'

// Used by the old /tenant pages in this app.
export async function submitMaintenanceRequest(formData: FormData) {
  if (process.env.NEXT_PUBLIC_DEMO_MODE === 'true') return { success: true }
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const { data: profile } = await supabase
    .from('profiles')
    .select('unit_id, full_name, units(label)')
    .eq('id', user.id)
    .single()

  if (!profile?.unit_id) return { error: 'No unit assigned' }

  const photos = formData.getAll('photos') as File[]
  const photoPaths: string[] = []

  for (const photo of photos) {
    if (photo.size === 0) continue
    const ext = (photo.name.split('.').pop() ?? 'jpg').replace(/[^a-z0-9]/gi, '').slice(0, 5) || 'jpg'
    const path = `${user.id}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`
    const { error } = await supabase.storage
      .from('maintenance-photos')
      .upload(path, photo)
    if (!error) photoPaths.push(path)
  }

  const { error } = await supabase.from('maintenance_requests').insert({
    unit_id: profile.unit_id,
    tenant_id: user.id,
    category: formData.get('category') as 'electrical' | 'plumbing' | 'appliances' | 'structural' | 'pest_control' | 'safety' | 'wifi' | 'other',
    description: formData.get('description') as string,
    urgency: formData.get('urgency') as 'low' | 'medium' | 'high',
    photo_urls: photoPaths,
    status: 'submitted',
    landlord_comment: null,
  })

  if (error) return { error: error.message }

  const landlordId = await getLandlordId(supabase)
  if (landlordId) {
    const unitLabel = (profile.units as { label: string } | null)?.label ?? 'a unit'
    await notify(supabase, {
      user_id: landlordId,
      type: 'maintenance_submitted',
      title: 'New maintenance request',
      body: `${profile.full_name} (${unitLabel}) submitted a ${formData.get('urgency')} priority request.`,
      link: '/landlord/maintenance',
    })
  }

  revalidatePath('/tenant/maintenance')
  return { success: true }
}

export async function updateMaintenanceStatus(
  requestId: string,
  status: string,
  comment?: string,
  repairCost?: number
) {
  if (process.env.NEXT_PUBLIC_DEMO_MODE === 'true') return { success: true }
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const { data: req, error } = await supabase
    .from('maintenance_requests')
    .update({ status: status as 'submitted' | 'acknowledged' | 'in_progress' | 'resolved', landlord_comment: comment ?? null })
    .eq('id', requestId)
    .select('tenant_id, category, unit_id')
    .single()

  if (error) return { error: error.message }

  // Log repair cost as an expense if provided
  if (repairCost && repairCost > 0 && req.unit_id) {
    await supabase.from('expenses').insert({
      unit_id: req.unit_id,
      category: req.category,
      amount: repairCost,
      expense_date: kigaliDateString(),
      description: `Maintenance repair (${req.category})`,
      linked_maintenance_request_id: requestId,
      created_by: user.id,
    })
  }

  const statusLabel: Record<string, string> = {
    acknowledged: 'acknowledged',
    in_progress: 'in progress',
    resolved: 'resolved',
  }

  await notify(supabase, {
    user_id: req.tenant_id,
    type: 'maintenance_updated',
    title: 'Maintenance request updated',
    body: `Your ${req.category} request has been marked as ${statusLabel[status] ?? status}.${comment ? ` Note: ${comment}` : ''}`,
    link: '/maintenance',
  })

  revalidatePath('/landlord/maintenance')
  revalidatePath('/landlord')
  return { success: true }
}
