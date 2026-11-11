'use client'

import { useState, useTransition } from 'react'
import { format, parseISO } from 'date-fns'
import { toast } from 'sonner'
import { agreePaymentPlan, giveMoreTime, issueVacateNotice, resumeRentLimit, saveLeaseOverride } from '@/app/actions/alerts'
import { DayChips } from '@/components/day-chips'
import { formatRWF } from '@/lib/currency'
import { formatPeriodMonth } from '@/lib/rent-utils'
import { LIMIT_LABELS, type LeaseLimitState } from '@/lib/rent-alerts'

export interface OverrideData {
  enabled: boolean
  before_due_days: number[] | null
  after_due_days: number[] | null
}

/** Pause alerts for this tenant, or give them different days. */
export function AlertOverridePanel({ leaseId, override, defaults }: {
  leaseId: string
  override: OverrideData | null
  defaults: { before_due_days: number[]; after_due_days: number[] }
}) {
  const [enabled, setEnabled] = useState(override?.enabled ?? true)
  const [custom, setCustom] = useState(!!(override?.before_due_days || override?.after_due_days))
  const [before, setBefore] = useState(override?.before_due_days ?? defaults.before_due_days)
  const [after, setAfter] = useState(override?.after_due_days ?? defaults.after_due_days)
  const [pending, start] = useTransition()

  function save() {
    start(async () => {
      const r = await saveLeaseOverride(leaseId, {
        enabled, before_due_days: custom ? before : null, after_due_days: custom ? after : null,
      })
      if ('error' in r) toast.error(r.error)
      else toast.success(enabled ? 'Alert settings saved for this tenant' : 'Alerts paused for this tenant')
    })
  }

  return (
    <section className="glass p-5 space-y-3" aria-labelledby="tenant-alerts">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="tenant-alerts" className="text-base font-semibold">Alerts</h2>
        {!enabled && <span className="chip chip-warning">Paused</span>}
      </div>
      <label className="flex items-center gap-3 min-h-11">
        <input type="checkbox" className="h-5 w-5" checked={!enabled} onChange={e => setEnabled(!e.target.checked)} />
        <span className="text-sm font-semibold">Pause rent alerts for this tenant (e.g. an agreed payment arrangement)</span>
      </label>
      <label className="flex items-center gap-3 min-h-11">
        <input type="checkbox" className="h-5 w-5" checked={custom} disabled={!enabled} onChange={e => setCustom(e.target.checked)} />
        <span className="text-sm font-semibold">Use different days for this tenant</span>
      </label>
      {enabled && custom && (
        <div className="space-y-3 pl-1">
          <DayChips id={`ov-before-${leaseId}`} label="Days before the due date" suffix="days before" value={before} onChange={setBefore} />
          <DayChips id={`ov-after-${leaseId}`} label="Days after the due date" suffix="days late" value={after} onChange={setAfter} />
        </div>
      )}
      {enabled && !custom && (
        <p className="text-xs text-[var(--muted)]">
          Uses your defaults: {defaults.before_due_days.join(', ') || 'none'} days before, {defaults.after_due_days.join(', ') || 'none'} days after.
        </p>
      )}
      <button type="button" onClick={save} disabled={pending} className="btn-primary">{pending ? 'Saving…' : 'Save'}</button>
    </section>
  )
}

export interface LimitData {
  state: LeaseLimitState
  total_owed: number
  oldest_month: string | null
  days_late: number
  plan_amount: number | null
  plan_end: string | null
  plan_kept: boolean | null
  more_time_until: string | null
  vacate_move_out: string | null
  max_unpaid_days: number
}

export interface LimitAction {
  id: string
  action: string
  details: Record<string, unknown>
  created_at: string
}

const ACTION_NAMES: Record<string, string> = {
  payment_plan: 'Payment plan agreed', more_time: 'More time given', notice_to_vacate: 'Notice to vacate issued', resume: 'Limit resumed',
}

function describe(a: LimitAction): string {
  const d = a.details
  if (a.action === 'payment_plan') return `${formatRWF(Number(d.amount_per_month))} a month until ${format(parseISO(String(d.end_date)), 'd MMM yyyy')}`
  if (a.action === 'more_time') return `until ${format(parseISO(String(d.until)), 'd MMM yyyy')}`
  if (a.action === 'notice_to_vacate') return `move out by ${format(parseISO(String(d.move_out_date)), 'd MMM yyyy')}${d.reason ? ` · ${d.reason}` : ''}`
  return ''
}

