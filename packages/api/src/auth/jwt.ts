import {
  createLocalJWKSet,
  createRemoteJWKSet,
  type JSONWebKeySet,
  type JWTPayload,
  type JWTVerifyGetKey,
  jwtVerify,
} from 'jose'

const remoteSets = new Map<string, JWTVerifyGetKey>()

/** JWKS resolver, cached per isolate (jose also caches keys and handles rotation). */
export function keySet(jwksUri: string, inline?: JSONWebKeySet): JWTVerifyGetKey {
  if (inline) return createLocalJWKSet(inline)
  let set = remoteSets.get(jwksUri)
  if (!set) {
    set = createRemoteJWKSet(new URL(jwksUri))
    remoteSets.set(jwksUri, set)
  }
  return set
}

export async function verifyJwt(
  token: string,
  keys: JWTVerifyGetKey,
  expected: { issuer: string; audience: string | string[] },
): Promise<JWTPayload | null> {
  try {
    const { payload } = await jwtVerify(token, keys, {
      issuer: expected.issuer,
      audience: expected.audience,
      algorithms: ['RS256', 'ES256', 'PS256', 'EdDSA'],
      clockTolerance: 30,
    })
    return payload
  } catch {
    return null
  }
}

export function bearerToken(header: string | undefined): string | null {
  const match = header ? /^Bearer\s+(\S+)$/i.exec(header) : null
  return match?.[1] ?? null
}
