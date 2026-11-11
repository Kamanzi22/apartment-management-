'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { notify } from '@/lib/notify'
import { emailConfigured, emailLayout, escapeHtml, sendEmail } from '@/lib/email'
import { formatRWF } from '@/lib/currency'
import { kigaliDateString } from '@/lib/rent-utils'
import {
  DEFAULT_ALERT_SETTINGS, LEVELS, fmtDay, renderTemplate, vacateMoveOutDate,
  type AlertChannel, type AlertSettings,
} from '@/lib/rent-alerts'

type Result = { error: string } | { success: true }
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

async function requireLandlord() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'Not authenticated' } as const
  const { data: profile } = await supabase.from('profiles').select('role, full_name').eq('id', user.id).single()
  if (profile?.role !== 'landlord') return { ok: false, error: 'Not authorized' } as const
  return { ok: true, supabase, user, name: profile.full_name } as const
}

function dayList(v: unknown): number[] | null {
  if (!Array.isArray(v)) return null
  const days = [...new Set(v.map(Number))].filter(n => Number.isInteger(n))
  if (days.length > 15 || days.some(n => n < 0 || n > 31)) return null
  return days.sort((a, b) => a - b)
}

function int(v: unknown, min: number, max: number): number | null {
  const n = Number(v)
  return Number.isInteger(n) && n >= min && n <= max ? n : null
}

/** Checks every field; returns the clean settings or an error message. */
function cleanSettings(input: Partial<AlertSettings>): AlertSettings | string {
  const s = { ...DEFAULT_ALERT_SETTINGS, ...input }
  const before = dayList(s.before_due_days)
  const after = dayList(s.after_due_days)
  if (!before || !after) return 'Days must be whole numbers from 0 to 31.'
  const nums: [keyof AlertSettings, number, number, string][] = [
    ['warning_after_days', 0, 365, 'Warning after'], ['final_warning_after_days', 0, 365, 'Final warning after'],
    ['notify_landlord_after_days', 0, 365, 'Alert me after'], ['send_hour', 0, 23, 'Send time'],
    ['lease_ending_days', 1, 365, 'Lease ending'], ['receipt_waiting_days', 1, 90, 'Receipt waiting'],
    ['repair_open_days', 1, 365, 'Repair open'], ['grace_days', 0, 60, 'Grace period'],
    ['max_unpaid_days', 1, 730, 'Unpaid limit'], ['notice_period_days', 1, 365, 'Notice period'],
  ]
  const out = { ...s, before_due_days: before, after_due_days: after } as AlertSettings
  for (const [key, min, max, label] of nums) {
    const n = int(s[key], min, max)
    if (n === null) return `${label} must be a whole number from ${min} to ${max}.`
    ;(out as unknown as Record<string, number>)[key] = n
  }
  if (out.final_warning_after_days < out.warning_after_days) return 'The final warning must come after the warning.'
  const channels = (Array.isArray(s.channels) ? s.channels : []).filter((c): c is AlertChannel => ['in_app', 'email', 'sms'].includes(c))
  if (!channels.length) return 'Choose at least one channel.'
  out.channels = [...new Set(channels)]
  for (const { field } of LEVELS) {
    const t = String(s[field] ?? '').trim()
    if (!t || t.length > 1000) return 'Each message must have 1 to 1,000 characters.'
    ;(out as unknown as Record<string, string>)[field] = t
  }
  out.enabled = !!s.enabled
  out.on_due_day = !!s.on_due_day
  return out
}

