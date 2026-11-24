// Reads configuration. Pure: takes a getter so tests don't touch Deno.env.
// Never log the values returned here.

export type EnvGet = (name: string) => string | undefined

export interface FunctionEnv {
  supabaseUrl: string
  /** Publishable key (sb_publishable_...) or, before the rotation, the legacy anon JWT. */
  publishableKey: string
  /** Secret key (sb_secret_...) or, before the rotation, the legacy service_role JWT. */
  secretKey: string
  brevoApiKey: string | null
  emailFrom: string | null
  emailFromName: string
  vapid: { publicKey: string; privateKey: string; subject: string } | null
  expoAccessToken: string | null
  notifyWebhookSecret: string | null
  /** true once the notifications INSERT webhook delivers every row: functions then skip their own delivery. */
  webhookDelivery: boolean
  /** Whether webhook deliveries also send web push (off until the web apps stop pushing themselves). */
  webhookWebPush: boolean
  tenantAppUrl: string
  landlordAppUrl: string
  phoneLookupPepper: string | null
}

/**
 * With the new API keys the platform provides SUPABASE_PUBLISHABLE_KEYS /
 * SUPABASE_SECRET_KEYS as JSON objects ({"default":"sb_..."}); before that only
 * the legacy SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY. Prefer the new ones.
 */
export function pickKey(json: string | undefined, name: string | undefined, legacy: string | undefined): string | null {
  if (json) {
    try {
      const obj = JSON.parse(json) as Record<string, unknown>
      const named = name ? obj[name] : undefined
      if (typeof named === 'string' && named) return named
      const def = obj['default']
      if (typeof def === 'string' && def) return def
      const first = Object.values(obj).find(v => typeof v === 'string' && v)
      if (typeof first === 'string') return first
    } catch { /* fall through to the legacy key */ }
  }
  return legacy || null
}

function trimSlash(s: string): string { return s.replace(/\/+$/, '') }

export function readEnv(get: EnvGet): FunctionEnv {
  const supabaseUrl = get('SUPABASE_URL')
  const publishableKey = pickKey(get('SUPABASE_PUBLISHABLE_KEYS'), get('PUBLISHABLE_KEY_NAME'), get('SUPABASE_ANON_KEY'))
  const secretKey = pickKey(get('SUPABASE_SECRET_KEYS'), get('SECRET_KEY_NAME'), get('SUPABASE_SERVICE_ROLE_KEY'))
  if (!supabaseUrl || !publishableKey || !secretKey) {
    throw new Error('Supabase URL or API keys are missing from the function environment')
  }
  const vapidPublic = get('VAPID_PUBLIC_KEY'), vapidPrivate = get('VAPID_PRIVATE_KEY')
  return {
    supabaseUrl,
    publishableKey,
    secretKey,
    brevoApiKey: get('BREVO_API_KEY') || null,
    emailFrom: get('EMAIL_FROM') || null,
    emailFromName: get('EMAIL_FROM_NAME') || 'Apartment Manager',
    vapid: vapidPublic && vapidPrivate
      ? { publicKey: vapidPublic, privateKey: vapidPrivate, subject: get('VAPID_SUBJECT') || 'mailto:admin@example.com' }
      : null,
    expoAccessToken: get('EXPO_ACCESS_TOKEN') || null,
    notifyWebhookSecret: get('NOTIFY_WEBHOOK_SECRET') || null,
    webhookDelivery: get('NOTIFY_WEBHOOK_ENABLED') === 'true',
    webhookWebPush: get('WEBHOOK_DELIVER_WEB_PUSH') === 'true',
    tenantAppUrl: trimSlash(get('TENANT_APP_URL') || 'https://apartment-manager-tenant.onrender.com'),
    landlordAppUrl: trimSlash(get('LANDLORD_APP_URL') || 'https://apartment-manager-landlord.onrender.com'),
    phoneLookupPepper: get('PHONE_LOOKUP_PEPPER') || null,
  }
}
