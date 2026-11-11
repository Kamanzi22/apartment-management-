'use client'

import { useState, useTransition } from 'react'
import { format } from 'date-fns'
import { toast } from 'sonner'
import { Send } from 'lucide-react'
import { saveAlertSettings, sendTestAlert } from '@/app/actions/alerts'
import { DayChips } from '@/components/day-chips'
import { formatRWF } from '@/lib/currency'
import { formatPeriodMonth } from '@/lib/rent-utils'
import { LEVELS, PLACEHOLDERS, fmtDay, renderTemplate, type AlertChannel, type AlertSettings } from '@/lib/rent-alerts'

export interface PreviewTenant {
  leaseId: string
  name: string
  unit: string
  amount: number
  month: string
  dueDate: string
  daysLate: number
}

export interface LogRow {
  key: string
  sentAt: string
  tenant: string
  unit: string
  month: string | null
  level: string
  channel: string
}

const LEVEL_NAMES: Record<string, string> = {
  before: 'Reminder', due_today: 'Due today', overdue: 'Overdue', warning: 'Warning', final_warning: 'Final warning',
  final_notice: 'Over limit', over_limit: 'Over limit (you)', summary: 'Late list (you)', lease_ending: 'Lease ending',
  receipt_waiting: 'Receipt waiting', repair_open: 'Repair open',
}

const card = 'glass p-5 md:p-6 space-y-4'
const label = 'block text-sm font-semibold text-[var(--ink)]'
const hint = 'text-xs text-[var(--muted)]'

function NumberField({ id, text, value, onChange, min, max, after }: {
  id: string; text: string; value: number; onChange: (n: number) => void; min: number; max: number; after: string
}) {
  return (
    <div className="space-y-1">
      <label htmlFor={id} className={label}>{text}</label>
      <div className="flex items-center gap-2">
        <input
          id={id} type="number" inputMode="numeric" min={min} max={max} value={Number.isFinite(value) ? value : ''}
          onChange={e => onChange(e.target.value === '' ? NaN : Number(e.target.value))}
          className="glass-input text-sm w-24!"
        />
        <span className="text-sm text-[var(--muted-2)]">{after}</span>
      </div>
    </div>
  )
}

