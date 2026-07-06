'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { signOut } from '@/app/actions/auth'
import {
  Building2, LayoutDashboard, CreditCard, Wrench,
  MessageSquare, LogOut, DollarSign, Receipt,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'

const navItems = [
  { href: '/landlord', label: 'Overview', icon: LayoutDashboard, exact: true },
  { href: '/landlord/rent', label: 'Rent', icon: CreditCard },
  { href: '/landlord/maintenance', label: 'Maintenance', icon: Wrench },
  { href: '/landlord/messages', label: 'Messages', icon: MessageSquare },
  { href: '/landlord/financials', label: 'Financials', icon: DollarSign },
  { href: '/landlord/building-costs', label: 'Building Costs', icon: Receipt },
]

interface Props {
  unreadCount: number
  unreadMessageCount?: number
  maintenanceCount?: number
  fullName: string
}

export function NavLandlord({ unreadCount, unreadMessageCount = 0, maintenanceCount = 0, fullName }: Props) {
  const pathname = usePathname()

  return (
    <>
      {/* Desktop sidebar */}
      <aside className="hidden lg:flex lg:flex-col lg:w-56 lg:fixed lg:inset-y-0 bg-slate-900 text-white">
        <div className="flex items-center gap-2 px-4 py-5 border-b border-slate-700">
          <Building2 className="h-5 w-5 text-slate-300" />
          <span className="font-semibold text-sm">Apartment Manager</span>
        </div>
        <nav className="flex-1 px-2 py-4 space-y-0.5">
          {navItems.map(({ href, label, icon: Icon, exact }) => {
            const active = exact ? pathname === href : pathname.startsWith(href)
            const isMessages = href === '/landlord/messages'
            const isMaintenance = href === '/landlord/maintenance'
            const badgeCount = isMessages ? unreadMessageCount : isMaintenance ? maintenanceCount : 0
            return (
              <Link
                key={href}
                href={href}
                className={cn(
                  'flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors',
                  active
                    ? 'bg-slate-700 text-white'
                    : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                )}
              >
                <Icon className="h-4 w-4 shrink-0" />
                {label}
                {badgeCount > 0 && (
                  <Badge variant="destructive" className="ml-auto text-xs px-1.5 py-0">
                    {badgeCount}
                  </Badge>
                )}
              </Link>
            )
          })}
        </nav>
        <div className="px-2 pb-4 border-t border-slate-700 pt-3 space-y-0.5">
          <form action={signOut}>
            <button
              type="submit"
              className="w-full flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium text-slate-300 hover:bg-slate-800 hover:text-white transition-colors"
            >
              <LogOut className="h-4 w-4 shrink-0" />
              Sign out
            </button>
          </form>
          <div className="px-3 py-2">
            <p className="text-xs text-slate-400 truncate">{fullName}</p>
          </div>
        </div>
      </aside>

      {/* Mobile bottom nav */}
      <nav className="lg:hidden fixed bottom-0 inset-x-0 bg-slate-900 border-t border-slate-700 z-50">
        <div className="flex">
          {navItems.map(({ href, label, icon: Icon, exact }) => {
            const active = exact ? pathname === href : pathname.startsWith(href)
            const isMessages = href === '/landlord/messages'
            const isMaintenance = href === '/landlord/maintenance'
            const badgeCount = isMessages ? unreadMessageCount : isMaintenance ? maintenanceCount : 0
            return (
              <Link
                key={href}
                href={href}
                className={cn(
                  'flex-1 flex flex-col items-center gap-0.5 py-2 text-xs relative',
                  active ? 'text-white' : 'text-slate-400'
                )}
              >
                <Icon className="h-5 w-5" />
                <span>{label}</span>
                {badgeCount > 0 && (
                  <span className="absolute top-1.5 right-2 h-4 w-4 rounded-full bg-red-500 text-white text-[10px] flex items-center justify-center">
                    {badgeCount > 9 ? '9+' : badgeCount}
                  </span>
                )}
              </Link>
            )
          })}
        </div>
      </nav>
    </>
  )
}
