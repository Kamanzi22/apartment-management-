import { createServerClient } from '@supabase/ssr'
import { cookies, headers } from 'next/headers'
import { cache } from 'react'
import type { Database } from './database.types'

export async function createClient() {
  const cookieStore = await cookies()
  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          } catch {}
        },
      },
    }
  )
}

// Memoized per-request: layout + page both call this without re-hitting the
// Supabase auth server twice for the same navigation. Use this only when you
// need fields beyond the id (e.g. email) — otherwise prefer getVerifiedUserId.
export const getAuthedUser = cache(async () => {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  return user
})

// Fast path: middleware has already called auth.getUser() for this exact
// request (to decide whether to redirect) and forwards the verified id via
// a header it controls, so most Server Components can skip a second network
// round trip to Supabase's auth server. Falls back to a real check if the
// header is somehow missing.
export const getVerifiedUserId = cache(async (): Promise<string | null> => {
  const headerId = (await headers()).get('x-verified-user-id')
  if (headerId) return headerId
  const user = await getAuthedUser()
  return user?.id ?? null
})

export async function createAdminClient() {
  const cookieStore = await cookies()
  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          } catch {}
        },
      },
    }
  )
}
