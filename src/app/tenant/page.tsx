import { redirect } from 'next/navigation'
import { createClient, getVerifiedUserId } from '@/lib/supabase/server'
import { RentCard } from './rent-card'
import { currentPeriodMonth, getDueDate, formatPeriodMonth } from '@/lib/rent-utils'
import { format } from 'date-fns'
import { AlertCircle, CheckCircle2 } from 'lucide-react'
import { PageTitle, PaymentHistory } from '@/components/tenant-ui'

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
      <div className="glass p-6">
        <div className="empty-state">
          <p className="text-base font-semibold text-[var(--ink)]">No active lease found</p>
          <p>Contact your landlord.</p>
        </div>
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

  const owesThisMonth = !currentPayment || currentPayment.status === 'rejected'
  const history = [
    ...(currentPayment ? [currentPayment] : []),
    ...(pastPayments ?? []),
  ]

  return (
    <div className="space-y-5">
      <PageTitle
        title="Rent"
        subtitle={<>{(lease.units as { label: string }).label} · Due {format(dueDate, 'MMM d')}</>}
      />

      {owesThisMonth ? (
        <section className="hero-card p-6">
          <div className="flex items-start justify-between gap-3">
            <p className="text-sm font-medium text-[var(--metal)]">You owe</p>
            <span className="chip chip-danger">
              <AlertCircle className="h-3 w-3" />
              {currentPayment?.status === 'rejected' ? 'Receipt rejected' : `Due ${format(dueDate, 'MMM d')}`}
            </span>
          </div>
          <p className="mt-2 text-4xl font-semibold tracking-tight">
            {new Intl.NumberFormat('en-US').format(Math.round(lease.monthly_rent))}{' '}
            <span className="accent-word text-[0.85em]">RWF</span>
          </p>
          <p className="text-sm text-white/90 mt-2">For {formatPeriodMonth(period)}. Upload your receipt below.</p>
        </section>
      ) : (
        <section className="hero-card p-6 flex items-center gap-4">
          <CheckCircle2 className="h-8 w-8 text-[var(--metal)] shrink-0" />
          <div>
            <p className="text-xl font-semibold">You&apos;re <span className="accent-word">all</span> caught up</p>
            <p className="text-sm text-white/90 mt-0.5">
              {currentPayment?.status === 'pending_review' ? 'Your receipt is waiting for review.' : 'No rent due right now.'}
            </p>
          </div>
          <span className={`chip ml-auto ${currentPayment?.status === 'pending_review' ? 'chip-warning' : 'chip-success'}`}>
            {currentPayment?.status === 'pending_review' ? 'Pending' : 'All clear'}
          </span>
        </section>
      )}

      <RentCard
        lease={lease}
        currentPayment={currentPayment}
        period={period}
        dueDate={format(dueDate, 'MMMM d, yyyy')}
        periodLabel={formatPeriodMonth(period)}
      />

      <PaymentHistory history={history} />
    </div>
  )
}
