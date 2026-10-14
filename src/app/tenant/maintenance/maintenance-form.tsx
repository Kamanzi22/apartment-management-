'use client'

import { useState, useRef } from 'react'
import { submitMaintenanceRequest } from '@/app/actions/maintenance'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Plus, X, ImagePlus, AlertTriangle } from 'lucide-react'
import { toast } from 'sonner'
import {
  MAINTENANCE_CATEGORIES,
  URGENCIES,
  defaultUrgency,
  type MaintenanceCategory,
  type Urgency,
} from '@/lib/categories'

export function MaintenanceForm() {
  const [open, setOpen] = useState(false)
  const [category, setCategory] = useState<MaintenanceCategory | ''>('')
  const [urgency, setUrgency] = useState<Urgency>('medium')
  const [description, setDescription] = useState('')
  const [otherText, setOtherText] = useState('')
  const [photos, setPhotos] = useState<File[]>([])
  const [submitting, setSubmitting] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  function handleCategoryChange(value: string | null) {
    const cat = (value ?? '') as MaintenanceCategory
    setCategory(cat)
    if (cat) setUrgency(defaultUrgency(cat))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!category || !urgency || !description.trim()) {
      toast.error('Please fill in all required fields')
      return
    }
    if (category === 'other' && !otherText.trim()) {
      toast.error('Please specify the maintenance type')
      return
    }
    setSubmitting(true)
    const fd = new FormData()
    fd.append('category', category)
    fd.append('urgency', urgency)
    fd.append('description', category === 'other' ? `${otherText.trim()}: ${description}` : description)
    for (const p of photos) fd.append('photos', p)

    const result = await submitMaintenanceRequest(fd)
    setSubmitting(false)

    if (result?.error) {
      toast.error(result.error)
    } else {
      toast.success('Request submitted!')
      setOpen(false)
      setCategory(''); setUrgency('medium'); setDescription(''); setOtherText(''); setPhotos([])
    }
  }

  if (!open) {
    return (
      <Button onClick={() => setOpen(true)} className="w-full sm:w-auto">
        <Plus className="h-4 w-4 mr-2" />
        New Maintenance Request
      </Button>
    )
  }

  return (
    <Card className="shadow-sm">
      <CardHeader className="pb-3">
        <CardTitle className="text-base">New Maintenance Request</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>Category *</Label>
              <Select value={category} onValueChange={handleCategoryChange}>
                <SelectTrigger>
                  <SelectValue placeholder="Select category" />
                </SelectTrigger>
                <SelectContent>
                  {MAINTENANCE_CATEGORIES.map(c => (
                    <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Urgency *</Label>
              <Select value={urgency} onValueChange={v => setUrgency((v ?? 'medium') as Urgency)}>
                <SelectTrigger>
                  <SelectValue placeholder="Select urgency" />
                </SelectTrigger>
                <SelectContent>
                  {URGENCIES.map(u => (
                    <SelectItem key={u} value={u} className="capitalize">{u}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {category === 'safety' && urgency === 'high' && (
                <p className="text-xs text-red-600 flex items-center gap-1 mt-1">
                  <AlertTriangle className="h-3 w-3" />
                  Safety issues are flagged high urgency by default
                </p>
              )}
            </div>
          </div>

          {category === 'other' && (
            <div className="space-y-1.5">
              <Label>Specify maintenance type *</Label>
              <Input
                value={otherText}
                onChange={e => setOtherText(e.target.value)}
                placeholder="e.g. Door lock, Painting…"
                required
              />
            </div>
          )}

          <div className="space-y-1.5">
            <Label>Description *</Label>
            <Textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder={
                category === 'safety'
                  ? 'Describe the safety hazard in detail — be as specific as possible…'
                  : 'Describe the issue in detail…'
              }
              className="min-h-[100px]"
              required
            />
          </div>

          <div className="space-y-1.5">
            <Label>Photos (optional)</Label>
            <div className="flex flex-wrap gap-2">
              {photos.map((f, i) => (
                <div key={i} className="relative">
                  <img
                    src={URL.createObjectURL(f)}
                    alt=""
                    className="h-16 w-16 rounded object-cover border"
                  />
                  <button
                    type="button"
                    className="absolute -top-1 -right-1 bg-white rounded-full border shadow-sm p-0.5"
                    onClick={() => setPhotos(prev => prev.filter((_, j) => j !== i))}
                  >
                    <X className="h-3 w-3 text-slate-500" />
                  </button>
                </div>
              ))}
              {photos.length < 5 && (
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  className="h-16 w-16 rounded border-2 border-dashed border-slate-300 flex items-center justify-center hover:border-slate-400 transition-colors"
                >
                  <ImagePlus className="h-5 w-5 text-slate-400" />
                </button>
              )}
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={e => {
                  const files = Array.from(e.target.files ?? [])
                  setPhotos(prev => [...prev, ...files].slice(0, 5))
                  e.target.value = ''
                }}
              />
            </div>
            <p className="text-xs text-slate-400">Up to 5 photos</p>
          </div>

          <div className="flex gap-2 pt-1">
            <Button type="submit" disabled={submitting || !category || !description.trim() || (category === 'other' && !otherText.trim())}>
              {submitting ? 'Submitting…' : 'Submit Request'}
            </Button>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}
