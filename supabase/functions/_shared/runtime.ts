// Deno entry glue: builds the per-request Ctx from the real environment and
// clients, then runs a handler inside withHttp(). Deno-only (uses Deno.env
// and npm: imports through deps.ts); everything it calls is tested elsewhere.

import { createClient, webpush } from './deps.ts'
import { readEnv, type FunctionEnv } from './env.ts'
import { bearerToken, clientIp, defaultLogger, withHttp } from './http.ts'
import { jwtIssuedAt, resolveCaller } from './context.ts'
import { adminDb, anonAuth, userDb } from './supabase-ports.ts'
import type { Ctx, WebPushSender } from './ports.ts'
import type { FetchLike } from './expo.ts'

export type Handler = (ctx: Ctx, body: Record<string, unknown>, req: Request) => Promise<unknown>

const noSession = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } }

function webPushSender(env: FunctionEnv): WebPushSender | null {
  if (!env.vapid) return null
  webpush.setVapidDetails(env.vapid.subject, env.vapid.publicKey, env.vapid.privateKey)
  return {
    async send(sub, payload) {
      try {
        await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, payload, { TTL: 86400 })
        return { ok: true }
      } catch (e) {
        return { ok: false, status: (e as { statusCode?: number }).statusCode ?? null }
      }
    },
  }
}

export async function buildContext(req: Request): Promise<Ctx> {
  const env = readEnv(name => Deno.env.get(name))
  const jwt = bearerToken(req)
  const authHeader = jwt ? { global: { headers: { Authorization: `Bearer ${jwt}` } } } : {}
  // Caller-scoped client: publishable key + the user's JWT, so RLS applies.
  const userClient = createClient(env.supabaseUrl, env.publishableKey, { ...noSession, ...authHeader })
  const anonClient = createClient(env.supabaseUrl, env.publishableKey, noSession)
  const adminClient = createClient(env.supabaseUrl, env.secretKey, noSession)

  const caller = await resolveCaller(jwt, {
    async getUser(token) {
      const { data, error } = await anonClient.auth.getUser(token)
      return error || !data?.user ? null : { id: data.user.id, email: data.user.email ?? null }
    },
    async getProfile(id) {
      const { data } = await userClient.from('profiles').select('role, deleted_at').eq('id', id).maybeSingle()
      return data ?? null
    },
  })

  return {
    env,
    caller,
    jwt,
    tokenIssuedAt: jwtIssuedAt(jwt),
    clientIp: clientIp(req),
    user: userDb(userClient),
    admin: adminDb(adminClient),
    anon: anonAuth(anonClient),
    fetch: fetch as unknown as FetchLike,
    webPush: webPushSender(env),
    log: defaultLogger,
    now: () => new Date(),
  }
}

export function serveFunction(name: string, handler: Handler): (req: Request) => Promise<Response> {
  return withHttp(name, async (req, body) => handler(await buildContext(req), body, req))
}
