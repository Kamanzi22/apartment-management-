'use client'

import { useState } from 'react'
import { MessageThread } from '@/components/message-thread'
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

interface Message {
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
  messages: Message[]
  landlordId: string
}

export function LandlordMessaging({ tenants, units, messages, landlordId }: Props) {
  const [selectedId, setSelectedId] = useState<string | 'broadcast'>('broadcast')

  const threadMessages = selectedId === 'broadcast'
    ? messages.filter(m => m.recipient_id === null)
    : messages.filter(m =>
        (m.sender_id === landlordId && m.recipient_id === selectedId) ||
        (m.sender_id === selectedId && m.recipient_id === landlordId)
      )

  const selectedTenant = tenants.find(t => t.id === selectedId)

  // Map unit id → tenant (the current occupant)
  const tenantByUnitId = new Map(tenants.filter(t => t.unit_id).map(t => [t.unit_id!, t]))

  return (
    <div className="flex gap-4 h-[calc(100vh-200px)] min-h-[500px]">
      {/* Sidebar */}
      <div className="w-56 shrink-0 rounded-xl border bg-white shadow-sm overflow-auto">

        {/* Broadcast all */}
        <button
          onClick={() => setSelectedId('broadcast')}
          className={cn(
            'w-full text-left px-3 py-2.5 flex items-center gap-2.5 border-b transition-colors',
            selectedId === 'broadcast' ? 'bg-slate-100' : 'hover:bg-slate-50'
          )}
        >
          <Megaphone className="h-4 w-4 text-slate-500 shrink-0" />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-slate-800">Broadcast All</p>
            <p className="text-xs text-slate-400">Message all units</p>
          </div>
        </button>

        {/* Divider label */}
        <div className="px-3 pt-3 pb-1">
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Units</p>
        </div>

        {/* One row per unit */}
        {units.map(unit => {
          const tenant = tenantByUnitId.get(unit.id)
          const isVacant = !tenant
          const isSelected = tenant && selectedId === tenant.id

          return (
            <button
              key={unit.id}
              onClick={() => !isVacant && setSelectedId(tenant!.id)}
              disabled={isVacant}
              className={cn(
                'w-full text-left px-3 py-2.5 flex items-center gap-2.5 border-b last:border-b-0 transition-colors',
                isSelected
                  ? 'bg-slate-100'
                  : isVacant
                    ? 'opacity-40 cursor-not-allowed'
                    : 'hover:bg-slate-50'
              )}
            >
              <Building2 className="h-4 w-4 text-slate-400 shrink-0" />
              <div className="min-w-0">
                <p className="text-sm font-medium text-slate-800">{unit.label}</p>
                <p className="text-xs text-slate-400 truncate">
                  {isVacant ? 'Vacant' : tenant!.full_name}
                </p>
              </div>
            </button>
          )
        })}

        {/* Individual tenants (by name) — kept as secondary reference */}
        {tenants.length > 0 && (
          <>
            <div className="px-3 pt-3 pb-1">
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">By Tenant</p>
            </div>
            {tenants.map(t => (
              <button
                key={t.id}
                onClick={() => setSelectedId(t.id)}
                className={cn(
                  'w-full text-left px-3 py-2.5 flex items-center gap-2.5 border-b last:border-b-0 transition-colors',
                  selectedId === t.id ? 'bg-slate-100' : 'hover:bg-slate-50'
                )}
              >
                <User className="h-4 w-4 text-slate-400 shrink-0" />
                <div className="min-w-0">
                  <p className="text-sm font-medium text-slate-800 truncate">{t.full_name}</p>
                  <p className="text-xs text-slate-400">{t.units?.label ?? 'No unit'}</p>
                </div>
              </button>
            ))}
          </>
        )}
      </div>

      {/* Active thread */}
      <div className="flex-1 min-w-0">
        <MessageThread
          messages={threadMessages}
          currentUserId={landlordId}
          recipientId={selectedId === 'broadcast' ? null : selectedId}
          recipientName={
            selectedId === 'broadcast'
              ? 'All Tenants'
              : selectedTenant?.full_name ?? ''
          }
          currentUserName="Landlord"
          isBroadcastThread={selectedId === 'broadcast'}
        />
      </div>
    </div>
  )
}
