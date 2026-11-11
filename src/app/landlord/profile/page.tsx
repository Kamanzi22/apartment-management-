import { redirect } from 'next/navigation'
import { createClient, getAuthedUser } from '@/lib/supabase/server'
import Link from 'next/link'
import { ChevronRight } from 'lucide-react'
import { ProfileForm } from './profile-form'

export default async function ProfilePage() {
  if (process.env.NEXT_PUBLIC_DEMO_MODE === 'true') {
    return (
      <div className="space-y-4">
        <div>
          <h1 className="on-photo text-3xl font-semibold tracking-tight">Profile</h1>
          <p className="text-sm text-slate-500 mt-0.5">Manage your login credentials</p>
        </div>
        <ProfileForm currentEmail="demo@example.com" />
      </div>
    )
  }

  const user = await getAuthedUser()
  if (!user) redirect('/login')

  const supabase = await createClient()

  return (
    <div className="space-y-4">
      <div>
        <h1 className="on-photo text-3xl font-semibold tracking-tight">Profile</h1>
        <p className="text-sm text-slate-500 mt-0.5">Manage your login credentials</p>
      </div>
      <ProfileForm currentEmail={user.email ?? ''} />
      <Link href="/landlord/settings/alerts" className="glass lift flex items-center justify-between gap-3 p-4">
        <span>
          <span className="block text-sm font-semibold">Rent alerts</span>
          <span className="block text-xs text-[var(--muted)]">Reminders, warnings, the unpaid rent limit and the send log</span>
        </span>
        <ChevronRight className="h-4 w-4 text-[var(--muted)]" />
      </Link>
    </div>
  )
}
