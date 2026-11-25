# Adapters

Tala keeps its edges pluggable. Each adapter is a small interface you pass to `createTalaApp` or `createTalaConsumer`; everything here is exported from `@talajs/api`.

## Auth: `AuthAdapter`

```ts
interface AuthAdapter<E> {
  readonly name: string
  /** An identity, or null if this adapter doesn't recognise the request. */
  authenticate(c: TalaContext<E>): Promise<Identity | null>
}
```

Adapters are tried in order; the first that returns an identity wins, and none means 401. An identity is `{ kind: 'staff', subject }` (looked up in `membership` by `subject`) or `{ kind: 'service', subject }` (platform automation: can create tenants and acts as owner everywhere). Registers authenticate with their own `tala_t_…` tokens, which Tala checks before your adapters.

Staff identities may also carry `email`, `emailVerified` and `name`. Set them when your source provides them:
- accepting an invitation requires `emailVerified` and an `email` matching the invitation;
- self-serve business creation requires a verified email;
- the team list and registers show `name` and `email` instead of the subject.

Built in:

| Import | Use |
|---|---|
| `@talajs/auth` (`auth.adapter`) | Built-in sign-in (Better Auth) for merchants and staff. The subject is `ba:<user id>`. See [`packages/auth`](../packages/auth). |
| `@talajs/api/auth/cloudflare-access` | Staff behind Cloudflare Access. The subject is the user's email (verified); Access service tokens become `service-token:<client id>`. |
| `@talajs/api/auth/oidc` | Bearer access tokens from any OIDC provider (JWKS discovery via `jose`). The subject is `sub`; `email`, `email_verified` and `name` claims are passed on. |
| `@talajs/api/auth/service-token` | A shared secret (≥ 32 characters) for automation and provisioning. |

Writing your own: return `null` for requests that aren't yours (so the next adapter can try), throw only for malformed credentials you're sure are yours, and return a stable `subject`: it's what memberships are keyed on and what ledgers record.

## Payments: `PaymentAdapter`

```ts
interface PaymentAdapter {
  readonly id: string                      // stored as payment.provider
  readonly methods: readonly PaymentMethod[] // 'CARD' | 'CRYPTO'
  charge(request: ChargeRequest): Promise<ChargeResult>
  refund(request: RefundRequest): Promise<RefundResult>
}
```

Cash is built in. For other methods, Tala records the payment as `PENDING` (reserving its amount against the balance), calls `charge` **outside** any database transaction, and stores the outcome under the order lock; a thrown error becomes a `FAILED` payment. Rules for implementers:

- **Be idempotent on `paymentId` / `refundId`.** Pass them to the processor as idempotency keys: a retried request can call you again.
- Return the processor's id as `externalId`; refunds receive it back.
- Resolve with the final outcome. Processors that only confirm later through webhooks aren't supported yet (that needs a provider-event pipeline, which will arrive with the first such adapter).

## Email: `Mailer`

```ts
interface Mailer {
  send(message: { to: string; subject: string; html: string; text: string; idempotencyKey?: string }): Promise<{ id: string }>
}
```

`@talajs/api/email/resend` is a Resend implementation over plain `fetch`. Throw on failure so the queue retries; honour `idempotencyKey` if your provider supports one (receipts use `tala-receipt/<orderId>`). Pass `render` in the consumer's `receipts` options to replace the built-in receipt layout.

## Events: `hooks.onEvent`

```ts
createTalaConsumer({ db, hooks: { async onEvent(event, env) { /* … */ } } })
```

Called after the change has committed, for `order.completed`, `order.voided`, `payment.succeeded`, `payment.failed` and `refund.succeeded`. Delivery is **at least once**: after a failure the event is retried, so key any side effect on `event.id`. Throwing retries the event with backoff; after the queue's retries run out it goes to your dead-letter queue, and `redeliverEvents` (run it from a Cron Trigger) re-queues events that were never processed.
