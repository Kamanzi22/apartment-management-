// Kept identical in apartment-manager and apartment-manager-tenant. Server-only.
import { after } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/database.types'
import { sendPush } from '@/lib/push'

export interface NewNotification {
  user_id: string
  type: string
  title: string
  body: string
  link: string | null
}

/**
 * Saves in-app notifications and, after the response is sent, pushes them to
 * any browser the recipient opted in on. Returns the insert error message, if any.
 * (No .select() after the insert: a tenant may not read the landlord's rows back.)
 */
export async function notify(
  supabase: SupabaseClient<Database>,
  items: NewNotification | NewNotification[],
): Promise<string | null> {
  const list = Array.isArray(items) ? items : [items]
  if (!list.length) return null
  const { error } = await supabase.from('notifications').insert(list)
  if (error) {
    console.error('notify failed:', error.message)
    return error.message
  }
  after(async () => {
    try {
      await Promise.all(list.map(n => sendPush([n.user_id], { title: n.title, body: n.body, url: n.link, tag: n.type })))
    } catch (e) {
      console.error('push failed:', e)
    }
  })
  return null
}
