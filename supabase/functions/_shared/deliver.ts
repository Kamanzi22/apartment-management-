// Delivers notification rows that already exist (or were just inserted):
// Expo push to the phone apps, web push to browsers, and email for the types
// the web app emails today. The in-app row is the source of truth; delivery
// failures are logged and never undo it.

import type { Ctx } from './ports.ts'
import type { NewNotification } from './messages.ts'
import { buildExpoMessages, sendExpoPush, type ExpoMessage } from './expo.ts'
import { emailConfigured, sendEmail } from './email.ts'
import { emailLayout, escapeHtml } from './messages.ts'

/** Types that also go out by email when the recipient has email_notifications on (web parity: maintenance only). */
export const EMAIL_TYPES = new Set(['maintenance_updated'])

export interface DeliverySummary {
  recipients: number
  skipped: number
  expo: { sent: number; failed: number; removed: number }
  webPush: { sent: number; removed: number }
  email: { sent: number }
}

export type DeliverDeps = Pick<Ctx, 'env' | 'admin' | 'fetch' | 'webPush' | 'log' | 'now'>

function isActiveBan(bannedUntil: string | null, now: Date): boolean {
  if (!bannedUntil) return false
  const t = Date.parse(bannedUntil)
  return Number.isFinite(t) && t > now.getTime()
}

/** Placeholder addresses we create on account deletion never get mail. */
function isRealEmail(email: string | null): email is string {
  return !!email && !email.endsWith('.invalid')
}

export async function deliverNotifications(
  deps: DeliverDeps,
  items: NewNotification[],
  opts: { webPush: boolean },
): Promise<DeliverySummary> {
  const summary: DeliverySummary = {
    recipients: 0, skipped: 0,
    expo: { sent: 0, failed: 0, removed: 0 }, webPush: { sent: 0, removed: 0 }, email: { sent: 0 },
  }
  if (!items.length) return summary
  const now = deps.now()
  const userIds = [...new Set(items.map(n => n.user_id))]

  // Who may still receive anything: not deleted, not archived (banned).
  const recipients = new Map<string, { role: string; email: string | null; emailOn: boolean }>()
  await Promise.all(userIds.map(async id => {
    const [profile, authUser] = await Promise.all([deps.admin.getProfile(id), deps.admin.getAuthUser(id)])
    if (!profile || profile.deleted_at || !authUser || isActiveBan(authUser.bannedUntil, now)) return
    recipients.set(id, { role: profile.role, email: authUser.email, emailOn: profile.email_notifications })
  }))
  summary.recipients = recipients.size
  summary.skipped = userIds.length - recipients.size
  const live = items.filter(n => recipients.has(n.user_id))
  if (!live.length) return summary
  const liveIds = [...recipients.keys()]

  // Expo: every notification x every token of its recipient, sent in batches of 100.
  const tokens = await deps.admin.listExpoTokens(liveIds)
  const byUser = new Map<string, string[]>()
  for (const t of tokens) byUser.set(t.user_id, [...(byUser.get(t.user_id) ?? []), t.token])
  const messages: ExpoMessage[] = live.flatMap(n =>
    buildExpoMessages(byUser.get(n.user_id) ?? [], { title: n.title, body: n.body, url: n.link, tag: n.type }))
  if (messages.length) {
    const r = await sendExpoPush(messages, { fetch: deps.fetch, accessToken: deps.env.expoAccessToken, log: deps.log })
    summary.expo.sent = r.sent
    summary.expo.failed = r.failed
    if (r.deadTokens.length) {
      await deps.admin.deleteExpoTokens(r.deadTokens)
      summary.expo.removed = r.deadTokens.length
    }
  }

  // Web push, same payload and cleanup as src/lib/push.ts.
  if (opts.webPush && deps.webPush) {
    const subs = await deps.admin.listWebPushSubs(liveIds)
    const removed = new Set<string>()
    await Promise.all(live.flatMap(n => subs.filter(s => s.user_id === n.user_id).map(async s => {
      if (removed.has(s.id)) return
      const payload = JSON.stringify({ title: n.title, body: n.body, url: n.link ?? '/', tag: n.type })
      const r = await deps.webPush!.send(s, payload)
      if (r.ok) summary.webPush.sent++
      else if (r.status === 404 || r.status === 410) {
        removed.add(s.id)
        await deps.admin.deleteWebPushSub(s.id)
      }
    })))
    summary.webPush.removed = removed.size
  }

  // Email for the types the web emails, if the recipient wants it.
  if (emailConfigured(deps.env)) {
    for (const n of live) {
      const r = recipients.get(n.user_id)!
      if (!EMAIL_TYPES.has(n.type) || !r.emailOn || !isRealEmail(r.email)) continue
      const base = r.role === 'landlord' ? deps.env.landlordAppUrl : deps.env.tenantAppUrl
      const href = `${base}${n.link ?? '/'}`
      const sent = await sendEmail(deps.env, deps.fetch, r.email, n.title,
        emailLayout(n.title, escapeHtml(n.body), { href, label: 'Open the app' }))
      if (sent) summary.email.sent++
    }
  }
  return summary
}

/**
 * Inserts notification rows as the caller (RLS decides who may notify whom),
 * then delivers them unless the database webhook already does that.
 * Returns a warning text when the in-app rows could not be saved.
 */
export async function notifyAndDeliver(ctx: Ctx, items: NewNotification[]): Promise<string | null> {
  if (!items.length) return null
  const err = await ctx.user.insertNotifications(items)
  if (err) {
    ctx.log(`notify: insert failed (${err.code ?? 'no code'})`)
    return 'The change was saved, but the alert could not be sent.'
  }
  if (!ctx.env.webhookDelivery) {
    try {
      await deliverNotifications(ctx, items, { webPush: true })
    } catch (e) {
      ctx.log(`notify: delivery failed: ${e instanceof Error ? e.message : 'unknown'}`)
    }
  }
  return null
}
