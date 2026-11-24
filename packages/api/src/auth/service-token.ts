import { type AuthAdapter, type Configurable, resolveConfig } from '../types.js'
import { bearerToken } from './jwt.js'

export interface ServiceTokenOptions<E> {
  /** Shared secret (>= 32 chars), typically `(env) => env.TALA_SERVICE_TOKEN`. Undefined disables. */
  token: Configurable<string | undefined, E>
  /** Subject recorded on ledgers. Default `service`. */
  subject?: string
}

async function digest(value: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))
}

/** Constant-time comparison of two strings (via their SHA-256 digests). */
async function safeEqual(a: string, b: string): Promise<boolean> {
  const [da, db] = await Promise.all([digest(a), digest(b)])
  let diff = 0
  for (let i = 0; i < da.length; i++) diff |= (da[i] ?? 0) ^ (db[i] ?? 0)
  return diff === 0
}

/**
 * Platform-operator credential: `Authorization: Bearer <token>`. Grants the `service` identity,
 * which can provision tenants and acts as OWNER in every tenant. Use for automation only.
 */
export function serviceToken<E = unknown>(options: ServiceTokenOptions<E>): AuthAdapter<E> {
  return {
    name: 'service-token',
    async authenticate(c) {
      const expected = resolveConfig(options.token, c.env)
      if (!expected) return null
      if (expected.length < 32)
        throw new Error('serviceToken: token must be at least 32 characters')
      const presented = bearerToken(c.req.header('authorization'))
      if (!presented || !(await safeEqual(presented, expected))) return null
      return { kind: 'service', subject: options.subject ?? 'service' }
    },
  }
}
