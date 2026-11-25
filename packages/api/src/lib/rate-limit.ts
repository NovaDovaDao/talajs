import type { TalaDb } from '@talajs/db'

export interface RateLimitRule {
  /** Window length in seconds. */
  window: number
  /** Requests allowed per window. */
  max: number
}

export interface RateLimitResult {
  allowed: boolean
  /** Seconds until the window resets, when not allowed. */
  retryAfter: number
}

/**
 * Fixed-window counter in `tala_auth.rate_limit`, checked and incremented in one atomic statement,
 * so it's exact across Worker isolates and needs no extra infrastructure. In-memory counters are
 * per isolate on Workers, and KV is eventually consistent; neither can count reliably.
 */
export async function consumeRateLimit(
  db: TalaDb,
  key: string,
  rule: RateLimitRule,
  now = Date.now(),
): Promise<RateLimitResult> {
  const windowMs = rule.window * 1000
  const rows = await db.client.$queryRaw<{ count: number; window_start: bigint }[]>`
    INSERT INTO tala_auth.rate_limit (key, count, window_start)
    VALUES (${key}, 1, ${now})
    ON CONFLICT (key) DO UPDATE SET
      count = CASE WHEN tala_auth.rate_limit.window_start <= ${now - windowMs}
                   THEN 1 ELSE tala_auth.rate_limit.count + 1 END,
      window_start = CASE WHEN tala_auth.rate_limit.window_start <= ${now - windowMs}
                          THEN ${now} ELSE tala_auth.rate_limit.window_start END
    RETURNING count, window_start`
  const row = rows[0]
  if (!row) return { allowed: true, retryAfter: 0 }
  const allowed = row.count <= rule.max
  const resetAt = Number(row.window_start) + windowMs
  return { allowed, retryAfter: allowed ? 0 : Math.max(1, Math.ceil((resetAt - now) / 1000)) }
}

/** The client IP as Cloudflare saw it. */
export function clientIp(headers: Headers): string {
  return headers.get('cf-connecting-ip') ?? 'unknown'
}
