import { redirect } from 'next/navigation'
import { createClient, getVerifiedUserId } from '@/lib/supabase/server'
import { RentCard } from './rent-card'
import { currentPeriodMonth, getDueDate, formatPeriodMonth } from '@/lib/rent-utils'
import { format } from 'date-fns'
import { formatRWF } from '@/lib/currency'

export default async function TenantRentPage() {
  const userId = await getVerifiedUserId()
  if (!userId) redirect('/login')

  const supabase = await createClient()

  const { data: lease } = await supabase
    .from('leases')
    .select('*, units(label)')
    .eq('tenant_id', userId)
    .eq('status', 'active')
    .single()

  if (!lease) {
    return (
      <div className="text-center py-16 text-slate-500">
        <p>No active lease found. Contact your landlord.</p>
      </div>
    )
  }

  const period = currentPeriodMonth()

  const [{ data: currentPayment }, { data: pastPayments }] = await Promise.all([
    supabase.from('payments').select('*')
      .eq('lease_id', lease.id).eq('period_month', period).single(),
    supabase.from('payments').select('*')
      .eq('lease_id', lease.id).neq('period_month', period)
      .order('period_month', { ascending: false }).limit(12),
  ])

  const dueDate = getDueDate(lease.rent_due_day)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Rent</h1>
        <p className="text-sm text-slate-500 mt-1">
          {(lease.units as { label: string }).label} · {formatRWF(lease.monthly_rent)}/month
        </p>
      </div>

      <RentCard
        lease={lease}
        currentPayment={currentPayment}
        period={period}
        dueDate={format(dueDate, 'MMMM d, yyyy')}
        periodLabel={formatPeriodMonth(period)}
      />

      {pastPayments && pastPayments.length > 0 && (
        <div>
          <h2 className="text-base font-semibold text-slate-800 mb-3">Payment History</h2>
          <div className="rounded-xl border bg-white divide-y">
            {pastPayments.map(p => (
              <div key={p.id} className="flex items-center justify-between px-4 py-3">
                <div>
                  <p className="text-sm font-medium text-slate-800">{formatPeriodMonth(p.period_month)}</p>
                  <p className="text-xs text-slate-500">{formatRWF(p.amount)}</p>
                </div>
                <StatusBadge status={p.status} notes={p.landlord_notes} />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function StatusBadge({ status, notes }: { status: string; notes?: string | null }) {
  const map = {
    pending_review: { label: 'Pending review', cls: 'bg-amber-100 text-amber-800' },
    confirmed: { label: 'Confirmed', cls: 'bg-green-100 text-green-800' },
    rejected: { label: 'Rejected', cls: 'bg-red-100 text-red-800' },
  }
  const s = map[status as keyof typeof map] ?? { label: status, cls: 'bg-slate-100 text-slate-700' }

  return (
    <div className="flex flex-col items-end gap-0.5">
      <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${s.cls}`}>{s.label}</span>
      {notes && <span className="text-xs text-slate-400 max-w-32 text-right">{notes}</span>}
    </div>
  )
}
