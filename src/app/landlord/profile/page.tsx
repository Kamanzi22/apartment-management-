import { redirect } from 'next/navigation'
import { createClient, getAuthedUser } from '@/lib/supabase/server'
import { ProfileForm } from './profile-form'

export default async function ProfilePage() {
  if (process.env.NEXT_PUBLIC_DEMO_MODE === 'true') {
    return (
      <div className="space-y-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Profile</h1>
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
        <h1 className="text-2xl font-bold text-slate-900">Profile</h1>
        <p className="text-sm text-slate-500 mt-0.5">Manage your login credentials</p>
      </div>
      <ProfileForm currentEmail={user.email ?? ''} />
    </div>
  )
}
