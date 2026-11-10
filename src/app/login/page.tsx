'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { lookupEmailByName } from '@/app/actions/auth'
import { Building2 } from 'lucide-react'

export default function LoginPage() {
  const [identifier, setIdentifier] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const router = useRouter()

  async function handleSignIn(e: React.SyntheticEvent<HTMLFormElement>) {
    e.preventDefault()
    setLoading(true)
    setError('')

    const supabase = createClient()

    let email = identifier
    if (!identifier.includes('@')) {
      const resolved = await lookupEmailByName(identifier)
      if (!resolved) {
        setError('No account found with that name.')
        setLoading(false)
        return
      }
      email = resolved
    }

    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password })
    if (signInError) {
      setError('Invalid name or password.')
      setLoading(false)
      return
    }

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { setLoading(false); return }

    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single()

    if (profile?.role === 'landlord') router.push('/landlord')
    else if (profile?.role === 'tenant') router.push('/tenant')
    else {
      setError('Account not configured. Contact your landlord.')
      setLoading(false)
    }
  }

  const inputCls = 'glass-input text-sm'
  const labelCls = 'block text-sm font-medium text-slate-700'

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center mb-8">
          <div className="bg-[var(--ink)] rounded-2xl p-3 mb-3 shadow-lg">
            <Building2 className="h-7 w-7 text-[var(--metal)]" />
          </div>
          <h1 className="on-photo text-3xl font-semibold tracking-tight">Apartment Manager</h1>
          <p className="on-photo text-sm mt-1 opacity-95">Sign in to your account</p>
        </div>

        <div className="glass p-6 space-y-4">
          {error && (
            <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              {error}
            </div>
          )}
          <form onSubmit={handleSignIn} className="space-y-4">
            <div className="space-y-1.5">
              <label className={labelCls}>Name or Email</label>
              <input
                type="text"
                required
                value={identifier}
                onChange={e => setIdentifier(e.target.value)}
                className={inputCls}
                placeholder="Enter your name or email"
                autoComplete="username"
              />
            </div>
            <div className="space-y-1.5">
              <label className={labelCls}>Password</label>
              <input
                type="password"
                required
                value={password}
                onChange={e => setPassword(e.target.value)}
                className={inputCls}
                autoComplete="current-password"
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="btn-primary w-full disabled:opacity-60"
            >
              {loading ? 'Signing in…' : 'Sign In'}
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}
