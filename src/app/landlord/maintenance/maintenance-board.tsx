'use client'

import { useState } from 'react'
import { format } from 'date-fns'
import { getMaintenanceDetail, updateMaintenanceStatus, type MaintenanceDetail } from '@/app/actions/maintenance'
import { MAINTENANCE_STATUSES, isOpenStatus, needsDate, needsReason, nextStatuses, statusInfo, validateStatusChange } from '@/lib/maintenance'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Wrench, DollarSign } from 'lucide-react'
import { toast } from 'sonner'
import { MAINTENANCE_CATEGORIES, categoryLabel } from '@/lib/categories'
import { formatRWF, parseAmountInput } from '@/lib/currency'
import { fileUrl } from '@/lib/storage-url'

interface Request {
  id: string
  category: string
  description: string
  urgency: string
  status: string
  photo_urls: string[]
  landlord_comment: string | null
  scheduled_for?: string | null
  repair_cost?: number | null
  created_at: string
  updated_at: string
  profiles: { full_name: string } | null
  units: { label: string } | null
}

const statusConfig = Object.fromEntries(MAINTENANCE_STATUSES.map(s => [s.value, { label: s.label, cls: s.cls }])) as
  Record<string, { label: string; cls: string }>

const urgencyConfig = {
  low:    { dot: 'bg-slate-400' },
  medium: { dot: 'bg-amber-500' },
  high:   { dot: 'bg-red-500' },
}

