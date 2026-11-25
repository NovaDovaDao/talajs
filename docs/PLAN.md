# Tala: design and roadmap

Status: **approved 2026-11-16.** Decisions on the open questions are in §7. Progress is tracked in §6.

Tala is being rebuilt as a lean, open-source (Apache-2.0), multi-tenant commerce core for cafés and lounges. It runs cheaply on Cloudflare and is meant to be embedded in someone else's Worker. This document covers where Tala came from, the architecture, a schema draft, the build order and the decisions taken along the way.

Ground rules for the rewrite:

- Business-agnostic. No consumer-specific code, names, or configuration in this repo.
- One source of API truth: Zod contracts.
- Scale to zero: no always-open DB connections, no long-running servers.
- The register never needs the cloud to complete a sale.

---

## 1. Background

Tala started as a NestJS + Apollo GraphQL server with a Vue admin, Auth0, Stripe and Coinbase webhooks, on AWS and then Netlify. This rewrite replaced all of it; none of that code is in this repository. Problems found in the old design shaped the new one:

- **Webhooks:** unverified signatures, fire-and-forget handlers and non-idempotent processing (a retry decremented stock and resent the receipt twice). → Provider events are stored, verified and processed idempotently from a queue (§2.3).
- **Side effects inside transactions:** emails were sent inside the payment transaction. → Domain events are written to an outbox in the transaction and acted on after commit.
- **Inventory:** read-then-write updates could oversell under concurrency. → A single conditional decrement with a ledger (§2.4).
- **No tenant model:** an auth subject copied onto every row, scoping repeated by hand, a globally unique customer email. → Tenants, memberships and composite foreign keys, with scoping enforced in one place.
- **Money:** a hard-coded currency, rounding that didn't add up (`subtotal + tax ≠ total`), tax rates parsed out of JSON. → Integer minor units with a currency everywhere and one tested pricing function.
- **Order lines as a JSON blob:** no line-level voids, refunds or reporting. → Snapshotted order lines.
- **Long-lived HS256 session tokens with no revocation.** → Identity from Cloudflare Access or OIDC; Tala issues no session tokens of its own.

---

## 2. Target architecture

```
consumer Worker
 ├─ app.route('/tala', createTalaApp({ db, auth, payments, hooks }))   ← Hono sub-app
 ├─ queue: createTalaQueueConsumer({ db, payments, hooks })            ← webhooks, events
 └─ assets: @talajs/admin/dist (Workers static assets, SPA fallback)

           │ Neon serverless driver (HTTP / per-request WebSocket) or Hyperdrive
           ▼
 Postgres ── schema "tala" (owned by Tala, own migration table) ── consumer's schemas
```

### 2.1 API: Hono app factory

```ts
const tala = createTalaApp({
  db: (env) => createDb({ url: env.DATABASE_URL }),      // per-request client
  auth: cloudflareAccess({ teamDomain, audience }),     // or oidc({...}) or a custom adapter
  payments: [cash(), stripe({ secretKey, webhookSecret }), crypto({ ... })],  // payment-method adapters
  mailer: resend({ apiKey, from }),                     // optional; enables receipts
  queue: (env) => env.TALA_QUEUE,
  hooks: { onEvent: async (evt, ctx) => { /* analytics, custom side effects */ } },
})
app.route('/tala', tala)
export default { fetch: app.fetch, queue: createTalaQueueConsumer({ ... }) }
```

- **REST + Zod, not GraphQL.** Nothing here needs GraphQL's flexibility, and dropping it gives a smaller Worker bundle, plain HTTP caching, and an RPC-shaped sync endpoint. Routes are declared with `@hono/zod-openapi`, so we get validation, an OpenAPI document and a typed `hc` client from the same Zod schemas.
- Handlers are thin. Domain logic lives in plain functions `(ctx: TenantCtx, input) => result` that can be tested without HTTP.
- **Auth is an adapter**: `authenticate(req) → Principal | null`, where `Principal = { kind: 'staff' | 'terminal' | 'service', tenantId, subject, roles, storeIds? }`. Built-in adapters: Cloudflare Access (verifies `Cf-Access-Jwt-Assertion` against the team JWKS), generic OIDC bearer (`jose`), and terminal tokens (always on). Staff identities map to tenants through a `membership` table. *(Changed 2026-11-24, see §7.10: Tala no longer "never issues its own staff sessions"; the optional `@talajs/auth` does, for merchants.)*
- **Tenancy is enforced in one place.** Middleware resolves the `Principal`, then hands handlers a `TenantDb`: a Prisma client extended (`$extends` query component) to inject `tenantId` into every `where` and `create` for tenant-owned models. The raw client isn't reachable from handlers. On top of that, the database rejects cross-tenant references through composite FKs `(tenant_id, x_id) → (tenant_id, id)`. Postgres RLS is a possible later hardening; it's not needed for v1.

### 2.2 Database

- **Prisma 7.10** (Rust-free client with driver adapters), Postgres, `multiSchema` with everything in schema `tala`. The package generates two clients from one schema (`runtime = "nodejs"` and `runtime = "workerd"`) and picks one through the `workerd` export condition. Prisma 8 is in release candidate; re-evaluate before 0.1.0.
- **Connections** (`createDb({ url, driver })`, one client per request, disposed in `ctx.waitUntil`):
  - `neon`: Neon serverless driver over a per-request WebSocket `Pool`. It supports interactive transactions and holds nothing open after the request.
  - `pg`: node-postgres, used with Hyperdrive (`nodejs_compat`), local Postgres, or any other host.
  - Neon's HTTP mode is **not** offered. Its Prisma adapter rejects every transaction ("Transactions are not supported in HTTP mode"), and order commit and payment processing need them.
  - See §6, M1 results, for what was verified and what still needs a real Neon project.
