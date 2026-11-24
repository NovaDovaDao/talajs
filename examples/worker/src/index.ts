import { type AdminRuntimeConfig, serveAdmin } from '@talajs/admin'
import { createTalaApp, createTalaConsumer, redeliverEvents } from '@talajs/api'
import { cloudflareAccess } from '@talajs/api/auth/cloudflare-access'
import { oidc } from '@talajs/api/auth/oidc'
import { serviceToken } from '@talajs/api/auth/service-token'
import { resend } from '@talajs/api/email/resend'
import type { EventMessage } from '@talajs/contracts'
import { createDb } from '@talajs/db'
import { Hono } from 'hono'

// Reference deployment: Tala mounted at /tala next to the consumer's own routes.
// `Env` is generated from wrangler.jsonc by `wrangler types` (worker-configuration.d.ts).

const db = (env: Env) => createDb({ url: env.HYPERDRIVE.connectionString, driver: 'pg' })

const tala = createTalaApp<Env>({
  db,
  auth: [
    // Automation / provisioning: `wrangler secret put TALA_SERVICE_TOKEN`.
    serviceToken({ token: (env) => env.TALA_SERVICE_TOKEN }),
    // Staff behind Cloudflare Access (the admin UI)…
    cloudflareAccess({
      teamDomain: (env) => env.ACCESS_TEAM_DOMAIN,
      audience: (env) => env.ACCESS_AUD,
    }),
    // …or any OIDC provider for other clients.
    oidc({ issuer: (env) => env.OIDC_ISSUER, audience: (env) => env.OIDC_AUDIENCE }),
  ],
  // Domain events go to a queue; the `queue` handler below processes them.
  events: { queue: (env) => env.TALA_EVENTS },
})

const app = new Hono<{ Bindings: Env }>()

app.get('/health', async (c) => {
  const db = createDb({ url: c.env.HYPERDRIVE.connectionString, driver: 'pg' })
  try {
    const [row] = await db.client.$queryRaw<{ ok: number }[]>`SELECT 1 AS ok`
    return c.json({ ok: row?.ok === 1 })
  } finally {
    c.executionCtx.waitUntil(db.dispose())
  }
})

app.route('/tala', tala)

// The admin web app, behind the same Access application as the API.
const admin = serveAdmin<Env>({
  basePath: '/admin',
  assets: (env) => env.ADMIN,
  config: (env): AdminRuntimeConfig => {
    const mode: string = env.ADMIN_AUTH_MODE
    return {
      apiBase: '/tala',
      auth:
        mode === 'oidc'
          ? { mode: 'oidc', issuer: env.OIDC_ISSUER, clientId: env.OIDC_AUDIENCE }
          : { mode: mode === 'token' ? 'token' : 'access' },
    }
  },
})
app.all('/admin', (c) => admin(c.req.raw, c.env))
app.all('/admin/*', (c) => admin(c.req.raw, c.env))

// Optional secret: receipts are only emailed when RESEND_API_KEY is set.
type WithResend = Env & { RESEND_API_KEY?: string }

export default {
  fetch: app.fetch,

  queue: createTalaConsumer<WithResend>({
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
} satisfies ExportedHandler<WithResend, EventMessage>
