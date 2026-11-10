'use server'

// Kept identical in apartment-manager and apartment-manager-tenant.
import { createAdminClient, createClient } from '@/lib/supabase/server'

interface BrowserSubscription {
  endpoint?: string
  keys?: { p256dh?: string; auth?: string }
}

export async function savePushSubscription(sub: BrowserSubscription): Promise<{ error?: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not signed in' }

  const endpoint = sub.endpoint ?? ''
  const p256dh = sub.keys?.p256dh ?? ''
  const auth = sub.keys?.auth ?? ''
  if (!endpoint.startsWith('https://') || !p256dh || !auth || endpoint.length > 2000) {
    return { error: 'This browser returned an invalid subscription' }
  }

  // The endpoint belongs to this browser; if another account used it before, move it over.
  const admin = await createAdminClient()
  await admin.from('push_subscriptions').delete().eq('endpoint', endpoint).neq('user_id', user.id)

  const { error } = await supabase
    .from('push_subscriptions')
    .upsert({ user_id: user.id, endpoint, p256dh, auth }, { onConflict: 'endpoint' })
  return error ? { error: error.message } : {}
}

export async function deletePushSubscription(endpoint: string): Promise<{ error?: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not signed in' }
  const { error } = await supabase.from('push_subscriptions').delete().eq('endpoint', endpoint).eq('user_id', user.id)
  return error ? { error: error.message } : {}
}
