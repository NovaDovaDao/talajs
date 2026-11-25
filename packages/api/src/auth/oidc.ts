import type { JSONWebKeySet } from 'jose'
import { type AuthAdapter, type Configurable, resolveConfig } from '../types.js'
import { bearerToken, keySet, verifyJwt } from './jwt.js'

export interface OidcOptions<E> {
  /** Issuer URL exactly as it appears in tokens' `iss` claim. */
  issuer: Configurable<string, E>
  /** Expected `aud` (your API identifier / client id). */
  audience: Configurable<string | string[], E>
  /** Claim used as the member subject. Default `sub`. */
  subjectClaim?: string
  /** Skip discovery and use this JWKS URI. */
  jwksUri?: Configurable<string, E>
  /** Inline signing keys (tests, air-gapped setups). */
  jwks?: JSONWebKeySet
}

const discovered = new Map<string, Promise<string>>()

async function discoverJwksUri(issuer: string): Promise<string> {
  let pending = discovered.get(issuer)
  if (!pending) {
    pending = (async () => {
      const res = await fetch(`${issuer.replace(/\/+$/, '')}/.well-known/openid-configuration`)
      if (!res.ok) throw new Error(`OIDC discovery failed for ${issuer}: ${res.status}`)
      const config = (await res.json()) as { jwks_uri?: unknown }
      if (typeof config.jwks_uri !== 'string') throw new Error(`No jwks_uri for ${issuer}`)
      return config.jwks_uri
    })()
    // Don't cache failures.
    pending.catch(() => discovered.delete(issuer))
    discovered.set(issuer, pending)
  }
  return pending
}

/** Verifies `Authorization: Bearer <JWT>` access tokens from any OIDC provider. */
export function oidc<E = unknown>(options: OidcOptions<E>): AuthAdapter<E> {
  const claim = options.subjectClaim ?? 'sub'
  return {
    name: 'oidc',
    async authenticate(c) {
      const token = bearerToken(c.req.header('authorization'))
      // Opaque (non-JWT) bearer tokens are left for other adapters.
      if (!token) return null
      if (token.split('.').length !== 3) return null
      const issuer = resolveConfig(options.issuer, c.env)
      const jwksUri = options.jwks
        ? 'inline'
        : options.jwksUri
          ? resolveConfig(options.jwksUri, c.env)
          : await discoverJwksUri(issuer)
      const payload = await verifyJwt(token, keySet(jwksUri, options.jwks), {
        issuer,
        audience: resolveConfig(options.audience, c.env),
      })
      const subject = payload?.[claim]
      const email = typeof payload?.email === 'string' ? payload.email.toLowerCase() : undefined
      const name = typeof payload?.name === 'string' ? payload.name : undefined
      return typeof subject === 'string' && subject
        ? {
            kind: 'staff',
            subject,
            claims: payload ?? {},
            ...(email ? { email, emailVerified: payload?.email_verified === true } : {}),
            ...(name ? { name } : {}),
          }
        : null
    },
  }
}
