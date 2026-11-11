'use server'

import { createAdminClient, createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { getLandlordId } from '@/lib/landlord'
import { notify } from '@/lib/notify'
import { kigaliDateString } from '@/lib/rent-utils'
import { format, parseISO } from 'date-fns'
import { emailConfigured, emailLayout, escapeHtml, sendEmail } from '@/lib/email'
import { isOpenStatus, statusInfo, validateStatusChange, type MaintenanceStatus } from '@/lib/maintenance'

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
  repairCost?: number,
  scheduledFor?: string,
) {
  if (process.env.NEXT_PUBLIC_DEMO_MODE === 'true') return { success: true }
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }
  const { data: me } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  if (me?.role !== 'landlord') return { error: 'Only the landlord can change the status' }

  const { data: current } = await supabase
    .from('maintenance_requests').select('status').eq('id', requestId).maybeSingle()
  if (!current) return { error: 'Request not found' }
  const note = comment?.trim() || null
  const invalid = validateStatusChange(current.status, status, note, scheduledFor)
  if (invalid) return { error: invalid }

  // The status history row is written by a database trigger (migration 14).
  const { data: req, error } = await supabase
    .from('maintenance_requests')
    .update({
      status: status as MaintenanceStatus,
      landlord_comment: note,
      ...(status === 'scheduled' ? { scheduled_for: scheduledFor } : {}),
    })
    .eq('id', requestId)
    .select('tenant_id, category, unit_id, description')
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

  const reopened = !isOpenStatus(current.status) && isOpenStatus(status)
  const label = statusInfo(status).label.toLowerCase()
  const when = status === 'scheduled' && scheduledFor ? ` for ${format(parseISO(scheduledFor), 'EEEE d MMMM')}` : ''
  const title = reopened ? 'Repair request reopened' : 'Repair request updated'
  const body = `Your ${req.category.replace('_', ' ')} request is now ${label}${when}.${note ? ` Note: ${note}` : ''}`

  await notify(supabase, { user_id: req.tenant_id, type: 'maintenance_updated', title, body, link: '/maintenance' })

  // Email too, if the tenant has email on.
  if (emailConfigured()) {
    const admin = await createAdminClient()
    const [{ data: tenant }, { data: authUser }] = await Promise.all([
      admin.from('profiles').select('email_notifications').eq('id', req.tenant_id).single(),
      admin.auth.admin.getUserById(req.tenant_id),
    ])
    const to = authUser.user?.email
    if (tenant?.email_notifications && to) {
      await sendEmail(to, title, emailLayout(title, escapeHtml(body), {
        href: `${process.env.TENANT_APP_URL ?? 'https://apartment-manager-tenant.onrender.com'}/maintenance`, label: 'View request',
      }))
    }
  }

  revalidatePath('/landlord', 'layout')
  return { success: true }
}

export interface MaintenanceDetail {
  history: { id: string; from_status: string | null; to_status: string; comment: string | null; changed_at: string }[]
  updates: { id: string; body: string; photo_paths: string[]; created_at: string }[]
}

/** Status history and the tenant's follow-ups for one request. */
export async function getMaintenanceDetail(requestId: string): Promise<MaintenanceDetail> {
  if (process.env.NEXT_PUBLIC_DEMO_MODE === 'true') return { history: [], updates: [] }
  const supabase = await createClient()
  const [{ data: history }, { data: updates }] = await Promise.all([
    supabase.from('maintenance_status_history').select('id, from_status, to_status, comment, changed_at')
      .eq('request_id', requestId).order('changed_at'),
    supabase.from('maintenance_updates').select('id, body, photo_paths, created_at')
      .eq('request_id', requestId).order('created_at'),
  ])
  return { history: history ?? [], updates: updates ?? [] }
}
