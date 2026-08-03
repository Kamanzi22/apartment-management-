import { redirect } from 'next/navigation'
import { createClient, getVerifiedUserId } from '@/lib/supabase/server'
import { MessageThread } from '@/components/message-thread'
import { markMessagesRead } from '@/app/actions/messages'

export default async function TenantMessagesPage() {
  const userId = await getVerifiedUserId()
  if (!userId) redirect('/login')

  const supabase = await createClient()

  const { data: landlord } = await supabase
    .from('profiles')
    .select('id, full_name')
    .eq('role', 'landlord')
    .single()

  if (!landlord) {
    return <div className="text-center py-16 text-slate-500">No landlord account found.</div>
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
        <h1 className="text-2xl font-bold text-slate-900">Messages</h1>
        <p className="text-sm text-slate-500 mt-1">Chat with your landlord</p>
      </div>
      <MessageThread
        messages={messages ?? []}
        currentUserId={userId}
        recipientId={landlord.id}
        recipientName={landlord.full_name}
        currentUserName={myProfile?.full_name ?? ''}
        isBroadcastThread={false}
      />
    </div>
  )
}