/** Over the unpaid limit: agree a plan, give more time, or issue a notice to vacate. */
export function RentLimitPanel({ leaseId, limit, history, noticeDays }: {
  leaseId: string
  limit: LimitData | null
  history: LimitAction[]
  noticeDays: number
}) {
  const [mode, setMode] = useState<'' | 'plan' | 'time' | 'vacate'>('')
  const [amount, setAmount] = useState('')
  const [end, setEnd] = useState('')
  const [until, setUntil] = useState('')
  const [reason, setReason] = useState('')
  const [pending, start] = useTransition()

  if (!limit && !history.length) return null
  const state = limit?.state ?? 'ok'

  function run(fn: () => Promise<{ error: string } | { success: true }>, done: string) {
    start(async () => {
      const r = await fn()
      if ('error' in r) toast.error(r.error)
      else { toast.success(done); setMode('') }
    })
  }

  const chip = state === 'over_limit' ? 'bg-red-600 text-white'
    : state === 'late' ? 'bg-red-50 text-red-700'
    : state === 'due' ? 'bg-amber-100 text-amber-800'
    : state === 'plan' || state === 'more_time' ? 'bg-amber-100 text-amber-800'
    : 'bg-green-100 text-green-700'

  return (
    <section className="glass p-5 space-y-3" aria-labelledby="rent-limit">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="rent-limit" className="text-base font-semibold">Unpaid rent limit</h2>
        <span className={`text-xs px-2.5 py-0.5 rounded-full font-bold ${chip}`}>{LIMIT_LABELS[state]}</span>
      </div>
      {limit && limit.total_owed > 0 && (
        <p className="text-sm text-[var(--muted-2)]">
          Owes {formatRWF(limit.total_owed)}; oldest unpaid month {limit.oldest_month ? formatPeriodMonth(limit.oldest_month) : '—'},
          {' '}{limit.days_late} days late (limit {limit.max_unpaid_days} days).
          {state === 'plan' && limit.plan_amount && ` Payment plan: ${formatRWF(limit.plan_amount)} a month until ${limit.plan_end ? format(parseISO(limit.plan_end), 'd MMM yyyy') : ''}, being kept.`}
          {state === 'more_time' && limit.more_time_until && ` More time given until ${format(parseISO(limit.more_time_until), 'd MMM yyyy')}.`}
        </p>
      )}
      {limit?.vacate_move_out && (
        <p className="text-sm font-semibold text-red-700">Notice to vacate issued: move out by {format(parseISO(limit.vacate_move_out), 'EEEE d MMMM yyyy')}.</p>
      )}

      {(state === 'over_limit' || state === 'late' || state === 'plan' || state === 'more_time') && (
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => setMode('plan')} className="min-h-11 px-4 rounded-full text-sm font-semibold bg-white/90 border border-white hover:bg-white">Agree a payment plan</button>
          <button type="button" onClick={() => setMode('time')} className="min-h-11 px-4 rounded-full text-sm font-semibold bg-white/90 border border-white hover:bg-white">Give more time</button>
          <button type="button" onClick={() => setMode('vacate')} className="min-h-11 px-4 rounded-full text-sm font-semibold bg-red-50 border border-red-100 text-red-700 hover:bg-red-100">Issue a notice to vacate</button>
          {(state === 'plan' || state === 'more_time') && (
            <button type="button" disabled={pending} onClick={() => run(() => resumeRentLimit(leaseId), 'The limit applies again')}
              className="min-h-11 px-4 rounded-full text-sm font-semibold text-[var(--muted-2)] underline underline-offset-2">End plan / extra time</button>
          )}
        </div>
      )}

      {mode === 'plan' && (
        <div className="grid sm:grid-cols-3 gap-3 items-end">
          <div className="space-y-1">
            <label htmlFor="plan-amount" className="block text-sm font-semibold">Amount per month (RWF)</label>
            <input id="plan-amount" type="number" min={1} inputMode="numeric" value={amount} onChange={e => setAmount(e.target.value)} className="glass-input text-sm" />
          </div>
          <div className="space-y-1">
            <label htmlFor="plan-end" className="block text-sm font-semibold">End date</label>
            <input id="plan-end" type="date" value={end} onChange={e => setEnd(e.target.value)} className="glass-input text-sm" />
          </div>
          <button type="button" disabled={pending} className="btn-primary"
            onClick={() => run(() => agreePaymentPlan(leaseId, Number(amount), end), 'Payment plan saved; warnings pause while it is kept')}>
            Save plan
          </button>
          <p className="text-xs text-[var(--muted)] sm:col-span-3">The first installment is due one month from today. Warnings come back if one is missed.</p>
        </div>
      )}
      {mode === 'time' && (
        <div className="flex flex-wrap gap-3 items-end">
          <div className="space-y-1">
            <label htmlFor="more-time" className="block text-sm font-semibold">Pause the limit until</label>
            <input id="more-time" type="date" value={until} onChange={e => setUntil(e.target.value)} className="glass-input text-sm" />
          </div>
          <button type="button" disabled={pending} className="btn-primary" onClick={() => run(() => giveMoreTime(leaseId, until), 'More time given')}>Save</button>
        </div>
      )}
      {mode === 'vacate' && (
        <div className="space-y-2">
          <label htmlFor="vacate-reason" className="block text-sm font-semibold">Reason</label>
          <textarea id="vacate-reason" rows={2} value={reason} onChange={e => setReason(e.target.value)} placeholder="Rent unpaid past the agreed limit" className="glass-input text-sm h-auto! py-2" />
          <p className="text-xs text-[var(--muted)]">
            The move-out date will be {noticeDays} days from today. The lease does not end by itself; you still confirm the move-out.
          </p>
          <button type="button" disabled={pending} className="min-h-11 px-5 rounded-full text-sm font-semibold bg-red-600 text-white hover:bg-red-700"
            onClick={() => { if (window.confirm('Issue a notice to vacate to this tenant?')) run(() => issueVacateNotice(leaseId, reason), 'Notice to vacate issued') }}>
            Issue notice
          </button>
        </div>
      )}

      {history.length > 0 && (
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)] mb-1">Decisions</p>
          <ul className="space-y-1">
            {history.map(a => (
              <li key={a.id} className="text-xs text-[var(--muted-2)]">
                {format(new Date(a.created_at), 'd MMM yyyy')} · <span className="font-semibold">{ACTION_NAMES[a.action] ?? a.action}</span> {describe(a)}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}
