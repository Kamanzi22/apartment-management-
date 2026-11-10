import { redirect } from 'next/navigation'
import { createClient, getVerifiedUserId } from '@/lib/supabase/server'
import { LandlordMessaging, type Message } from './landlord-messaging'
import { demoTenants, demoMessages, DEMO_LANDLORD_ID } from '@/lib/demo-data'

// Newest messages per thread. Loading everything oldest-first hit Supabase's
// 1,000-row cap after about two years and hid the newest messages.
const PAGE = 200

export default async function LandlordMessagesPage() {
  if (process.env.NEXT_PUBLIC_DEMO_MODE === 'true') {
    return (
      <div className="space-y-4">
        <div>
          <h1 className="on-photo text-3xl font-semibold tracking-tight">Messages</h1>
          <p className="on-photo text-sm mt-1 opacity-95">Per-tenant threads and broadcast</p>
        </div>
        <LandlordMessaging
          tenants={demoTenants as never}
          units={[]}
          threads={{ broadcast: demoMessages.filter(m => m.recipient_id === null) as unknown as Message[] }}
          hasMore={{}}
          unread={{}}
          landlordId={DEMO_LANDLORD_ID}
        />
      </div>
    )
  }

  const userId = await getVerifiedUserId()
  if (!userId) redirect('/login')

  const supabase = await createClient()

  const [{ data: tenants }, { data: units }, { data: broadcasts }, { data: unreadRows }] = await Promise.all([
    supabase.from('profiles').select('id, full_name, unit_id, units(label)').eq('role', 'tenant').order('full_name'),
    supabase.from('units').select('id, label').order('label'),
    supabase.from('messages').select('id, sender_id, recipient_id, body, created_at, read_at')
      .is('recipient_id', null).order('created_at', { ascending: false }).limit(PAGE),
    supabase.from('messages').select('sender_id').eq('recipient_id', userId).is('read_at', null).limit(1000),
  ])

  const tenantThreads = await Promise.all((tenants ?? []).map(async t => {
    const { data } = await supabase
      .from('messages')
      .select('id, sender_id, recipient_id, body, created_at, read_at')
      .or(`and(sender_id.eq.${userId},recipient_id.eq.${t.id}),and(sender_id.eq.${t.id},recipient_id.eq.${userId})`)
      .order('created_at', { ascending: false })
      .limit(PAGE)
    return [t.id, data ?? []] as const
  }))

  const threads: Record<string, Message[]> = { broadcast: [...(broadcasts ?? [])].reverse() }
  const hasMore: Record<string, boolean> = { broadcast: (broadcasts?.length ?? 0) === PAGE }
  for (const [id, rows] of tenantThreads) {
    threads[id] = [...rows].reverse()
    hasMore[id] = rows.length === PAGE
  }
  const unread: Record<string, number> = {}
  for (const r of unreadRows ?? []) unread[r.sender_id] = (unread[r.sender_id] ?? 0) + 1

  return (
    <div className="space-y-4">
      <div>
        <h1 className="on-photo text-3xl font-semibold tracking-tight">Messages</h1>
        <p className="on-photo text-sm mt-1 opacity-95">Broadcast all units or message a specific unit</p>
      </div>
      <LandlordMessaging
        tenants={(tenants ?? []) as never}
        units={units ?? []}
        threads={threads}
        hasMore={hasMore}
        unread={unread}
        landlordId={userId}
      />
    </div>
  )
}
