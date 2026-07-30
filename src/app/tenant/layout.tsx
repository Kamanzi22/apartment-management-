import { redirect } from 'next/navigation'
import { createClient, getAuthedUser } from '@/lib/supabase/server'
import { NavTenant } from '@/components/nav-tenant'

export default async function TenantLayout({ children }: { children: React.ReactNode }) {
  const user = await getAuthedUser()
  if (!user) redirect('/login')

  const supabase = await createClient()

  const [{ data: profile }, { count }] = await Promise.all([
    supabase.from('profiles').select('role, full_name, unit_id, units(label)').eq('id', user.id).single(),
    supabase.from('notifications').select('*', { count: 'exact', head: true })
      .eq('user_id', user.id).is('read_at', null),
  ])

  if (profile?.role !== 'tenant') redirect('/landlord')

  const unitLabel = (profile.units as { label: string } | null)?.label ?? 'My Unit'

  return (
    <div className="min-h-screen flex">
      <NavTenant
        unreadCount={count ?? 0}
        fullName={profile.full_name}
        unitLabel={unitLabel}
      />
      <main className="flex-1 lg:ml-56 pb-20 lg:pb-0">
        <div className="max-w-3xl mx-auto px-4 py-6">
          {children}
        </div>
      </main>
    </div>
  )
}