- **Migrations:** authored with `prisma migrate diff`, shipped as plain SQL in the `db` package (`migrations/0001_init.sql`, …) and applied by a small bundled runner (`tala-db migrate`). The runner:
  - records history in **`tala._migrations`** (name, checksum, applied_at), so it never touches a consumer's `_prisma_migrations`,
  - takes a `pg_advisory_lock` so concurrent deploys are safe,
  - refuses to run if an applied migration's checksum has changed,
  - can run from CI or from Node, and needs no Prisma CLI on the consumer side.

  Consumers keep their own schema and migration tool, whatever it is. Their tables may reference `tala.*` but not the other way round.
- **IDs:** UUIDv7 everywhere, client-generatable. Terminals create order and line ids offline, and those ids double as dedupe keys.
- **Money:** `Int` minor units plus `currency char(3)` on every monetary row. One currency per order. Each store has a default currency.

### 2.3 Async work: webhooks → Queues

1. `POST /webhooks/:provider` verifies the signature over the **raw body**. Stripe uses `constructEventAsync` with SubtleCrypto; the crypto provider uses its HMAC with constant-time compare.
2. `INSERT INTO provider_event … ON CONFLICT (provider, external_id) DO NOTHING`. This is the dedupe point. If the DB is unreachable, return 5xx so the provider retries.
3. Enqueue `{ providerEventId }` to Cloudflare Queues and return 200.
4. The consumer loads the event, skips it if `processed_at` is set, applies it in one transaction (payment status → order state → inventory), sets `processed_at`, and *then* emits domain events (`order.completed`, `payment.refunded`, …) to `hooks.onEvent`. Failures retry with backoff and go to a DLQ after N attempts.
5. Events that arrive out of order are fine: processing goes from the stored event plus a provider re-fetch, not from earlier events having arrived.

### 2.4 Inventory and concurrency

Online and admin orders decrement stock inside the order-commit transaction with a single conditional statement:

```sql
UPDATE tala.stock_level SET on_hand = on_hand - $qty
WHERE tenant_id = $t AND id = $id AND (on_hand >= $qty OR NOT track_strictly)
RETURNING on_hand;
```

If no row comes back, the transaction aborts with an `insufficient_stock` error. Every change also appends to `stock_movement`, an auditable ledger. Postgres row locks make this safe under concurrency, so **a Durable Object isn't needed for correctness**. DOs stay available for later real-time features (live tab or KDS fan-out).

**Offline sales are facts, not requests.** A sale the register already completed is never rejected. If applying it drives stock negative, the movement is recorded and a `review_item` (`negative_stock`) is opened.

### 2.5 POS terminals and offline sync

- **Registration:** an admin creates a terminal for a store and gets a one-time pairing code (short TTL). The terminal exchanges the code for a long-lived **opaque token**. Only `sha256(token)` is stored. Tokens are scoped to one tenant and one store plus `scopes[]`, revocable (`revoked_at`) and rotatable, and `last_seen_at` is tracked.
- **Push** (`POST /sync/push`): a batch of mutations, each `{ id: uuid, terminalId, clientTs, type, payload, baseVersion? }`. The server inserts into `sync_mutation` with `UNIQUE (tenant_id, id)`. Duplicates return the stored result. Each mutation gets back `applied | duplicate | conflict(reviewItemId)`. Mutations apply in client order within a batch, and one conflict doesn't block the rest.
- **Pull** (`GET /sync/pull?cursor=`): a catalog, price and config change feed ordered by a per-tenant monotonic `change_seq`, so terminals stay current without full reloads.
- **Conflicts never drop data.** Examples: a stale `baseVersion` on a tab edit, a price mismatch beyond tolerance, a void after a refund, negative stock. Each one becomes a `review_item` with the original payload, a reason and a resolution. They're resolved in the admin.
- **Order numbers:** terminals assign `T{terminalCode}-{seq}` offline. Server-created orders use a per-store counter. Both are display numbers only; the UUID is the identity.
- Contracts for the sync protocol live in `@talajs/contracts`, so a future Tauri terminal shares them.

### 2.6 Admin

- *(Changed 2026-11-22, see §7.8.)* React 19 + Vite + Tailwind 4 + shadcn/ui, rebuilt against the REST API, with types from contracts.
- Built once and configured at runtime: the build fetches `./tala-admin.json` (`{ apiBase, auth: { mode: 'access' | 'oidc' | 'none', issuer?, clientId? } }`), so the same published `dist/` works for every deployment.
  - With Cloudflare Access, the admin does nothing: same-origin cookies, and the API's Access adapter verifies the assertion.
  - With OIDC, it uses an authorization-code + PKCE flow (`oauth4webapi`).
  - With built-in sign-in (`better-auth`, §7.10), same-origin httpOnly session cookies; the admin has sign-in, invitation, password reset and account screens.
- It's served from Workers static assets with SPA fallback, and the base path is configurable so it can mount under `/admin`.

---

## 3. Packages and versioning

| Package | Contents | Runtime deps |
|---|---|---|
| `@talajs/contracts` | Zod schemas and inferred types for every request, response and event; money/tax pure functions; sync protocol | `zod` |
| `@talajs/db` | Prisma schema, generated client, SQL migrations, `tala-db` migration CLI, `createDb()`, `TenantDb` extension | `@prisma/client`, adapters |
| `@talajs/api` | `createTalaApp`, `createTalaQueueConsumer`, auth adapters, payment adapters as subpath exports (`@talajs/api/payments/stripe`) so unused providers aren't bundled | `hono`, `@talajs/contracts`, `@talajs/db` |
| `@talajs/admin` | Static `dist/` (React) and a tiny `serveAdmin()` helper | none at runtime |

There's also `examples/worker`, which isn't published. It's a complete `wrangler.jsonc` reference deployment that doubles as the end-to-end test harness.

**Names:** npm scope `@talajs` (the org exists; nothing is published yet). `@talajs/pos` is reserved for the future terminal app.

**Versioning:**

