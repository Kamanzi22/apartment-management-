'use client'

// Kept identical in apartment-manager and apartment-manager-tenant.
import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'

const NOT_ON = 'Google sign-in is not switched on yet'

/**
 * "Continue with Google". After Google, Supabase returns to /auth/confirm,
 * which exchanges the code and continues to `next` (the app's role check).
 */
export function GoogleButton({ next, onError }: { next: string; onError?: (message: string) => void }) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  function fail(message: string) {
    setError(message)
    onError?.(message)
    setLoading(false)
  }

  async function handleClick() {
    setLoading(true)
    setError('')
    const supabase = createClient()
    const { data, error: oauthError } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/auth/confirm?next=${encodeURIComponent(next)}`,
        queryParams: { prompt: 'select_account' },
        skipBrowserRedirect: true,
      },
    })
    if (oauthError || !data?.url) {
      fail(/provider is not enabled|unsupported provider/i.test(oauthError?.message ?? '') ? NOT_ON : 'Could not start Google sign-in. Try again.')
      return
    }
    // If Google is switched off in Supabase, the authorize URL answers with a
    // JSON error instead of a redirect; show a clear message instead of that page.
    try {
      const res = await fetch(data.url, { redirect: 'manual' })
      if (res.type !== 'opaqueredirect' && res.status >= 400) {
        const text = await res.text().catch(() => '')
        fail(/provider is not enabled|unsupported provider/i.test(text) ? NOT_ON : 'Could not start Google sign-in. Try again.')
        return
      }
    } catch {
      // Cross-origin check not possible here; just continue to Google.
    }
    window.location.assign(data.url)
  }

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={handleClick}
        disabled={loading}
        className="w-full min-h-11 rounded-full bg-white/90 border border-white text-sm font-semibold text-[var(--ink)] inline-flex items-center justify-center gap-2 hover:bg-white disabled:opacity-60 shadow-sm"
      >
        <svg aria-hidden viewBox="0 0 48 48" className="h-4 w-4">
          <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.1 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
          <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.1 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
          <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
          <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
        </svg>
        {loading ? 'Opening Google…' : 'Continue with Google'}
      </button>
      {error && !onError && <p className="text-xs text-center text-red-600">{error}</p>}
    </div>
  )
}
