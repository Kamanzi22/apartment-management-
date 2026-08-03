import { redirect } from 'next/navigation'
import { createClient, getVerifiedUserId } from '@/lib/supabase/server'

export default async function RootPage() {
  if (process.env.NEXT_PUBLIC_DEMO_MODE === 'true') redirect('/landlord')

  const userId = await getVerifiedUserId()
  if (!userId) redirect('/login')

  const supabase = await createClient()

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', userId)
    .single()

  if (profile?.role === 'landlord') redirect('/landlord')
  if (profile?.role === 'tenant') redirect('/tenant')

  redirect('/login')
}
