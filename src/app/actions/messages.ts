'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { getLandlordId } from '@/lib/landlord'
import { notify } from '@/lib/notify'

const THREAD_PAGE_SIZE = 200

export interface ThreadMessage {
  id: string
  sender_id: string
  recipient_id: string | null
  body: string
  created_at: string
  read_at: string | null
}

export async function sendMessage(recipientId: string | null, body: string) {
  if (process.env.NEXT_PUBLIC_DEMO_MODE === 'true') return { success: true }
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }
  const text = body.trim()
  if (!text) return { error: 'Message cannot be empty' }

  const { data: sender } = await supabase
    .from('profiles')
    .select('full_name, role')
    .eq('id', user.id)
    .single()

  // Tenants (old /tenant pages) can only write to the landlord.
  const to = sender?.role === 'landlord' ? recipientId : await getLandlordId(supabase)
  if (sender?.role !== 'landlord' && !to) return { error: 'Landlord not found' }

  const { error } = await supabase.from('messages').insert({
    sender_id: user.id,
    recipient_id: to,
    body: text,
  })
  if (error) return { error: error.message }

  if (to) {
    await notify(supabase, {
      user_id: to,
      type: 'new_message',
      title: 'New message',
      body: `${sender?.full_name ?? 'Someone'} sent you a message.`,
      link: sender?.role === 'landlord' ? '/messages' : '/landlord/messages',
    })
  } else {
    // Broadcast — notify the tenants who can see it (those with a current unit).
    const { data: tenants } = await supabase
      .from('profiles')
      .select('id')
      .eq('role', 'tenant')
      .not('unit_id', 'is', null)
    await notify(supabase, (tenants ?? []).map(t => ({
      user_id: t.id,
      type: 'broadcast',
      title: 'Announcement',
      body: `${sender?.full_name ?? 'Landlord'}: ${text.slice(0, 80)}${text.length > 80 ? '…' : ''}`,
      link: '/messages',
    })))
  }

  revalidatePath('/landlord/messages')
  revalidatePath('/tenant/messages')
  return { success: true }
}

/** Marks the other person's messages to me as read (opening a thread clears its badge). */
export async function markMessagesRead(otherUserId: string) {
  if (process.env.NEXT_PUBLIC_DEMO_MODE === 'true') return
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return

  await supabase
    .from('messages')
    .update({ read_at: new Date().toISOString() })
    .eq('sender_id', otherUserId)
    .eq('recipient_id', user.id)
    .is('read_at', null)
  // No revalidatePath here: the old /tenant/messages page calls this while
  // rendering, where revalidation is not allowed. The landlord thread view
  // refreshes itself after calling it.
}

/**
 * One page of a thread, newest first, older than `before` (ISO time).
 * `threadId` is a tenant id, or 'broadcast' for announcements.
 */
export async function loadThreadMessages(threadId: string, before?: string): Promise<ThreadMessage[]> {
  if (process.env.NEXT_PUBLIC_DEMO_MODE === 'true') return []
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return []

  let query = supabase.from('messages').select('id, sender_id, recipient_id, body, created_at, read_at')
  query = threadId === 'broadcast'
    ? query.is('recipient_id', null)
    : query.or(`and(sender_id.eq.${user.id},recipient_id.eq.${threadId}),and(sender_id.eq.${threadId},recipient_id.eq.${user.id})`)
  if (before) query = query.lt('created_at', before)
  const { data } = await query.order('created_at', { ascending: false }).limit(THREAD_PAGE_SIZE)
  return data ?? []
}
