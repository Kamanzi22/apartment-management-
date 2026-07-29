import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { NavLandlord } from '@/components/nav-landlord'

export default async function LandlordLayout({ children }: { children: React.ReactNode }) {
  if (process.env.NEXT_PUBLIC_DEMO_MODE === 'true') {
    return (
      <div className="min-h-screen flex">
        <NavLandlord unreadCount={2} fullName="Alex (Demo)" />
        <main className="flex-1 lg:ml-56 pb-20 lg:pb-0">
          <div className="max-w-5xl mx-auto px-4 py-6">{children}</div>
        </main>
      </div>
    )
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, full_name')
    .eq('id', user.id)
    .single()

  if (profile?.role !== 'landlord') redirect('/tenant')

  const { count } = await supabase
    .from('notifications')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', user.id)
    .is('read_at', null)

  const { count: unreadMessages } = await supabase
    .from('messages')
    .select('*', { count: 'exact', head: true })
    .eq('recipient_id', user.id)
    .is('read_at', null)

  const { count: openMaintenance } = await supabase
    .from('maintenance_requests')
    .select('*', { count: 'exact', head: true })
    .neq('status', 'resolved')

  return (
    <div className="min-h-screen flex">
      <NavLandlord unreadCount={count ?? 0} unreadMessageCount={unreadMessages ?? 0} maintenanceCount={openMaintenance ?? 0} fullName={profile.full_name} />
      <main className="flex-1 lg:ml-56 pb-20 lg:pb-0">
        <div className="max-w-5xl mx-auto px-4 py-6">
          {children}
        </div>
      </main>
    </div>
  )
}
