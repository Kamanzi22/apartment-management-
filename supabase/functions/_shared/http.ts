// Pure HTTP helpers shared by every Edge Function: CORS, JSON responses,
// one error shape, and a request wrapper. No Deno APIs here, so vitest can
// run it under Node.

export const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-webhook-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Max-Age': '86400',
}

export type ErrorCode =
  | 'bad_request' | 'unauthorized' | 'forbidden' | 'not_found' | 'conflict'
  | 'rate_limited' | 'method_not_allowed' | 'payload_too_large' | 'unavailable' | 'internal'

/** Every error leaves a function in this shape. */
export interface ErrorBody { error: string; code: ErrorCode }

const STATUS: Record<ErrorCode, number> = {
  bad_request: 400, unauthorized: 401, forbidden: 403, not_found: 404, method_not_allowed: 405,
  conflict: 409, payload_too_large: 413, rate_limited: 429, internal: 500, unavailable: 503,
}

export class HttpError extends Error {
  readonly status: number
  readonly code: ErrorCode
  constructor(code: ErrorCode, message: string) {
    super(message)
    this.code = code
    this.status = STATUS[code]
  }
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

export function errorResponse(code: ErrorCode, message: string): Response {
  const body: ErrorBody = { error: message, code }
  return json(body, STATUS[code])
}

export const MAX_BODY_BYTES = 64 * 1024

/** Reads a JSON object body (max 64 KB). An empty body counts as `{}`. */
export async function readJsonBody(req: Request): Promise<Record<string, unknown>> {
  const text = await req.text()
  if (text.length > MAX_BODY_BYTES) throw new HttpError('payload_too_large', 'Request is too large.')
  if (!text.trim()) return {}
  let parsed: unknown
  try { parsed = JSON.parse(text) } catch { throw new HttpError('bad_request', 'Request body must be JSON.') }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new HttpError('bad_request', 'Request body must be a JSON object.')
  }
  return parsed as Record<string, unknown>
}

/** `Authorization: Bearer <jwt>` -> the token, or null. */
export function bearerToken(req: Request): string | null {
  const h = req.headers.get('Authorization')
  const m = h?.match(/^Bearer\s+(\S+)$/i)
  return m ? m[1] : null
}

/** First address in x-forwarded-for (set by the Supabase edge), else cf-connecting-ip. */
export function clientIp(req: Request): string | null {
  const fwd = req.headers.get('x-forwarded-for')
  if (fwd) return fwd.split(',')[0].trim() || null
  return req.headers.get('cf-connecting-ip')
}

/** Constant-time string compare for shared secrets. */
export function safeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder()
  const x = enc.encode(a), y = enc.encode(b)
  let diff = x.length ^ y.length
  const n = Math.max(x.length, y.length)
  for (let i = 0; i < n; i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0)
  return diff === 0
}

export type Logger = (msg: string) => void
export const defaultLogger: Logger = msg => console.error(msg)

/**
 * Wraps a function body: CORS preflight, POST only, JSON parsing, and one
 * error shape. Unexpected errors are logged by name and message only (never
 * the request body, headers or keys) and returned as a generic 500.
 */
export function withHttp(
  name: string,
  run: (req: Request, body: Record<string, unknown>) => Promise<unknown>,
  log: Logger = defaultLogger,
): (req: Request) => Promise<Response> {
  return async (req: Request) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
    if (req.method !== 'POST') return errorResponse('method_not_allowed', 'Use POST.')
    try {
      const body = await readJsonBody(req)
      const result = await run(req, body)
      return json(result ?? { ok: true })
    } catch (e) {
      if (e instanceof HttpError) return errorResponse(e.code, e.message)
      log(`${name}: unexpected error: ${e instanceof Error ? e.message : String(e)}`)
      return errorResponse('internal', 'Something went wrong. Please try again.')
    }
  }
}
