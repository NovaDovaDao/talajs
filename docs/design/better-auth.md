# Design: built-in merchant sign-in with Better Auth

Status: **draft, awaiting review** (2026-11-24). Nothing here is implemented yet.

## 1. Why

Today staff identity comes only from Cloudflare Access, OIDC or a service token, and `docs/PLAN.md` §2.2 says "Tala never issues its own staff sessions." That suits platform operators and enterprises with an identity provider. It doesn't suit the people who use Tala day to day: a café owner can't be expected to set up a Zero Trust application or an IdP, and baristas need to sign up from an invite and reset a forgotten password on their own.

**Decision (proposed):** add an optional, first-party Better Auth integration. It becomes the default way merchant owners and staff sign in. Access, OIDC and service tokens stay for operators, automation and enterprises. PLAN.md gets a new decision recording the reversal.

**What doesn't change:** Better Auth answers only "who is this person?". Authorization stays in Tala's `membership` table (OWNER, MANAGER or STAFF, plus `storeIds`), checked on every request as today. Better Auth's organization plugin is not used (§6).

## 2. What the docs say (Better Auth 1.7.28, checked 2026-11-24)

| Topic | Finding | Consequence for Tala |
|---|---|---|
| Workers | Official Cloudflare guide; needs `nodejs_compat` (default from compatibility date 2026-08-04). Uses `node:crypto` and `AsyncLocalStorage`. | Fine: Tala already requires `nodejs_compat`. |
| DB connections | "An auth instance at module scope cannot hold a client that keeps connections open, such as a `pg` … pool, even through Hyperdrive." Several Workers bugs were fixed in the last weeks, including hangs with instances created inside a request (#12396, #12397). | Tala already creates one DB client per request (§4.2). The integration must use that client, and the spike in §9 tests the per-request pattern before anything else is built. |
| Prisma adapter | `prismaAdapter(prisma, { provider: 'postgresql' })`, documented with Prisma 7 and `@prisma/adapter-pg`. Prisma 8 is **not** supported yet (#9636). | Use the Prisma adapter with Tala's own per-request client, for `pg` and Neon alike (the driver sits below Prisma). Tala stays on Prisma 7 until Better Auth supports 8. |
| Migrations | Hand-written SQL is supported ("If you prefer adding tables manually, you can do that as well"). The CLI is optional. | Tables come from Tala's SQL migrations and `tala-db`, as the brief requires. |
| Schema control | Table and column names configurable (`modelName`, `fields`); ids via `advanced.database.generateId` (custom function or `'uuid'`). | snake_case columns, UUIDv7 ids, dedicated Postgres schema (§4.1). |
| Passwords | scrypt by default. Custom `emailAndPassword.password.{hash, verify}` supported. No guidance on Workers CPU limits. | Open question 6: secure password hashing needs more than the 10 ms CPU of Workers Free. |
| Sessions | DB-backed sessions, opaque signed token in an httpOnly cookie, SameSite=Lax, Secure in production. `cookieCache` (off by default) can serve a revoked session until it expires. `revokeSessions()` = sign out everywhere; `emailAndPassword.revokeSessionsOnPasswordReset`. | Keep `cookieCache` **off**, so revocation is effective on the next request. |
| CSRF | Every request to the handler has its `Origin` checked against `baseURL`'s origin plus `trustedOrigins`. | Same-origin admin works with no extra origins; consumers list any others. |
| Bearer | `bearer()` plugin: session token in `Authorization`, returned in a `set-auth-token` header. Docs: only "for APIs that don't support cookies". | Supported in the adapter, but off unless a consumer enables it. |
| Rate limiting | Default storage is per-isolate memory (useless on Workers). KV is explicitly ruled out (eventually consistent, no atomic ops). A `customStorage.consume(key, rule)` hook must check and increment atomically. The client IP must come from `cf-connecting-ip`. | Implement `consume` as one atomic Postgres upsert (§7). Optionally use Cloudflare's Rate Limiting binding in front. |
| Sign-up gating | `databaseHooks.user.create.before` can throw `APIError` to refuse creating a user, for every sign-up method. | Invite-only sign-up (§5.3). |
| Secret | `secret` / `BETTER_AUTH_SECRET`, required in production; versioned rotation via `secrets`/`BETTER_AUTH_SECRETS`. | The only new secret. |

## 3. Packaging: a separate `@talajs/auth` package (recommended)

- **Dependencies stay optional.** `better-auth` and its dependencies are only installed by consumers who want built-in sign-in. A subpath of `@talajs/api` would make every consumer install them, even Access-only operators. The fixed version group keeps `@talajs/auth` in lockstep with the other packages.
- **The split follows the boundary in §1.**
  - `@talajs/auth`: Better Auth wiring, i.e. the handler, the `AuthAdapter`, the email templates and the rate-limit store.
  - `@talajs/api`: everything about authorization, i.e. invitations, memberships, staff PINs and `/v1/me`. These work with any identity source.
  - `@talajs/db`: all tables, in the one migration history.

```ts
import { createTalaAuth } from '@talajs/auth'

const auth = createTalaAuth<Env>({
  db,                                   // the same per-request createDb as createTalaApp
  secret: (env) => env.BETTER_AUTH_SECRET,
  baseURL: (env) => `${env.PUBLIC_ORIGIN}/tala/auth`,   // basePath comes from the URL path
  trustedOrigins: [],                   // same origin is always trusted
  mailer: (env) => resend({ apiKey: env.RESEND_API_KEY, from: 'Café <hello@cafe.example>' }),
  methods: { password: true, magicLink: true, google: undefined },
})

app.on(['GET', 'POST'], '/tala/auth/*', (c) => auth.handler(c.req.raw, c.env, c.executionCtx))

app.route('/tala', createTalaApp<Env>({
  db,
  auth: [auth.adapter, cloudflareAccess({ … }), serviceToken({ … })],
  invitations: { mailer: … },           // invite emails
  allowSelfServeTenants: false,
}))
```

`auth.adapter` resolves the Better Auth session from the cookie (or a bearer token, if enabled) and returns `{ kind: 'staff', subject: 'ba:<userId>', email, emailVerified, name }`. The `ba:` prefix can't collide with Access emails or OIDC `sub`s.

`Identity` gains optional `email`, `emailVerified` and `name` fields:
- Access sets them from the verified email.
- OIDC sets them from the `email` and `email_verified` claims.

That makes invitations (§5) work for every identity source, not only Better Auth.

## 4. Storage

### 4.1 A dedicated `tala_auth` schema (recommended)

Better Auth's `user`, `session`, `account`, `verification` and `rate_limit` tables live in a new Postgres schema, `tala_auth`. Reasons:

- **They aren't tenant data.** A person belongs to several businesses. The `tala` schema's rule, that every table has `tenant_id` and composite foreign keys, doesn't apply to them, and a separate schema makes that boundary visible.
- **Separate permissions:** operators can grant or restrict access to credentials (password hashes, OAuth tokens) independently of business data.
- **Clear ownership:** Better Auth's shape changes with its releases. Keeping it apart limits how far those changes reach.

Columns are snake_case (via Better Auth's `fields` mapping) and ids are UUIDv7 (`generateId`).

All of this is created by migration **`0002_better_auth.sql`**, applied by `tala-db` like any other, so consumers who don't use `@talajs/auth` simply have empty tables. Prisma models for these tables live in `schema.prisma` under `@@schema("tala_auth")`, so the adapter can use Tala's generated client. A test compares our columns with Better Auth's expected schema (via its schema check) so upgrades can't drift silently.

### 4.2 Per-request client

Workers can't share connections across requests, and Tala already creates and disposes one DB client per request. Two ways to give that client to Better Auth:

- **(a) A Better Auth instance per request**, built around that request's client. Simple, but this is where the recent Workers hang bugs were.
- **(b) One module-scope instance** whose Prisma adapter is handed a proxy that resolves to the *current request's* client through `AsyncLocalStorage`. Better Auth then never sees a connection that outlives a request.

The spike (§9, step 1) tries (a) first and falls back to (b), testing each under workerd with both `pg` (Hyperdrive) and the Neon WebSocket driver.

## 5. Invitations and memberships (in `@talajs/api`, any identity source)

### 5.1 Tables (migration `0002`)

**`tala.invitation`** (tenant-scoped):

| Column | Notes |
|---|---|
| `id`, `tenant_id` | |
| `email` | lower-cased |
| `role`, `store_ids` | what the membership will get |
| `token_hash` | sha256 of the token; the token itself is only in the email |
| `expires_at` | default 7 days |
| `invited_by` | |
| `accepted_at`, `accepted_by` | |
| `revoked_at` | |
| `last_sent_at`, `send_count` | for re-sending |

At most one pending invite per (tenant, email).

**`tala.membership`** gains:
- `email` and `display_name`, so the Team screen and registers can show people. Today's subjects like `ba:<uuid>` are unreadable.
- PIN columns (§8).

**`tala.audit_log`** (tenant-scoped, append-only): `id`, `tenant_id`, `actor`, `action`, `subject_type`, `subject_id`, `details`, `created_at`. Actions:
- `invitation.created`, `.resent`, `.revoked`, `.accepted`;
- `membership.created`, `.updated`, `.revoked`;
- `pin.set`, `pin.locked`.

Sign-ins aren't tenant-scoped, so they're recorded by Better Auth's session rows (IP, user agent, time). An optional hook can forward them elsewhere.

### 5.2 Endpoints

- `POST /v1/tenants/{t}/invitations`: create an invite and email a link.
  - MANAGER+ may invite STAFF; only OWNER may invite MANAGER or OWNER.
  - A manager limited to some stores can only grant those stores.
- `GET …/invitations`, `POST …/invitations/{id}/resend` (new token, old one invalid), `POST …/invitations/{id}/revoke`.
- `GET /v1/invitations/{token}`: unauthenticated preview (business name, role, the invited email masked) for the accept screen. Rate-limited.
- `POST /v1/invitations/accept { token }`: requires a signed-in identity whose **verified** email equals the invite's email (case-insensitive).
  - It creates the membership for `subject` (e.g. `ba:<userId>`), or reactivates a revoked one.
  - A single conditional update makes the token single-use.
  - A mismatched or unverified email gets 403 with a clear code (`email_mismatch`, `email_unverified`).

### 5.3 Invite-only sign-up

With `allowSelfServeTenants` off, `databaseHooks.user.create.before` refuses to create a Better Auth user unless a pending, unexpired invitation exists for that email in any tenant. This holds for every method: password, magic link and Google. People without an invite can't create accounts, so there's nothing to spam.

### 5.4 Several businesses

`/v1/me` already lists memberships, so the admin's business picker becomes a switcher in the sidebar. `me` also gains `name` and `email`.

### 5.5 Revocation

- **Revoking a membership** takes effect on the next request; the tenant middleware already checks it.
- **"Sign out everywhere"** calls Better Auth's `revokeSessions`. Password reset revokes all sessions (`revokeSessionsOnPasswordReset: true`).
- `cookieCache` stays off, so no revoked session outlives its next request.

## 6. Why not Better Auth's organization plugin

It brings its own `organization`, `member` and `invitation` tables and its own roles (owner/admin/member, stored as strings). Using it would mean two role systems kept in sync, two sources of truth for "who may do what", and tenancy logic outside Tala's tenant-scoped database layer. Its invitation flow is the only appealing part, and it's small enough (§5) to own outright, with the same verified-email rule.

## 7. Rate limiting on Workers

- **Store:** Better Auth's `customStorage.consume(key, rule)` is implemented as **one atomic Postgres statement** on `tala_auth.rate_limit`:
  ```sql
  INSERT … ON CONFLICT (key) DO UPDATE
  SET count = CASE WHEN window expired THEN 1 ELSE count + 1 END
  RETURNING count, window_start
  ```
  That's exact across isolates, needs no extra infrastructure, and costs one round trip on auth endpoints only.
- **Client IP:** taken from `cf-connecting-ip` (`advanced.ipAddress.ipAddressHeaders`). Cloudflare sets it at the edge.
- **Rules:**
  - sign-in: 5 per minute per IP and per email;
  - sign-up: 3 per minute per IP;
  - password reset and magic link: 3 per 10 minutes per email;
  - invitation preview: 20 per minute per IP.
- **Optional:** consumers on the Workers Paid plan can add Cloudflare's Rate Limiting binding as a cheap first line in front. It's per location and approximate, so it complements Postgres rather than replacing it.

## 8. Staff PINs on registers

The terminal token authenticates the *device*. A PIN identifies the *person* at a shared counter, for attribution (`actor` on orders, voids, payments).

- **Storage:** `membership.pin_hash` holds PBKDF2-SHA256 (WebCrypto) with a per-membership random salt; plus `pin_failed_attempts` and `pin_locked_until`. A PIN is set by the member in the admin, or reset by a manager, and is unique within the store, so a PIN alone can pick the person.
- **Online check:** `POST /v1/tenants/{t}/sync/pin` (terminal token) takes `{ pin }` and returns the matching member.
  - 5 failures in a row lock that register's PIN entry for 15 minutes, and the attempts go to the audit log.
  - Manager-only actions are checked online here.
- **Offline: attribution, not authorization.**
  - The pull feed sends registers a `staff` entity: membership id, display name, role, and the PIN verifier.
  - **Anyone holding the register's storage can brute-force a 4–6 digit PIN from its verifier in seconds.** No hashing cost fixes that for so few digits.
  - So offline, a PIN only *attributes* an action. Mutations carry `actorMembershipId`, and the server records `actor = 'pin:<membershipId>@terminal:<id>'`.
- **Manager-only actions while offline** must not be trusted on the strength of a PIN:
  - voids after completion and refunds are already conflicts or unavailable in sync;
  - any new manager-only mutation type goes to the review queue when made offline.
- This all gets documented in `docs/sync-protocol.md`.

## 9. Plan of work (after your OK)

1. **Spike (go/no-go):**
   - Better Auth 1.7.x in workerd with Tala's per-request Prisma client, (a) then (b) from §4.2.
   - Under both `pg`/Hyperdrive and the Neon WebSocket driver.
   - Measure sign-up and sign-in CPU time and the bundle size.
   - If the Prisma adapter doesn't work cleanly, report back before going further (the alternative is Better Auth's Kysely adapter over the same driver).
2. Migration `0002`: the `tala_auth` schema and tables, invitations, the membership columns, `audit_log`.
3. `@talajs/auth`: `createTalaAuth`, the adapter, the rate-limit store, email templates (verification, reset, magic link).
4. `@talajs/api`: `Identity` email fields, invitations, the audit log, `/v1/me` additions, PINs plus the sync `staff` entity and `/sync/pin`, `allowSelfServeTenants`.
5. Admin:
   - an `auth.mode: 'better-auth'` (Better Auth React client, same origin);
   - sign-in, accept-invite sign-up, forgot and reset password, verify email;
   - the business switcher;
   - an Account screen (password, sessions, sign out everywhere, PIN);
   - Team invites (send, re-send, revoke).
6. Example worker: Better Auth for staff at `/tala/auth`, operators via a separate Access-protected hostname (see question 7).
7. Docs (PLAN decision 10, READMEs, the auth table, sync protocol) and a minor changeset.

Tests in workerd cover the brief's list: session validation, invite accept with a matching email and rejection on a mismatch, cross-tenant isolation, revocation, PIN lockout. They also cover invite-only sign-up and the rate limiter's atomicity under concurrency.

## 10. Open questions

1. **Package:** a separate `@talajs/auth` (recommended, §3) or a subpath of `@talajs/api`?
2. **Schema:** a dedicated `tala_auth` (recommended, §4.1) or the `tala` schema?
3. **Sign-in methods first:** email + password (with verification and reset) plus magic link, as you suggested. Google is wired but off by default. Agreed?
4. **Self-serve business sign-up:** recommend shipping the `allowSelfServeTenants` flag (default off) in this release. It's small: a verified-email check, the creator becomes OWNER, at most N businesses per person. Or defer?
5. **PIN policy:**
   - 4–6 digits, 4 by default and configurable per tenant;
   - unique within a store;
   - 5 failures → 15-minute lock per register;
   - a manager can reset a PIN.
   OK?
6. **Workers plan and password hashing (new).** Secure password hashing (scrypt or PBKDF2 at recommended strength) takes far more than Workers Free's 10 ms CPU per request, so password sign-in effectively needs **Workers Paid**. Magic link and email codes involve no hashing and work on Free. Options:
   - (a) require Paid for password sign-in and document it;
   - (b) make magic link the default and password opt-in;
   - (c) weaken hashing (not recommended).
   Which plan is your first consumer on?
7. **Operators vs merchants on one hostname (new).** If Cloudflare Access protects `/admin` or `/tala`, merchants can never reach the Better Auth sign-in. Recommendation:
   - merchants use the public hostname with Better Auth;
   - operators use a separate Access-protected hostname routed to the same Worker, or service tokens and OIDC.
   OK?
8. **Audit log scope (new):** a tenant-scoped `audit_log` table for invitations, memberships and PINs (§5.1), with sign-in history from Better Auth's sessions. Enough, or should sign-ins be copied into the audit log too?
