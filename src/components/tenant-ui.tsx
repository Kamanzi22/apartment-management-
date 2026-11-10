// Shared Slate and silver tenant UI pieces.
// This file is kept identical in apartment-manager (src/components/tenant-ui.tsx)
// and apartment-manager-tenant so both tenant portals look the same.
import { format } from 'date-fns'
import { ExternalLink, Receipt } from 'lucide-react'
import { formatRWF } from '@/lib/currency'
import { formatPeriodMonth } from '@/lib/rent-utils'

export interface HistoryItem {
  id: string
  period_month: string
  amount: number
  status: string
  submitted_at: string | null
  receipt_file_url?: string | null
  landlord_notes?: string | null
}

export function StatusChip({ status }: { status: string }) {
  const cfg =
    status === 'confirmed' ? { label: 'Paid', cls: 'chip-success' } :
    status === 'pending_review' ? { label: 'Pending', cls: 'chip-warning' } :
    status === 'rejected' ? { label: 'Rejected', cls: 'chip-danger' } :
    { label: status.replace('_', ' '), cls: 'chip-neutral' }
  return <span className={`chip ${cfg.cls}`}>{cfg.label}</span>
}

export function PageTitle({ title, subtitle }: { title: string; subtitle?: React.ReactNode }) {
  return (
    <div>
      <h1 className="on-photo text-3xl font-semibold tracking-tight">{title}</h1>
      {subtitle && <p className="on-photo text-sm mt-1 opacity-95">{subtitle}</p>}
    </div>
  )
}

export function PaymentHistory({ history, totalPaid }: { history: HistoryItem[]; totalPaid?: number }) {
  return (
    <section className="glass p-5" aria-labelledby="payment-history">
      <div className="flex items-baseline justify-between gap-3 mb-3">
        <h2 id="payment-history" className="text-base font-semibold">Payment History</h2>
        {!!totalPaid && totalPaid > 0 && (
          <p className="text-xs text-[var(--muted)]">Total confirmed: {formatRWF(totalPaid)}</p>
        )}
      </div>
      {history.length === 0 ? (
        <div className="empty-state">
          <Receipt className="h-5 w-5" />
          <p>No payments submitted yet</p>
        </div>
      ) : (
        <div className="space-y-2">
          {history.map(p => (
            <div key={p.id} className="glass-row px-4 py-3">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold">{formatPeriodMonth(p.period_month)}</p>
                  <p className="text-xs text-[var(--muted)] mt-0.5">
                    Submitted {p.submitted_at ? format(new Date(p.submitted_at), 'MMM d, yyyy') : '—'}
                  </p>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <span className="text-sm font-semibold">{formatRWF(p.amount)}</span>
                  <StatusChip status={p.status} />
                </div>
              </div>
              {(p.landlord_notes || p.receipt_file_url) && (
                <div className="mt-1.5 space-y-1">
                  {p.landlord_notes && (
                    <p className="text-xs text-[var(--muted-2)] bg-white/70 rounded-xl px-2.5 py-1.5">
                      Landlord: {p.landlord_notes}
                    </p>
                  )}
                  {p.receipt_file_url && (
                    <a
                      href={p.receipt_file_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 min-h-8 text-xs font-semibold text-[var(--muted-2)] hover:text-[var(--ink)]"
                    >
                      <ExternalLink className="h-3 w-3" /> View receipt
                    </a>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

// Glass payment card: header (month, amount, due date) and a body slot for status + form.
export function PaymentCardShell({
  periodLabel, amount, dueDate, children,
}: { periodLabel: string; amount: number; dueDate: string; children: React.ReactNode }) {
  return (
    <section className="glass overflow-hidden" aria-label={`Pay rent for ${periodLabel}`}>
      <div className="px-5 pt-5 pb-4 border-b border-white/70">
        <p className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">{periodLabel}</p>
        <p className="text-3xl font-semibold tracking-tight mt-1">{formatRWF(amount)}</p>
        <p className="text-xs text-[var(--muted)] mt-1">Due {dueDate}</p>
      </div>
      <div className="p-5 space-y-4">{children}</div>
    </section>
  )
}

export const fieldLabelCls = 'block text-sm font-semibold text-[var(--ink)]'
export const uploadBoxCls =
  'flex flex-col items-center gap-2 rounded-2xl border-[1.5px] border-dashed border-[rgba(30,39,48,0.22)] bg-white/40 p-5 cursor-pointer hover:bg-white/60 transition-colors text-center focus-within:ring-3 focus-within:ring-[var(--accent)]/40'
export const statusBoxCls: Record<string, string> = {
  confirmed: 'bg-[var(--success-bg)] text-[var(--success-text)]',
  pending_review: 'bg-[var(--warning-bg)] text-[var(--warning-text)]',
  rejected: 'bg-[var(--danger-bg)] text-[var(--danger-text)]',
}
