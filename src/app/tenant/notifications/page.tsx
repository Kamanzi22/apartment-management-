import { redirect } from 'next/navigation'
import { createClient, getVerifiedUserId } from '@/lib/supabase/server'
import { NotificationList } from '@/components/notification-list'
import { markAllNotificationsRead } from '@/app/actions/notifications'

export default async function TenantNotificationsPage() {
  const userId = await getVerifiedUserId()
  if (!userId) redirect('/login')

  const supabase = await createClient()

  const { data: notifications } = await supabase
    .from('notifications')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(50)

  const unreadCount = notifications?.filter(n => !n.read_at).length ?? 0

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Notifications</h1>
          {unreadCount > 0 && (
            <p className="text-sm text-slate-500 mt-1">{unreadCount} unread</p>
          )}
        </div>
        {unreadCount > 0 && (
          <form action={markAllNotificationsRead}>
            <button type="submit" className="text-sm text-slate-500 hover:text-slate-700 underline-offset-2 hover:underline">
              Mark all read
            </button>
          </form>
        )}
      </div>
      <NotificationList notifications={notifications ?? []} />
    </div>
  )
}
