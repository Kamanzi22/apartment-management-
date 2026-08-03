'use client'

import { useState } from 'react'
import { reviewPayment } from '@/app/actions/payments'
import { formatPeriodMonth } from '@/lib/rent-utils'
import { formatRWF } from '@/lib/currency'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { CheckCircle2, XCircle, FileText, Eye } from 'lucide-react'
import { toast } from 'sonner'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'

interface Payment {
  id: string
  tenant_id: string
  period_month: string
  amount: number
  receipt_file_url: string | null
  submitted_at: string
  status: string
  landlord_notes: string | null
  profiles: {
    full_name: string
    unit_id: string | null
    units: { label: string } | null
  } | null
}

interface Props {
  payments: Payment[]
  currentPeriod: string
}

export function RentReviewList({ payments, currentPeriod }: Props) {
  const [filterStatus, setFilterStatus] = useState<string>('all')
  const [filterPeriod, setFilterPeriod] = useState<string>(currentPeriod)
  const [reviewingId, setReviewingId] = useState<string | null>(null)
  const [notes, setNotes] = useState('')
  const [loading, setLoading] = useState(false)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)

  const periods = [...new Set(payments.map(p => p.period_month))].sort().reverse()

  const filtered = payments.filter(p => {
    if (filterPeriod !== 'all' && p.period_month !== filterPeriod) return false
    if (filterStatus !== 'all' && p.status !== filterStatus) return false
    return true
  })

  async function handleReview(id: string, status: 'confirmed' | 'rejected') {
    setLoading(true)
    const result = await reviewPayment(id, status, notes || undefined)
    setLoading(false)
    if (result?.error) {
      toast.error(result.error)
    } else {
      toast.success(status === 'confirmed' ? 'Payment confirmed' : 'Payment rejected')
      setReviewingId(null)
      setNotes('')
    }
  }

  const statusColors = {
    pending_review: 'bg-amber-100 text-amber-800',
    confirmed: 'bg-green-100 text-green-800',
    rejected: 'bg-red-100 text-red-800',
  }

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-wrap gap-2">
        <select
          value={filterPeriod}
          onChange={e => setFilterPeriod(e.target.value)}
          className="text-sm border rounded-lg px-3 py-1.5 bg-white text-slate-700"
        >
          <option value="all">All months</option>
          {periods.map(p => (
            <option key={p} value={p}>{formatPeriodMonth(p)}</option>
          ))}
        </select>
        <select
          value={filterStatus}
          onChange={e => setFilterStatus(e.target.value)}
          className="text-sm border rounded-lg px-3 py-1.5 bg-white text-slate-700"
        >
          <option value="all">All statuses</option>
          <option value="pending_review">Pending review</option>
          <option value="confirmed">Confirmed</option>
          <option value="rejected">Rejected</option>
        </select>
      </div>

      {/* List */}
      {filtered.length === 0 ? (
        <div className="text-center py-12 text-slate-400">
          <FileText className="h-8 w-8 mx-auto mb-2 opacity-40" />
          <p>No payments match this filter</p>
        </div>
      ) : (
        <div className="rounded-xl border bg-white divide-y shadow-sm">
          {filtered.map(p => (
            <div key={p.id} className="p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-medium text-slate-900 text-sm">{p.profiles?.full_name ?? '—'}</p>
                    <span className="text-xs text-slate-400">{p.profiles?.units?.label}</span>
                  </div>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {formatPeriodMonth(p.period_month)} · {formatRWF(p.amount)}
                  </p>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Submitted {new Date(p.submitted_at).toLocaleDateString()}
                  </p>
                  {p.landlord_notes && (
                    <p className="text-xs text-slate-500 mt-1">Note: {p.landlord_notes}</p>
                  )}
                </div>
                <div className="flex flex-col items-end gap-2 shrink-0">
                  <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${statusColors[p.status as keyof typeof statusColors] ?? 'bg-slate-100 text-slate-700'}`}>
                    {p.status.replace('_', ' ')}
                  </span>
                  <div className="flex gap-1.5">
                    {p.receipt_file_url && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs px-2"
                        onClick={() => setPreviewUrl(p.receipt_file_url)}
                      >
                        <Eye className="h-3 w-3 mr-1" />
                        Receipt
                      </Button>
                    )}
                    {p.status === 'pending_review' && (
                      reviewingId === p.id ? (
                        <div className="flex flex-col gap-1.5 w-48">
                          <Textarea
                            value={notes}
                            onChange={e => setNotes(e.target.value)}
                            placeholder="Optional note to tenant…"
                            className="text-xs h-16 resize-none"
                          />
                          <div className="flex gap-1">
                            <Button
                              size="sm"
                              className="flex-1 h-7 text-xs bg-green-600 hover:bg-green-700"
                              disabled={loading}
                              onClick={() => handleReview(p.id, 'confirmed')}
                            >
                              <CheckCircle2 className="h-3 w-3 mr-1" />
                              Confirm
                            </Button>
                            <Button
                              size="sm"
                              variant="destructive"
                              className="flex-1 h-7 text-xs"
                              disabled={loading}
                              onClick={() => handleReview(p.id, 'rejected')}
                            >
                              <XCircle className="h-3 w-3 mr-1" />
                              Reject
                            </Button>
                          </div>
                          <button
                            className="text-xs text-slate-400 hover:text-slate-600"
                            onClick={() => { setReviewingId(null); setNotes('') }}
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs px-2"
                          onClick={() => setReviewingId(p.id)}
                        >
                          Review
                        </Button>
                      )
                    )}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Receipt preview dialog */}
      <Dialog open={!!previewUrl} onOpenChange={() => setPreviewUrl(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Payment Receipt</DialogTitle>
          </DialogHeader>
          {previewUrl && (
            previewUrl.endsWith('.pdf')
              ? <iframe src={previewUrl} className="w-full h-96 rounded-lg" />
              : <img src={previewUrl} alt="Receipt" className="w-full rounded-lg max-h-[70vh] object-contain" />
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
