// notify: two ways in.
//
// 1. Signed-in user (phone or web): { userId, type, title, body, link }.
//    The in-app row is inserted AS THE CALLER, so the notifications RLS
//    policies decide first (landlord -> anyone, tenant -> landlord only);
//    canNotify() adds a type allow-list for tenants on top. Then the row is
//    delivered (Expo push + web push + email for the emailed types).
//    A body/title from a client is never sent to someone RLS would not let
//    that client notify, so this is not a spam relay.
//
// 2. Database webhook on notifications INSERT (header x-webhook-secret):
//    delivers a row that already exists, whoever wrote it (web, phone, cron).
//    Only active when NOTIFY_WEBHOOK_ENABLED=true; then the other functions
//    stop delivering on their own, so nothing is pushed twice.

import { HttpError, safeEqual } from '../http.ts'
import { canNotify, requireSignedIn } from '../authz.ts'
import { isAppPath, isUuid, parseNotify } from '../validate.ts'
import { deliverNotifications, type DeliverySummary } from '../deliver.ts'
import type { NewNotification } from '../messages.ts'
import type { Ctx } from '../ports.ts'

export type NotifyResult =
  | { ok: true; delivered: DeliverySummary | null; warning?: string }
  | { ok: true; skipped: string }

/** The record of a Supabase database webhook payload, checked field by field. */
export function parseWebhookRecord(body: Record<string, unknown>): NewNotification | null {
  if (body.type !== 'INSERT' || body.table !== 'notifications') return null
  const r = body.record as Record<string, unknown> | undefined
  if (!r || !isUuid(r.user_id) || typeof r.type !== 'string' || typeof r.title !== 'string' || typeof r.body !== 'string') return null
  const link = typeof r.link === 'string' && isAppPath(r.link) ? r.link : null
  return { user_id: r.user_id, type: r.type, title: r.title, body: r.body, link }
}

export async function notify(ctx: Ctx, body: Record<string, unknown>, req: Request): Promise<NotifyResult> {
  const secretHeader = req.headers.get('x-webhook-secret')
  if (secretHeader !== null) {
    if (!ctx.env.notifyWebhookSecret || !safeEqual(secretHeader, ctx.env.notifyWebhookSecret)) {
      throw new HttpError('unauthorized', 'Bad webhook secret.')
    }
    if (!ctx.env.webhookDelivery) return { ok: true, skipped: 'webhook delivery is turned off (NOTIFY_WEBHOOK_ENABLED)' }
    const record = parseWebhookRecord(body)
    if (!record) return { ok: true, skipped: 'not a notifications insert' }
    const delivered = await deliverNotifications(ctx, [record], { webPush: ctx.env.webhookWebPush })
    return { ok: true, delivered }
  }

  const caller = requireSignedIn(ctx.caller)
  const p = parseNotify(body)
  if (!p.ok) throw new HttpError('bad_request', p.error)

  // Read as the caller: a tenant can read the landlord's profile (09) but no other tenant's.
  const recipient = await ctx.user.getProfile(p.value.userId)
  const allowed = canNotify(caller, recipient ? { id: recipient.id, role: recipient.role, deletedAt: recipient.deleted_at } : null, p.value.type)
  if (!allowed.ok) throw allowed.error

  const item: NewNotification = {
    user_id: p.value.userId, type: p.value.type, title: p.value.title, body: p.value.body, link: p.value.link,
  }
  const err = await ctx.user.insertNotifications([item])
  if (err) throw new HttpError(err.code === '42501' ? 'forbidden' : 'internal', err.code === '42501' ? 'Not authorized' : 'Could not save the alert.')

  if (ctx.env.webhookDelivery) return { ok: true, delivered: null }
  try {
    const delivered = await deliverNotifications(ctx, [item], { webPush: true })
    return { ok: true, delivered }
  } catch (e) {
    ctx.log(`notify: delivery failed: ${e instanceof Error ? e.message : 'unknown'}`)
    return { ok: true, delivered: null, warning: 'Saved, but the push could not be sent.' }
  }
}
