import { AlertCircle, CheckCircle2 } from 'lucide-react'
import { formatRWF } from '@/lib/currency'
import { formatPeriodMonth } from '@/lib/rent-utils'
import type { TenantArrears } from './rent-data'

/** Each tenant who owes rent, with the unit and months, across all of their leases. */
export function ArrearsList({ tenants, title = 'Arrears', emptyText = 'Nobody owes rent.' }: {
  tenants: TenantArrears[]
  title?: string
  emptyText?: string
}) {
  const owing = tenants.filter(t => t.total > 0).sort((a, b) => b.total - a.total)
  const grand = owing.reduce((s, t) => s + t.total, 0)
  return (
    <section className="glass p-5 md:p-6" aria-labelledby="arrears-title">
      <div className="flex items-center justify-between gap-3 mb-3">
        <h2 id="arrears-title" className="text-lg font-semibold">{title}</h2>
        {owing.length > 0 && <span className="chip chip-danger">{formatRWF(grand)} owed</span>}
      </div>
      {owing.length === 0 ? (
        <div className="empty-state py-4"><CheckCircle2 className="h-5 w-5" />{emptyText}</div>
      ) : (
        <ul className="space-y-2">
          {owing.map(t => (
            <li key={t.tenantId} className="glass-row px-4 py-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold flex items-center gap-2 flex-wrap">
                    {t.name}
                    {!t.isCurrent && <span className="chip chip-neutral">Former tenant</span>}
                  </p>
                  {t.lines.map(line => (
                    <p key={line.leaseId} className="text-xs text-[var(--muted)] mt-0.5">
                      {line.unitLabel}{line.active ? '' : ' (previous lease)'}: {line.months.map(m =>
                        `${formatPeriodMonth(m.period_month)} ${formatRWF(m.balance)}${m.status === 'pending' ? ' (receipt in review)' : ''}`
                      ).join(' · ')}
                    </p>
                  ))}
                </div>
                <span className="text-sm font-bold text-[var(--danger-text)] shrink-0 inline-flex items-center gap-1">
                  <AlertCircle className="h-3.5 w-3.5" />{formatRWF(t.total)}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
