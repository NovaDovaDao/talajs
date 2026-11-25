# @talajs/api

Tala's HTTP API as a Hono app you mount in your own Cloudflare Worker.

```ts
import { createTalaApp } from '@talajs/api'
import { cloudflareAccess } from '@talajs/api/auth/cloudflare-access'
import { serviceToken } from '@talajs/api/auth/service-token'
import { createDb } from '@talajs/db'

const tala = createTalaApp<Env>({
  db: (env) => createDb({ url: env.HYPERDRIVE.connectionString }),
  auth: [
    serviceToken({ token: (env) => env.TALA_SERVICE_TOKEN }),
    cloudflareAccess({ teamDomain: (env) => env.ACCESS_TEAM_DOMAIN, audience: (env) => env.ACCESS_AUD }),
  ],
})

app.route('/tala', tala)   // OpenAPI document at /tala/openapi.json
```

## Auth

Auth adapters are tried in order, and the first one that recognises a request decides who is calling.

| Adapter | Credential | Identity |
|---|---|---|
| `auth.adapter` from [`@talajs/auth`](../auth) | Session cookie from built-in sign-in (Better Auth) | `ba:<user id>`, with verified email and name |
| `cloudflareAccess` | `Cf-Access-Jwt-Assertion` (verified against your team's keys and AUD) | lower-cased email (verified), or `service-token:<client id>` |
| `oidc` | `Authorization: Bearer <JWT>` from any OIDC provider | `sub` (configurable), with `email`, `email_verified` and `name` claims |
| `serviceToken` | `Authorization: Bearer <shared secret>` | the platform `service` identity |

Built-in sign-in is the easy path for merchants and staff; Access, OIDC and service tokens suit operators, automation and businesses with their own identity provider. To write your own adapter, implement `{ name, authenticate(c) → Identity | null }`. Set `email` and `emailVerified` on the identity if you can: invitations match on them.

## Tenancy and roles

Every resource lives under `/v1/tenants/{tenantId}`. A staff identity is admitted only through an active **membership** in that tenant. Non-members get `404`, so tenant ids can't be probed. Handlers receive only a tenant-scoped database client.

- `STAFF`: read the catalog; add customers and notes; adjust stock.
- `MANAGER`: write the catalog, stock levels and per-store settings; archive customers.
- `MANAGER` can also see the team and invite `STAFF` to their own stores.
- `OWNER`: change and remove members, invite anyone, read the audit log. A tenant always keeps at least one owner.
- A member can be limited to particular stores (`storeIds`).
- The `service` identity provisions tenants (`POST /v1/tenants`) and acts as OWNER anywhere.

## Team: invitations, PINs and the audit log

```ts
createTalaApp<Env>({
  db,
  auth,
  invitations: {
    acceptUrl: (token, env) => `${env.PUBLIC_ORIGIN}/admin/invite/${token}`,
    mailer: (env) => resend({ apiKey: env.RESEND_API_KEY, from: 'Café <hello@cafe.example>' }),
  },
  allowSelfServeTenants: false,   // true: anyone with a verified email can create a business
})
```

- **Invitations.** `POST …/invitations { email, role, storeIds }` emails a link that works once, for 7 days, and only for that email.
  - `GET /v1/invitations/{token}` previews it without signing in, showing the business, role and masked email.
  - `POST /v1/invitations/accept { token }` joins. It requires a signed-in identity whose **verified** email matches; otherwise `403 email_mismatch` or `email_unverified`.
  - Re-sending issues a new link. Without a mailer, the response includes the link for you to share.
- **Self-serve businesses.** With `allowSelfServeTenants`, a person with a verified email may `POST /v1/tenants` without `ownerSubject` and becomes its owner, up to `maxTenantsPerPerson` (default 3).
- **Register PINs.** `PUT …/memberships/{id}/pin { pin }` works for your own PIN, a manager resetting staff, or an owner for anyone. Registers check PINs at `POST …/sync/pin`. See [`docs/sync-protocol.md`](../../docs/sync-protocol.md) §6 for the lockout and why PINs only attribute offline.
- **Audit log.** `GET …/audit-log` lists invitations, membership changes, PINs and settings changes, newest first.

## Conventions

- Lists are keyset-paginated: `?limit=&cursor=`, returning `{ data, nextCursor }`.
- `DELETE` archives a record and `POST …/restore` restores it. Archived records are hidden unless `?includeArchived=true`.
- Errors look like `{ error: { code, message, details? } }`. `code` is one of `ErrorCode` in `@talajs/contracts`, for example `validation_error`, `unauthenticated`, `forbidden`, `not_found`, `conflict`, `invalid_reference`, `insufficient_stock`, `email_mismatch` or `invalid_pin`.
- Every response is validated against its schema in `@talajs/contracts` before it is sent.

## Orders, payments and refunds

- `POST /orders` opens an order or tab. Lines snapshot catalog data and take stock when they're added. Voids put stock back.
- Every mutation bumps `version`. Send `expectedVersion` to make an edit conditional.
- **Cash** is built in. Other methods need a `PaymentAdapter` (`createTalaApp({ payments: [myAdapter] })`):
  - Tala records the payment as `PENDING`.
  - It then calls `adapter.charge` outside any transaction and stores the outcome.
  - Adapters must be idempotent on `paymentId` and `refundId`.
- **Refunds** (managers only) cover part or all of a successful payment. Named lines can have their stock put back, and a line is never restocked twice.

## Events, receipts and the queue

Changes write domain events (`order.completed`, `order.voided`, `payment.succeeded`, `payment.failed`, `refund.succeeded`) to an outbox table in the same transaction. Once the request succeeds, their ids are sent to a Cloudflare Queue:

```ts
import { createTalaApp, createTalaConsumer, redeliverEvents } from '@talajs/api'
import { resend } from '@talajs/api/email/resend'

const tala = createTalaApp<Env>({ db, auth, events: { queue: (env) => env.TALA_EVENTS } })

export default {
  fetch: app.fetch,
  queue: createTalaConsumer<Env>({
    db,
    receipts: { mailer: (env) => resend({ apiKey: env.RESEND_API_KEY, from: env.RECEIPTS_FROM }) },
    hooks: { async onEvent(event, env) { /* your integrations */ } },
  }),
  // Cron Trigger: re-queue events whose send failed or that ran out of retries.
  async scheduled(_c, env, ctx) { ctx.waitUntil(redeliverEvents({ db: db(env), queue: env.TALA_EVENTS })) },
}
```

- **Delivery:** the consumer processes each event until it succeeds once, retrying with backoff. `hooks.onEvent` is at least once, so key side effects on `event.id`.
- **Receipts:** when an order with a customer email completes, a receipt is emailed once. `order.receiptSentAt` records the send, and the Resend `Idempotency-Key` covers a crash before it's recorded. Pass `receipts.render` to use your own layout. Set `mailer` to `null` to turn receipts off.
- **Without a queue:** events still land in the outbox and nothing is lost.

See `examples/worker` for the full wiring (queue, dead-letter queue, cron).

## Terminals and offline sync

Registers pair with a one-time code and then use their own token (`tala_t_…`), which is checked before your auth adapters. They push offline sales to `/sync/push` and pull catalog changes from `/sync/pull`. Conflicts and anything odd land in the review queue (`/review-items`). The protocol is in [`docs/sync-protocol.md`](../../docs/sync-protocol.md).
