import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient, getVerifiedUserId } from '@/lib/supabase/server'
import { RentUnitCard } from './rent-unit-card'
import { loadRentState } from '../rent-data'
import { ArrearsList } from '../arrears-list'
import { currentPeriodMonth, formatPeriodMonth } from '@/lib/rent-utils'
import { cn } from '@/lib/utils'

export default async function LandlordRentPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string }>
}) {
  const userId = await getVerifiedUserId()
  if (!userId) redirect('/login')

  const supabase = await createClient()
  const currentMonth = currentPeriodMonth()
  const thisYear = Number(currentMonth.slice(0, 4))

  const [{ data: units }, rent] = await Promise.all([
    supabase.from('units').select('id, label, status, monthly_rent').order('label'),
    loadRentState(supabase),
  ])

  const firstYear = rent.leases.reduce((y, l) => Math.min(y, Number(l.move_in_date.slice(0, 4))), thisYear)
  const years = Array.from({ length: thisYear - firstYear + 1 }, (_, i) => thisYear - i)
  const { year: yearParam } = await searchParams
  const requested = Number(yearParam)
  const year = years.includes(requested) ? requested : thisYear

  const ledgers = Object.fromEntries(rent.ledgers)
  const arrears = Object.fromEntries(rent.arrears)

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="on-photo text-3xl font-semibold tracking-tight">Rent</h1>
          <p className="on-photo text-sm mt-1 opacity-95">{formatPeriodMonth(currentMonth)}</p>
        </div>
        <nav aria-label="Year" className="glass rounded-full! p-1 flex flex-wrap gap-1">
          {years.map(y => (
            <Link
              key={y}
              href={y === thisYear ? '/landlord/rent' : `/landlord/rent?year=${y}`}
              aria-current={y === year ? 'page' : undefined}
              className={cn(
                'min-h-11 min-w-16 px-4 inline-flex items-center justify-center rounded-full text-sm font-semibold',
                y === year ? 'bg-white/90 text-[var(--ink)] shadow-sm' : 'text-[var(--muted-2)] hover:bg-white/50',
              )}
            >
              {y}
            </Link>
          ))}
        </nav>
      </div>

      <div className="space-y-3">
        {(units ?? []).map(unit => (
          <RentUnitCard
            key={unit.id}
            unit={{ ...unit, monthly_rent: Number(unit.monthly_rent) }}
            leases={rent.leases.filter(l => l.unit_id === unit.id)}
            ledgers={ledgers}
            arrears={arrears}
            year={year}
            currentMonth={currentMonth}
          />
        ))}
      </div>

      <ArrearsList tenants={[...rent.arrears.values()]} title="Arrears (all tenants, all years)" />
    </div>
  )
}