- Changesets in **fixed (lockstep) mode**: all four packages share one version, so consumers never have to work out a compatibility matrix.
- Stay on `0.x` until terminal sync and a production consumer are live. Until then, a minor bump may break; after 1.0, normal semver applies.
- **Any release that adds a migration is at least a minor bump**, and the changelog says "run `tala-db migrate`".
- Destructive schema changes use expand/contract across two releases.
- Releases are published from GitHub Actions with npm provenance. A git dependency works for early testing, but published builds are the supported path.

---

## 4. Schema draft (schema `tala`)

Every table except `tenant` has `tenant_id`. Every unique key is per tenant. All FKs between tenant-owned rows are composite `(tenant_id, …)`. `created_at` and `updated_at` are omitted below for brevity.

```prisma
// ── tenancy & access ───────────────────────────────────────────
model Tenant      { id, name, slug @unique, defaultCurrency, disabledAt? }
model Store       { id, tenantId, name, slug, currency, timezone, pricesIncludeTax Boolean,
                    @@unique([tenantId, slug]) }
model Membership  { id, tenantId, subject /* IdP sub or email */, role /* owner|manager|staff */,
                    storeIds String[], @@unique([tenantId, subject]) }
model Terminal    { id, tenantId, storeId, name, code /* short, for order numbers */,
                    tokenHash? @unique, pairingCodeHash?, pairingExpiresAt?, scopes String[],
                    lastSeenAt?, revokedAt?, @@unique([tenantId, storeId, code]) }

// ── catalog ────────────────────────────────────────────────────
model TaxRate        { id, tenantId, name, rateBps Int /* 825 = 8.25% */, archivedAt? }
model Category       { id, tenantId, name, sortOrder, parentId? }
model Item           { id, tenantId, name, description?, taxRateId?, archivedAt?, version Int }
model ItemCategory   { tenantId, itemId, categoryId, sortOrder, @@id([tenantId, itemId, categoryId]) }
model Variant        { id, tenantId, itemId, name /* "12oz" */, sku?, priceMinor Int, currency,
                       stockLevelId?, sortOrder, archivedAt?, @@unique([tenantId, sku]) }
model ModifierGroup  { id, tenantId, name /* "Milk" */, minSelect Int, maxSelect Int }
model Modifier       { id, tenantId, groupId, name /* "Oat" */, priceDeltaMinor Int, stockLevelId?, archivedAt? }
model ItemModifierGroup { tenantId, itemId, groupId, sortOrder, @@id([tenantId, itemId, groupId]) }
model StoreItem      { tenantId, storeId, itemId, available Boolean, priceOverrideMinor?  /* per-location */ }

// ── inventory ──────────────────────────────────────────────────
model StockLevel     { id, tenantId, storeId, name, unit, onHand Int, trackStrictly Boolean }
model StockMovement  { id, tenantId, stockLevelId, delta Int, reason /* sale|void|refund|adjust|recount|receive */,
                       orderLineId?, syncMutationId?, note?, actor }

// ── customers ──────────────────────────────────────────────────
model Customer       { id, tenantId, name?, email?, phone?, marketingOptIn Boolean,
                       @@unique([tenantId, email]), @@unique([tenantId, phone]) }
model CustomerNote   { id, tenantId, customerId, body, author }
model Tag            { id, tenantId, name, @@unique([tenantId, name]) }
model CustomerTag    { tenantId, customerId, tagId, @@id([tenantId, customerId, tagId]) }
// order history = orders by customer_id (no separate table)

// ── orders, tabs ───────────────────────────────────────────────
enum OrderStatus { OPEN /* tab or cart */  COMPLETED  VOIDED }
model Order          { id /* client UUID */, tenantId, storeId, terminalId?, customerId?,
                       number String, status, isTab Boolean, tabName?,
                       currency, subtotalMinor, discountMinor, taxMinor, totalMinor, tipMinor,
                       openedAt, completedAt?, voidedAt?, voidReason?, version Int,
                       source /* pos|online|admin */, @@unique([tenantId, storeId, number]) }
model OrderLine      { id, tenantId, orderId, variantId?,
                       itemName, variantName?, unitPriceMinor, quantity, taxRateBps,   // snapshots
                       modifiersTotalMinor, lineTotalMinor, note?,
                       voidedAt?, voidReason?, addedAt /* tabs: when added */ }
model OrderLineModifier { id, tenantId, orderLineId, modifierId?, groupName, name, priceDeltaMinor }  // snapshot

// ── payments ───────────────────────────────────────────────────
enum PaymentMethod   { CASH  CARD  CRYPTO }
enum PaymentStatus   { PENDING  SUCCESS  FAILED  CANCELED }
model Payment        { id, tenantId, orderId, method, provider? /* stripe|crypto|… */, status,
                       amountMinor, currency, tipMinor, externalId?, asset? /* "USDC" */,
                       terminalId?, failureReason?, @@unique([provider, externalId]) }
model Refund         { id, tenantId, paymentId, amountMinor, currency, reason, status,
                       externalId?, lineIds String[] /* optional: which lines */, actor }
model PaymentAccount { id, tenantId, provider, externalAccountId, status, @@unique([tenantId, provider]) }
model ProviderEvent  { id, provider, externalId, tenantId?, type, payload Json,
                       receivedAt, processedAt?, attempts Int, lastError?, @@unique([provider, externalId]) }

// ── sync & review ──────────────────────────────────────────────
model SyncMutation   { id /* client UUID */, tenantId, terminalId, type, payload Json, clientTs,
                       receivedAt, status /* applied|duplicate|conflict|rejected */, result Json?,
                       @@id([tenantId, id]) }
model ReviewItem     { id, tenantId, kind /* sync_conflict|negative_stock|payment_mismatch */,
                       subjectType, subjectId, syncMutationId?, details Json,
                       status /* open|resolved|dismissed */, resolution Json?, resolvedBy?, resolvedAt? }
model ChangeLog      { seq BigInt @id @default(autoincrement()), tenantId, entity, entityId, op }  // pull feed
```

