export interface EmailMessage {
  to: string
  subject: string
  html: string
  text: string
  /**
   * Stable key for this message, e.g. `receipt/<orderId>`. Mailers that support it (Resend)
   * drop repeats of the same key, which makes retried deliveries safe.
   */
  idempotencyKey?: string
}

/** Sends one email. Throw on failure so the queue retries. */
export interface Mailer {
  send(message: EmailMessage): Promise<{ id: string }>
}
