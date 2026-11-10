// Kept identical in apartment-manager and apartment-manager-tenant.
// Transactional email through Brevo (BREVO_API_KEY, EMAIL_FROM, EMAIL_FROM_NAME).

export function emailConfigured(): boolean {
  return !!process.env.BREVO_API_KEY && !!process.env.EMAIL_FROM
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))
}

export async function sendEmail(to: string, subject: string, html: string): Promise<boolean> {
  const key = process.env.BREVO_API_KEY
  const from = process.env.EMAIL_FROM
  if (!key || !from) return false
  try {
    const res = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'api-key': key },
      body: JSON.stringify({
        sender: { name: process.env.EMAIL_FROM_NAME ?? 'Apartment Manager', email: from },
        to: [{ email: to }],
        subject,
        htmlContent: html,
      }),
      signal: AbortSignal.timeout(10000),
    })
    return res.ok
  } catch {
    return false
  }
}

/** Simple branded layout used by every email. `body` must already be escaped. */
export function emailLayout(title: string, body: string, button?: { href: string; label: string }): string {
  return `
    <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px 24px">
      <h2 style="color:#1e293b;margin:0 0 12px">${escapeHtml(title)}</h2>
      <p style="color:#475569;margin:0 0 24px;line-height:1.5">${body}</p>
      ${button ? `<a href="${button.href}" style="display:inline-block;background:#1e293b;color:#fff;text-decoration:none;padding:12px 28px;border-radius:8px;font-weight:600;font-size:15px">${escapeHtml(button.label)}</a>` : ''}
    </div>`
}
