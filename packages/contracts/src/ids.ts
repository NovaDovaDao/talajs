import { z } from 'zod'

// contracts runs on every runtime (Workers, browsers, Node, terminals) and pulls in no
// platform typings; declare just the Web Crypto surface we use.
declare const crypto: { getRandomValues<T extends Uint8Array>(array: T): T }

/** Any RFC 9562 UUID. Tala generates v7, but clients may send any version. */
export const Id = z.uuid()
export type Id = z.infer<typeof Id>

// Monotonic state (RFC 9562 §6.2, method 1: a 12-bit counter in rand_a).
let lastMs = -1
let counter = 0

/**
 * Generate a UUIDv7. Ids from one process are strictly increasing, even within the same
 * millisecond and if the clock steps backwards, so "order by id" is creation order. Safe to
 * call offline on terminals; client-generated ids double as idempotency keys.
 *
 * Passing `now` pins the timestamp (for tests and backfills) and skips the monotonic state.
 */
export function uuidv7(now?: number): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)

  let ms: number
  let seq: number
  if (now !== undefined) {
    ms = now
    seq = ((bytes[6] ?? 0) << 8) | (bytes[7] ?? 0)
  } else {
    const t = Date.now()
    if (t > lastMs) {
      lastMs = t
      // Start in the lower half so the counter has room before it overflows.
      counter = (((bytes[6] ?? 0) << 8) | (bytes[7] ?? 0)) & 0x7ff
    } else if (++counter > 0xfff) {
      // 4096 ids in one millisecond: borrow the next millisecond.
      lastMs += 1
      counter = 0
    }
    ms = lastMs
    seq = counter
  }

  // 48-bit big-endian Unix ms timestamp
  for (let i = 5; i >= 0; i--) {
    bytes[i] = ms % 256
    ms = Math.floor(ms / 256)
  }
  bytes[6] = 0x70 | ((seq >> 8) & 0x0f) // version 7 + counter high bits
  bytes[7] = seq & 0xff
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80 // RFC 9562 variant
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}
