import { basePath } from './config'

/**
 * A small client for the Better Auth endpoints the admin uses. Plain fetch on the same origin:
 * the session lives in an httpOnly cookie, so there's nothing to store here.
 */
export class AuthError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message)
  }
}

export interface AuthSessionInfo {
  id: string
  createdAt: string
  updatedAt: string
  expiresAt: string
  ipAddress?: string | null
  userAgent?: string | null
  token: string
}

export interface AuthUser {
  id: string
  email: string
  name: string
  emailVerified: boolean
}

/** An absolute URL inside the admin, for links that come back here (emails, redirects). */
export const adminUrl = (path: string) =>
  new URL(path.replace(/^\//, ''), new URL(basePath(), location.origin)).href

export function createAuthClient(baseURL: string) {
  const base = new URL(baseURL.replace(/\/?$/, '/'), document.baseURI)

  async function call<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    const res = await fetch(new URL(path.replace(/^\//, ''), base), {
      method,
      credentials: 'include',
      headers: body === undefined ? {} : { 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    const text = await res.text()
    const json = text ? JSON.parse(text) : null
    if (!res.ok) {
      throw new AuthError(
        res.status,
        json?.code ?? 'UNKNOWN',
        json?.message ??
          (res.status === 429 ? 'Too many attempts; try again shortly' : res.statusText),
      )
    }
    return json as T
  }

  return {
    sendMagicLink: (email: string, next: string) =>
      call('POST', '/sign-in/magic-link', {
        email,
        callbackURL: adminUrl(next),
        newUserCallbackURL: adminUrl(next),
        errorCallbackURL: adminUrl('/sign-in'),
      }),
    signInPassword: (email: string, password: string) =>
      call<{ user: AuthUser }>('POST', '/sign-in/email', { email, password }),
    signUpPassword: (name: string, email: string, password: string, next: string) =>
      call('POST', '/sign-up/email', { name, email, password, callbackURL: adminUrl(next) }),
    signInGoogle: async (next: string) => {
      const { url } = await call<{ url: string }>('POST', '/sign-in/social', {
        provider: 'google',
        callbackURL: adminUrl(next),
        errorCallbackURL: adminUrl('/sign-in'),
      })
      location.assign(url)
    },
    requestPasswordReset: (email: string) =>
      call('POST', '/request-password-reset', { email, redirectTo: adminUrl('/reset-password') }),
    resetPassword: (token: string, newPassword: string) =>
      call('POST', '/reset-password', { token, newPassword }),
    changePassword: (currentPassword: string, newPassword: string) =>
      call('POST', '/change-password', { currentPassword, newPassword, revokeOtherSessions: true }),
    updateName: (name: string) => call('POST', '/update-user', { name }),
    listSessions: () => call<AuthSessionInfo[]>('GET', '/list-sessions'),
    getSession: () =>
      call<{ session: AuthSessionInfo; user: AuthUser } | null>('GET', '/get-session'),
    revokeSession: (token: string) => call('POST', '/revoke-session', { token }),
    /** Sign out everywhere, this browser included. */
    revokeSessions: () => call('POST', '/revoke-sessions', {}),
    signOut: () => call('POST', '/sign-out', {}),
  }
}

export type AuthClient = ReturnType<typeof createAuthClient>

/** Better Auth's error codes, in words for people. */
export function authErrorMessage(code: string | null | undefined, fallback?: string) {
  switch (code) {
    case 'INVITE_REQUIRED':
    case 'new_user_signup_disabled':
      return 'You need an invitation to sign up. Ask your manager to invite this email address.'
    case 'INVALID_EMAIL_OR_PASSWORD':
      return 'Wrong email or password.'
    case 'EMAIL_NOT_VERIFIED':
      return 'Confirm your email first: we sent you a link.'
    case 'INVALID_TOKEN':
    case 'EXPIRED_TOKEN':
      return 'That link has expired or was already used. Request a new one.'
    case 'USER_ALREADY_EXISTS':
    case 'USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL':
      return 'An account with this email exists. Sign in instead.'
    case 'PASSWORD_TOO_SHORT':
      return 'Use at least 8 characters.'
    default:
      return fallback ?? 'Something went wrong. Try again.'
  }
}
