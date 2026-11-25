export interface AuthEmail {
  subject: string
  html: string
  text: string
}

export type AuthEmailKind = 'magic-link' | 'verify-email' | 'reset-password'

export interface AuthEmailData {
  kind: AuthEmailKind
  to: string
  url: string
  /** `appName` from the options, e.g. the café's name. */
  appName: string
}

const escapeHtml = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch] ?? ch,
  )

const COPY: Record<AuthEmailKind, { subject: string; lead: string; button: string; tail: string }> =
  {
    'magic-link': {
      subject: 'Your sign-in link',
      lead: 'Use this link to sign in.',
      button: 'Sign in',
      tail: "It works once and expires in 5 minutes. If you didn't ask for it, you can ignore this email.",
    },
    'verify-email': {
      subject: 'Confirm your email',
      lead: 'Confirm this is your email address.',
      button: 'Confirm email',
      tail: "If you didn't create an account, you can ignore this email.",
    },
    'reset-password': {
      subject: 'Reset your password',
      lead: 'Use this link to choose a new password. Resetting signs you out everywhere.',
      button: 'Reset password',
      tail: "It expires in 1 hour. If you didn't ask for it, you can ignore this email.",
    },
  }

/** Plain sign-in emails. Pass `renderEmail` to `createTalaAuth` to brand them. */
export function renderAuthEmail({ kind, url, appName }: AuthEmailData): AuthEmail {
  const copy = COPY[kind]
  const subject = `${appName}: ${copy.subject}`
  const text = `${copy.lead}\n\n${url}\n\n${copy.tail}`
  const html = `<!doctype html><html><body style="font-family:system-ui,sans-serif;max-width:480px;margin:auto;padding:24px;color:#111">
<p><strong>${escapeHtml(appName)}</strong></p>
<p>${escapeHtml(copy.lead)}</p>
<p><a href="${escapeHtml(url)}" style="display:inline-block;padding:10px 16px;background:#111;color:#fff;border-radius:6px;text-decoration:none">${escapeHtml(copy.button)}</a></p>
<p style="color:#555;font-size:14px">${escapeHtml(copy.tail)}</p>
</body></html>`
  return { subject, html, text }
}
