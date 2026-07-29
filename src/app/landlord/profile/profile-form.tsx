'use client'

import { useState, useRef } from 'react'
import { updateLandlordEmail, updateLandlordPassword } from '@/app/actions/profile'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Mail, Lock, CheckCircle2, AlertCircle, Eye, EyeOff } from 'lucide-react'

function StatusBanner({ ok, msg }: { ok: boolean; msg: string }) {
  return (
    <div className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm ${ok ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-600'}`}>
      {ok ? <CheckCircle2 className="h-4 w-4 shrink-0" /> : <AlertCircle className="h-4 w-4 shrink-0" />}
      {msg}
    </div>
  )
}

function PasswordInput({ name, placeholder, label }: { name: string; placeholder?: string; label: string }) {
  const [show, setShow] = useState(false)
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <div className="relative">
        <Input name={name} type={show ? 'text' : 'password'} placeholder={placeholder} required className="pr-9" />
        <button type="button" tabIndex={-1} onClick={() => setShow(v => !v)}
          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
          {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      </div>
    </div>
  )
}

export function ProfileForm({ currentEmail }: { currentEmail: string }) {
  const [emailStatus, setEmailStatus] = useState<{ ok: boolean; msg: string } | null>(null)
  const [emailLoading, setEmailLoading] = useState(false)
  const [displayEmail, setDisplayEmail] = useState(currentEmail)
  const emailFormRef = useRef<HTMLFormElement>(null)

  const [pwStatus, setPwStatus] = useState<{ ok: boolean; msg: string } | null>(null)
  const [pwLoading, setPwLoading] = useState(false)
  const pwFormRef = useRef<HTMLFormElement>(null)

  async function handleEmailSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setEmailLoading(true)
    setEmailStatus(null)
    const fd = new FormData(e.currentTarget)
    const result = await updateLandlordEmail(fd)
    setEmailLoading(false)
    if (result.error) {
      setEmailStatus({ ok: false, msg: result.error })
    } else {
      const newEmail = (fd.get('new_email') as string).trim().toLowerCase()
      setDisplayEmail(newEmail)
      setEmailStatus({ ok: true, msg: 'Email updated successfully.' })
      emailFormRef.current?.reset()
    }
  }

  async function handlePwSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setPwLoading(true)
    setPwStatus(null)
    const fd = new FormData(e.currentTarget)
    const result = await updateLandlordPassword(fd)
    setPwLoading(false)
    if (result.error) {
      setPwStatus({ ok: false, msg: result.error })
    } else {
      setPwStatus({ ok: true, msg: 'Password updated successfully.' })
      pwFormRef.current?.reset()
    }
  }

  return (
    <div className="space-y-6 max-w-md">

      {/* Email section */}
      <div className="bg-white rounded-xl border shadow-sm p-5 space-y-4">
        <div className="flex items-center gap-2">
          <Mail className="h-4 w-4 text-slate-400" />
          <h2 className="font-semibold text-slate-800">Email Address</h2>
        </div>
        <div className="space-y-1">
          <p className="text-xs text-slate-400 uppercase tracking-wide font-semibold">Current email</p>
          <p className="text-sm font-medium text-slate-700 break-all">{displayEmail}</p>
        </div>
        <form ref={emailFormRef} onSubmit={handleEmailSubmit} className="space-y-3 border-t pt-4">
          <p className="text-sm font-semibold text-slate-600">Change email</p>
          <div className="space-y-1.5">
            <Label>New email address</Label>
            <Input name="new_email" type="email" placeholder="new@example.com" required />
          </div>
          <PasswordInput name="current_password" label="Current password" placeholder="Required to confirm" />
          {emailStatus && <StatusBanner ok={emailStatus.ok} msg={emailStatus.msg} />}
          <Button type="submit" className="w-full" disabled={emailLoading}>
            {emailLoading ? 'Updating…' : 'Update Email'}
          </Button>
        </form>
      </div>

      {/* Password section */}
      <div className="bg-white rounded-xl border shadow-sm p-5 space-y-4">
        <div className="flex items-center gap-2">
          <Lock className="h-4 w-4 text-slate-400" />
          <h2 className="font-semibold text-slate-800">Password</h2>
        </div>
        <form ref={pwFormRef} onSubmit={handlePwSubmit} className="space-y-3">
          <PasswordInput name="current_password" label="Current password" />
          <PasswordInput name="new_password" label="New password" placeholder="Min 8 characters" />
          <PasswordInput name="confirm_password" label="Confirm new password" />
          {pwStatus && <StatusBanner ok={pwStatus.ok} msg={pwStatus.msg} />}
          <Button type="submit" className="w-full" disabled={pwLoading}>
            {pwLoading ? 'Updating…' : 'Update Password'}
          </Button>
        </form>
      </div>

    </div>
  )
}
