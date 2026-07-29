'use client'

import { useState } from 'react'
import { resetTenantPassword } from '@/app/actions/admin'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { KeyRound, Eye, EyeOff, Copy, Check, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'

interface Props {
  tenantId: string
  tenantName: string
}

function generatePassword() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789'
  return Array.from({ length: 10 }, () => chars[Math.floor(Math.random() * chars.length)]).join('')
}

export function ResetTenantPasswordDialog({ tenantId, tenantName }: Props) {
  const [open, setOpen] = useState(false)
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [copied, setCopied] = useState(false)

  function handleOpen() {
    setPassword(generatePassword())
    setShowPassword(true)
    setCopied(false)
    setOpen(true)
  }

  async function handleSubmit(e: React.SyntheticEvent<HTMLFormElement>) {
    e.preventDefault()
    if (password.length < 8) {
      toast.error('Password must be at least 8 characters.')
      return
    }
    setLoading(true)
    const result = await resetTenantPassword(tenantId, password)
    setLoading(false)
    if (result?.error) {
      toast.error(result.error)
    } else {
      toast.success(`Password updated for ${tenantName}`)
      setOpen(false)
    }
  }

  function copyPassword() {
    navigator.clipboard.writeText(password)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <>
      <button
        onClick={handleOpen}
        className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-800 transition-colors border border-slate-200 rounded-md px-2 py-1 hover:border-slate-400"
        title="Reset tenant password"
      >
        <KeyRound className="h-3 w-3" />
        Reset Password
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Reset Password — {tenantName}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4 pt-1">
            <p className="text-sm text-slate-500">
              Set a new password for this tenant. Share it with them directly.
            </p>
            <div className="space-y-1.5">
              <Label>New password</Label>
              <div className="relative flex items-center gap-2">
                <div className="relative flex-1">
                  <Input
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    required
                    minLength={8}
                    className="pr-8 font-mono"
                    autoComplete="new-password"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(v => !v)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                  >
                    {showPassword ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => setPassword(generatePassword())}
                  className="shrink-0 p-2 text-slate-400 hover:text-slate-700 transition-colors"
                  title="Generate new password"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={copyPassword}
                  className="shrink-0 p-2 text-slate-400 hover:text-slate-700 transition-colors"
                  title="Copy password"
                >
                  {copied ? <Check className="h-3.5 w-3.5 text-green-600" /> : <Copy className="h-3.5 w-3.5" />}
                </button>
              </div>
              <p className="text-xs text-slate-400">Click copy to share with the tenant.</p>
            </div>
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? 'Updating…' : 'Set New Password'}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}
