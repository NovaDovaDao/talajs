/** SHA-256 as lower-case hex. */
export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
}

/** Terminal tokens carry a recognisable prefix, so they're routed straight to terminal auth. */
export const TERMINAL_TOKEN_PREFIX = 'tala_t_'

/** 32 random bytes, base64url. */
export function newTerminalToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  const b64 = btoa(String.fromCharCode(...bytes))
  return TERMINAL_TOKEN_PREFIX + b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

// No 0/O, 1/I/L, U: easy to read off one screen and type into another.
const PAIRING_ALPHABET = '23456789ABCDEFGHJKMNPQRSTVWXYZ'

/** 10 characters (≈49 bits), shown as `XXXXX-XXXXX`. */
export function newPairingCode(): string {
  const n = PAIRING_ALPHABET.length
  const limit = 256 - (256 % n) // reject bytes that would bias the modulo
  let code = ''
  while (code.length < 10) {
    for (const b of crypto.getRandomValues(new Uint8Array(16))) {
      if (b < limit && code.length < 10) code += PAIRING_ALPHABET[b % n]
    }
  }
  return `${code.slice(0, 5)}-${code.slice(5)}`
}

/** Normalise what a person typed: case, spaces and dashes don't matter. */
export const normalisePairingCode = (code: string) => code.toUpperCase().replace(/[\s-]/g, '')
