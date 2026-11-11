// Kept identical in apartment-manager and apartment-manager-tenant.
// Repair statuses. Only the landlord changes them (enforced in migration 14).
import type { MaintenanceStatus } from '@/lib/supabase/database.types'

export type { MaintenanceStatus }

export const MAINTENANCE_STATUSES: { value: MaintenanceStatus; label: string; cls: string }[] = [
  { value: 'submitted', label: 'Submitted', cls: 'bg-slate-100 text-slate-700' },
  { value: 'acknowledged', label: 'Acknowledged', cls: 'bg-blue-100 text-blue-700' },
  { value: 'scheduled', label: 'Scheduled', cls: 'bg-indigo-100 text-indigo-700' },
  { value: 'in_progress', label: 'In progress', cls: 'bg-amber-100 text-amber-700' },
  { value: 'on_hold', label: 'On hold', cls: 'bg-orange-100 text-orange-700' },
  { value: 'resolved', label: 'Resolved', cls: 'bg-green-100 text-green-700' },
  { value: 'closed', label: "Closed – won't fix", cls: 'bg-slate-200 text-slate-600' },
]

export function statusInfo(status: string) {
  return MAINTENANCE_STATUSES.find(s => s.value === status)
    ?? { value: status as MaintenanceStatus, label: status.replace('_', ' '), cls: 'bg-slate-100 text-slate-600' }
}

/** Resolved and closed requests are finished; the landlord can reopen them. */
export function isOpenStatus(status: string): boolean {
  return status !== 'resolved' && status !== 'closed'
}

/** The statuses the landlord can move a request to from `current`. */
export function nextStatuses(current: string): MaintenanceStatus[] {
  if (!isOpenStatus(current)) return ['acknowledged', 'in_progress'] // reopen
  return MAINTENANCE_STATUSES.map(s => s.value).filter(s => s !== current && s !== 'submitted')
}

export function needsReason(status: string): boolean {
  return status === 'on_hold' || status === 'closed'
}

export function needsDate(status: string): boolean {
  return status === 'scheduled'
}

/** Returns an error message, or null when the change is valid. */
export function validateStatusChange(
  current: string, next: string, comment: string | null | undefined, scheduledFor: string | null | undefined,
): string | null {
  if (!MAINTENANCE_STATUSES.some(s => s.value === next)) return 'Unknown status.'
  if (next === current) return 'Choose a different status.'
  if (!nextStatuses(current).includes(next as MaintenanceStatus)) return 'That change is not allowed.'
  if (needsReason(next) && !comment?.trim()) return 'Give a reason for putting this on hold or closing it.'
  if (needsDate(next) && !/^\d{4}-\d{2}-\d{2}$/.test(scheduledFor ?? '')) return 'Choose the date the repair is scheduled for.'
  return null
}
