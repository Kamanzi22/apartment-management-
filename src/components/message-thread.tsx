'use client'

import { useState, useRef, useEffect } from 'react'
import { sendMessage } from '@/app/actions/messages'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Send, Megaphone } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

interface Message {
  id: string
  sender_id: string
  recipient_id: string | null
  body: string
  created_at: string
  read_at: string | null
}

interface Props {
  messages: Message[]
  currentUserId: string
  recipientId: string | null
  recipientName: string
  currentUserName: string
  isBroadcastThread: boolean
}

export function MessageThread({
  messages,
  currentUserId,
  recipientId,
  recipientName,
  currentUserName,
  isBroadcastThread,
}: Props) {
  const [body, setBody] = useState('')
  const [sending, setSending] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages.length])

  async function handleSend(e: React.FormEvent) {
    e.preventDefault()
    if (!body.trim()) return
    setSending(true)
    const result = await sendMessage(recipientId, body)
    setSending(false)
    if (result?.error) {
      toast.error(result.error)
    } else {
      setBody('')
    }
  }

  return (
    <div className="flex flex-col glass overflow-hidden" style={{ height: 'calc(100vh - 220px)', minHeight: 400 }}>
      {/* Header */}
      <div className="border-b border-white/70 px-4 py-3 flex items-center gap-2 bg-white/40">
        {isBroadcastThread
          ? <><Megaphone className="h-4 w-4 text-slate-500" /><span className="font-medium text-sm text-slate-800">Broadcast to all tenants</span></>
          : <span className="font-medium text-sm text-slate-800">{recipientName}</span>
        }
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        {messages.length === 0 && (
          <div className="empty-state mt-6"><Megaphone className="h-5 w-5" /><p>No messages yet. Say hello!</p></div>
        )}
        {messages.map(m => {
          const isMine = m.sender_id === currentUserId
          const isBroadcast = m.recipient_id === null

          return (
            <div key={m.id} className={cn('flex', isMine ? 'justify-end' : 'justify-start')}>
              <div className={cn(
                'max-w-[75%] rounded-2xl px-3.5 py-2.5 text-sm',
                isBroadcast
                  ? 'bg-white/80 text-[var(--ink)] border border-white/85 rounded-2xl w-full max-w-full'
                  : isMine
                    ? 'bg-[var(--ink)] text-[var(--on-dark)] rounded-br-md'
                    : 'bg-white/80 text-[var(--ink)] border border-white/85 rounded-bl-md'
              )}>
                {isBroadcast && (
                  <div className="flex items-center gap-1.5 mb-1 text-[var(--accent-2)] text-xs font-bold">
                    <Megaphone className="h-3 w-3" />
                    Announcement
                  </div>
                )}
                <p className="whitespace-pre-wrap">{m.body}</p>
                <p className={cn(
                  'text-[11px] mt-1',
                  isMine ? 'text-[var(--metal)]' : 'text-[var(--muted)]'
                )}>
                  {new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  {' · '}
                  {new Date(m.created_at).toLocaleDateString([], { month: 'short', day: 'numeric' })}
                </p>
              </div>
            </div>
          )
        })}
        <div ref={bottomRef} />
      </div>

      {/* Composer */}
      {!isBroadcastThread || recipientId === null ? (
        <form onSubmit={handleSend} className="border-t border-white/70 p-3 flex gap-2 items-end bg-white/40">
          <Textarea
            value={body}
            onChange={e => setBody(e.target.value)}
            placeholder={isBroadcastThread ? 'Write an announcement to all tenants…' : 'Type a message…'}
            className="resize-none min-h-[44px] max-h-32"
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                handleSend(e as unknown as React.FormEvent)
              }
            }}
          />
          <Button type="submit" size="icon" aria-label="Send message" disabled={sending || !body.trim()} className="shrink-0">
            <Send className="h-4 w-4" />
          </Button>
        </form>
      ) : null}
    </div>
  )
}
