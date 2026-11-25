# @talajs/auth

Optional built-in sign-in for the people who run a business on Tala: owners, managers and staff. Powered by [Better Auth](https://better-auth.com), running on Tala's own database client, inside your Worker.

- **Magic link by default.** People sign in with a link emailed to them. It needs no password hashing, so it runs on Workers Free.
- **Email and password, opt in.** Includes email confirmation and reset. Secure password hashing needs more CPU per request than Workers Free allows, so turn it on with Workers Paid.
- **Google, opt in.**
- **Invite-only.** Nobody can create an account without a pending invitation, unless you enable self-serve businesses.
- **Revocation is immediate.** Sessions live in the database, with no cookie cache: signing out everywhere, a password reset or a removed membership take effect on the next request.
- **Rate limited without extra infrastructure.** An atomic Postgres counter, keyed on Cloudflare's `cf-connecting-ip`, plus per-email limits on outgoing links.

Better Auth only answers *who is this person*. What they may do is decided by their Tala membership (OWNER, MANAGER or STAFF, and which stores), as for every other identity source.

```ts
import { createTalaApp } from '@talajs/api'
import { serviceToken } from '@talajs/api/auth/service-token'
import { resend } from '@talajs/api/email/resend'
import { createTalaAuth } from '@talajs/auth'
import { createDb } from '@talajs/db'
import { Hono } from 'hono'

const db = (env: Env) => createDb({ url: env.DATABASE_URL })   // or env.HYPERDRIVE.connectionString
const mailer = (env: Env) => resend({ apiKey: env.RESEND_API_KEY, from: 'Café <hello@cafe.example>' })

const auth = createTalaAuth<Env>({
  db,
  secret: (env) => env.BETTER_AUTH_SECRET,                 // wrangler secret put BETTER_AUTH_SECRET
  baseURL: (env) => `${env.PUBLIC_ORIGIN}/tala/auth`,
  mailer,
  appName: 'Café',
  methods: { magicLink: true, password: false },           // password: Workers Paid
})

const app = new Hono<{ Bindings: Env }>()
app.on(['GET', 'POST'], '/tala/auth/*', (c) => auth.handler(c.req.raw, c.env, c.executionCtx))
app.route('/tala', createTalaApp<Env>({
  db,
  auth: [auth.adapter, serviceToken({ token: (env) => env.TALA_SERVICE_TOKEN })],
  invitations: { acceptUrl: (token, env) => `${env.PUBLIC_ORIGIN}/admin/invite/${token}`, mailer },
}))
```

Serve the admin with `auth: { mode: 'better-auth', methods: { magicLink: true, password: false } }` in its runtime config (match `methods`), on the same origin.

## Setup

1. **Migrate.** `tala-db migrate` creates Better Auth's tables in the `tala_auth` schema (migration `0002`). People and sessions aren't tenant data, so they live apart from the `tala` schema.
2. **Secret.** `BETTER_AUTH_SECRET`: at least 32 random characters (`openssl rand -base64 32`). To rotate it without signing everyone out, see Better Auth's `BETTER_AUTH_SECRETS`.
3. **Email.** A mailer is required: without email nobody can sign in. Any `Mailer` from `@talajs/api` works; `resend()` is built in.
4. **Origins.** `baseURL`'s origin is trusted for CSRF checks. List any other origin that calls the handler in `trustedOrigins`.
5. **The first owner.** Provision a business with a service token (`POST /tala/v1/tenants`) and invite its owner (`POST /tala/v1/tenants/{id}/invitations` with `role: "OWNER"`). Or set `allowSelfServeTenants: true` on both `createTalaAuth` and `createTalaApp` to let anyone with a verified email create a business.

## Options

| Option | |
|---|---|
| `db` | The same per-request client factory as `createTalaApp`. |
| `secret` | `BETTER_AUTH_SECRET`. |
| `baseURL` | Public URL of the handler; its path is the mount point. |
| `trustedOrigins` | Other origins allowed to call the handler. |
| `mailer` | Sends sign-in links, confirmations and resets. |
| `appName`, `renderEmail` | Branding for the emails. |
| `methods` | `{ magicLink = true, password = false, google? }`. `google` takes `{ clientId, clientSecret }`. |
| `allowSelfServeTenants` | Let anyone sign up. Match `createTalaApp`. Default off: invite only. |
| `bearer` | Accept the session token as `Authorization: Bearer` (clients without cookies). Default off. |
| `configure` | Last word on the Better Auth options, for anything else. |

The adapter's identity is `{ kind: 'staff', subject: 'ba:<user id>', email, emailVerified, name }`. The `ba:` prefix can't collide with Cloudflare Access emails or OIDC subjects.

## Operators and Cloudflare Access

Don't put a Cloudflare Access application in front of the paths merchants use (`/admin`, `/tala`): they could never reach the sign-in screen. Route a second hostname to the same Worker for operators and protect that one with Access. Keep `cloudflareAccess()` in the adapter list; it only matches requests that carry an Access token. [`examples/worker`](../../examples/worker) does exactly this.

## Notes

- One Better Auth instance is created per request, on that request's database client. Workers can't share database connections between requests, even through Hyperdrive.
- Better Auth requires Prisma 7; Tala stays on Prisma 7 until Better Auth supports 8.
- Tested in workerd with node-postgres through Hyperdrive. The Neon serverless driver sits below Prisma, so Better Auth sees the same client either way.
