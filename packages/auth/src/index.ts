import {
  type AuthAdapter,
  type Configurable,
  consumeRateLimit,
  hasPendingInvitation,
  type Identity,
  type Mailer,
} from '@talajs/api'
import { uuidv7 } from '@talajs/contracts'
import type { TalaDb } from '@talajs/db'
import { APIError, type BetterAuthOptions, betterAuth } from 'better-auth'
import { prismaAdapter } from 'better-auth/adapters/prisma'
import { bearer, magicLink } from 'better-auth/plugins'
import { type AuthEmailData, renderAuthEmail } from './emails.js'

export {
  type AuthEmail,
  type AuthEmailData,
  type AuthEmailKind,
  renderAuthEmail,
} from './emails.js'

const resolve = <T, E>(value: Configurable<T, E>, env: E): T =>
  typeof value === 'function' ? (value as (env: E) => T)(env) : value

export interface GoogleOptions {
  clientId: string
  clientSecret: string
}

export interface TalaAuthOptions<E> {
  /** The same per-request client factory you give `createTalaApp`. */
  db: (env: E) => TalaDb
  /** `BETTER_AUTH_SECRET`: at least 32 random characters. Signs cookies and tokens. */
  secret: Configurable<string, E>
  /**
   * The public URL the handler is mounted at, e.g. `https://cafe.example/tala/auth`. Its origin
   * is trusted for CSRF checks and its path is the base path.
   */
  baseURL: Configurable<string, E>
  /** Other origins allowed to call the handler (the same origin always is). */
  trustedOrigins?: Configurable<string[], E>
  /** Sends sign-in links, email confirmations and password resets. */
  mailer: Configurable<Mailer, E>
  /** Shown in emails, e.g. your business name. Default "Sign in". */
  appName?: string
  renderEmail?: (data: AuthEmailData) => { subject: string; html: string; text: string }
  methods?: {
    /** Email sign-in links. Default on; needs no password hashing, so it runs on Workers Free. */
    magicLink?: boolean
    /**
     * Email and password, with email confirmation and reset. Default off: secure password hashing
     * needs more CPU than Workers Free allows per request, so enable it on Workers Paid.
     */
    password?: boolean
    /** Sign in with Google. Off unless configured. */
    google?: Configurable<GoogleOptions | undefined, E>
  }
  /**
   * Who may create an account. By default only people with a pending invitation, so nobody can
   * sign up to an empty account. Set it to match `createTalaApp`'s `allowSelfServeTenants`.
   */
  allowSelfServeTenants?: boolean
  /** Accept the session token as `Authorization: Bearer` for clients without cookies. Default off. */
  bearer?: boolean
  /** Final say over the Better Auth options, for anything not covered here. */
  configure?: (options: BetterAuthOptions, env: E) => BetterAuthOptions
}

/** Adapter subjects are `ba:<user id>`, which can't collide with Access emails or OIDC subjects. */
export const SUBJECT_PREFIX = 'ba:'

/** Per-IP rules on the handler's endpoints (seconds, requests). */
const RULES = {
  '/sign-in/*': { window: 60, max: 5 },
  '/sign-up/*': { window: 60, max: 3 },
  '/request-password-reset': { window: 600, max: 3 },
  '/send-verification-email': { window: 600, max: 3 },
  '/magic-link/verify': { window: 60, max: 10 },
}
/** Per-email limit on outgoing links, on top of the per-IP rules. */
const PER_EMAIL = { window: 600, max: 3 }

