// Kept identical in apartment-manager and apartment-manager-tenant.
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/database.types'

/**
 * The landlord who receives tenant alerts and messages. Works with any number
 * of landlord profiles (the earliest-created one wins), unlike
 * `.eq('role', 'landlord').single()`, which errors as soon as there are two.
 */
export async function getLandlordId(supabase: SupabaseClient<Database>): Promise<string | null> {
  const { data } = await supabase
    .from('profiles')
    .select('id')
    .eq('role', 'landlord')
    .order('created_at', { ascending: true })
    .order('id', { ascending: true })
    .limit(1)
    .maybeSingle()
  return data?.id ?? null
}

export async function getLandlord(
  supabase: SupabaseClient<Database>,
): Promise<{ id: string; full_name: string } | null> {
  const { data } = await supabase
    .from('profiles')
    .select('id, full_name')
    .eq('role', 'landlord')
    .order('created_at', { ascending: true })
    .order('id', { ascending: true })
    .limit(1)
    .maybeSingle()
  return data ?? null
}
