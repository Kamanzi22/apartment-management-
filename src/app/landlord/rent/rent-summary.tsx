'use client'

import { useState } from 'react'
import { CheckCircle2, Clock, AlertCircle, Users } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { formatRWF } from '@/lib/currency'

type Period = 'monthly' | 'quarterly' | 'yearly'

export interface UnitRentStatus {
  id: string
  label: string
  tenantName: string | null
  paymentStatus: string | null
  paymentAmount: number | null
  monthlyRent: number
  rentDuePassed: boolean
}

export interface PaymentSlim {
  period_month: string
  amount: number
  status: string
}

interface Props {
  units: UnitRentStatus[]
  monthlyExpected: number
  allPayments: PaymentSlim[]
  currentPeriod: string
}

function getLastNMonthKeys(currentPeriod: string, n: number): string[] {
  const [year, month] = currentPeriod.split('-').map(Number)
  const months: string[] = []
  for (let i = 0; i < n; i++) {
    let m = month - i
    let y = year
    while (m <= 0) { m += 12; y-- }
    months.push(`${y}-${String(m).padStart(2, '0')}`)
  }
  return months
}

export function RentSummary({ units, monthlyExpected, allPayments, currentPeriod }: Props) {
  const [period, setPeriod] = useState<Period>('monthly')

  const n = period === 'monthly' ? 1 : period === 'quarterly' ? 3 : 12
  const monthKeys = getLastNMonthKeys(currentPeriod, n)
  const relevant = allPayments.filter(p => monthKeys.includes(p.period_month))
  const confirmed = relevant.filter(p => p.status === 'confirmed').reduce((s, p) => s + p.amount, 0)
  const expected = monthlyExpected * n
  const outstanding = Math.max(0, expected - confirmed)

  const periodLabel =
    period === 'monthly' ? 'this month' :
    period === 'quarterly' ? 'last 3 months' : 'last 12 months'

  return (
    <div className="space-y-4">
      {/* Income summary with period selector */}
      <Card className="shadow-sm">
        <CardContent className="pt-4 pb-4">
          <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
            <h2 className="text-sm font-semibold text-slate-700">Income Summary</h2>
            <select
              value={period}
              onChange={e => setPeriod(e.target.value as Period)}
              className="text-sm border rounded-lg px-3 py-1.5 bg-white text-slate-700"
            >
              <option value="monthly">Monthly</option>
              <option value="quarterly">Quarterly (3 months)</option>
              <option value="yearly">Yearly (12 months)</option>
            </select>
          </div>
          <div className="flex items-center gap-6 flex-wrap">
            <div>
              <p className="text-xs text-slate-500 capitalize">Expected ({periodLabel})</p>
              <p className="text-xl font-bold text-slate-900">
                {formatRWF(expected)}
              </p>
            </div>
            <div className="h-8 w-px bg-slate-200" />
            <div>
              <p className="text-xs text-slate-500">Confirmed</p>
              <p className="text-xl font-bold text-green-600">
                {formatRWF(confirmed)}
              </p>
            </div>
            <div className="h-8 w-px bg-slate-200" />
            <div>
              <p className="text-xs text-slate-500">Outstanding</p>
              <p className="text-xl font-bold text-red-500">
                {formatRWF(outstanding)}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Per-unit status for the current month */}
      <div>
        <h2 className="text-sm font-semibold text-slate-700 mb-2">This month — all units</h2>
        <div className="rounded-xl border bg-white divide-y shadow-sm">
          {units.map(unit => (
            <div key={unit.id} className="flex items-center justify-between px-4 py-3">
              <div>
                <p className="text-sm font-medium text-slate-900">{unit.label}</p>
                <div className="flex items-center gap-1 text-xs text-slate-500 mt-0.5">
                  <Users className="h-3 w-3" />
                  <span>{unit.tenantName ?? 'No tenant'}</span>
                </div>
              </div>

              <div className="text-right shrink-0">
                {!unit.tenantName ? (
                  <span className="text-xs text-slate-400">Vacant</span>
                ) : unit.paymentStatus === 'confirmed' ? (
                  <div className="flex items-center gap-1.5">
                    <CheckCircle2 className="h-4 w-4 text-green-600" />
                    <div>
                      <p className="text-xs font-medium text-green-700">Paid</p>
                      <p className="text-xs text-green-600">{formatRWF(unit.paymentAmount ?? 0)}</p>
                    </div>
                  </div>
                ) : unit.paymentStatus === 'pending_review' ? (
                  <div className="flex items-center gap-1.5">
                    <Clock className="h-4 w-4 text-amber-600" />
                    <div>
                      <p className="text-xs font-medium text-amber-700">Pending</p>
                      <p className="text-xs text-amber-600">{formatRWF(unit.paymentAmount ?? 0)}</p>
                    </div>
                  </div>
                ) : unit.rentDuePassed ? (
                  <div className="flex items-center gap-1.5">
                    <AlertCircle className="h-4 w-4 text-red-500" />
                    <div>
                      <p className="text-xs font-medium text-red-700">Unpaid</p>
                      <p className="text-xs text-slate-400">{formatRWF(unit.monthlyRent)} due</p>
                    </div>
                  </div>
                ) : (
                  <span className="text-xs text-slate-400">Not due yet</span>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