How the domain rules map onto this:

- **Tab:** `Order { status: OPEN, isTab: true, tabName }`. *Add* appends `OrderLine`s and bumps `version`. *Complete* takes payment(s) and sets `COMPLETED` once `Σ successful payments − refunds ≥ total`. Split tender is just multiple `Payment` rows.
- **Void:** before payment, a line void (`OrderLine.voidedAt`) or an order void (`VOIDED`). Both restock through `StockMovement(reason: void)`. **Refund:** after payment, a `Refund` row against a `Payment`, with optional restock.
- **Tax:** computed in `@talajs/contracts` as a pure function. Line amounts are grouped by `taxRateBps` and rounded half-up once per rate per order. `pricesIncludeTax` per store handles VAT-style menus. The same function runs on the server and on terminals, so offline totals match.
- The old `Checkout` maps to `Payment`; `CheckoutMethod.BITCOIN` becomes `CRYPTO` + `asset`.

---

## 5. Repository layout

```
tala/
├─ packages/
│  ├─ contracts/      src/{money,tax,catalog,orders,payments,customers,sync,events}.ts
│  ├─ db/             prisma/schema.prisma, migrations/*.sql, src/{client,tenant,migrate}.ts, bin/tala-db
│  ├─ api/            src/{app.ts,queue.ts,middleware/,routes/,domain/,auth/,payments/}
│  └─ admin/          React app
├─ examples/worker/   wrangler.jsonc, src/index.ts (mounts everything), e2e tests
├─ docs/              PLAN.md, architecture, sync-protocol.md, adapters.md
├─ .changeset/  pnpm-workspace.yaml  tsconfig.base.json (strict)  biome.json  LICENSE
```

Tooling: pnpm workspaces, TypeScript `strict` (+ `noUncheckedIndexedAccess`), Biome for lint and format, Vitest 5 with `@cloudflare/vitest-plugin` for API tests (the renamed successor of `vitest-pool-workers`), and a Postgres service container in CI (plus an optional Neon branch per PR). Tests run in workerd, not Node.

---

## 6. Milestones

Each one ends green in CI with a conventional-commit history on `feat/cloudflare-core` (or a follow-on branch per milestone). Nothing gets pushed without asking.

| # | Milestone | Exit criteria |
|---|---|---|
| **M0** | Cleanup ✅ | old demo and third-party game code removed, Apache-2.0, plan approved, README rewritten to the "embeddable core" positioning |
| **M1** | Foundations and DB spike ✅ (one item open, see below) | pnpm + strict TS + Biome + Vitest + Changesets + CI; `contracts` (money/tax and their tests); `db` with the full schema, `0001_init.sql`, `tala-db migrate` with its own history table; spike results recorded for Prisma 7 on workerd (Neon HTTP vs WebSocket vs Hyperdrive, interactive transactions, cold start, scale to zero) |
| **M2** | API skeleton, tenancy, catalog ✅ | `createTalaApp`, auth adapters (Access, OIDC, test), `TenantDb` + cross-tenant tests, CRUD for stores/categories/items/variants/modifiers/tax/stock, customers + notes + tags, OpenAPI doc served; `examples/worker` deploys |
| **M3** | Orders, tabs, inventory ✅ | order create/commit with line snapshots, tabs (open/add/complete), voids, the conditional stock decrement with ledger, plus a concurrency test that proves no oversell under parallel commits |
| **M4** | Payments and async ✅ | cash refunds (with optional restock); the payment adapter interface (no card or crypto adapters yet, see §7.7); domain events → Queue → idempotent consumer → `hooks.onEvent`; Resend receipts; duplicate and replay tests. Provider webhooks wait for a real adapter. **The old NestJS `packages/api` is deleted here.** |
| **M5** | Terminals and sync ✅ | pairing, opaque tokens, revoke/rotate; `/sync/push` with dedupe and the review queue, `/sync/pull` change feed; protocol doc; a fake-terminal test suite (offline sale → push twice → one order; conflicting tab edit → review item) |
| **M6** | Admin port ✅ (React, see §7.8) | Vue/daisyUI upgrade, typed client, runtime config, Access/OIDC/none auth modes; views for catalog, orders/tabs, customers, terminals, review queue, payment-account onboarding; served from static assets in the example. **The old `packages/web` is deleted here.** |
| **M7** | Publish 0.1.0 ✅ (2026-11-24) | README, docs, adapters guide, example; Changesets release with provenance; first consumer integrates from npm |

M1 is the only milestone with real technical risk (Prisma 7 on workerd and transaction support for each driver). If the spike turns up a blocker, we'll revisit before starting M2.

### M1 results (2026-11-16)

Verified, in `examples/worker/test/spike-db.test.ts` (inside workerd, through a local Hyperdrive binding to Postgres) and `packages/db/src/*.test.ts`:

- The workerd Prisma client runs under workerd with the `pg` adapter through Hyperdrive. Interactive transactions commit and roll back correctly.
- **No oversell:** 12 concurrent transactions run a conditional decrement on a stock level of 5 (`updateMany where onHand >= n`, `decrement`). Exactly 5 succeed, the level ends at 0, and there are 5 ledger rows. No raw SQL and no Durable Object needed.
- **Tenant isolation:** the scoped client can't read, update or delete another tenant's rows, even by id. The composite FKs reject a cross-tenant reference written through the *unscoped* client. Customer email is unique per tenant.
- **`tala-db migrate`:** runs once, is a no-op on re-run, serialises concurrent runs, rolls back a failing migration, refuses edited or unknown migrations, and never creates `_prisma_migrations`.
- **Worker bundle** (example plus Prisma): 4.4 MiB raw, **1.39 MiB gzip**, which fits the Workers Free 3 MB limit. The query-compiler wasm (3.4 MB raw) is most of it.
- **Cold start:** client init plus first query is about 0.5 s locally (wasm compile). Warm transactions take 16–40 ms.

