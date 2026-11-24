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
| `cloudflareAccess` | `Cf-Access-Jwt-Assertion` (verified against your team's keys and AUD) | lower-cased email, or `service-token:<client id>` |
| `oidc` | `Authorization: Bearer <JWT>` from any OIDC provider | `sub` (configurable) |
| `serviceToken` | `Authorization: Bearer <shared secret>` | the platform `service` identity |

To write your own adapter, implement `{ name, authenticate(c) → Identity | null }`.

## Tenancy and roles

Every resource lives under `/v1/tenants/{tenantId}`. A staff identity is admitted only through an active **membership** in that tenant. Non-members get `404`, so tenant ids can't be probed. Handlers receive only a tenant-scoped database client.

- `STAFF`: read the catalog; add customers and notes; adjust stock.
- `MANAGER`: write the catalog, stock levels and per-store settings; archive customers.
- `OWNER`: manage members. A tenant always keeps at least one owner.
- A member can be limited to particular stores (`storeIds`).
- The `service` identity provisions tenants (`POST /v1/tenants`) and acts as OWNER anywhere.

## Conventions

- Lists are keyset-paginated: `?limit=&cursor=`, returning `{ data, nextCursor }`.
- `DELETE` archives a record and `POST …/restore` restores it. Archived records are hidden unless `?includeArchived=true`.
- Errors look like `{ error: { code, message, details? } }`, where `code` is one of `validation_error`, `unauthenticated`, `forbidden`, `not_found`, `conflict`, `invalid_reference` or `insufficient_stock`.
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
