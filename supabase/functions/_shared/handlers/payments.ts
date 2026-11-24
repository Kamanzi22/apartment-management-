// confirm-payment / reject-payment. Same as reviewPayment() in the landlord
// web app, plus: only a payment that is still pending_review changes, so a
// second phone or the web cannot review it twice.

import { HttpError } from '../http.ts'
import { requireLandlord, rpcErrorToHttp } from '../authz.ts'
import { parseReviewPayment } from '../validate.ts'
import { notifyAndDeliver } from '../deliver.ts'
import { paymentReviewedNotification } from '../messages.ts'
import type { Ctx } from '../ports.ts'

export interface ReviewPaymentResult { ok: true; paymentId: string; status: 'confirmed' | 'rejected'; warning?: string }

function reviewHandler(status: 'confirmed' | 'rejected') {
  return async (ctx: Ctx, body: Record<string, unknown>): Promise<ReviewPaymentResult> => {
    const caller = requireLandlord(ctx.caller)
    const p = parseReviewPayment(body)
    if (!p.ok) throw new HttpError('bad_request', p.error)

    const { data, error } = await ctx.user.reviewPayment(p.value.paymentId, status, p.value.note, caller.id)
    if (error) throw rpcErrorToHttp(error)
    if (!data) throw new HttpError('conflict', 'This payment was already reviewed (or no longer exists). Refresh the list.')

    const warning = await notifyAndDeliver(ctx, [
      paymentReviewedNotification(data.tenant_id, status, data.period_month, p.value.note),
    ])
    return { ok: true, paymentId: p.value.paymentId, status, ...(warning ? { warning } : {}) }
  }
}

export const confirmPayment = reviewHandler('confirmed')
export const rejectPayment = reviewHandler('rejected')
