import { OpenAPIHono } from '@hono/zod-openapi'
import type { TalaDb } from '@talajs/db'
import {
  type InvitationEmailData,
  type InvitationSettings,
  renderInvitation,
} from './domain/invitations.js'
import { type SelfServeTenants, selfServeLimit } from './domain/tenancy.js'
import type { Mailer } from './email/types.js'
import { errorResponse, HttpError, toHttpError } from './errors.js'
import { type EventQueue, publishEvents } from './events/publish.js'
import { authenticate, dbMiddleware, tenantMiddleware } from './middleware/index.js'
import type { PaymentAdapter } from './payments.js'
import { registerCatalogRoutes } from './routes/catalog.js'
import { registerCustomerRoutes } from './routes/customers.js'
import { registerInventoryRoutes } from './routes/inventory.js'
import { registerOrderRoutes } from './routes/orders.js'
import { registerPairingRoute, registerSyncRoutes } from './routes/sync.js'
import {
  registerInvitationPreviewRoute,
  registerTenancyRoutes,
  type TeamSettings,
} from './routes/tenancy.js'
import { type AuthAdapter, type Configurable, resolveConfig, type TalaEnv } from './types.js'

export interface InvitationOptions<E> {
  /**
   * The link in the invitation email, where your admin shows the accept screen. With the
   * bundled admin at `/admin`: `` (token, env) => `${env.PUBLIC_ORIGIN}/admin/invite/${token}` ``.
   */
  acceptUrl: (token: string, env: E) => string
  /** Sends invitation emails. Without one, create and re-send return the link to share. */
  mailer?: Configurable<Mailer, E>
  /** Days until an invitation expires. Default 7. */
  expiresInDays?: number
  /** Brand the email. Defaults to a plain template. */
  render?: (data: InvitationEmailData) => { subject: string; html: string; text: string }
}

export interface TalaAppOptions<E> {
  /** Create a database client for a request, e.g. `(env) => createDb({ url: env.HYPERDRIVE.connectionString })`. */
  db: (env: E) => TalaDb
  /** Tried in order; the first adapter that recognises the request wins. */
  auth: AuthAdapter<E> | AuthAdapter<E>[]
  /** Card, crypto or other processors. Cash is built in. */
  payments?: Configurable<readonly PaymentAdapter[], E>
  /**
   * Queue for domain events (order completed, refunds, …), e.g. `(env) => env.TALA_EVENTS`.
   * Consume it with `createTalaConsumer`. Without a queue, events still land in the outbox.
   */
  events?: { queue: Configurable<EventQueue, E> }
  /** Invite people by email. Accepting works with any auth adapter that provides a verified email. */
  invitations?: InvitationOptions<E>
  /**
   * Let anyone signed in with a verified email create a business and become its owner. Off by
   * default: tenants are provisioned by a service credential. With @talajs/auth, pass the same
   * value to `createTalaAuth`, which otherwise only lets invited people sign up.
   */
  allowSelfServeTenants?: boolean | SelfServeTenants
  /** Serve the OpenAPI document at `/openapi.json` (default true). */
  openapi?: boolean
}

export const API_VERSION = '0.0.0'

/**
 * Tala's HTTP API as a Hono app. Mount it in your Worker:
 *
 *     app.route('/tala', createTalaApp({ db, auth }))
 */
export function createTalaApp<E = unknown>(options: TalaAppOptions<E>) {
  const adapters = Array.isArray(options.auth) ? options.auth : [options.auth]
  if (adapters.length === 0) throw new Error('createTalaApp: at least one auth adapter is required')

  const app = new OpenAPIHono<TalaEnv<E>>({
    defaultHook: (result, c) => {
      if (!result.success) {
        return errorResponse(
          c,
          new HttpError(400, 'validation_error', 'Invalid request', result.error.issues),
        )
      }
    },
  })

  app.onError((error, c) => {
    const httpError = toHttpError(error)
    if (httpError.status >= 500) console.error('tala: unhandled error', error)
    return errorResponse(c, httpError)
  })
  app.notFound((c) => errorResponse(c, new HttpError(404, 'not_found', 'Route not found')))

  // Unauthenticated routes, registered first so the auth middleware below never runs for them.
  app.use('/v1/terminal/pair', dbMiddleware(options.db))
  registerPairingRoute(app)
  if (options.invitations) {
    app.on('GET', '/v1/invitations/:token{tala_i_[A-Za-z0-9_-]+}', dbMiddleware(options.db))
    registerInvitationPreviewRoute(app)
  }

  const invitations = options.invitations
  const team: TeamSettings<E> = {
    selfServeTenants: selfServeLimit(options.allowSelfServeTenants),
    invitations: invitations
      ? (c): InvitationSettings => ({
          acceptUrl: (token) => invitations.acceptUrl(token, c.env),
          mailer: invitations.mailer ? resolveConfig(invitations.mailer, c.env) : null,
          ttlDays: invitations.expiresInDays ?? 7,
          render: invitations.render ?? renderInvitation,
        })
      : null,
  }

  app.use(
    '/v1/*',
    dbMiddleware(options.db),
    publishEvents(options.events?.queue),
    authenticate(adapters),
  )
  app.use('/v1/tenants/:tenantId', tenantMiddleware<E>(options.payments))
  app.use('/v1/tenants/:tenantId/*', tenantMiddleware<E>(options.payments))

  registerTenancyRoutes(app, team)
  registerCatalogRoutes(app)
  registerInventoryRoutes(app)
  registerCustomerRoutes(app)
  registerOrderRoutes(app)
  registerSyncRoutes(app)

  if (options.openapi ?? true) {
    app.openAPIRegistry.registerComponent('securitySchemes', 'bearer', {
      type: 'http',
      scheme: 'bearer',
      description: 'OIDC access token, service token or terminal token',
    })
    app.openAPIRegistry.registerComponent('securitySchemes', 'cloudflareAccess', {
      type: 'apiKey',
      in: 'header',
      name: 'Cf-Access-Jwt-Assertion',
    })
    app.doc31('/openapi.json', {
      openapi: '3.1.0',
      info: { title: 'Tala API', version: API_VERSION, license: { name: 'Apache-2.0' } },
      security: [{ bearer: [] }, { cloudflareAccess: [] }],
    })
  }

  return app
}
