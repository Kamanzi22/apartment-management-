// Notification and email texts. Same wording as the web server actions so a
// tenant gets the same alert whether the landlord used the web or the phone.

export interface NewNotification {
  user_id: string
  type: string
  title: string
  body: string
  link: string | null
}

export function tenancyEndedNotification(tenantId: string, moveOutDate: string): NewNotification {
  return {
    user_id: tenantId,
    type: 'tenancy_ended',
    title: 'Your tenancy has ended',
    body: `Your move-out on ${moveOutDate} is confirmed. You can still sign in to see your receipts and pay any balance.`,
    link: '/',
  }
}

export function paymentReviewedNotification(
  tenantId: string, status: 'confirmed' | 'rejected', periodMonth: string, note: string | null,
): NewNotification {
  return {
    user_id: tenantId,
    type: 'payment_reviewed',
    title: status === 'confirmed' ? 'Payment confirmed' : 'Payment rejected',
    body: status === 'confirmed'
      ? `Your payment for ${periodMonth} has been confirmed.`
      : `Your payment for ${periodMonth} was rejected. ${note ? `Note: ${note}` : 'Please upload the receipt again.'}`,
    link: '/',
  }
}

export function broadcastNotifications(tenantIds: string[], senderName: string | null, text: string): NewNotification[] {
  const preview = `${text.slice(0, 80)}${text.length > 80 ? '…' : ''}`
  return [...new Set(tenantIds)].map(id => ({
    user_id: id,
    type: 'broadcast',
    title: 'Announcement',
    body: `${senderName ?? 'Landlord'}: ${preview}`,
    link: '/messages',
  }))
}

export function tenantDeletedAccountNotification(landlordId: string, unitLabel: string | null): NewNotification {
  return {
    user_id: landlordId,
    type: 'tenant_deleted_account',
    title: 'A tenant closed their account',
    body: `The tenant of ${unitLabel ?? 'a unit'} closed their account and can no longer sign in. All their details and records are kept; you can reactivate the account from the unit page. End the tenancy when they move out.`,
    link: '/landlord',
  }
}

// ── Email (same layout as src/lib/email.ts) ──────────────────

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))
}

/** `body` must already be escaped. */
export function emailLayout(title: string, body: string, button?: { href: string; label: string }): string {
  return `
    <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px 24px">
      <h2 style="color:#1e293b;margin:0 0 12px">${escapeHtml(title)}</h2>
      <p style="color:#475569;margin:0 0 24px;line-height:1.5">${body}</p>
      ${button ? `<a href="${escapeHtml(button.href)}" style="display:inline-block;background:#1e293b;color:#fff;text-decoration:none;padding:12px 28px;border-radius:8px;font-weight:600;font-size:15px">${escapeHtml(button.label)}</a>` : ''}
    </div>`
}

export function recoveryLink(tenantAppUrl: string, hashedToken: string): string {
  return `${tenantAppUrl}/auth/confirm?token_hash=${encodeURIComponent(hashedToken)}&type=recovery&next=/reset-password`
}

export function passwordResetEmail(link: string): { subject: string; html: string } {
  return {
    subject: 'Set your Apartment Manager password',
    html: emailLayout(
      'Set your password',
      'Your landlord asked us to send you a link to set a new password for your tenant account. This link expires in 24&nbsp;hours. If you did not expect this, ignore this email.',
      { href: link, label: 'Set password' },
    ),
  }
}