export function MaintenanceBoard({ requests }: { requests: Request[] }) {
  const [localRequests, setLocalRequests] = useState<Request[]>(requests)
  const [filterStatus,   setFilterStatus]   = useState('all')
  const [filterUrgency,  setFilterUrgency]  = useState('all')
  const [filterUnit,     setFilterUnit]     = useState('all')
  const [filterCategory, setFilterCategory] = useState('all')
  const [selected,  setSelected]  = useState<Request | null>(null)
  const [newStatus, setNewStatus] = useState('')
  const [comment,   setComment]   = useState('')
  const [repairCost, setRepairCost] = useState('')
  const [saving,    setSaving]    = useState(false)
  const [scheduledFor, setScheduledFor] = useState('')
  const [detail, setDetail] = useState<MaintenanceDetail | null>(null)

  const units = [...new Set(localRequests.map(r => r.units?.label).filter(Boolean))]

  const filtered = localRequests.filter(r => {
    if (filterStatus   !== 'all' && r.status          !== filterStatus)   return false
    if (filterUrgency  !== 'all' && r.urgency         !== filterUrgency)  return false
    if (filterUnit     !== 'all' && r.units?.label    !== filterUnit)     return false
    if (filterCategory !== 'all' && r.category        !== filterCategory) return false
    return true
  })

  function openRequest(r: Request) {
    setSelected(r)
    setNewStatus(nextStatuses(r.status)[0] ?? '')
    setComment('')
    setScheduledFor(r.scheduled_for ?? '')
    setRepairCost(r.repair_cost != null ? r.repair_cost.toString() : '')
    setDetail(null)
    getMaintenanceDetail(r.id).then(setDetail).catch(() => setDetail({ history: [], updates: [] }))
  }

  async function handleSave() {
    if (!selected) return
    const invalid = validateStatusChange(selected.status, newStatus, comment, scheduledFor)
    if (invalid) { toast.error(invalid); return }
    setSaving(true)
    const cost = repairCost ? parseAmountInput(repairCost) : undefined
    const result = await updateMaintenanceStatus(selected.id, newStatus, comment || undefined, cost,
      needsDate(newStatus) ? scheduledFor : undefined)
    setSaving(false)
    if (result?.error) {
      toast.error(result.error)
    } else {
      toast.success('Request updated')
      // Update local state so the list reflects the change immediately
      setLocalRequests(prev => prev.map(r =>
        r.id === selected.id
          ? { ...r, status: newStatus, landlord_comment: comment || null, repair_cost: cost ?? r.repair_cost,
              scheduled_for: needsDate(newStatus) ? scheduledFor : r.scheduled_for }
          : r
      ))
      setSelected(null)
    }
  }

  return (
    <>
      {/* Status filter chips */}
      <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by status">
        {[['all', 'All'], ...Object.entries(statusConfig).map(([v, { label }]) => [v, label])].map(([v, label]) => (
          <button
            key={v}
            type="button"
            aria-pressed={filterStatus === v}
            onClick={() => setFilterStatus(v)}
            className={filterStatus === v
              ? 'min-h-11 px-4 rounded-full text-sm font-semibold bg-[var(--ink)] text-[var(--on-dark)]'
              : 'min-h-11 px-4 rounded-full text-sm font-semibold bg-white/60 border border-white/85 text-[var(--muted-2)] hover:bg-white/80'}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2">
        <select
          value={filterCategory}
          onChange={e => setFilterCategory(e.target.value)}
          className="text-sm min-h-11 rounded-full border border-white/85 bg-white/60 px-4 font-medium text-[var(--ink)] focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-[var(--accent)]/40" aria-label="Filter by category"
        >
          <option value="all">All categories</option>
          {MAINTENANCE_CATEGORIES.map(c => (
            <option key={c.value} value={c.value}>{c.label}</option>
          ))}
        </select>
        <select
          value={filterUrgency}
          onChange={e => setFilterUrgency(e.target.value)}
          className="text-sm min-h-11 rounded-full border border-white/85 bg-white/60 px-4 font-medium text-[var(--ink)] focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-[var(--accent)]/40" aria-label="Filter by urgency"
        >
          <option value="all">All urgencies</option>
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
        </select>
        <select
          value={filterUnit}
          onChange={e => setFilterUnit(e.target.value)}
          className="text-sm min-h-11 rounded-full border border-white/85 bg-white/60 px-4 font-medium text-[var(--ink)] focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-[var(--accent)]/40" aria-label="Filter by unit"
        >
          <option value="all">All units</option>
          {units.map(u => <option key={u} value={u!}>{u}</option>)}
        </select>
      </div>

      {filtered.length === 0 ? (
        <div className="empty-state">
          <Wrench className="h-6 w-6" />
          <p>No requests match this filter</p>
        </div>
      ) : (
        <div className="glass divide-y divide-white/70 overflow-hidden">
          {filtered.map(r => (
            <button
              key={r.id}
              onClick={() => openRequest(r)}
              className="w-full text-left p-4 hover:bg-slate-50 transition-colors"
            >
              <div className="flex items-start gap-3">
                <div className={`mt-1.5 h-2 w-2 rounded-full shrink-0 ${urgencyConfig[r.urgency as keyof typeof urgencyConfig]?.dot ?? 'bg-slate-300'}`} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm text-slate-900">
                        {categoryLabel(r.category, MAINTENANCE_CATEGORIES)}
                      </span>
                      <span className="text-xs text-slate-400">{r.units?.label} · {r.profiles?.full_name}</span>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {r.repair_cost != null && r.repair_cost > 0 && (
                        <span className="text-xs font-medium text-slate-500 flex items-center gap-0.5">
                          <DollarSign className="h-3 w-3" />{formatRWF(r.repair_cost)}
                        </span>
                      )}
                      <span className={`text-xs px-2.5 py-0.5 rounded-full font-bold ${statusConfig[r.status as keyof typeof statusConfig]?.cls}`}>
                        {statusConfig[r.status as keyof typeof statusConfig]?.label ?? r.status}
                      </span>
                    </div>
                  </div>
                  <p className="text-sm text-slate-600 mt-0.5 truncate">{r.description}</p>
                  <p className="text-xs text-slate-400 mt-0.5">
                    {new Date(r.created_at).toLocaleDateString()}
                    {r.urgency === 'high' && (
                      <span className="ml-2 text-red-500 font-medium">· High priority</span>
                    )}
                  </p>
                </div>
              </div>
            </button>
          ))}
        </div>
      )}

      {/* Detail dialog */}
      <Dialog open={!!selected} onOpenChange={() => setSelected(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{selected ? categoryLabel(selected.category, MAINTENANCE_CATEGORIES) : ''} Request</DialogTitle>
          </DialogHeader>
          {selected && (
            <div className="space-y-4">
              <div className="text-sm text-slate-500 flex flex-wrap gap-3">
                <span>{selected.units?.label}</span>
                <span>{selected.profiles?.full_name}</span>
                <span className="capitalize">{selected.urgency} urgency</span>
              </div>
              <p className="text-sm text-slate-700 whitespace-pre-wrap">{selected.description}</p>

              {selected.photo_urls?.length > 0 && (
                <div className="flex gap-2 flex-wrap">
                  {selected.photo_urls.map((stored, i) => {
                    const url = fileUrl('maintenance-photos', stored)
                    if (!url) return null
                    return (
                      <a key={i} href={url} target="_blank" rel="noopener noreferrer">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={url} alt={`Photo ${i + 1}`} className="h-20 w-20 rounded object-cover border" />
                      </a>
                    )
                  })}
                </div>
              )}

              {detail && (detail.history.length > 0 || detail.updates.length > 0) && (
                <div className="space-y-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">History</p>
                  <ol className="space-y-1.5 max-h-48 overflow-y-auto">
                    {[
                      ...detail.history.map(h => ({ at: h.changed_at, text: `${statusInfo(h.to_status).label}${h.comment ? ` · ${h.comment}` : ''}`, tenant: false, photos: [] as string[] })),
                      ...detail.updates.map(u => ({ at: u.created_at, text: `Tenant: ${u.body}`, tenant: true, photos: u.photo_paths })),
                    ].sort((x, y) => x.at.localeCompare(y.at)).map((e, i) => (
                      <li key={i} className={`text-xs rounded-xl px-3 py-2 ${e.tenant ? 'bg-amber-50 text-amber-900' : 'bg-white/70 text-slate-700'}`}>
                        <span className="text-slate-400">{format(new Date(e.at), 'd MMM yyyy, HH:mm')} · </span>{e.text}
                        {e.photos.length > 0 && (
                          <span className="flex gap-1.5 mt-1">
                            {e.photos.map((p, j) => {
                              const url = fileUrl('maintenance-photos', p)
                              return url ? <a key={j} href={url} target="_blank" rel="noopener noreferrer" className="underline">Photo {j + 1}</a> : null
                            })}
                          </span>
                        )}
                      </li>
                    ))}
                  </ol>
                </div>
              )}

              <div className="space-y-1.5">
                <label className="text-sm font-medium text-slate-700">
                  {isOpenStatus(selected.status) ? 'Change status' : 'Reopen as'}
                  <span className="text-slate-400 font-normal"> (now {statusInfo(selected.status).label})</span>
                </label>
                <Select value={newStatus} onValueChange={v => setNewStatus(v ?? '')}>
                  <SelectTrigger>
                    {/* Show the label ("Acknowledged"), not the stored value ("acknowledged"). */}
                    <SelectValue>{(v: string | null) => (v ? statusInfo(v).label : '')}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {nextStatuses(selected.status).map(v => (
                      <SelectItem key={v} value={v}>{statusInfo(v).label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {needsDate(newStatus) && (
                <div className="space-y-1.5">
                  <label htmlFor="scheduled-for" className="text-sm font-medium text-slate-700">Scheduled for *</label>
                  <input
                    id="scheduled-for"
                    type="date"
                    value={scheduledFor}
                    onChange={e => setScheduledFor(e.target.value)}
                    className="w-full border border-white/85 rounded-[14px] px-3.5 min-h-11 text-sm text-slate-900 bg-white/70"
                  />
                </div>
              )}

              <div className="space-y-1.5">
                <label htmlFor="landlord-comment" className="text-sm font-medium text-slate-700">
                  {needsReason(newStatus) ? 'Reason *' : <>Comment to tenant <span className="text-slate-400 font-normal">(optional)</span></>}
                </label>
                <Textarea
                  id="landlord-comment"
                  value={comment}
                  onChange={e => setComment(e.target.value)}
                  placeholder={needsReason(newStatus) ? 'e.g. Waiting for a spare part' : 'e.g. Plumber scheduled for Thursday'}
                  className="resize-none h-20"
                />
                <p className="text-xs text-slate-400">The tenant is notified of every change.</p>
              </div>

              <div className="space-y-1.5">
                <label className="text-sm font-medium text-slate-700">
                  Repair cost (RWF) <span className="text-slate-400 font-normal">(optional — logged as expense)</span>
                </label>
                <input
                  type="text"
                  inputMode="decimal"
                  value={repairCost}
                  onChange={e => setRepairCost(e.target.value)}
                  placeholder="e.g. 50,000"
                  className="w-full border border-white/85 rounded-[14px] px-3.5 min-h-11 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-500 bg-white/70"
                />
              </div>

              <div className="flex gap-2">
                <Button onClick={handleSave} disabled={saving}>
                  {saving ? 'Saving…' : isOpenStatus(selected.status) ? 'Save' : 'Reopen'}
                </Button>
                <Button variant="outline" onClick={() => setSelected(null)}>Cancel</Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
