// Expo push: build messages, send in batches of at most 100 (Expo's limit),
// and report tokens Expo says are dead (DeviceNotRegistered) so the caller
// deletes them. fetch is injected: tests never touch the network.

import { EXPO_TOKEN_RE } from './validate.ts'

export const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send'
export const EXPO_BATCH_SIZE = 100

export interface PushPayload {
  title: string
  body: string
  /** App path stored on the notification ("/rent"); the phone maps it to a screen. */
  url?: string | null
  /** Notification type, e.g. payment_reviewed. */
  tag?: string
}

export interface ExpoMessage {
  to: string
  title: string
  body: string
  sound: 'default'
  priority: 'high'
  data: { url: string; type: string | null }
}

export interface ExpoTicket {
  status: 'ok' | 'error'
  id?: string
  message?: string
  details?: { error?: string; expoPushToken?: string }
}

export interface ExpoSendResult {
  sent: number
  failed: number
  /** Tokens to delete from expo_push_tokens. */
  deadTokens: string[]
  /** Accepted tickets, for checkExpoReceipts() later. */
  tickets: PendingTicket[]
}

export type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal }) =>
  Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>

export function chunk<T>(items: T[], size = EXPO_BATCH_SIZE): T[][] {
  if (size < 1) throw new Error('chunk size must be at least 1')
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

/** One message per valid, distinct token. Invalid strings are dropped, not sent. */
export function buildExpoMessages(tokens: string[], p: PushPayload): ExpoMessage[] {
  const valid = [...new Set(tokens)].filter(t => EXPO_TOKEN_RE.test(t))
  return valid.map(to => ({
    to,
    title: p.title.slice(0, 120),
    body: p.body.slice(0, 1000),
    sound: 'default',
    priority: 'high',
    data: { url: p.url ?? '/', type: p.tag ?? null },
  }))
}

/**
 * Tickets come back in the same order as the messages. A ticket error
 * DeviceNotRegistered means the app was uninstalled or the token expired.
 */
export function deadTokensFromTickets(messages: ExpoMessage[], tickets: ExpoTicket[]): string[] {
  const dead: string[] = []
  tickets.forEach((t, i) => {
    if (t?.status === 'error' && t.details?.error === 'DeviceNotRegistered') {
      const token = t.details.expoPushToken ?? messages[i]?.to
      if (token) dead.push(token)
    }
  })
  return [...new Set(dead)]
}

export async function sendExpoPush(
  messages: ExpoMessage[],
  opts: { fetch: FetchLike; accessToken?: string | null; log?: (m: string) => void },
): Promise<ExpoSendResult> {
  const result: ExpoSendResult = { sent: 0, failed: 0, deadTokens: [], tickets: [] }
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    'Accept-Encoding': 'gzip, deflate',
  }
  if (opts.accessToken) headers.Authorization = `Bearer ${opts.accessToken}`

  for (const batch of chunk(messages)) {
    try {
      const res = await opts.fetch(EXPO_PUSH_URL, {
        method: 'POST', headers, body: JSON.stringify(batch), signal: AbortSignal.timeout(10_000),
      })
      if (!res.ok) {
        result.failed += batch.length
        opts.log?.(`expo push: HTTP ${res.status} for a batch of ${batch.length}`)
        continue
      }
      const body = (await res.json()) as { data?: ExpoTicket[] }
      const tickets = Array.isArray(body?.data) ? body.data : []
      for (let i = 0; i < batch.length; i++) {
        if (tickets[i]?.status === 'ok') {
          result.sent++
          if (tickets[i].id) result.tickets.push({ id: tickets[i].id!, token: batch[i].to })
        }
        else result.failed++
      }
      result.deadTokens.push(...deadTokensFromTickets(batch, tickets))
    } catch (e) {
      result.failed += batch.length
      opts.log?.(`expo push: ${e instanceof Error ? e.message : 'request failed'}`)
    }
  }
  result.deadTokens = [...new Set(result.deadTokens)]
  return result
}

// ── Receipts ─────────────────────────────────────────────────
// A ticket "ok" only means Expo accepted the message. Whether Apple/Google
// delivered it is in the receipt, available about 15 minutes later (kept by
// Expo for 24 hours). DeviceNotRegistered can show up only there.
// sendExpoPush returns the ticket ids with their tokens; a scheduled caller
// (see README: needs a small table for pending tickets, not in migration 17)
// passes them here and deletes the dead tokens.

export const EXPO_RECEIPTS_URL = 'https://exp.host/--/api/v2/push/getReceipts'
export const EXPO_RECEIPTS_BATCH = 1000

export interface PendingTicket { id: string; token: string }

export interface ExpoReceipt { status: 'ok' | 'error'; message?: string; details?: { error?: string } }

export interface ReceiptCheckResult {
  delivered: number
  failed: number
  /** Tokens to delete from expo_push_tokens. */
  deadTokens: string[]
  /** Ticket ids Expo had no receipt for yet: ask again later. */
  pending: string[]
}

export async function checkExpoReceipts(
  tickets: PendingTicket[],
  opts: { fetch: FetchLike; accessToken?: string | null; log?: (m: string) => void },
): Promise<ReceiptCheckResult> {
  const out: ReceiptCheckResult = { delivered: 0, failed: 0, deadTokens: [], pending: [] }
  const tokenOf = new Map(tickets.map(t => [t.id, t.token]))
  const headers: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'application/json' }
  if (opts.accessToken) headers.Authorization = `Bearer ${opts.accessToken}`

  for (const batch of chunk([...tokenOf.keys()], EXPO_RECEIPTS_BATCH)) {
    try {
      const res = await opts.fetch(EXPO_RECEIPTS_URL, {
        method: 'POST', headers, body: JSON.stringify({ ids: batch }), signal: AbortSignal.timeout(10_000),
      })
      if (!res.ok) {
        opts.log?.(`expo receipts: HTTP ${res.status}`)
        out.pending.push(...batch)
        continue
      }
      const receipts = ((await res.json()) as { data?: Record<string, ExpoReceipt> })?.data ?? {}
      for (const id of batch) {
        const r = receipts[id]
        if (!r) { out.pending.push(id); continue }
        if (r.status === 'ok') { out.delivered++; continue }
        out.failed++
        if (r.details?.error === 'DeviceNotRegistered') out.deadTokens.push(tokenOf.get(id)!)
      }
    } catch (e) {
      opts.log?.(`expo receipts: ${e instanceof Error ? e.message : 'request failed'}`)
      out.pending.push(...batch)
    }
  }
  out.deadTokens = [...new Set(out.deadTokens)]
  return out
}