export async function saveAlertSettings(input: Partial<AlertSettings>): Promise<Result> {
  if (process.env.NEXT_PUBLIC_DEMO_MODE === 'true') return { success: true }
  const auth = await requireLandlord()
  if (!auth.ok) return { error: auth.error }
  const clean = cleanSettings(input)
  if (typeof clean === 'string') return { error: clean }

  // The settings in force belong to the landlord who receives the alerts.
  const { data: current } = await auth.supabase.rpc('alert_settings_current')
  const landlordId = current?.[0]?.landlord_id ?? auth.user.id
  const { error } = await auth.supabase
    .from('alert_settings')
    .upsert({ ...clean, landlord_id: landlordId, updated_at: new Date().toISOString() }, { onConflict: 'landlord_id' })
  if (error) return { error: error.message }
  revalidatePath('/landlord/settings/alerts')
  return { success: true }
}

/** Sends one message, filled in with a real tenant's data, to the landlord only. */
export async function sendTestAlert(level: string, template: string, vars: Record<string, string>): Promise<Result> {
  if (process.env.NEXT_PUBLIC_DEMO_MODE === 'true') return { success: true }
  const auth = await requireLandlord()
  if (!auth.ok) return { error: auth.error }
  const info = LEVELS.find(l => l.level === level)
  if (!info || !template.trim()) return { error: 'Choose a message to test.' }
  const body = renderTemplate(template.slice(0, 1000), vars)
  const title = `Test: ${info.title}`

  const err = await notify(auth.supabase, { user_id: auth.user.id, type: 'alert_test', title, body, link: '/landlord/settings/alerts' })
  if (err) return { error: err }
  if (emailConfigured() && auth.user.email) {
    const ok = await sendEmail(auth.user.email, title, emailLayout(title, escapeHtml(body)))
    if (!ok) return { error: 'The in-app test was sent, but the email failed.' }
  }
  return { success: true }
}

export async function saveLeaseOverride(
  leaseId: string,
  input: { enabled: boolean; before_due_days: number[] | null; after_due_days: number[] | null },
): Promise<Result> {
  if (process.env.NEXT_PUBLIC_DEMO_MODE === 'true') return { success: true }
  const auth = await requireLandlord()
  if (!auth.ok) return { error: auth.error }
  const before = input.before_due_days === null ? null : dayList(input.before_due_days)
  const after = input.after_due_days === null ? null : dayList(input.after_due_days)
  if ((input.before_due_days !== null && !before) || (input.after_due_days !== null && !after)) {
    return { error: 'Days must be whole numbers from 0 to 31.' }
  }
  // Nothing custom left: remove the override so the landlord defaults apply.
  if (input.enabled && before === null && after === null) {
    const { error } = await auth.supabase.from('lease_alert_overrides').delete().eq('lease_id', leaseId)
    if (error) return { error: error.message }
  } else {
    const { error } = await auth.supabase.from('lease_alert_overrides').upsert({
      lease_id: leaseId, enabled: input.enabled, before_due_days: before, after_due_days: after,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'lease_id' })
    if (error) return { error: error.message }
  }
  revalidatePath('/landlord', 'layout')
  return { success: true }
}

async function leaseFor(supabase: Awaited<ReturnType<typeof createClient>>, leaseId: string) {
  const { data } = await supabase
    .from('leases').select('id, tenant_id, unit_id, units!leases_unit_id_fkey(label)').eq('id', leaseId).maybeSingle()
  return data
}

/** Agree a payment plan: pauses late notices while installments are paid. */
export async function agreePaymentPlan(leaseId: string, amountPerMonth: number, endDate: string): Promise<Result> {
  if (process.env.NEXT_PUBLIC_DEMO_MODE === 'true') return { success: true }
  const auth = await requireLandlord()
  if (!auth.ok) return { error: auth.error }
  const amount = Math.round(Number(amountPerMonth))
  const today = kigaliDateString()
  if (!(amount > 0)) return { error: 'Enter the amount per month.' }
  if (!DATE_RE.test(endDate) || endDate <= today) return { error: 'The plan must end after today.' }
  const lease = await leaseFor(auth.supabase, leaseId)
  if (!lease) return { error: 'Lease not found' }

  const { error } = await auth.supabase.from('rent_limit_actions').insert({
    lease_id: leaseId, action: 'payment_plan', created_by: auth.user.id,
    details: { amount_per_month: amount, end_date: endDate },
  })
  if (error) return { error: error.message }
  await notify(auth.supabase, {
    user_id: lease.tenant_id, type: 'rent_plan', title: 'Payment plan agreed',
    body: `You agreed to pay ${formatRWF(amount)} a month towards what you owe, starting a month from today, until ${fmtDay(endDate)}. Reminders are paused while the plan is kept.`,
    link: '/',
  })
  revalidatePath('/landlord', 'layout')
  return { success: true }
}

