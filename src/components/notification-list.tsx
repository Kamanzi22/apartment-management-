'use client'

import Link from 'next/link'
import { markNotificationRead } from '@/app/actions/notifications'
import { Bell } from 'lucide-react'
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

export function NotificationList({ notifications }: { notifications: Notification[] }) {
  if (notifications.length === 0) {
    return (
      <div className="empty-state">
        <Bell className="h-6 w-6" />
        <p>No notifications yet</p>
      </div>
    )
  }

  return (
    <div className="glass divide-y divide-white/70 overflow-hidden">
      {notifications.map(n => {
        const content = (
          <div className={cn(
            'flex gap-3 px-4 py-3 transition-colors',
            !n.read_at ? 'bg-blue-50/50' : '',
            n.link ? 'hover:bg-slate-50 cursor-pointer' : ''
          )}>
            <div className={cn(
              'mt-0.5 h-2 w-2 rounded-full shrink-0',
              n.read_at ? 'bg-slate-200' : 'bg-blue-500'
            )} />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-slate-800">{n.title}</p>
              <p className="text-xs text-slate-500 mt-0.5">{n.body}</p>
              <p className="text-xs text-slate-400 mt-1">
                {new Date(n.created_at).toLocaleString([], {
                  month: 'short', day: 'numeric',
                  hour: '2-digit', minute: '2-digit'
                })}
              </p>
            </div>
          </div>
        )

        const handleClick = () => {
          if (!n.read_at) markNotificationRead(n.id)
        }

        if (n.link) {
          return (
            <Link key={n.id} href={n.link} onClick={handleClick}>
              {content}
            </Link>
          )
        }

        return (
          <div key={n.id} onClick={handleClick}>
            {content}
          </div>
        )
      })}
    </div>
  )
}
