'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { signOut } from '@/app/actions/auth'
import {
  Building2, LayoutDashboard, CreditCard, Wrench,
  MessageSquare, LogOut, DollarSign, Receipt, User,
} from 'lucide-react'
import { cn } from '@/lib/utils'

type NavItem = { href: string; label: string; icon: typeof LayoutDashboard; exact?: boolean }

const navGroups: { title: string; items: NavItem[] }[] = [
  {
    title: 'Main',
    items: [
      { href: '/landlord', label: 'Overview', icon: LayoutDashboard, exact: true },
      { href: '/landlord/rent', label: 'Rent', icon: CreditCard },
      { href: '/landlord/maintenance', label: 'Maintenance', icon: Wrench },
      { href: '/landlord/messages', label: 'Messages', icon: MessageSquare },
    ],
  },
  {
    title: 'Money',
    items: [
      { href: '/landlord/building-costs', label: 'Expenses', icon: Receipt },
      { href: '/landlord/financials', label: 'Financials', icon: DollarSign },
    ],
  },
  {
    title: 'Account',
    items: [{ href: '/landlord/profile', label: 'Profile', icon: User }],
  },
]

const allItems = navGroups.flatMap(g => g.items)

interface Props {
  unreadCount: number
  unreadMessageCount?: number
  maintenanceCount?: number
  fullName: string
}

export function NavLandlord({ unreadMessageCount = 0, maintenanceCount = 0, fullName }: Props) {
  const pathname = usePathname()
  const isActive = (href: string, exact?: boolean) => (exact ? pathname === href : pathname.startsWith(href))
  const badgeFor = (href: string) =>
    href === '/landlord/messages' ? unreadMessageCount : href === '/landlord/maintenance' ? maintenanceCount : 0

  return (
    <>
      {/* Desktop sidebar */}
      <aside className="glass hidden md:flex md:flex-col fixed top-5 bottom-5 left-5 w-[270px] z-40 p-4">
        <div className="flex items-center gap-3 px-2 pt-1 pb-5">
          <div className="h-11 w-11 rounded-2xl bg-[var(--ink)] text-[var(--metal)] flex items-center justify-center shadow-md">
            <Building2 className="h-5 w-5" />
          </div>
          <div className="leading-tight">
            <p className="font-semibold text-[15px] text-[var(--ink)]">Apartment Manager</p>
            <p className="text-xs text-[var(--muted)]">Landlord</p>
          </div>
        </div>

        <nav className="flex-1 overflow-y-auto space-y-5" aria-label="Main">
          {navGroups.map(group => (
            <div key={group.title}>
              <p className="px-3 mb-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--muted)]">
                {group.title}
              </p>
              <div className="space-y-1">
                {group.items.map(({ href, label, icon: Icon, exact }) => {
                  const active = isActive(href, exact)
                  const badgeCount = badgeFor(href)
                  return (
                    <Link
                      key={href}
                      href={href}
                      aria-current={active ? 'page' : undefined}
                      className={cn(
                        'flex items-center gap-3 min-h-11 px-3.5 rounded-full text-sm font-medium transition-colors',
                        active
                          ? 'bg-white/85 text-[var(--ink)] font-semibold shadow-[0_6px_16px_rgba(20,30,40,0.12)]'
                          : 'text-[var(--muted-2)] hover:bg-white/50 hover:text-[var(--ink)]'
                      )}
                    >
                      <Icon className="h-[18px] w-[18px] shrink-0" />
                      {label}
                      {badgeCount > 0 && (
                        <span className="chip chip-danger ml-auto">{badgeCount}</span>
                      )}
                    </Link>
                  )
                })}
              </div>
            </div>
          ))}
        </nav>

        <div className="glass-row flex items-center gap-3 p-2.5 mt-3">
          <div className="h-10 w-10 shrink-0 rounded-full bg-[var(--accent)] text-white font-semibold flex items-center justify-center" aria-hidden>
            {fullName?.trim()?.[0]?.toUpperCase() ?? '?'}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-[var(--ink)] truncate">{fullName}</p>
            <p className="text-xs text-[var(--muted)]">Landlord</p>
          </div>
          <form action={signOut}>
            <button
              type="submit"
              aria-label="Sign out"
              title="Sign out"
              className="h-11 w-11 rounded-full flex items-center justify-center text-[var(--muted-2)] hover:bg-white/80 hover:text-[var(--ink)] transition-colors"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </form>
        </div>
      </aside>

      {/* Mobile bottom nav */}
      <nav
        aria-label="Main"
        className="glass md:hidden fixed bottom-3.5 inset-x-3.5 z-50 rounded-[24px]! p-1.5"
      >
        <div className="flex">
          {allItems.map(({ href, label, icon: Icon, exact }) => {
            const active = isActive(href, exact)
            const badgeCount = badgeFor(href)
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex-1 min-w-0 min-h-[52px] flex flex-col items-center justify-center gap-0.5 rounded-[18px] text-[10px] font-medium relative transition-colors',
                  active ? 'bg-white/85 text-[var(--ink)] font-semibold shadow-[0_4px_12px_rgba(20,30,40,0.12)]' : 'text-[var(--muted-2)]'
                )}
              >
                <Icon className="h-5 w-5" />
                <span className="truncate max-w-full px-0.5">{label}</span>
                {badgeCount > 0 && (
                  <span className="absolute top-1 right-1.5 h-4 min-w-4 px-1 rounded-full bg-[var(--danger-text)] text-white text-[10px] font-bold flex items-center justify-center">
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
