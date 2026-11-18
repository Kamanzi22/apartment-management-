import { redirect } from 'next/navigation'
import { createClient, getVerifiedUserId } from '@/lib/supabase/server'
import { MessageThread } from '@/components/message-thread'
import { markMessagesRead } from '@/app/actions/messages'
import { getLandlord } from '@/lib/landlord'

export default async function TenantMessagesPage() {
  const userId = await getVerifiedUserId()
  if (!userId) redirect('/login')

  const supabase = await createClient()

  const landlord = await getLandlord(supabase)

  if (!landlord) {
    return <div className="glass p-6"><div className="empty-state">No landlord account found.</div></div>
  }

  const [, { data: messages }, { data: myProfile }] = await Promise.all([
    markMessagesRead(landlord.id), // marks landlord's messages to this tenant as read
    supabase.from('messages').select('*')
      .or(`and(sender_id.eq.${userId},recipient_id.eq.${landlord.id}),and(sender_id.eq.${landlord.id},recipient_id.eq.${userId}),recipient_id.is.null`)
      .order('created_at', { ascending: true }),
    supabase.from('profiles').select('full_name').eq('id', userId).single(),
  ])

  return (
    <div className="space-y-4">
      <div>
        <h1 className="on-photo text-3xl font-semibold tracking-tight">Messages</h1>
        <p className="on-photo text-sm mt-1 opacity-95">Chat with your landlord</p>
      </div>
      <div className="h-[calc(100dvh_-_12.5rem_-_env(safe-area-inset-top)_-_env(safe-area-inset-bottom))] min-h-[320px]">
      <MessageThread
        messages={messages ?? []}
        currentUserId={userId}
        recipientId={landlord.id}
        recipientName={landlord.full_name}
        currentUserName={myProfile?.full_name ?? ''}
        isBroadcastThread={false}
      />
      </div>
    </div>
  )
}
