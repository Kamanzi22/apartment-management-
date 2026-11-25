// Landlord app only. Tenants who closed their account from the phone app
// (migration 17: profiles.deleted_at). Their login is blocked; every detail and
// record is kept, so the landlord still sees name, phone and email.
//
// deleted_at is not in database.types.ts yet (that file is shared with the
// tenant repo and is regenerated once 17 is applied), so this reads it with an
// untyped query. Before 17 is applied the column does not exist: the query
// fails and every tenant counts as open.
import type { SupabaseClient } from '@supabase/supabase-js'

export const CLOSED_ACCOUNT_LABEL = 'Former tenant (account closed)'

export interface ClosedAccount { phone: string | null; closedAt: string }

type Loose = { from(table: string): any } // eslint-disable-line @typescript-eslint/no-explicit-any

/** Closed accounts among `ids`, keyed by profile id. */
export async function loadClosedAccounts(supabase: SupabaseClient | unknown, ids: string[]): Promise<Map<string, ClosedAccount>> {
  const out = new Map<string, ClosedAccount>()
  const unique = [...new Set(ids.filter(Boolean))]
  if (!unique.length) return out
  try {
    const { data, error } = await (supabase as Loose).from('profiles')
      .select('id, phone, deleted_at').in('id', unique).not('deleted_at', 'is', null)
    if (error || !Array.isArray(data)) return out
    for (const r of data as { id: string; phone: string | null; deleted_at: string | null }[]) {
      if (r.deleted_at) out.set(r.id, { phone: r.phone, closedAt: r.deleted_at })
    }
  } catch { /* column missing before migration 17: nobody is closed */ }
  return out
}
