'use client'

import { useState } from 'react'
import { updateMaintenanceStatus } from '@/app/actions/maintenance'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Wrench, DollarSign } from 'lucide-react'
import { toast } from 'sonner'
import { MAINTENANCE_CATEGORIES, categoryLabel } from '@/lib/categories'
import { formatRWF, parseAmountInput } from '@/lib/currency'

interface Request {
  id: string
  category: string
  description: string
  urgency: string
  status: string
  photo_urls: string[]
  landlord_comment: string | null
  repair_cost?: number | null
  created_at: string
  updated_at: string
  profiles: { full_name: string } | null
  units: { label: string } | null
}

const statusConfig = {
  submitted:    { label: 'Submitted',    cls: 'bg-slate-100 text-slate-700' },
  acknowledged: { label: 'Acknowledged', cls: 'bg-blue-100 text-blue-700' },
  in_progress:  { label: 'In progress',  cls: 'bg-amber-100 text-amber-700' },
  resolved:     { label: 'Resolved',     cls: 'bg-green-100 text-green-700' },
}

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
    setNewStatus(r.status)
    setComment(r.landlord_comment ?? '')
    setRepairCost(r.repair_cost != null ? r.repair_cost.toString() : '')
  }

  async function handleSave() {
    if (!selected) return
    setSaving(true)
    const cost = repairCost ? parseAmountInput(repairCost) : undefined
    const result = await updateMaintenanceStatus(selected.id, newStatus, comment || undefined, cost)
    setSaving(false)
    if (result?.error) {
      toast.error(result.error)
    } else {
      toast.success('Request updated')
      // Update local state so the list reflects the change immediately
      setLocalRequests(prev => prev.map(r =>
        r.id === selected.id
          ? { ...r, status: newStatus, landlord_comment: comment || null, repair_cost: cost ?? r.repair_cost }
          : r
      ))
      setSelected(null)
    }
  }

  return (
    <>
      {/* Filters */}
      <div className="flex flex-wrap gap-2">
        <select
          value={filterCategory}
          onChange={e => setFilterCategory(e.target.value)}
          className="text-sm border rounded-lg px-3 py-1.5 bg-white text-slate-700"
        >
          <option value="all">All categories</option>
          {MAINTENANCE_CATEGORIES.map(c => (
            <option key={c.value} value={c.value}>{c.label}</option>
          ))}
        </select>
        <select
          value={filterStatus}
          onChange={e => setFilterStatus(e.target.value)}
          className="text-sm border rounded-lg px-3 py-1.5 bg-white text-slate-700"
        >
          <option value="all">All statuses</option>
          {Object.entries(statusConfig).map(([v, { label }]) => (
            <option key={v} value={v}>{label}</option>
          ))}
        </select>
        <select
          value={filterUrgency}
          onChange={e => setFilterUrgency(e.target.value)}
          className="text-sm border rounded-lg px-3 py-1.5 bg-white text-slate-700"
        >
          <option value="all">All urgencies</option>
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
        </select>
        <select
          value={filterUnit}
          onChange={e => setFilterUnit(e.target.value)}
          className="text-sm border rounded-lg px-3 py-1.5 bg-white text-slate-700"
        >
          <option value="all">All units</option>
          {units.map(u => <option key={u} value={u!}>{u}</option>)}
        </select>
      </div>

      {filtered.length === 0 ? (
        <div className="text-center py-12 text-slate-400">
          <Wrench className="h-8 w-8 mx-auto mb-2 opacity-40" />
          <p>No requests match this filter</p>
        </div>
      ) : (
        <div className="rounded-xl border bg-white divide-y shadow-sm">
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
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${statusConfig[r.status as keyof typeof statusConfig]?.cls}`}>
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
                  {selected.photo_urls.map((url, i) => (
                    <a key={i} href={url} target="_blank" rel="noopener noreferrer">
                      <img src={url} alt="" className="h-20 w-20 rounded object-cover border" />
                    </a>
                  ))}
                </div>
              )}

              <div className="space-y-1.5">
                <label className="text-sm font-medium text-slate-700">Update status</label>
                <Select value={newStatus} onValueChange={v => setNewStatus(v ?? '')}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(statusConfig).map(([v, { label }]) => (
                      <SelectItem key={v} value={v}>{label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <label className="text-sm font-medium text-slate-700">Note to tenant <span className="text-slate-400 font-normal">(optional)</span></label>
                <Textarea
                  value={comment}
                  onChange={e => setComment(e.target.value)}
                  placeholder="e.g. Plumber scheduled for Thursday"
                  className="resize-none h-20"
                />
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
                  className="w-full border rounded-lg px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-500"
                />
              </div>

              <div className="flex gap-2">
                <Button onClick={handleSave} disabled={saving}>
                  {saving ? 'Saving…' : 'Save'}
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
