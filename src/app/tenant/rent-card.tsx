'use client'

import { useState, useRef } from 'react'
import { submitPayment } from '@/app/actions/payments'
import { Button } from '@/components/ui/button'
import { PaymentCardShell, uploadBoxCls, statusBoxCls } from '@/components/tenant-ui'
import { Upload, CheckCircle2, Clock, XCircle, AlertCircle } from 'lucide-react'
import { toast } from 'sonner'

interface Lease {
  id: string
  monthly_rent: number
  rent_due_day: number
}

interface Payment {
  id: string
  status: string
  amount: number
  receipt_file_url: string | null
  landlord_notes: string | null
  submitted_at: string
}

interface Props {
  lease: Lease
  currentPayment: Payment | null
  period: string
  dueDate: string
  periodLabel: string
}

export function RentCard({ lease, currentPayment, period, dueDate, periodLabel }: Props) {
  const [uploading, setUploading] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!file) { toast.error('Please select a receipt file'); return }
    setUploading(true)

    const fd = new FormData()
    fd.append('receipt', file)
    fd.append('amount', lease.monthly_rent.toString())
    fd.append('lease_id', lease.id)
    fd.append('period_month', period)

    const result = await submitPayment(fd)
    setUploading(false)

    if (result?.error) {
      toast.error(result.error)
    } else {
      toast.success('Receipt submitted! Awaiting landlord review.')
      setFile(null)
    }
  }

  const statusUI = {
    pending_review: {
      icon: <Clock className="h-5 w-5 text-amber-500" />,
      label: 'Pending review',
      color: 'text-amber-700',
      bg: 'bg-amber-50 border-amber-200',
    },
    confirmed: {
      icon: <CheckCircle2 className="h-5 w-5 text-green-500" />,
      label: 'Payment confirmed',
      color: 'text-green-700',
      bg: 'bg-green-50 border-green-200',
    },
    rejected: {
      icon: <XCircle className="h-5 w-5 text-red-500" />,
      label: 'Receipt rejected',
      color: 'text-red-700',
      bg: 'bg-red-50 border-red-200',
    },
  }

  return (
    <PaymentCardShell periodLabel={periodLabel} amount={lease.monthly_rent} dueDate={dueDate}>
        {currentPayment ? (
          <div className={`rounded-2xl p-4 ${statusBoxCls[currentPayment.status] ?? 'bg-white/70'}`}>
            <div className="flex items-center gap-2">
              {statusUI[currentPayment.status as keyof typeof statusUI]?.icon ?? <AlertCircle className="h-5 w-5 text-slate-400" />}
              <p className={`font-medium text-sm ${statusUI[currentPayment.status as keyof typeof statusUI]?.color ?? 'text-slate-700'}`}>
                {statusUI[currentPayment.status as keyof typeof statusUI]?.label ?? currentPayment.status}
              </p>
            </div>
            {currentPayment.landlord_notes && (
              <p className="text-sm text-slate-600 mt-2 pl-7">
                Note from landlord: {currentPayment.landlord_notes}
              </p>
            )}
            {currentPayment.receipt_file_url && (
              <a
                href={currentPayment.receipt_file_url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs font-semibold underline underline-offset-2 mt-2 pl-7 inline-flex min-h-8 items-center"
              >
                View uploaded receipt
              </a>
            )}
            {currentPayment.status === 'rejected' && (
              <form onSubmit={handleSubmit} className="mt-4 space-y-3">
                <p className="text-sm font-medium text-slate-700">Upload a new receipt:</p>
                <div
                  className={uploadBoxCls} role="button" tabIndex={0} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInputRef.current?.click() } }}
                  onClick={() => fileInputRef.current?.click()}
                >
                  <Upload className="h-5 w-5 text-slate-400 mx-auto mb-1" />
                  <p className="text-sm text-slate-500">
                    {file ? file.name : 'Click to upload (image or PDF)'}
                  </p>
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*,.pdf"
                  className="hidden"
                  onChange={e => setFile(e.target.files?.[0] ?? null)}
                />
                <Button type="submit" disabled={uploading || !file} className="w-full h-12">
                  {uploading ? 'Uploading…' : 'Resubmit Receipt'}
                </Button>
              </form>
            )}
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-3">
            <p className="text-sm text-slate-600">
              Upload your payment receipt (bank transfer screenshot, M-Pesa confirmation, etc.)
            </p>
            <div
              className={uploadBoxCls} role="button" tabIndex={0} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInputRef.current?.click() } }}
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload className="h-6 w-6 text-slate-400 mx-auto mb-2" />
              <p className="text-sm font-medium text-slate-700">
                {file ? file.name : 'Click to select receipt'}
              </p>
              <p className="text-xs text-slate-400 mt-1">JPG, PNG, or PDF</p>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*,.pdf"
              className="hidden"
              onChange={e => setFile(e.target.files?.[0] ?? null)}
            />
            <Button type="submit" disabled={uploading || !file} className="w-full h-12">
              {uploading ? 'Uploading…' : 'Submit Receipt'}
            </Button>
          </form>
        )}
    </PaymentCardShell>
  )
}