export function createTalaAuth<E>(options: TalaAuthOptions<E>) {
  const appName = options.appName ?? 'Sign in'
  const render = options.renderEmail ?? renderAuthEmail
  const methods = { magicLink: true, password: false, ...options.methods }

  function build(env: E, db: TalaDb) {
    const mailer = resolve(options.mailer, env)
    async function sendLink(kind: AuthEmailData['kind'], to: string, url: string) {
      // Quietly drop links past the per-email limit: an error would tell a stranger which
      // addresses have accounts, and the owner of the inbox already has a recent link.
      const limit = await consumeRateLimit(db, `email:${kind}:${to.toLowerCase()}`, PER_EMAIL)
      if (!limit.allowed) return
      await mailer.send({ to, ...render({ kind, to, url, appName }) })
    }

    const baseURL = resolve(options.baseURL, env)
    const google = methods.google ? resolve(methods.google, env) : undefined
    const plugins = []
    if (methods.magicLink) {
      plugins.push(
        magicLink({ sendMagicLink: ({ email, url }) => sendLink('magic-link', email, url) }),
      )
    }
    if (options.bearer) plugins.push(bearer())

    const config: BetterAuthOptions = {
      appName,
      secret: resolve(options.secret, env),
      baseURL,
      basePath: new URL(baseURL).pathname,
      trustedOrigins: options.trustedOrigins ? resolve(options.trustedOrigins, env) : [],
      database: prismaAdapter(db.client, { provider: 'postgresql' }),
      user: { modelName: 'authUser' },
      session: {
        modelName: 'authSession',
        // Off, so a revoked session or membership stops working on the very next request.
        cookieCache: { enabled: false },
      },
      account: { modelName: 'authAccount', accountLinking: { enabled: true } },
      verification: { modelName: 'authVerification' },
      emailAndPassword: {
        enabled: methods.password,
        requireEmailVerification: true,
        revokeSessionsOnPasswordReset: true,
        sendResetPassword: ({ user, url }) => sendLink('reset-password', user.email, url),
      },
      emailVerification: {
        sendOnSignUp: true,
        autoSignInAfterVerification: true,
        sendVerificationEmail: ({ user, url }) => sendLink('verify-email', user.email, url),
      },
      ...(google ? { socialProviders: { google } } : {}),
      databaseHooks: {
        user: {
          create: {
            async before(user) {
              if (options.allowSelfServeTenants) return
              if (await hasPendingInvitation(db, user.email)) return
              throw new APIError('FORBIDDEN', {
                code: 'INVITE_REQUIRED',
                message: 'Ask your manager for an invitation to sign up',
              })
            },
          },
        },
      },
      rateLimit: {
        enabled: true,
        window: 60,
        max: 60,
        customRules: RULES,
        customStorage: {
          consume: async (key, rule) => {
            const result = await consumeRateLimit(db, `auth:${key}`, rule)
            return {
              allowed: result.allowed,
              retryAfter: result.allowed ? null : result.retryAfter,
            }
          },
        },
      },
      advanced: {
        cookiePrefix: 'tala',
        ipAddress: { ipAddressHeaders: ['cf-connecting-ip'] },
        database: { generateId: () => uuidv7() },
      },
      telemetry: { enabled: false },
      plugins,
    }
    return betterAuth(options.configure ? options.configure(config, env) : config)
  }

  return {
    /**
     * Serve Better Auth's endpoints. Mount at the `baseURL` path:
     *
     *     app.on(['GET', 'POST'], '/tala/auth/*', (c) => auth.handler(c.req.raw, c.env, c.executionCtx))
     */
    async handler(request: Request, env: E, ctx?: ExecutionContext): Promise<Response> {
      const db = options.db(env)
      try {
        return await build(env, db).handler(request)
      } finally {
        const done = db.dispose()
        if (ctx) ctx.waitUntil(done)
        else await done
      }
    },

    /** For `createTalaApp({ auth: [auth.adapter, …] })`: a signed-in person, from the session cookie. */
    adapter: {
      name: 'better-auth',
      async authenticate(c): Promise<Identity | null> {
        const headers = c.req.raw.headers
        const cookie = headers.get('cookie') ?? ''
        const hasCookie = cookie.includes('tala.session_token=')
        const hasBearer = options.bearer && /^bearer\s/i.test(headers.get('authorization') ?? '')
        if (!hasCookie && !hasBearer) return null
        const session = await build(c.env, c.get('db')).api.getSession({ headers })
        if (!session) return null
        const { user } = session
        return {
          kind: 'staff',
          subject: `${SUBJECT_PREFIX}${user.id}`,
          email: user.email.toLowerCase(),
          emailVerified: user.emailVerified,
          name: user.name || undefined,
          claims: { sessionId: session.session.id },
        }
      },
    } satisfies AuthAdapter<E>,

    /** A Better Auth instance for server-side calls (`auth.api.*`) within one request. */
    instance: (env: E, db: TalaDb) => build(env, db),
  }
}

export type TalaAuth<E> = ReturnType<typeof createTalaAuth<E>>