**Still open (needs a Neon project):** the `neon` WebSocket driver against real Neon from a deployed Worker, cold-start latency there, and whether a Neon compute suspends between requests under each driver. That includes Hyperdrive's pooled origin connections, which may keep a compute awake. This doesn't block M2: both drivers sit behind the same `createDb`, and the API code doesn't depend on which one is used.

---

## 7. Decisions (2026-11-16)

1. **npm scope:** `@talajs` (see §3). `@tala` was taken on npm (2026-11-22); `@tala` is held on JSR for possible future use (see 9).
2. **Data:** clean start. The old `20240524035724_init` migration and its data aren't carried over, and there's no import tooling.
3. **Stripe** *(deferred, see 7)* is a payment-method adapter (`method: CARD`, `provider: stripe`) on the current Stripe API version, pinned through the SDK and recorded in the adapter. The model is **Connect with Tala as the platform**: each tenant onboards a connected account (`PaymentAccount`), and charges run on that account. The platform keys belong to the deployment's operator.
4. **Crypto/USDC** *(deferred, see 7)*: still an adapter. Confirm the current provider API first.
5. **Online storefront:** public storefront endpoints (menu browsing, customer checkout) are deferred until after 0.1.0. The data model already supports them (`Order.source = online`).
6. **Email:** **Resend**, behind a small `Mailer` interface (`@talajs/api/email/resend`, plain `fetch`, Workers-safe). When a mailer is configured, the queue consumer sends receipts on `order.completed`, outside any DB transaction and idempotent per order. Without a mailer, no email is sent.
7. **Payments are cash-only for now (2026-11-19).** The processor first considered was a bank's "ePay Retail" card API. Its public help pages aren't enough to build on:
   - There are only two ISO 8583-style authorization endpoints, plus one that sends SMS/email.
   - Authentication, base URLs, a sandbox, response models and response codes aren't documented.
   - There's no refund, void, status lookup, webhook, tokenization or hosted-page flow.
   - Raw PAN, track data, PIN block and CVV go in the request body, which would put the Worker in PCI scope.

   Card (Stripe) and crypto adapters are deferred as well. Revisit if a processor provides a full integration guide with sandbox credentials. M4 keeps a small adapter interface so a card processor can be added later without schema changes.
8. **Admin: React 19 + shadcn/ui instead of Vue (2026-11-22).** The admin is rebuilt rather than ported: React 19, Vite 8, Tailwind 4, shadcn/ui (Radix, "nova" preset), React Router 8 and TanStack Query. The shadcn MCP server is configured in `.mcp.json` for Claude Code. The legacy Vue admin was deleted.
9. **Registry: npm, not JSR (2026-11-22).** A JSR dry run hit three blockers:
   - every exported Zod schema fails JSR's slow-types check (132 errors in contracts), and the opt-out ships no `.d.ts` to Node and pnpm users;
   - JSR refused Prisma's `.wasm` query compiler whatever include/exclude rules were tried;
   - JSR's docs don't cover `bin` or export conditions (`workerd`).

   The admin's built assets don't fit JSR either. Tala ships to npm as `@talajs/*`. The JSR `@tala` scope stays reserved, e.g. for publishing `@talajs/contracts` there later.
10. **Built-in merchant sign-in with Better Auth (2026-11-24).** This reverses §2.1's "Tala never issues its own staff sessions". A café owner can't be expected to set up a Zero Trust application or an identity provider, and baristas need to accept an invite and reset a password on their own. So a new, optional `@talajs/auth` package wraps Better Auth and becomes the default sign-in for merchants and staff. Access, OIDC and service tokens stay for operators, automation and enterprises. Design and doc findings: [`docs/design/better-auth.md`](design/better-auth.md). The decisions:
    - Better Auth only answers "who is this person". Authorization stays in `membership`. Its organization plugin isn't used.
    - A separate package, so consumers who don't use it don't install it. Its tables live in a `tala_auth` schema (migration `0002`).
    - Magic link is the default, because it runs on Workers Free. Password sign-in is opt-in and needs Workers Paid for its hashing CPU. Google is wired but off.
    - Invitations live in `@talajs/api` and work with any identity source that gives a verified email.
    - Sign-up is invite-only unless `allowSelfServeTenants` is set (off by default).
    - Register PINs only attribute an action offline; anything that needs a manager is checked online.
    - Operators use a separate, Access-protected hostname on the same Worker, because Access in front of `/admin` would lock merchants out of the sign-in screen.
    - A tenant audit log covers invitations, memberships and PINs. Sign-in history comes from Better Auth's session rows.

### M2 results (2026-11-19)

- `createTalaApp({ db, auth })` is a mountable Hono/OpenAPI app with an OpenAPI 3.1 document. There are auth adapters for Cloudflare Access, OIDC and service tokens. Tenant middleware turns a membership into a tenant-scoped context, with roles `OWNER`, `MANAGER` and `STAFF`, plus store-restricted members.
- REST resources: tenants and memberships; stores and per-store item settings; tax rates; categories (rejecting parent cycles); items with variants, categories and modifier groups; modifier groups and modifiers; stock levels with atomic adjustments and a ledger; customers with tags, notes and order history.
- Catalog writes bump `version` and append to `change_log` in the same transaction, ready for the M5 terminal pull feed.
- Every response is validated against its contract schema at runtime.
- Tests: 41 API tests run in workerd against Postgres, using real signed JWTs, and cover roles, tenant isolation, cross-tenant references and concurrency. Three deliberate breakages were each caught by the suite: role checks, tenant scoping and the stock floor.
- **Bug found and fixed:** `uuidv7()` wasn't monotonic within a millisecond, so "order by id" wasn't creation order. It now uses RFC 9562's counter method and survives clock steps. Nested variants and modifiers also default `sortOrder` to their position in the request.
- The example worker mounts the API at `/tala`. Deploy bundle: 1.55 MiB gzip.
- Still undeployed: a real deploy needs a Cloudflare account, a Hyperdrive config id and an Access application.