/** Give more time: the unpaid limit is paused until `until`. */
export async function giveMoreTime(leaseId: string, until: string): Promise<Result> {
  if (process.env.NEXT_PUBLIC_DEMO_MODE === 'true') return { success: true }
  const auth = await requireLandlord()
  if (!auth.ok) return { error: auth.error }
  if (!DATE_RE.test(until) || until <= kigaliDateString()) return { error: 'Choose a date after today.' }
  const lease = await leaseFor(auth.supabase, leaseId)
  if (!lease) return { error: 'Lease not found' }
  const { error } = await auth.supabase.from('rent_limit_actions').insert({
    lease_id: leaseId, action: 'more_time', created_by: auth.user.id, details: { until },
  })
  if (error) return { error: error.message }
  await notify(auth.supabase, {
    user_id: lease.tenant_id, type: 'rent_more_time', title: 'More time to pay',
    body: `You have until ${fmtDay(until)} to pay what you owe.`, link: '/',
  })
  revalidatePath('/landlord', 'layout')
  return { success: true }
}

/** Notice to vacate, move-out = today + notice period. Does not end the lease. */
export async function issueVacateNotice(leaseId: string, reason: string): Promise<Result> {
  if (process.env.NEXT_PUBLIC_DEMO_MODE === 'true') return { success: true }
  const auth = await requireLandlord()
  if (!auth.ok) return { error: auth.error }
  const lease = await leaseFor(auth.supabase, leaseId)
  if (!lease) return { error: 'Lease not found' }
  const { data: settings } = await auth.supabase.rpc('alert_settings_current')
  const moveOut = vacateMoveOutDate(kigaliDateString(), settings?.[0] ?? DEFAULT_ALERT_SETTINGS)
  const text = (reason ?? '').trim().slice(0, 500) || 'Rent unpaid past the agreed limit'

  const { error } = await auth.supabase.from('vacate_notices').insert({
    lease_id: leaseId, tenant_id: lease.tenant_id, issued_by: auth.user.id, move_out_date: moveOut, reason: text,
  })
  if (error) return { error: error.message }
  const { error: logError } = await auth.supabase.from('rent_limit_actions').insert({
    lease_id: leaseId, action: 'notice_to_vacate', created_by: auth.user.id, details: { move_out_date: moveOut, reason: text },
  })
  if (logError) return { error: logError.message }

  const unit = (lease.units as { label: string } | null)?.label ?? 'your unit'
  await notify(auth.supabase, {
    user_id: lease.tenant_id, type: 'vacate_notice', title: 'Notice to vacate',
    body: `You must leave ${unit} by ${fmtDay(moveOut)}. Reason: ${text}. You can still pay what you owe in the app.`,
    link: '/',
  })
  revalidatePath('/landlord', 'layout')
  return { success: true }
}

/** Ends a payment plan or extra time early; the limit applies again. */
export async function resumeRentLimit(leaseId: string): Promise<Result> {
  if (process.env.NEXT_PUBLIC_DEMO_MODE === 'true') return { success: true }
  const auth = await requireLandlord()
  if (!auth.ok) return { error: auth.error }
  const { error } = await auth.supabase.from('rent_limit_actions').insert({
    lease_id: leaseId, action: 'resume', created_by: auth.user.id, details: {},
  })
  if (error) return { error: error.message }
  revalidatePath('/landlord', 'layout')
  return { success: true }
}
