'use client'

// Kept identical in apartment-manager and apartment-manager-tenant.
import { useEffect, useState } from 'react'
import { BellRing, BellOff } from 'lucide-react'
import { toast } from 'sonner'
import { savePushSubscription, deletePushSubscription } from '@/app/actions/push'

const VAPID_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY

function keyToBytes(base64: string): Uint8Array<ArrayBuffer> {
  const padded = (base64 + '='.repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(padded)
  const out = new Uint8Array(new ArrayBuffer(raw.length))
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}

/** Opt-in switch for phone / desktop alerts on this browser. */
export function PushToggle({ className = '' }: { className?: string }) {
  const [supported, setSupported] = useState(false)
  const [enabled, setEnabled] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!VAPID_KEY || !('serviceWorker' in navigator) || !('PushManager' in window)) return
    // Feature detection only works in the browser, after mount.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSupported(true)
    navigator.serviceWorker.ready
      .then(reg => reg.pushManager.getSubscription())
      .then(sub => setEnabled(!!sub))
      .catch(() => {})
  }, [])

  if (!supported) return null

  async function toggle() {
    setBusy(true)
    try {
      const reg = await navigator.serviceWorker.ready
      const existing = await reg.pushManager.getSubscription()
      if (enabled && existing) {
        await deletePushSubscription(existing.endpoint)
        await existing.unsubscribe()
        setEnabled(false)
        toast.success('Phone alerts turned off on this device')
        return
      }
      const permission = await Notification.requestPermission()
      if (permission !== 'granted') {
        toast.error('Alerts are blocked. Allow notifications for this site in your browser settings.')
        return
      }
      const sub = existing ?? await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyToBytes(VAPID_KEY!) })
      const result = await savePushSubscription(sub.toJSON())
      if (result.error) {
        toast.error(result.error)
        return
      }
      setEnabled(true)
      toast.success('Phone alerts turned on for this device')
    } catch {
      toast.error('Could not change alerts on this device')
    } finally {
      setBusy(false)
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={busy}
      aria-pressed={enabled}
      className={`inline-flex items-center gap-2 min-h-11 px-4 rounded-full text-sm font-semibold glass-row hover:bg-white/80 disabled:opacity-60 ${className}`}
    >
      {enabled ? <BellRing className="h-4 w-4" /> : <BellOff className="h-4 w-4" />}
      {busy ? 'Working…' : enabled ? 'Phone alerts on' : 'Turn on phone alerts'}
    </button>
  )
}
