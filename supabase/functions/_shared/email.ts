// Transactional email through Brevo, same call as src/lib/email.ts in the web
// apps. fetch is injected so tests stay offline.

import type { FetchLike } from './expo.ts'

export interface EmailConfig {
  brevoApiKey: string | null
  emailFrom: string | null
  emailFromName: string
}

export function emailConfigured(c: EmailConfig): boolean {
  return !!c.brevoApiKey && !!c.emailFrom
}

export async function sendEmail(
  c: EmailConfig, fetchFn: FetchLike, to: string, subject: string, html: string,
): Promise<boolean> {
  if (!c.brevoApiKey || !c.emailFrom) return false
  try {
    const res = await fetchFn('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'api-key': c.brevoApiKey },
      body: JSON.stringify({
        sender: { name: c.emailFromName, email: c.emailFrom },
        to: [{ email: to }],
        subject,
        htmlContent: html,
      }),
      signal: AbortSignal.timeout(10_000),
    })
    return res.ok
  } catch {
    return false
  }
}
