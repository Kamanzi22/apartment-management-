// broadcast (landlord only): one message to every current tenant, then one
// 'broadcast' notification each. Same as sendMessage(null, body) on the web.
// Both inserts run as the landlord, so RLS applies ("messages: landlord full
// access"; tenants are refused by the 08 policy anyway).

import { HttpError } from '../http.ts'
import { requireLandlord, rpcErrorToHttp } from '../authz.ts'
import { parseBroadcast } from '../validate.ts'
import { notifyAndDeliver } from '../deliver.ts'
import { broadcastNotifications } from '../messages.ts'
import type { Ctx } from '../ports.ts'

export interface BroadcastResult { ok: true; messageId: string; notified: number; warning?: string }

export async function broadcast(ctx: Ctx, body: Record<string, unknown>): Promise<BroadcastResult> {
  const caller = requireLandlord(ctx.caller)
  const p = parseBroadcast(body)
  if (!p.ok) throw new HttpError('bad_request', p.error)

  const msg = await ctx.user.insertBroadcast(caller.id, p.value.body)
  if (msg.error) throw rpcErrorToHttp(msg.error)

  const [tenantIds, me] = await Promise.all([ctx.user.currentTenantIds(), ctx.user.getProfile(caller.id)])
  const items = broadcastNotifications(tenantIds, me?.full_name ?? null, p.value.body)
  const warning = await notifyAndDeliver(ctx, items)
  return { ok: true, messageId: msg.data.id, notified: items.length, ...(warning ? { warning } : {}) }
}
