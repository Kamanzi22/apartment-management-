'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { MessageThread } from '@/components/message-thread'
import { loadThreadMessages, markMessagesRead } from '@/app/actions/messages'
import { Megaphone, Building2, User } from 'lucide-react'
import { cn } from '@/lib/utils'

interface Tenant {
  id: string
  full_name: string
  unit_id: string | null
  units: { label: string } | null
}

interface Unit {
  id: string
  label: string
}

export interface Message {
  id: string
  sender_id: string
  recipient_id: string | null
  body: string
  created_at: string
  read_at: string | null
}

interface Props {
  tenants: Tenant[]
  units: Unit[]
  /** Newest messages of each thread (oldest first), keyed by tenant id or 'broadcast'. */
  threads: Record<string, Message[]>
  hasMore: Record<string, boolean>
  /** Unread direct messages per tenant. */
  unread: Record<string, number>
  landlordId: string
}

export function LandlordMessaging({ tenants, units, threads, hasMore, unread, landlordId }: Props) {
  const [selectedId, setSelectedId] = useState<string>('broadcast')
  // Phones show one pane at a time: the conversation list, then the open thread. Desktop shows both.
  const [mobilePane, setMobilePane] = useState<'list' | 'thread'>('list')
  const [older, setOlder] = useState<Record<string, Message[]>>({})
  const [more, setMore] = useState<Record<string, boolean>>(hasMore)
  const [cleared, setCleared] = useState<Record<string, boolean>>({})
  const [loadingOlder, startLoading] = useTransition()
  const router = useRouter()

  // Opening a tenant's thread marks their messages read (clears the badges).
  function openThread(id: string) {
    setSelectedId(id)
    setMobilePane('thread')
    if (id === 'broadcast' || !unread[id] || cleared[id]) return
    setCleared(c => ({ ...c, [id]: true }))
    // Refresh so the nav badge and the Overview counts update too.
    void markMessagesRead(id).then(() => router.refresh())
  }

  const latest = threads[selectedId] ?? []
  const seen = new Set(latest.map(m => m.id))
  const threadMessages = [...(older[selectedId] ?? []).filter(m => !seen.has(m.id)), ...latest]

  function loadOlder() {
    const threadId = selectedId
    const oldest = threadMessages[0]
    if (!oldest) return
    startLoading(async () => {
      const page = await loadThreadMessages(threadId, oldest.created_at)
      setOlder(o => ({ ...o, [threadId]: [...[...page].reverse(), ...(o[threadId] ?? [])] }))
      setMore(m => ({ ...m, [threadId]: page.length === 200 }))
    })
  }

  const badge = (id: string) => (cleared[id] ? 0 : unread[id] ?? 0)
  const selectedTenant = tenants.find(t => t.id === selectedId)
  const tenantByUnitId = new Map(tenants.filter(t => t.unit_id).map(t => [t.unit_id!, t]))

  return (
    <div className="flex flex-col md:flex-row gap-4 md:h-[calc(100dvh-200px)] md:min-h-[500px]">
      {/* Sidebar */}
      <div className={cn('md:w-56 shrink-0 glass overflow-auto', mobilePane === 'thread' && 'hidden md:block')}>

        <button
          onClick={() => openThread('broadcast')}
          className={cn(
            'w-full text-left px-3 py-2.5 flex items-center gap-2.5 border-b border-white/60 transition-colors',
            selectedId === 'broadcast' ? 'bg-white/85 shadow-[0_4px_12px_rgba(20,30,40,0.1)]' : 'hover:bg-white/50'
          )}
        >
          <Megaphone className="h-4 w-4 text-slate-500 shrink-0" />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-slate-800">Broadcast All</p>
            <p className="text-xs text-slate-400">Message all units</p>
          </div>
        </button>

        <div className="px-3 pt-3 pb-1">
          <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-[0.08em]">Units</p>
        </div>

        {units.map(unit => {
          const tenant = tenantByUnitId.get(unit.id)
          const isVacant = !tenant
          const isSelected = tenant && selectedId === tenant.id
          const count = tenant ? badge(tenant.id) : 0

          return (
            <button
              key={unit.id}
              onClick={() => !isVacant && openThread(tenant!.id)}
              disabled={isVacant}
              className={cn(
                'w-full text-left px-3 py-2.5 flex items-center gap-2.5 border-b border-white/60 last:border-b-0 transition-colors',
                isSelected
                  ? 'bg-white/85 shadow-[0_4px_12px_rgba(20,30,40,0.1)]'
                  : isVacant
                    ? 'opacity-40 cursor-not-allowed'
                    : 'hover:bg-white/50'
              )}
            >
              <Building2 className="h-4 w-4 text-slate-400 shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-slate-800">{unit.label}</p>
                <p className="text-xs text-slate-400 truncate">
                  {isVacant ? 'Vacant' : tenant!.full_name}
                </p>
              </div>
              {count > 0 && <span className="chip chip-danger" aria-label={`${count} unread`}>{count}</span>}
            </button>
          )
        })}

        {tenants.length > 0 && (
          <>
            <div className="px-3 pt-3 pb-1">
              <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-[0.08em]">By Tenant</p>
            </div>
            {tenants.map(t => {
              const count = badge(t.id)
              return (
                <button
                  key={t.id}
                  onClick={() => openThread(t.id)}
                  className={cn(
                    'w-full text-left px-3 py-2.5 flex items-center gap-2.5 border-b border-white/60 last:border-b-0 transition-colors',
                    selectedId === t.id ? 'bg-white/85 shadow-[0_4px_12px_rgba(20,30,40,0.1)]' : 'hover:bg-white/50'
                  )}
                >
                  <User className="h-4 w-4 text-slate-400 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-slate-800 truncate">{t.full_name}</p>
                    <p className="text-xs text-slate-400">{t.units?.label ?? 'Former tenant'}</p>
                  </div>
                  {count > 0 && <span className="chip chip-danger" aria-label={`${count} unread`}>{count}</span>}
                </button>
              )
            })}
          </>
        )}
      </div>

      {/* Phone: fill the space between the page title and the bottom tab bar, so the composer stays visible */}
      <div className={cn(
        'flex-none md:flex-1 min-w-0 min-h-[320px] h-[calc(100dvh_-_12.5rem_-_env(safe-area-inset-top)_-_env(safe-area-inset-bottom))] md:h-auto md:min-h-0',
        mobilePane === 'list' && 'hidden md:block',
      )}>
        <MessageThread
          onBack={() => setMobilePane('list')}
          messages={threadMessages}
          currentUserId={landlordId}
          recipientId={selectedId === 'broadcast' ? null : selectedId}
          recipientName={selectedId === 'broadcast' ? 'All Tenants' : selectedTenant?.full_name ?? ''}
          currentUserName="Landlord"
          isBroadcastThread={selectedId === 'broadcast'}
          hasOlder={!!more[selectedId]}
          loadingOlder={loadingOlder}
          onLoadOlder={loadOlder}
        />
      </div>
    </div>
  )
}
