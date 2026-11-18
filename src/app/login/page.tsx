'use client'

import { useEffect, useState } from 'react'
import { signInWithIdentifier, sendPasswordResetEmail } from '@/app/actions/auth'
import { GoogleButton } from '@/components/google-button'
import { ArrowLeft, Building2, Mail } from 'lucide-react'

const LINK_ERRORS: Record<string, string> = {
  not_landlord: 'That Google account is not a landlord account. Sign in with your landlord email instead.',
  google_failed: 'Google sign-in did not finish. Please try again.',
  invalid_link: 'This reset link is invalid or has expired. Please request a new one.',
}

export default function LoginPage() {
  const [mode, setMode] = useState<'signin' | 'forgot'>('signin')
  const [identifier, setIdentifier] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [forgotEmail, setForgotEmail] = useState('')
  const [resetSent, setResetSent] = useState(false)

  useEffect(() => {
    const code = new URLSearchParams(window.location.search).get('error')
    // Read once from the URL after mount (the page is prerendered, so not during render).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (code) setError(LINK_ERRORS[code] ?? 'Something went wrong. Please try again.')
  }, [])

  async function handleSignIn(e: React.SyntheticEvent<HTMLFormElement>) {
    e.preventDefault()
    setLoading(true)
    setError('')
    const result = await signInWithIdentifier(identifier, password).catch(() => ({
      error: 'Could not reach the server. Check your connection and try again.', redirectTo: undefined,
    }))
    if (result.error || !result.redirectTo) {
      setError(result.error ?? 'Invalid name, email or password.')
      setLoading(false)
      return
    }
    window.location.replace(result.redirectTo)
  }

  async function handleSendReset(e: React.SyntheticEvent<HTMLFormElement>) {
    e.preventDefault()
    setLoading(true)
    setError('')
    try {
      const result = await sendPasswordResetEmail(forgotEmail)
      if (result.error) setError(result.error)
      else setResetSent(true)
    } catch {
      setError('Could not reach the server. Check your connection and try again.')
    }
    setLoading(false)
  }

  const inputCls = 'glass-input text-sm'
  const labelCls = 'block text-sm font-medium text-slate-700'

  return (
    <div className="min-h-dvh flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center mb-8">
          <div className="bg-[var(--ink)] rounded-2xl p-3 mb-3 shadow-lg">
            <Building2 className="h-7 w-7 text-[var(--metal)]" />
          </div>
          <h1 className="on-photo text-3xl font-semibold tracking-tight">Apartment Manager</h1>
          <p className="on-photo text-sm mt-1 opacity-95">
            {mode === 'signin' ? 'Sign in to your account' : 'Reset your password'}
          </p>
        </div>

        <div className="glass p-6 space-y-4">
          {error && (
            <div role="alert" className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              {error}
            </div>
          )}

          {mode === 'signin' ? (
            <>
              <form onSubmit={handleSignIn} className="space-y-4">
                <div className="space-y-1.5">
                  <label htmlFor="identifier" className={labelCls}>Name or Email</label>
                  <input
                    id="identifier"
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
                  <label htmlFor="password" className={labelCls}>Password</label>
                  <input
                    id="password"
                    type="password"
                    required
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    className={inputCls}
                    autoComplete="current-password"
                  />
                </div>
                <button type="submit" disabled={loading} className="btn-primary w-full disabled:opacity-60">
                  {loading ? 'Signing in…' : 'Sign In'}
                </button>
                <button
                  type="button"
                  onClick={() => { setMode('forgot'); setError(''); setResetSent(false) }}
                  className="w-full min-h-11 text-sm font-medium text-slate-600 hover:text-slate-900"
                >
                  Forgot your password?
                </button>
              </form>
              <div className="flex items-center gap-3 text-xs text-slate-400">
                <span className="h-px flex-1 bg-white/80" />or<span className="h-px flex-1 bg-white/80" />
              </div>
              <GoogleButton next="/auth/landlord" onError={setError} />
            </>
          ) : (
            <div className="space-y-4">
              <button
                type="button"
                onClick={() => { setMode('signin'); setError('') }}
                className="flex items-center gap-1 min-h-11 text-sm font-medium text-slate-600 hover:text-slate-900 -mt-1"
              >
                <ArrowLeft className="h-3.5 w-3.5" /> Back to sign in
              </button>
              {!resetSent ? (
                <form onSubmit={handleSendReset} className="space-y-4">
                  <div className="space-y-1.5">
                    <label htmlFor="forgot-email" className={labelCls}>Your email address</label>
                    <input
                      id="forgot-email"
                      type="email"
                      required
                      value={forgotEmail}
                      onChange={e => setForgotEmail(e.target.value)}
                      className={inputCls}
                      placeholder="you@example.com"
                      autoComplete="email"
                    />
                    <p className="text-xs text-slate-400">We&apos;ll email you a link to set a new password.</p>
                  </div>
                  <button type="submit" disabled={loading} className="btn-primary w-full disabled:opacity-60">
                    {loading ? 'Sending…' : 'Send Reset Link'}
                  </button>
                </form>
              ) : (
                <div className="flex flex-col items-center gap-3 py-4 text-center">
                  <div className="bg-slate-100 rounded-full p-3"><Mail className="h-6 w-6 text-slate-600" /></div>
                  <p className="text-sm font-medium text-slate-900">Check your email</p>
                  <p className="text-sm text-slate-500">
                    If a landlord account exists for <strong>{forgotEmail}</strong>, a reset link has been sent.
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
