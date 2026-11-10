'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { signOut } from '@/app/actions/auth'
import { CreditCard, Wrench, MessageSquare, DoorOpen, FileText, Bell, LogOut } from 'lucide-react'
import { cn } from '@/lib/utils'

// Same floating glass tab bar as the standalone tenant app (apartment-manager-tenant),
// plus this portal's extra Move-out, Lease and Alerts pages so they stay reachable.
const navItems = [
  { href: '/tenant', label: 'Rent', icon: CreditCard, exact: true },
  { href: '/tenant/maintenance', label: 'Maintenance', icon: Wrench },
  { href: '/tenant/messages', label: 'Messages', icon: MessageSquare },
  { href: '/tenant/move-out', label: 'Move-out', icon: DoorOpen },
  { href: '/tenant/lease', label: 'Lease', icon: FileText },
  { href: '/tenant/notifications', label: 'Alerts', icon: Bell },
]

interface Props {
  unreadCount: number
  fullName: string
  unitLabel: string
}

const tabCls =
  'w-full min-h-[56px] flex flex-col items-center justify-center gap-0.5 rounded-[18px] text-[10px] sm:text-[11px] font-medium transition-colors relative'
const activeCls = 'bg-white/85 text-[var(--ink)] font-semibold shadow-[0_4px_12px_rgba(20,30,40,0.12)]'
const idleCls = 'text-[var(--muted-2)] hover:bg-white/40'

export function NavTenant({ unreadCount, fullName, unitLabel }: Props) {
  const pathname = usePathname()

  return (
    <nav
      aria-label={`Tenant portal: ${fullName}, ${unitLabel}`}
      className="glass fixed bottom-3.5 inset-x-3.5 md:left-1/2 md:right-auto md:w-[600px] md:-translate-x-1/2 z-50 rounded-[24px]! p-1.5"
    >
      <div className="flex gap-0.5">
        {navItems.map(({ href, label, icon: Icon, exact }) => {
          const active = exact ? pathname === href : pathname.startsWith(href)
          const badge = href === '/tenant/notifications' ? unreadCount : 0
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? 'page' : undefined}
              aria-label={badge > 0 ? `${label}, ${badge} unread` : undefined}
              className={cn('flex-1 min-w-0', tabCls, active ? activeCls : idleCls)}
            >
              <Icon className="h-5 w-5" />
              <span className="truncate max-w-full px-0.5">{label}</span>
              {badge > 0 && (
                <span className="absolute top-1 right-1.5 h-4 min-w-4 px-1 rounded-full bg-[var(--danger-text)] text-white text-[10px] font-bold flex items-center justify-center">
                  {badge > 9 ? '9+' : badge}
                </span>
              )}
            </Link>
          )
        })}
        <form action={signOut} className="flex-1 min-w-0">
          <button type="submit" className={cn(tabCls, idleCls)}>
            <LogOut className="h-5 w-5" />
            <span className="truncate max-w-full px-0.5">Sign out</span>
          </button>
        </form>
      </div>
    </nav>
  )
}
