'use client'

import { useRouter } from 'next/navigation'
import { useTransition } from 'react'
import { markNotificationRead } from '@/app/actions/notifications'
import { Bell, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'

interface Notification {
  id: string
  type: string
  title: string
  body: string
  link: string | null
  read_at: string | null
  created_at: string
}

// Clicking a notification marks it read, then opens its link.
export function NotificationList({ notifications }: { notifications: Notification[] }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  if (notifications.length === 0) {
    return (
      <div className="glass p-6">
        <div className="empty-state">
          <Bell className="h-6 w-6" />
          <p>No notifications yet</p>
        </div>
      </div>
    )
  }

  function open(n: Notification) {
    startTransition(async () => {
      if (!n.read_at) await markNotificationRead(n.id)
      if (n.link) router.push(n.link)
      else router.refresh()
    })
  }

  return (
    <div className={cn('glass divide-y divide-white/70 overflow-hidden', pending && 'opacity-80')}>
      {notifications.map(n => (
        <button
          key={n.id}
          type="button"
          onClick={() => open(n)}
          className={cn(
            'w-full text-left flex gap-3 px-4 py-3 transition-colors hover:bg-white/60',
            !n.read_at && 'bg-blue-50/50'
          )}
        >
          <span
            aria-hidden
            className={cn('mt-1.5 h-2 w-2 rounded-full shrink-0', n.read_at ? 'bg-slate-200' : 'bg-blue-500')}
          />
          <span className="flex-1 min-w-0">
            <span className="block text-sm font-medium text-slate-800">
              {n.title}
              {!n.read_at && <span className="sr-only"> (unread)</span>}
            </span>
            <span className="block text-xs text-slate-500 mt-0.5">{n.body}</span>
            <span className="block text-xs text-slate-400 mt-1">
              {new Date(n.created_at).toLocaleString('en-GB', {
                timeZone: 'Africa/Kigali', day: 'numeric', month: 'short', year: 'numeric',
                hour: '2-digit', minute: '2-digit',
              })}
            </span>
          </span>
          {n.link && <ChevronRight className="h-4 w-4 text-slate-400 self-center shrink-0" />}
        </button>
      ))}
    </div>
  )
}
