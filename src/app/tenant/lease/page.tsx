import { redirect } from 'next/navigation'
import { createClient, getAuthedUser } from '@/lib/supabase/server'
import { getDueDate } from '@/lib/rent-utils'
import { format, differenceInDays } from 'date-fns'
import { FileText, Calendar, DollarSign, Home } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'

export default async function TenantLeasePage() {
  const user = await getAuthedUser()
  if (!user) redirect('/login')

  const supabase = await createClient()

  const { data: lease } = await supabase
    .from('leases')
    .select('*, units(label, bedroom_count)')
    .eq('tenant_id', user.id)
    .eq('status', 'active')
    .single()

  if (!lease) {
    return (
      <div className="text-center py-16 text-slate-500">
        <FileText className="h-8 w-8 mx-auto mb-3 opacity-40" />
        <p>No active lease found.</p>
      </div>
    )
  }

  const unit = lease.units as { label: string; bedroom_count: number }
  const dueDate = getDueDate(lease.rent_due_day)
  const daysUntilDue = differenceInDays(dueDate, new Date())
  const leaseEnd = lease.lease_end ? new Date(lease.lease_end) : null
  const daysUntilEnd = leaseEnd ? differenceInDays(leaseEnd, new Date()) : null

  const items = [
    {
      icon: <Home className="h-4 w-4 text-slate-400" />,
      label: 'Unit',
      value: `${unit.label} (${unit.bedroom_count} bedroom)`,
    },
    {
      icon: <DollarSign className="h-4 w-4 text-slate-400" />,
      label: 'Monthly rent',
      value: `$${lease.monthly_rent.toFixed(2)}`,
    },
    {
      icon: <DollarSign className="h-4 w-4 text-slate-400" />,
      label: 'Security deposit',
      value: `$${lease.deposit_amount.toFixed(2)}`,
    },
    {
      icon: <Calendar className="h-4 w-4 text-slate-400" />,
      label: 'Rent due each month',
      value: `Day ${lease.rent_due_day} (next: ${format(dueDate, 'MMM d')}, ${daysUntilDue >= 0 ? `in ${daysUntilDue} days` : `${Math.abs(daysUntilDue)} days ago`})`,
    },
    {
      icon: <Calendar className="h-4 w-4 text-slate-400" />,
      label: 'Move-in date',
      value: format(new Date(lease.move_in_date), 'MMMM d, yyyy'),
    },
    {
      icon: <Calendar className="h-4 w-4 text-slate-400" />,
      label: 'Lease start',
      value: format(new Date(lease.lease_start), 'MMMM d, yyyy'),
    },
    {
      icon: <Calendar className="h-4 w-4 text-slate-400" />,
      label: 'Lease end',
      value: leaseEnd
        ? `${format(leaseEnd, 'MMMM d, yyyy')}${daysUntilEnd !== null ? ` (${daysUntilEnd > 0 ? `in ${daysUntilEnd} days` : 'expired'})` : ''}`
        : 'Month-to-month',
    },
  ]

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">My Lease</h1>
        <p className="text-sm text-slate-500 mt-1">Your current lease details</p>
      </div>

      {leaseEnd && daysUntilEnd !== null && daysUntilEnd <= 60 && daysUntilEnd > 0 && (
        <div className="rounded-xl bg-amber-50 border border-amber-200 p-4">
          <p className="text-sm font-medium text-amber-800">
            Your lease ends in {daysUntilEnd} days. Contact your landlord about renewal.
          </p>
        </div>
      )}

      <Card className="shadow-sm">
        <CardContent className="pt-5 pb-2">
          <div className="divide-y">
            {items.map((item, i) => (
              <div key={i} className="flex items-start gap-3 py-3">
                <div className="mt-0.5 shrink-0">{item.icon}</div>
                <div>
                  <p className="text-xs text-slate-500 font-medium">{item.label}</p>
                  <p className="text-sm text-slate-800 mt-0.5">{item.value}</p>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
