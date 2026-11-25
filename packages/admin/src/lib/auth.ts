import * as oauth from 'oauth4webapi'
import { type AuthClient, createAuthClient } from './better-auth'
import { type AdminConfig, basePath } from './config'

/**
 * Supplies credentials for API calls. `headers()` returns what to send; `signIn()` starts
 * whatever the mode needs; `signOut()` forgets the session.
 */
export interface Auth {
  mode: AdminConfig['auth']['mode']
  headers(): Promise<Record<string, string>>
  /** Whether there's something to try; the API decides if it's valid. */
  hasSession(): boolean
  signIn(token?: string): Promise<void>
  signOut(): void | Promise<void>
  /** Finish a redirect-based sign-in, if this page load is one. */
  completeSignIn(): Promise<void>
  /** Better Auth endpoints, in `better-auth` mode. */
  client?: AuthClient
}

const TOKEN_KEY = 'tala-admin:token'
const PKCE_KEY = 'tala-admin:pkce'

function tokenAuth(): Auth {
  return {
    mode: 'token',
    async headers(): Promise<Record<string, string>> {
      const token = sessionStorage.getItem(TOKEN_KEY)
      return token ? { authorization: `Bearer ${token}` } : {}
    },
    hasSession: () => sessionStorage.getItem(TOKEN_KEY) !== null,
    async signIn(token) {
      if (token) sessionStorage.setItem(TOKEN_KEY, token.trim())
    },
    signOut: () => sessionStorage.removeItem(TOKEN_KEY),
    async completeSignIn() {},
  }
}

function accessAuth(): Auth {
  return {
    mode: 'access',
    // Cloudflare Access adds `Cf-Access-Jwt-Assertion` at the edge from its cookie.
    headers: async () => ({}),
    hasSession: () => true,
    async signIn() {
      window.location.reload()
    },
    signOut() {
      window.location.assign('/cdn-cgi/access/logout')
    },
    async completeSignIn() {},
  }
}

function oidcAuth(config: Extract<AdminConfig['auth'], { mode: 'oidc' }>): Auth {
  const client: oauth.Client = { client_id: config.clientId }
  const redirectUri = new URL('auth/callback', new URL(basePath(), location.origin)).href
  let server: oauth.AuthorizationServer | undefined

  async function discover() {
    if (server) return server
    const issuer = new URL(config.issuer)
    const res = await oauth.discoveryRequest(issuer, { algorithm: 'oidc' })
    server = await oauth.processDiscoveryResponse(issuer, res)
    return server
  }

  return {
    mode: 'oidc',
    async headers(): Promise<Record<string, string>> {
      const token = sessionStorage.getItem(TOKEN_KEY)
      return token ? { authorization: `Bearer ${token}` } : {}
    },
    hasSession: () => sessionStorage.getItem(TOKEN_KEY) !== null,
    async signIn() {
      const as = await discover()
      const verifier = oauth.generateRandomCodeVerifier()
      const state = oauth.generateRandomState()
      sessionStorage.setItem(PKCE_KEY, JSON.stringify({ verifier, state, back: location.href }))
      const url = new URL(as.authorization_endpoint as string)
      url.searchParams.set('client_id', config.clientId)
      url.searchParams.set('redirect_uri', redirectUri)
      url.searchParams.set('response_type', 'code')
      url.searchParams.set('scope', config.scope)
      url.searchParams.set('state', state)
      url.searchParams.set('code_challenge', await oauth.calculatePKCECodeChallenge(verifier))
      url.searchParams.set('code_challenge_method', 'S256')
      if (config.audience) url.searchParams.set('audience', config.audience)
      location.assign(url)
    },
    signOut: () => sessionStorage.removeItem(TOKEN_KEY),
    async completeSignIn() {
      if (location.href.split('?')[0] !== redirectUri) return
      const saved = JSON.parse(sessionStorage.getItem(PKCE_KEY) ?? 'null') as {
        verifier: string
        state: string
        back: string
      } | null
      if (!saved) throw new Error('Sign-in expired; please try again')
      sessionStorage.removeItem(PKCE_KEY)
      const as = await discover()
      const params = oauth.validateAuthResponse(as, client, new URL(location.href), saved.state)
      const res = await oauth.authorizationCodeGrantRequest(
        as,
        client,
        oauth.None(),
        params,
        redirectUri,
        saved.verifier,
      )
      const result = await oauth.processAuthorizationCodeResponse(as, client, res)
      sessionStorage.setItem(TOKEN_KEY, result.access_token)
      history.replaceState(
        null,
        '',
        saved.back.startsWith(location.origin) ? saved.back : basePath(),
      )
    },
  }
}

function betterAuth(baseURL: string): Auth {
  const client = createAuthClient(baseURL)
  return {
    mode: 'better-auth',
    // The session cookie rides along with every same-origin request.
    headers: async () => ({}),
    hasSession: () => true,
    async signIn() {},
    async signOut() {
      await client.signOut().catch(() => {})
    },
    async completeSignIn() {},
    client,
  }
}

export function createAuth(config: AdminConfig): Auth {
  switch (config.auth.mode) {
    case 'access':
      return accessAuth()
    case 'oidc':
      return oidcAuth(config.auth)
    case 'token':
      return tokenAuth()
    case 'better-auth':
      return betterAuth(config.auth.baseURL ?? `${config.apiBase.replace(/\/$/, '')}/auth`)
  }
}
