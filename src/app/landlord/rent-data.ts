import type { createClient } from '@/lib/supabase/server'
import { fetchLedgers, owedAfterPending, type LedgerRow } from '@/lib/rent-ledger'

type Client = Awaited<ReturnType<typeof createClient>>

export interface LeaseInfo {
  id: string
  unit_id: string
  tenant_id: string
  monthly_rent: number
  rent_due_day: number
  move_in_date: string
  lease_start: string
  lease_end: string | null
  status: 'active' | 'ended'
  tenant_name: string
  unit_label: string
}

export interface ArrearsLine {
  leaseId: string
  unitLabel: string
  active: boolean
  months: LedgerRow[]
  total: number
}

export interface TenantArrears {
  tenantId: string
  name: string
  /** Balance across all of the tenant's leases (confirmed payments only). */
  total: number
  /** Part of `total` already covered by receipts waiting for review. */
  underReview: number
  /** Balance on ended leases only ("previous balance"). */
  previous: number
  isCurrent: boolean
  lines: ArrearsLine[]
}

export interface RentState {
  leases: LeaseInfo[]
  ledgers: Map<string, LedgerRow[]>
  arrears: Map<string, TenantArrears>
}

/** Every lease, its ledger (one RPC call), and each tenant's arrears across all their leases. */
export async function loadRentState(supabase: Client): Promise<RentState> {
  const { data, error } = await supabase
    .from('leases')
    .select(`
      id, unit_id, tenant_id, monthly_rent, rent_due_day, move_in_date, lease_start, lease_end, status,
      profiles!leases_tenant_id_fkey(full_name),
      units!leases_unit_id_fkey(label)
    `)
    .order('move_in_date')
  if (error) throw new Error(`leases: ${error.message}`)

  const leases: LeaseInfo[] = (data ?? []).map(l => ({
    id: l.id,
    unit_id: l.unit_id,
    tenant_id: l.tenant_id,
    monthly_rent: Number(l.monthly_rent),
    rent_due_day: l.rent_due_day,
    move_in_date: l.move_in_date,
    lease_start: l.lease_start,
    lease_end: l.lease_end,
    status: l.status,
    tenant_name: (l.profiles as { full_name: string } | null)?.full_name ?? 'Tenant',
    unit_label: (l.units as { label: string } | null)?.label ?? 'Unit',
  }))
  const ledgers = await fetchLedgers(supabase, leases.map(l => l.id))
  return { leases, ledgers, arrears: buildArrears(leases, ledgers) }
}

export function buildArrears(leases: LeaseInfo[], ledgers: Map<string, LedgerRow[]>): Map<string, TenantArrears> {
  const map = new Map<string, TenantArrears>()
  for (const lease of leases) {
    const rows = ledgers.get(lease.id) ?? []
    const months = rows.filter(r => r.balance > 0)
    const entry = map.get(lease.tenant_id) ?? {
      tenantId: lease.tenant_id, name: lease.tenant_name, total: 0, underReview: 0, previous: 0,
      isCurrent: false, lines: [],
    }
    const total = months.reduce((s, r) => s + r.balance, 0)
    entry.total += total
    entry.underReview += months.reduce((s, r) => s + (r.balance - owedAfterPending(r)), 0)
    if (lease.status !== 'active') entry.previous += total
    if (lease.status === 'active') entry.isCurrent = true
    if (months.length) {
      entry.lines.push({ leaseId: lease.id, unitLabel: lease.unit_label, active: lease.status === 'active', months, total })
    }
    map.set(lease.tenant_id, entry)
  }
  return map
}

export interface OpenNotice {
  id: string
  lease_id: string
  tenant_id: string
  tenant_name: string
  unit_id: string
  unit_label: string
  intended_move_out_date: string
  reason: string | null
  status: 'submitted' | 'acknowledged'
  created_at: string
}

/** Move-out notices whose lease is still active (not yet confirmed). */
export async function loadOpenNotices(supabase: Client, unitId?: string): Promise<OpenNotice[]> {
  const { data, error } = await supabase
    .from('move_out_notices')
    .select(`
      id, lease_id, tenant_id, intended_move_out_date, reason, status, created_at,
      profiles!move_out_notices_tenant_id_fkey(full_name),
      leases!move_out_notices_lease_id_fkey(unit_id, status, units!leases_unit_id_fkey(label))
    `)
    .order('intended_move_out_date')
  if (error) throw new Error(`move_out_notices: ${error.message}`)
  return (data ?? [])
    .map(n => {
      const lease = n.leases as unknown as { unit_id: string; status: string; units: { label: string } | null } | null
      return {
        id: n.id,
        lease_id: n.lease_id,
        tenant_id: n.tenant_id,
        tenant_name: (n.profiles as { full_name: string } | null)?.full_name ?? 'Tenant',
        unit_id: lease?.unit_id ?? '',
        unit_label: lease?.units?.label ?? 'Unit',
        intended_move_out_date: n.intended_move_out_date,
        reason: n.reason,
        status: n.status,
        created_at: n.created_at,
        leaseActive: lease?.status === 'active',
      }
    })
    .filter(n => n.leaseActive && (!unitId || n.unit_id === unitId))
    .map(({ leaseActive: _active, ...n }) => n)
}