### M3 results (2026-11-19)

- `/orders`: open an order or tab (optionally with lines), add lines, void a line, void the order, take a cash payment, complete. Lists filter by store, status, tab and customer. Orders get a per-store number handed out under the store's row lock.
- **Line snapshots:** item and variant name, unit price (after the store's price override), modifier names and deltas, and the tax rate are copied onto the line, so later catalog edits don't change past orders. Custom open-price lines (no variant) are supported. Modifier choices are checked against each group's min/max. Archived items, and items marked unavailable in the store, are refused with `item_unavailable`.
- **Pricing** runs through the shared `priceOrder` in `@talajs/contracts` after every change; voided lines count as zero but keep their amount for history.
- **Stock** is taken when a line is added (a tab's drink is already poured), with the §2.4 conditional decrement and a `SALE` ledger row per line. Voids put it back as `VOID` rows, based on what the line actually took. All-or-nothing per request.
- **Concurrency:** every mutation first bumps the order's `version` with a single conditional `UPDATE`, which takes the row lock and makes `expectedVersion` checks race-free. Stock rows are locked afterwards in id order, so orders can't deadlock each other.
- **Retries:** repeating a create with the same order id, or a payment with the same payment id, returns the existing record with 200.
- **Rules:** a line void that would leave the order overpaid is refused, as is voiding an order with a successful payment (refunds arrive in M4). Completing needs at least one live line and no balance due (`balance_due`). Who opened, completed and voided an order, and who added and voided each line, is recorded (new columns folded into the unreleased `0001_init`).
- **Payments:** cash only for now (applied amount ≤ balance due, plus tip). Card and crypto return 422 until the M4 adapters.
- Tests: 16 new API tests, including 12 parallel orders against 5 croissants (exactly 5 succeed, stock ends at 0, 5 `SALE` rows, distinct numbers) and two registers editing one tab. Three deliberate breakages (stock guard, version check, restock) were each caught. Bundle: 1.56 MiB gzip.
- **Known limitations, to revisit:**
  - A variant or modifier links to one stock level, and stock levels belong to one store. Sales in other stores therefore don't draw down stock. Multi-store stock needs a per-store link table.
  - A store's price override is per item, so it replaces the price of every variant of that item in that store.
  - Discounts aren't modelled yet (`discountMinor` stays 0).

### M4 results (2026-11-19)

- **Refunds** (`POST /orders/{id}/refunds`, managers only) cover part or all of a successful payment, on an open or completed order, and are capped at what's left of it.
  - Named lines can have their stock put back. Restocking uses each line's *net* stock movements, so refunding or voiding a line twice never restocks twice.
  - `paidMinor` is now net of refunds. `refundedMinor`, `refunds[]` and `receiptSentAt` are on the order, and `balanceDueMinor` only applies while the order is open.
  - An open order whose payments are fully refunded can be voided.
- **Payment adapters:** `PaymentAdapter { id, methods, charge, refund }` passed to `createTalaApp({ payments })`, with cash built in.
  - A non-cash payment is first recorded `PENDING`, which reserves its amount against the balance.
  - The adapter is then called outside any transaction, and the outcome is stored under the order lock.
  - Processor errors become `FAILED` payments.
  - No card or crypto adapter ships (§7.7). Only synchronous outcomes are supported; webhook-settled processors need the provider-event pipeline, which comes with the first such adapter.
- **Outbox and queue:**
  - A new `domain_event` table (folded into the unreleased `0001_init`) is written in the same transaction as the change.
  - The ids are queued after a successful response.
  - `createTalaConsumer` loads each event and skips it if it's missing (rolled back) or already processed. It then sends receipts, calls `hooks.onEvent` and marks the event processed. Failures record `attempts` and `last_error` and retry with backoff.
  - `redeliverEvents` (cron) re-queues stragglers.
- **Receipts:** a Resend `Mailer` (`@talajs/api/email/resend`, plain `fetch`) and a built-in HTML/text receipt that escapes snapshot text.
  - A receipt is sent once per order: `receipt_sent_at` records it, and Resend's `Idempotency-Key` (`tala-receipt/<orderId>`) covers a crash in between.
  - `render` can be overridden, and the mailer can be `null` to turn receipts off.
- The example worker wires the producer, consumer, dead-letter queue and a 10-minute cron. `RESEND_API_KEY` is optional.
- `legacy/api` is deleted. `legacy/common` and `schema.gql` stay as reference for the M6 admin port.
- **Tests:** 13 new (70 API tests in all), covering cash and adapter refunds, declines, processor errors, the outbox, redelivery, the consumer (once-only receipt, hook retry, ghost and malformed messages) and the Resend request format.
  - Of four deliberate breakages, three were caught: net restock, the processed-event skip and the refund cap.
  - The fourth (queueing events from a failed request) wasn't. No current endpoint writes an event and then fails, so that guard is defensive.
- Bundle: 1.56 MiB gzip.

### M5 results (2026-11-19)

- **Terminals:** managers create a terminal per store (with a short `code` for offline order numbers) and get a one-time pairing code.
  - The code is 10 characters from an unambiguous alphabet, about 49 bits. It's hashed, expires after 15 minutes and works once.
  - `POST /v1/terminal/pair` is the one unauthenticated route and exchanges the code for an opaque `tala_t_…` token, of which only the SHA-256 is stored.
  - Terminal tokens are checked before the configured auth adapters. A terminal is `STAFF` in its own store and tenant, and `lastSeenAt` is refreshed at most once a minute.
  - Re-pairing issues a new code; the old token works until the code is used. Revocation is permanent and immediate.
- **Push** applies mutations in order, each in its own transaction.
  - The `sync_mutation` row is inserted first in the same transaction, so a mutation is applied exactly once even when two pushes of the same batch race.
  - Six mutation types (open, add_lines, void_line, pay, complete, void). Results are `APPLIED`, `DUPLICATE` (with the original status), `CONFLICT` or `REJECTED`. All four are final, so the register can always drop the mutation from its outbox.
  - Offline sales are facts: stock may go below zero (`NEGATIVE_STOCK` review), the charged price is kept (a `price_mismatch` review if it differs from the catalog), and double cash payments are recorded (`PAYMENT_MISMATCH` review).
  - Voids with a stale `baseVersion`, and edits to closed orders, become conflicts; nothing is lost, because the payload goes into a review item.
- **Pull** returns each changed entity's current state, collapsed per entity and filtered to the terminal's store.
  - `change_log` gained `store_id` and a `txid xid8` column (`pg_current_xact_id()`), folded into the unreleased `0001_init`.
  - The feed pages by `(txid, seq)` and only reads rows older than the oldest running write transaction (`pg_snapshot_xmin`). That closes the "a lower seq commits after a reader moved past it" gap noted in M2: a slow transaction delays the feed instead of being skipped.
  - The trade-off: any long-running write transaction in the database delays every tenant's feed until it ends.
- **Review queue:** list, get, and resolve or dismiss, for managers with access to all stores.
- `docs/sync-protocol.md` documents pairing, the mutation types, push results, conflict rules, pull and a recommended register loop.
- **Tests:** a 12-test fake-terminal suite, including:
  - pairing, expiry, rotation and revocation
  - terminal scope
  - an offline sale pushed twice (one order) and the same batch pushed twice concurrently (each mutation applied once)
  - negative stock, price drift, rejections not blocking the rest, a stale tab void becoming a review item, double cash payments
  - a full and an incremental pull
  - a slow transaction committing behind a later change
- Four deliberate breakages (the xmin guard, `baseVersion`, forced stock, store filtering) were each caught.
- Bundle: 1.57 MiB gzip.
- **Not yet:** pull loads each entity separately (N+1), which is fine for a café catalog but could be batched later. Pairing has no built-in rate limit; the code space and 15-minute TTL make guessing impractical, and a Cloudflare rate-limiting rule can be added on top (§8).

### M6 results (2026-11-22)

- **`@talajs/admin`:** a React 19 + shadcn/ui app, built once and configured at runtime via `tala-admin.json`, with auth modes `access`, `oidc` (PKCE via `oauth4webapi`) and `token`.
  - **Screens:** overview; a web register (item grid, size and modifier picker enforcing group rules, client-side totals with the shared `priceOrder`, cash with change, open tab, add to an existing order); orders and tabs with voids, payments, completing, refunds and editing; customers with notes, tags and history; items, categories, modifier groups and tax rates; inventory with adjustments and history; stores with per-store availability and price overrides; registers (pairing codes, re-pair, revoke); the review queue; and the team.
  - Navigation and actions follow the member's role and store access. Screens are lazy-loaded; the entry chunk is about 150 kB gzipped.
- **`serveAdmin()`** serves `dist/` from Workers static assets under any base path. It rewrites `<base href>`, answers `tala-admin.json` from the Worker's env, falls back to the shell for in-app routes and 404s missing files.
  - Requests to the assets binding are built fresh. Forwarding the incoming request made the binding answer 404 when called from a Worker behind the asset router; the example tests caught this.
- The example worker serves the admin at `/admin` (`run_worker_first`), with `ADMIN_AUTH_MODE` choosing the sign-in mode.
- **Verified in a browser** (headless Chrome against `wrangler dev` and a local database):
  - every screen renders with no console errors or failed requests;
  - a register sale (two items, charge, cash with change, auto-complete) completes the order.
  - This run found and fixed two endpoints that return `{ data: [...] }` where the admin expected arrays (tags and store items), and a missing lazy-route fallback.
- **Tests:** 7 admin unit tests (money parsing, `serveAdmin`) and 3 example tests for the mounted admin. The workspace total is 137.
- `legacy/` (Vue admin, shared helpers, GraphQL schema) is deleted.
- **Not covered by automated tests:** the UI itself (no component or end-to-end suite yet). Playwright against `wrangler dev` would be the natural next step.

### M7 preparation (2026-11-22)

- **Scope:** npm `@talajs` (§7.1, §7.9).
- **Package metadata:** every package gets `publishConfig.access: public`, `homepage`, `bugs`, `keywords`, `engines`, a LICENSE copy, and a README (new for contracts). The admin package no longer ships the dev `tala-admin.json`.
- **Release tooling:**
  - `.changeset/first-release.md` bumps all four packages to 0.1.0 (fixed mode).
  - `scripts/publish.mjs` packs each package with pnpm, so `workspace:*` becomes real versions, publishes with the npm CLI (trusted publishing and provenance) in dependency order, skips versions already on npm, and prints `New tag:` lines for changesets.
  - `.github/workflows/release.yml` (changesets/action) opens the version PR and publishes on merge.
  - `RELEASING.md` covers the one-time setup.
- **Verified as an outside consumer**, without publishing: the four packed tarballs were installed into a fresh project outside the workspace.
  - The README's usage example typechecks with TypeScript 5.9 against the published `.d.ts`, and a deliberate type error is caught.
  - wrangler bundles it (1.56 MiB gzip).
  - The packaged `tala-db` CLI reads migration status.
  - Under `wrangler dev`, the API (56 OpenAPI paths), tenant creation and the admin at `/admin/` all work.
  - One consumer caveat, documented: with `@cloudflare/workers-types` and `skipLibCheck: false`, `@types/pg` pulls in `@types/node` and the globals clash. Use `wrangler types` (Cloudflare's current recommendation) or `skipLibCheck`.
- `docs/adapters.md` documents the auth, payment, mailer and event-hook interfaces.

### Built-in sign-in results (2026-11-24)

- **Spike (go).** Better Auth 1.7.27 runs in workerd with Tala's own Prisma client. A fresh Better Auth instance is created per request, the pattern Tala needs, with no hangs.
  - Through Hyperdrive and node-postgres: password sign-up, sign-in and get-session, plus magic link.
  - The AsyncLocalStorage fallback wasn't needed.
  - Costs: password sign-in about 90 ms, almost all scrypt CPU, which confirms decision 10's Workers Paid note. Magic-link request and verify take 12–37 ms.
  - Better Auth adds about 330 KiB gzip to a Worker.
  - The Neon driver is not yet exercised (no Neon project, §8). It sits below Prisma, so Better Auth sees the same client.
- **Migration `0002_better_auth`:**
  - `tala_auth` user, session, account, verification and rate_limit tables;
  - `tala.invitation`, with a partial unique index for one pending invite per email;
  - `tala.audit_log`;
  - membership `email`, `display_name`, `pin_digest` and `pin_set_at`;
  - terminal `pin_failures` and `pin_locked_until`; tenant `pin_length`;
  - a backfill of `staff` rows into the change feed for existing members.
- **`@talajs/api`:**
  - `Identity` gains `email`, `emailVerified` and `name`.
  - Invitation endpoints:
    - create, list, re-send (new token), revoke;
    - an unauthenticated preview, rate limited per IP;
    - accept, which requires the verified email to match and is single use under races.
  - PIN endpoints: set and clear, plus `/sync/pin` with a 5-strike, 15-minute lock per register.
  - The sync `staff` entity and `actorMembershipId` attribution.
  - `allowSelfServeTenants`, `PATCH` on the tenant (name, PIN length), the audit log, and `consumeRateLimit`.
  - Managers may now list members and invite staff to their own stores.
- **Deviations from the design doc:**
  - PINs are stored as `sha256(membershipId:pin)`, not PBKDF2. No hashing cost protects a 4–6 digit space, and the online check runs against every candidate member, so CPU matters on Workers Free.
  - The lockout counts per register, on the terminal row.
  - The admin calls Better Auth's endpoints with `fetch` instead of its React client, which keeps the bundle and dependency list small.
- **Admin:**
  - The `better-auth` mode, with sign-in, accept-invite with sign-up, forgot and reset password.
  - An account page: name, PIN, password, sessions, sign out everywhere.
  - Invitations on the Team page, a business switcher, and self-serve "create a business".
- **Example Worker:**
  - Merchants use Better Auth on the public host, operators use Access on `OPERATOR_HOST`.
  - A console mailer for local development.
  - An end-to-end test through the Worker's own export: invite, magic link, accept.
- **Tests:** contracts 20, db 18, api 94, auth 11, admin 7, example 11.

---

## 8. Open items for the maintainer

Things only the maintainer can do. Updated at each milestone; tick them off here.

**Before the first deploy**
- [ ] Cloudflare account; create a Hyperdrive config (`wrangler hyperdrive create`) and put its id in `examples/worker/wrangler.jsonc`.
- [ ] Merchant sign-in (§7.10): set `PUBLIC_ORIGIN` and `AUTH_FROM`; `wrangler secret put BETTER_AUTH_SECRET` (`openssl rand -base64 32`). It needs email to work at all, so the Resend item below becomes required.
- [ ] Operators: route a second hostname (`OPERATOR_HOST`) to the Worker and put a Cloudflare Access application on **that hostname only**; set `ACCESS_TEAM_DOMAIN` and `ACCESS_AUD`. Access must not cover the public hostname's `/admin` or `/tala`, or merchants can't reach the sign-in screen.
- [ ] `wrangler secret put TALA_SERVICE_TOKEN` (at least 32 random characters).
- [ ] The first owner: create the business with the service token and invite its owner by email (see `packages/auth/README.md`, "Setup").
- [ ] Queues: `wrangler queues create tala-events` and `wrangler queues create tala-events-dlq`.
- [ ] Run `tala-db migrate` against the production database (direct connection).

**Email (required for sign-in; also sends receipts)**
- [ ] Verify a sending domain in Resend; set `AUTH_FROM` and `RECEIPTS_FROM`, and `wrangler secret put RESEND_API_KEY`.

**Before 0.1.0 (M7)**
- [x] Claim the npm org: `@talajs` (2026-11-22; `@tala` was taken).
- [x] Public repository: `NovaDovaDao/talajs` (2026-11-23), with a fresh history.
- [x] Push the initial commit to `NovaDovaDao/talajs` (2026-11-23).
- [x] First publish: 0.1.0 of all four packages, from the maintainer's machine (2026-11-24; no provenance on this version).
- [x] npm trusted publishing for the four packages (2026-11-24; 0.1.1 was published by GitHub Actions with provenance). The trusted publisher's Environment field must be empty.

**Before 0.2.0 (built-in sign-in)**
- [ ] `@talajs/auth` is a new package, and npm can only set up trusted publishing for a package that exists. When the 0.2.0 version PR is merged, CI publishes the other four and then fails on `@talajs/auth` (it's published last for this reason). Then pull `main`, `npm login`, and run `pnpm release`: it skips what's already on npm and publishes `@talajs/auth`. Finally add its trusted publisher (Environment empty), as for the others.
- [ ] Workers plan: magic link is the default and runs on Free. Turn on password sign-in (`methods.password`, in both `createTalaAuth` and the admin config) only on Workers Paid.
- [ ] Create a Neon project, so the open M1 item can be checked: the WebSocket driver, cold start, and scale to zero (including Hyperdrive's pooled connections). Your first consumer uses Neon, so also try sign-in there with the `neon` driver (magic link, accept an invitation).
- [ ] Decide on multi-store stock (M3 known limitation): add a per-store link table before 0.1.0, or document it.

**Hardening (optional)**
- [ ] Add a Cloudflare rate-limiting rule for `POST */v1/terminal/pair` (for example 10 requests per minute per IP).

**Payments (when ready)**
- [ ] Ask the bank for the full ePay integration guide: auth scheme, base URLs, sandbox credentials, response codes, refund/void/status endpoints, and whether there's a hosted page or tokenization (see §7.7).
