import { type AdminRuntimeConfig, serveAdmin } from '@talajs/admin'
import { createTalaApp, createTalaConsumer, type Mailer, redeliverEvents } from '@talajs/api'
import { cloudflareAccess } from '@talajs/api/auth/cloudflare-access'
import { oidc } from '@talajs/api/auth/oidc'
import { serviceToken } from '@talajs/api/auth/service-token'
import { resend } from '@talajs/api/email/resend'
import { createTalaAuth } from '@talajs/auth'
import type { EventMessage } from '@talajs/contracts'
import { createDb } from '@talajs/db'
import { Hono } from 'hono'

// Reference deployment: Tala mounted at /tala next to the consumer's own routes.
// `Env` is generated from wrangler.jsonc by `wrangler types` (worker-configuration.d.ts).
//
// Two kinds of people sign in:
// - Merchants (owners, managers, staff) on the public hostname, with built-in sign-in
//   (@talajs/auth): an emailed link, nothing to install or configure for them.
// - Platform operators on OPERATOR_HOST, a second hostname routed to this same Worker and
//   protected by a Cloudflare Access application. Access must not cover the public hostname's
//   /admin or /tala, or merchants could never reach the sign-in screen.

type AppEnv = Env & { RESEND_API_KEY?: string }

const db = (env: AppEnv) => createDb({ url: env.HYPERDRIVE.connectionString, driver: 'pg' })

/** Resend when configured; otherwise sign-in links go to the log (local development). */
const mailer = (env: AppEnv, from: string): Mailer =>
  env.RESEND_API_KEY
    ? resend({ apiKey: env.RESEND_API_KEY, from })
    : {
        async send(message) {
          console.log(`email to ${message.to}: ${message.subject}\n${message.text}`)
          return { id: 'logged' }
        },
      }

const auth = createTalaAuth<AppEnv>({
  db,
  // `wrangler secret put BETTER_AUTH_SECRET` (at least 32 random characters).
  secret: (env) => env.BETTER_AUTH_SECRET,
  baseURL: (env) => `${env.PUBLIC_ORIGIN}/tala/auth`,
  mailer: (env) => mailer(env, env.AUTH_FROM),
  appName: 'Tala',
  // Magic links work on Workers Free. Password sign-in needs Workers Paid for its hashing CPU.
  methods: { magicLink: true, password: false },
  // Only invited people can create an account.
  allowSelfServeTenants: false,
})

const tala = createTalaApp<AppEnv>({
  db,
  auth: [
    // Merchants: the session cookie set by /tala/auth.
    auth.adapter,
    // Automation / provisioning: `wrangler secret put TALA_SERVICE_TOKEN`.
    serviceToken({ token: (env) => env.TALA_SERVICE_TOKEN }),
    // Operators on OPERATOR_HOST, behind Cloudflare Access…
    cloudflareAccess({
      teamDomain: (env) => env.ACCESS_TEAM_DOMAIN,
      audience: (env) => env.ACCESS_AUD,
    }),
    // …or any OIDC provider for other clients.
    oidc({ issuer: (env) => env.OIDC_ISSUER, audience: (env) => env.OIDC_AUDIENCE }),
  ],
  invitations: {
    acceptUrl: (token, env) => `${env.PUBLIC_ORIGIN}/admin/invite/${token}`,
    mailer: (env) => mailer(env, env.AUTH_FROM),
  },
  allowSelfServeTenants: false,
  // Domain events go to a queue; the `queue` handler below processes them.
  events: { queue: (env) => env.TALA_EVENTS },
})

const app = new Hono<{ Bindings: AppEnv }>()

app.get('/health', async (c) => {
  const db = createDb({ url: c.env.HYPERDRIVE.connectionString, driver: 'pg' })
  try {
    const [row] = await db.client.$queryRaw<{ ok: number }[]>`SELECT 1 AS ok`
    return c.json({ ok: row?.ok === 1 })
  } finally {
    c.executionCtx.waitUntil(db.dispose())
  }
})

app.on(['GET', 'POST'], '/tala/auth/*', (c) => auth.handler(c.req.raw, c.env, c.executionCtx))
app.route('/tala', tala)

// The admin web app: built-in sign-in for merchants, Cloudflare Access on the operator host.
const adminFor = (auth: (env: AppEnv) => AdminRuntimeConfig['auth']) =>
  serveAdmin<AppEnv>({
    basePath: '/admin',
    assets: (env) => env.ADMIN,
    config: (env) => ({ apiBase: '/tala', auth: auth(env) }),
  })
const merchantAdmin = adminFor((env) =>
  (env.ADMIN_AUTH_MODE as string) === 'token'
    ? { mode: 'token' } // local development with a service token
    : { mode: 'better-auth', methods: { magicLink: true, password: false } },
)
const operatorAdmin = adminFor(() => ({ mode: 'access' }))
const admin = (request: Request, env: AppEnv) =>
  (new URL(request.url).hostname === env.OPERATOR_HOST ? operatorAdmin : merchantAdmin)(
    request,
    env,
  )
app.all('/admin', (c) => admin(c.req.raw, c.env))
app.all('/admin/*', (c) => admin(c.req.raw, c.env))

export default {
  fetch: app.fetch,

  queue: createTalaConsumer<AppEnv>({
    db,
    receipts: {
      mailer: (env) =>
        env.RESEND_API_KEY ? resend({ apiKey: env.RESEND_API_KEY, from: env.RECEIPTS_FROM }) : null,
    },
    hooks: {
      async onEvent(event) {
        // Your integrations go here (at least once; key side effects on event.id).
        console.log('tala event', event.type, event.id)
      },
    },
  }),

  // Re-queue events whose queue send failed or that ran out of retries.
  async scheduled(_controller, env, ctx) {
    const client = db(env)
    ctx.waitUntil(
      redeliverEvents({ db: client, queue: env.TALA_EVENTS }).finally(() => client.dispose()),
    )
  },
} satisfies ExportedHandler<AppEnv, EventMessage>