export function AlertSettingsForm({ initial, preview, landlordName, log }: {
  initial: AlertSettings
  preview: PreviewTenant[]
  landlordName: string
  log: LogRow[]
}) {
  const [s, setS] = useState<AlertSettings>(initial)
  const [level, setLevel] = useState<(typeof LEVELS)[number]['level']>('before')
  const [tenantId, setTenantId] = useState(preview[0]?.leaseId ?? '')
  const [saving, startSave] = useTransition()
  const [testing, startTest] = useTransition()

  const set = <K extends keyof AlertSettings>(key: K, value: AlertSettings[K]) => setS(prev => ({ ...prev, [key]: value }))
  const info = LEVELS.find(l => l.level === level)!
  const template = String(s[info.field])
  const t = preview.find(p => p.leaseId === tenantId)
  const vars = {
    tenant_name: t?.name ?? 'Jane', unit: t?.unit ?? 'Unit 1',
    amount: formatRWF(t?.amount ?? 350000), month: formatPeriodMonth(t?.month ?? '2027-01'),
    due_date: fmtDay(t?.dueDate ?? '2027-01-05'), days_late: String(t?.daysLate ?? 0), landlord_name: landlordName,
  }

  function toggleChannel(ch: AlertChannel, on: boolean) {
    set('channels', on ? [...new Set([...s.channels, ch])] : s.channels.filter(c => c !== ch))
  }

  function save() {
    startSave(async () => {
      const result = await saveAlertSettings(s)
      if ('error' in result) toast.error(result.error)
      else toast.success('Alert settings saved. They apply from the next hourly run.')
    })
  }

  function test() {
    startTest(async () => {
      const result = await sendTestAlert(level, template, vars)
      if ('error' in result) toast.error(result.error)
      else toast.success('Test sent to you only (in-app and email).')
    })
  }

  return (
    <div className="space-y-4">
      <section className={card} aria-labelledby="alerts-general">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="alerts-general" className="text-lg font-semibold">Rent alerts</h2>
          <label className="inline-flex items-center gap-3 min-h-11 cursor-pointer">
            <span className="text-sm font-semibold">{s.enabled ? 'On' : 'Off'}</span>
            <input
              type="checkbox" role="switch" checked={s.enabled} onChange={e => set('enabled', e.target.checked)}
              className="h-6 w-11 accent-[var(--ink)]" aria-label="Send rent alerts to tenants"
            />
          </label>
        </div>
        <DayChips id="before-days" label="Days before the due date" suffix="days before"
          value={s.before_due_days} onChange={v => set('before_due_days', v)} />
        <label className="flex items-center gap-3 min-h-11">
          <input type="checkbox" checked={s.on_due_day} onChange={e => set('on_due_day', e.target.checked)} className="h-5 w-5" />
          <span className="text-sm font-semibold">Remind on the due day</span>
        </label>
        <DayChips id="after-days" label="Days after the due date" suffix="days late"
          value={s.after_due_days} onChange={v => set('after_due_days', v)} />
        <div className="grid sm:grid-cols-2 gap-4">
          <div className="space-y-1">
            <label htmlFor="send-hour" className={label}>Send time (Kigali)</label>
            <select id="send-hour" value={s.send_hour} onChange={e => set('send_hour', Number(e.target.value))} className="glass-input text-sm w-32!">
              {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>)}
            </select>
          </div>
          <fieldset className="space-y-1">
            <legend className={label}>Send by</legend>
            <div className="flex flex-wrap gap-4">
              <label className="inline-flex items-center gap-2 min-h-11"><input type="checkbox" className="h-5 w-5"
                checked={s.channels.includes('in_app')} onChange={e => toggleChannel('in_app', e.target.checked)} />In-app</label>
              <label className="inline-flex items-center gap-2 min-h-11"><input type="checkbox" className="h-5 w-5"
                checked={s.channels.includes('email')} onChange={e => toggleChannel('email', e.target.checked)} />Email</label>
              <span className="inline-flex items-center gap-2 min-h-11 text-[var(--muted)]"><input type="checkbox" disabled className="h-5 w-5" />SMS (later)</span>
            </div>
          </fieldset>
          <NumberField id="warn" text="Warning from" value={s.warning_after_days} onChange={n => set('warning_after_days', n)} min={0} max={365} after="days late" />
          <NumberField id="final" text="Final warning from" value={s.final_warning_after_days} onChange={n => set('final_warning_after_days', n)} min={0} max={365} after="days late" />
          <NumberField id="notify-me" text="Alert me when a tenant is" value={s.notify_landlord_after_days} onChange={n => set('notify_landlord_after_days', n)} min={0} max={365} after="days late" />
        </div>
        <p className={hint}>Warnings also go out on the day each threshold is reached. A month is skipped while a receipt for it is waiting for your review, and alerts stop once it is paid.</p>
      </section>

      <section className={card} aria-labelledby="alerts-limit">
        <h2 id="alerts-limit" className="text-lg font-semibold">Unpaid rent limit</h2>
        <div className="grid sm:grid-cols-2 gap-4">
          <NumberField id="grace" text="Grace period" value={s.grace_days} onChange={n => set('grace_days', n)} min={0} max={60} after="days shown as Due, not Late" />
          <div className="space-y-1">
            <NumberField id="max-unpaid" text="Limit" value={s.max_unpaid_days} onChange={n => set('max_unpaid_days', n)} min={1} max={730} after="days unpaid" />
            <label className="inline-flex items-center gap-2 text-xs text-[var(--muted-2)]">
              or
              <input
                type="number" min={1} max={24} aria-label="Limit in months"
                value={Number.isFinite(s.max_unpaid_days) ? Math.round(s.max_unpaid_days / 30) : ''}
                onChange={e => set('max_unpaid_days', Number(e.target.value) * 30)}
                className="glass-input text-xs w-16! min-h-9!"
              />
              months (30 days each)
            </label>
          </div>
          <NumberField id="notice" text="Notice to vacate" value={s.notice_period_days} onChange={n => set('notice_period_days', n)} min={1} max={365} after="days to move out" />
        </div>
        <p className={hint}>
          When the oldest unpaid month is more than {Number.isFinite(s.max_unpaid_days) ? s.max_unpaid_days : '…'} days past its due date,
          the tenant is Over limit: they get a final notice, you get an alert, and the unit page asks you to agree a payment plan,
          give more time or issue a notice to vacate. Tenants are never locked out of paying.
        </p>
      </section>

      <section className={card} aria-labelledby="alerts-other">
        <h2 id="alerts-other" className="text-lg font-semibold">Other alerts</h2>
        <div className="grid sm:grid-cols-3 gap-4">
          <NumberField id="lease-ending" text="Lease ending (tenant)" value={s.lease_ending_days} onChange={n => set('lease_ending_days', n)} min={1} max={365} after="days before" />
          <NumberField id="receipt-waiting" text="Receipt waiting (you)" value={s.receipt_waiting_days} onChange={n => set('receipt_waiting_days', n)} min={1} max={90} after="days" />
          <NumberField id="repair-open" text="Repair still open (you)" value={s.repair_open_days} onChange={n => set('repair_open_days', n)} min={1} max={365} after="days" />
        </div>
      </section>

      <section className={card} aria-labelledby="alerts-messages">
        <h2 id="alerts-messages" className="text-lg font-semibold">Messages</h2>
        <div className="flex flex-wrap gap-2" role="tablist" aria-label="Message">
          {LEVELS.map(l => (
            <button key={l.level} type="button" role="tab" aria-selected={level === l.level} onClick={() => setLevel(l.level)}
              className={level === l.level
                ? 'min-h-11 px-4 rounded-full text-sm font-semibold bg-[var(--ink)] text-[var(--on-dark)]'
                : 'min-h-11 px-4 rounded-full text-sm font-semibold bg-white/60 border border-white/85 text-[var(--muted-2)]'}>
              {l.label}
            </button>
          ))}
        </div>
        <div className="space-y-1">
          <label htmlFor="template" className={label}>{info.label} message</label>
          <textarea id="template" rows={4} maxLength={1000} value={template}
            onChange={e => set(info.field, e.target.value as never)}
            className="glass-input text-sm h-auto! py-3" />
          <p className={hint}>Placeholders: {PLACEHOLDERS.map(p => `{${p}}`).join(' ')}</p>
        </div>
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <label htmlFor="preview-tenant" className="text-sm font-semibold">Preview with</label>
            <select id="preview-tenant" value={tenantId} onChange={e => setTenantId(e.target.value)} className="glass-input text-sm w-auto!">
              {preview.length === 0 && <option value="">Sample tenant</option>}
              {preview.map(p => <option key={p.leaseId} value={p.leaseId}>{p.name} · {p.unit}</option>)}
            </select>
          </div>
          <div className="rounded-2xl bg-white/80 border border-white p-4">
            <p className="text-sm font-semibold">{info.title}</p>
            <p className="text-sm text-[var(--muted-2)] mt-1 whitespace-pre-wrap">{renderTemplate(template, vars)}</p>
          </div>
          <button type="button" onClick={test} disabled={testing}
            className="inline-flex items-center gap-2 min-h-11 px-4 rounded-full text-sm font-semibold bg-white/90 border border-white hover:bg-white disabled:opacity-60">
            <Send className="h-4 w-4" /> {testing ? 'Sending…' : 'Send me a test'}
          </button>
        </div>
      </section>

      <div className="sticky bottom-24 md:bottom-4 z-10 flex justify-end">
        <button type="button" onClick={save} disabled={saving} className="btn-primary shadow-lg">
          {saving ? 'Saving…' : 'Save settings'}
        </button>
      </div>

      <section className={card} aria-labelledby="alerts-log">
        <h2 id="alerts-log" className="text-lg font-semibold">Last 100 alerts sent</h2>
        {log.length === 0 ? <p className={hint}>Nothing sent yet.</p> : (
          <div className="overflow-x-auto -mx-2">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-[var(--muted)]">
                  <th className="px-2 py-1 font-semibold">Date</th><th className="px-2 py-1 font-semibold">Tenant</th>
                  <th className="px-2 py-1 font-semibold">Unit</th><th className="px-2 py-1 font-semibold">Month</th>
                  <th className="px-2 py-1 font-semibold">Level</th><th className="px-2 py-1 font-semibold">Channel</th>
                </tr>
              </thead>
              <tbody>
                {log.map(r => (
                  <tr key={r.key} className="border-t border-white/70">
                    <td className="px-2 py-1.5 whitespace-nowrap">{format(new Date(r.sentAt), 'd MMM yyyy HH:mm')}</td>
                    <td className="px-2 py-1.5">{r.tenant}</td>
                    <td className="px-2 py-1.5">{r.unit}</td>
                    <td className="px-2 py-1.5 whitespace-nowrap">{r.month ? formatPeriodMonth(r.month) : '—'}</td>
                    <td className="px-2 py-1.5">{LEVEL_NAMES[r.level] ?? r.level}</td>
                    <td className="px-2 py-1.5">{r.channel === 'in_app' ? 'In-app' : r.channel === 'email' ? 'Email' : r.channel}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}
