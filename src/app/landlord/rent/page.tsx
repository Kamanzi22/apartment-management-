import { redirect } from 'next/navigation'
import { createClient, getVerifiedUserId } from '@/lib/supabase/server'
import { RentUnitCard } from './rent-unit-card'
import { format } from 'date-fns'

export default async function LandlordRentPage() {
  const userId = await getVerifiedUserId()
  if (!userId) redirect('/login')

  const supabase = await createClient()

  const currentYear = new Date().getFullYear()

  const [{ data: units }, { data: allLeases }, { data: yearPayments }, { data: allPayments }] = await Promise.all([
    supabase.from('units').select('id, label, status, monthly_rent').order('label'),
    supabase.from('leases').select(`
      id, unit_id, tenant_id, monthly_rent, rent_due_day,
      move_in_date, lease_start, lease_end, status,
      profiles!leases_tenant_id_fkey(full_name)
    `).order('move_in_date'),
    supabase.from('payments')
      .select('id, lease_id, tenant_id, period_month, amount, status')
      .gte('period_month', `${currentYear}-01`)
      .lte('period_month', `${currentYear}-12`),
    supabase.from('payments')
      .select('lease_id, period_month, amount, status')
      .order('period_month'),
  ])

  // Group leases and payments by unit
  const leasesByUnit = new Map<string, typeof allLeases>()
  for (const lease of allLeases ?? []) {
    if (!leasesByUnit.has(lease.unit_id)) leasesByUnit.set(lease.unit_id, [])
    leasesByUnit.get(lease.unit_id)!.push(lease)
  }

  const yearPaymentsByUnit = new Map<string, typeof yearPayments>()
  const allPaymentsByUnit  = new Map<string, typeof allPayments>()
  for (const lease of allLeases ?? []) {
    const yp = (yearPayments ?? []).filter(p => p.lease_id === lease.id)
    yearPaymentsByUnit.set(lease.unit_id, [...(yearPaymentsByUnit.get(lease.unit_id) ?? []), ...yp])

    const ap = (allPayments ?? []).filter(p => p.lease_id === lease.id)
    allPaymentsByUnit.set(lease.unit_id, [...(allPaymentsByUnit.get(lease.unit_id) ?? []), ...ap])
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Rent</h1>
        <p className="text-sm text-slate-500 mt-1">{format(new Date(), 'MMMM yyyy')}</p>
      </div>

      <div className="space-y-3">
        {(units ?? []).map(unit => (
          <RentUnitCard
            key={unit.id}
            unit={unit}
            leases={(leasesByUnit.get(unit.id) ?? []) as any[]}
            payments={(yearPaymentsByUnit.get(unit.id) ?? []) as any[]}
            allPayments={(allPaymentsByUnit.get(unit.id) ?? []) as any[]}
            currentYear={currentYear}
          />
        ))}
      </div>
    </div>
  )
}
