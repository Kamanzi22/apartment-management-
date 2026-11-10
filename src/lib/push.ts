// Kept identical in apartment-manager and apartment-manager-tenant. Server-only.
//
// Web push through each app's public/sw.js. Needs NEXT_PUBLIC_VAPID_PUBLIC_KEY,
// VAPID_PRIVATE_KEY and VAPID_SUBJECT (mailto: or https: URL). Without them
// every call is a no-op, so the rest of the app works unchanged.
import webpush from 'web-push'
import { createAdminClient } from '@/lib/supabase/server'

export function pushConfigured(): boolean {
  return !!process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY && !!process.env.VAPID_PRIVATE_KEY
}

export interface PushPayload {
  title: string
  body: string
  url?: string | null
  tag?: string
}

/** Sends to every browser the users opted in on. Returns how many were delivered. */
export async function sendPush(userIds: string[], payload: PushPayload): Promise<number> {
  if (!pushConfigured() || !userIds.length) return 0
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT ?? 'mailto:admin@example.com',
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!,
    process.env.VAPID_PRIVATE_KEY!,
  )
  const admin = await createAdminClient()
  const { data: subs } = await admin
    .from('push_subscriptions')
    .select('id, endpoint, p256dh, auth')
    .in('user_id', [...new Set(userIds)])

  let sent = 0
  const body = JSON.stringify({ title: payload.title, body: payload.body, url: payload.url ?? '/', tag: payload.tag })
  await Promise.all((subs ?? []).map(async s => {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, body, { TTL: 86400 })
      sent++
    } catch (e) {
      const status = (e as { statusCode?: number }).statusCode
      // The browser unsubscribed or the subscription expired.
      if (status === 404 || status === 410) await admin.from('push_subscriptions').delete().eq('id', s.id)
    }
  }))
  return sent
}
