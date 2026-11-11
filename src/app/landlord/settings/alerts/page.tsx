import { redirect } from 'next/navigation'
import { createClient, getVerifiedUserId } from '@/lib/supabase/server'
import { DEFAULT_ALERT_SETTINGS, type AlertSettings } from '@/lib/rent-alerts'
import { owedAfterPending } from '@/lib/rent-ledger'
import { currentPeriodMonth, kigaliDateString } from '@/lib/rent-utils'
import { differenceInCalendarDays, parseISO } from 'date-fns'
import { loadRentState } from '../../rent-data'
import { AlertSettingsForm, type PreviewTenant, type LogRow } from './alert-settings-form'

export default async function AlertSettingsPage() {
  const userId = await getVerifiedUserId()
  if (!userId) redirect('/login')
  const supabase = await createClient()

  const [{ data: rows }, rent, { data: log }, { data: me }] = await Promise.all([
    supabase.rpc('alert_settings_current'),
    loadRentState(supabase),
    supabase.from('sent_alerts')
      .select('key, level, channel, lease_id, period_month, user_id, sent_at')
      .order('sent_at', { ascending: false })
      .limit(100),
    supabase.from('profiles').select('full_name').eq('id', userId).single(),
  ])

  const settings: AlertSettings = { ...DEFAULT_ALERT_SETTINGS, ...(rows?.[0] ?? {}) } as AlertSettings
  const today = kigaliDateString()
  const month = currentPeriodMonth()

  // Real tenants for the preview: their oldest unpaid month, or this month.
  const preview: PreviewTenant[] = rent.leases
    .filter(l => l.status === 'active')
    .map(l => {
      const ledger = rent.ledgers.get(l.id) ?? []
      const row = ledger.find(r => owedAfterPending(r) > 0) ?? ledger.find(r => r.period_month === month) ?? ledger.at(-1)
      return {
        leaseId: l.id,
        name: l.tenant_name,
        unit: l.unit_label,
        amount: row ? Math.max(row.expected - row.confirmed_paid, 0) || row.expected : l.monthly_rent,
        month: row?.period_month ?? month,
        dueDate: row?.due_date ?? today,
        daysLate: row ? Math.max(differenceInCalendarDays(parseISO(today), parseISO(row.due_date)), 0) : 0,
      }
    })

  const leaseById = new Map(rent.leases.map(l => [l.id, l]))
  const logRows: LogRow[] = (log ?? []).map(r => {
    const lease = r.lease_id ? leaseById.get(r.lease_id) : undefined
    const toLandlord = r.user_id === userId || (!!r.user_id && !rent.leases.some(l => l.tenant_id === r.user_id))
    return {
      key: r.key,
      sentAt: r.sent_at,
      tenant: toLandlord ? 'You (landlord)' : lease?.tenant_name ?? '—',
      unit: lease?.unit_label ?? '—',
      month: r.period_month,
      level: r.level ?? r.key.split(':')[0],
      channel: r.channel ?? 'in_app',
    }
  })

  return (
    <div className="space-y-4">
      <div>
        <h1 className="on-photo text-3xl font-semibold tracking-tight">Rent alerts</h1>
        <p className="on-photo text-sm mt-1 opacity-95">When reminders and warnings go out, and what they say</p>
      </div>
      <AlertSettingsForm
        initial={settings}
        preview={preview}
        landlordName={me?.full_name ?? 'Your landlord'}
        log={logRows}
      />
    </div>
  )
}
