import type { JSONWebKeySet } from 'jose'
import { type AuthAdapter, type Configurable, resolveConfig } from '../types.js'
import { keySet, verifyJwt } from './jwt.js'

export interface CloudflareAccessOptions<E> {
  /** Your Zero Trust team domain, e.g. `acme.cloudflareaccess.com`. */
  teamDomain: Configurable<string, E>
  /** The Access application's AUD tag. */
  audience: Configurable<string, E>
  /** Inline signing keys instead of fetching `/cdn-cgi/access/certs` (tests, air-gapped setups). */
  jwks?: JSONWebKeySet
}

/**
 * Trusts the `Cf-Access-Jwt-Assertion` header Cloudflare Access adds to requests that passed
 * an Access policy. The JWT is verified against the team's signing keys, issuer and AUD tag,
 * so a request that bypassed Access (or forged the header) is rejected.
 *
 * Subject: the user's email (lower-cased). Access service tokens have no email; they become
 * `service-token:<client id>`, which you can add as a member like any user.
 */
export function cloudflareAccess<E = unknown>(options: CloudflareAccessOptions<E>): AuthAdapter<E> {
  return {
    name: 'cloudflare-access',
    async authenticate(c) {
      const token = c.req.header('cf-access-jwt-assertion')
      if (!token) return null
      const team = resolveConfig(options.teamDomain, c.env)
        .replace(/^https?:\/\//, '')
        .replace(/\/+$/, '')
      const issuer = `https://${team}`
      const payload = await verifyJwt(
        token,
        keySet(`${issuer}/cdn-cgi/access/certs`, options.jwks),
        {
          issuer,
          audience: resolveConfig(options.audience, c.env),
        },
      )
      if (!payload) return null
      const email = typeof payload.email === 'string' ? payload.email.toLowerCase() : null
      const commonName = typeof payload.common_name === 'string' ? payload.common_name : null
      const subject = email ?? (commonName ? `service-token:${commonName}` : null)
      if (!subject) return null
      // Access only issues identity tokens for emails it has verified.
      return email
        ? {
            kind: 'staff',
            subject,
            claims: payload,
            email: email.toLowerCase(),
            emailVerified: true,
          }
        : { kind: 'staff', subject, claims: payload }
    },
  }
}
