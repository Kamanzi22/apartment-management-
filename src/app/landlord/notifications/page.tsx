import { redirect } from 'next/navigation'
import { createClient, getVerifiedUserId } from '@/lib/supabase/server'
import { NotificationList } from '@/components/notification-list'
import { PushToggle } from '@/components/push-toggle'
import { markAllNotificationsRead } from '@/app/actions/notifications'

export default async function LandlordNotificationsPage() {
  const userId = await getVerifiedUserId()
  if (!userId) redirect('/login')

  const supabase = await createClient()
  const [{ data: notifications }, { count: unreadCount }] = await Promise.all([
    supabase
      .from('notifications')
      .select('id, type, title, body, link, read_at, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(50),
    supabase
      .from('notifications')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .is('read_at', null),
  ])

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="on-photo text-3xl font-semibold tracking-tight">Notifications</h1>
          <p className="on-photo text-sm mt-1 opacity-95">
            {unreadCount ? `${unreadCount} unread` : 'All caught up'} · newest 50
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <PushToggle />
          {!!unreadCount && (
            <form action={markAllNotificationsRead}>
              <button type="submit" className="btn-primary">Mark all read</button>
            </form>
          )}
        </div>
      </div>
      <NotificationList notifications={notifications ?? []} />
    </div>
  )
}
