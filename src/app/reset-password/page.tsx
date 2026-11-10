'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Building2, Eye, EyeOff } from 'lucide-react'

export default function ResetPasswordPage() {
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(e: React.SyntheticEvent<HTMLFormElement>) {
    e.preventDefault()
    setError('')

    if (newPassword.length < 8) {
      setError('Password must be at least 8 characters.')
      return
    }
    if (newPassword !== confirmPassword) {
      setError('Passwords do not match.')
      return
    }

    setLoading(true)
    const supabase = createClient()
    const { error } = await supabase.auth.updateUser({ password: newPassword })

    if (error) {
      setError(error.name === 'AuthSessionMissingError'
        ? 'Your reset link has expired. Go back to sign in and request a new one.'
        : error.message)
      setLoading(false)
    } else {
      window.location.replace('/landlord')
    }
  }

  const inputCls = 'glass-input text-sm'
  const labelCls = 'block text-sm font-semibold text-[var(--ink)]'

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center mb-8">
          <div className="bg-[var(--ink)] rounded-2xl p-3 mb-3 shadow-lg">
            <Building2 className="h-7 w-7 text-[var(--metal)]" />
          </div>
          <h1 className="on-photo text-3xl font-semibold tracking-tight">Set New Password</h1>
          <p className="on-photo text-sm mt-1 opacity-95">Choose a new password for your account</p>
        </div>

        <div className="glass p-6 space-y-4">
          {error && (
            <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <label className={labelCls}>New password <span className="text-slate-400 font-normal">(min 8 chars)</span></label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  required
                  minLength={8}
                  value={newPassword}
                  onChange={e => setNewPassword(e.target.value)}
                  className={inputCls + ' pr-10'}
                  autoComplete="new-password"
                  autoFocus
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(v => !v)}
                  aria-label={showPassword ? "Hide password" : "Show password"} className="absolute right-0.5 top-1/2 -translate-y-1/2 h-11 w-11 inline-flex items-center justify-center rounded-full text-slate-500 hover:text-slate-700"
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>
            <div className="space-y-1.5">
              <label className={labelCls}>Confirm new password</label>
              <input
                type={showPassword ? 'text' : 'password'}
                required
                value={confirmPassword}
                onChange={e => setConfirmPassword(e.target.value)}
                className={inputCls}
                autoComplete="new-password"
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="btn-primary w-full"
            >
              {loading ? 'Saving…' : 'Set New Password'}
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}
