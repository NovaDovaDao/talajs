import type { EmailMessage, Mailer } from './types.js'

export interface ResendOptions {
  apiKey: string
  /** A sender on a domain verified in Resend, e.g. `"Café Uno <receipts@cafe.example>"`. */
  from: string
  replyTo?: string
  /** Override the API origin (tests). */
  baseUrl?: string
  fetch?: typeof fetch
}

export class ResendError extends Error {
  override name = 'ResendError'
  constructor(
    readonly status: number,
    readonly code: string | undefined,
    message: string,
  ) {
    super(message)
  }
}

/**
 * A `Mailer` backed by Resend's HTTP API (plain `fetch`, so it runs on Workers). The message's
 * `idempotencyKey` is sent as `Idempotency-Key`: Resend returns the original result for a repeat
 * within 24 hours instead of sending twice.
 */
export function resend(options: ResendOptions): Mailer {
  const doFetch = options.fetch ?? fetch
  const url = `${options.baseUrl ?? 'https://api.resend.com'}/emails`
  return {
    async send(message: EmailMessage) {
      const headers: Record<string, string> = {
        authorization: `Bearer ${options.apiKey}`,
        'content-type': 'application/json',
      }
      if (message.idempotencyKey) headers['idempotency-key'] = message.idempotencyKey
      const res = await doFetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          from: options.from,
          to: message.to,
          subject: message.subject,
          html: message.html,
          text: message.text,
          ...(options.replyTo ? { reply_to: options.replyTo } : {}),
        }),
      })
      const body = (await res.json().catch(() => ({}))) as {
        id?: string
        name?: string
        message?: string
      }
      if (!res.ok || !body.id) {
        throw new ResendError(
          res.status,
          body.name,
          body.message ?? `Resend returned ${res.status}`,
        )
      }
      return { id: body.id }
    },
  }
}

export type { EmailMessage, Mailer } from './types.js'
