# Tala

**A lean, multi-tenant commerce core for cafés and lounges.** It covers the catalog (with variants and modifiers), tabs, orders, payments, customers and offline POS sync. Mount it in your own Cloudflare Worker.

> **Status: pre-release (0.x).** The design, milestones and decisions are in [`docs/PLAN.md`](docs/PLAN.md). Until 1.0, minor versions may include breaking changes.

## Why Tala

- **Embeddable, not a platform.** Tala is a Hono app factory you mount next to your own routes. It brings no frontend opinions or business logic of its own, and has no lock-in.
- **Cheap to run.** It's built for Cloudflare Workers and Queues, with Postgres over Neon's serverless driver or Hyperdrive. There are no always-on servers or connections, so an idle deployment costs close to nothing.
- **Café-shaped domain.** Sizes, milk choices and extra shots; open tabs; voids and refunds; split tender. Cash is built in; card and crypto processors plug in as payment adapters.
- **Offline-first registers.** Terminals sell without the cloud and sync later. The server deduplicates every mutation, and conflicts land in a review queue instead of disappearing.
- **Multi-tenant from the start.** Every row is tenant-scoped, and the scoping is enforced in one place and backed by database constraints.
- **Sign-in for the people who use it.** Optional built-in sign-in (`@talajs/auth`, on Better Auth): owners invite staff by email, and people sign in with an emailed link. Nobody has to set up an identity provider.
- **Pluggable edges.** Auth (built-in sign-in, Cloudflare Access, OIDC or your own), payment processors and email (Resend) are adapters.
- **Admin included.** A React admin (register, orders and tabs, menu, inventory, customers, registers, review queue, team) ships as a static build you serve from the same Worker.

## Usage

```ts
import { serveAdmin } from '@talajs/admin'
import { createTalaApp, createTalaConsumer } from '@talajs/api'
import { cloudflareAccess } from '@talajs/api/auth/cloudflare-access'
import { resend } from '@talajs/api/email/resend'
import { createDb } from '@talajs/db'
import { Hono } from 'hono'

const db = (env: Env) => createDb({ url: env.HYPERDRIVE.connectionString })
const app = new Hono<{ Bindings: Env }>()

app.route('/tala', createTalaApp<Env>({
  db,
  auth: cloudflareAccess({ teamDomain: 'example.cloudflareaccess.com', audience: '…' }),
  events: { queue: (env) => env.TALA_EVENTS },
}))

const admin = serveAdmin<Env>({
  basePath: '/admin',
  assets: (env) => env.ADMIN,
  config: { apiBase: '/tala', auth: { mode: 'access' } },
})
app.all('/admin/*', (c) => admin(c.req.raw, c.env))

export default {
  fetch: app.fetch,
  queue: createTalaConsumer<Env>({
    db,
    receipts: { mailer: (env) => resend({ apiKey: env.RESEND_API_KEY, from: 'Café <receipts@cafe.example>' }) },
  }),
}
```

For built-in sign-in instead of Cloudflare Access, see [`@talajs/auth`](packages/auth). [`examples/worker`](examples/worker) is a complete reference deployment: `wrangler.jsonc`, queues, cron, the admin, built-in sign-in for merchants and Access for operators.

Tala keeps its tables in their own Postgres schema (`tala`) with its own migration history, so you can apply its migrations alongside yours:

```sh
npx tala-db migrate --url "$DATABASE_URL"
```

## Packages

| Package | Purpose |
|---|---|
| `@talajs/contracts` | Zod schemas and types for the API, money and tax math, and the sync protocol |
| `@talajs/db` | Prisma schema, SQL migrations, the `tala-db` CLI, and a tenant-scoped client |
| `@talajs/api` | Hono app factory, queue consumer, and auth/payment/email adapters |
| `@talajs/auth` | Optional built-in sign-in for merchants and staff (Better Auth) |
| `@talajs/admin` | Static admin UI, deployable on Workers static assets |

## Development

```sh
pnpm install
pnpm check      # lint, typecheck, test
```

Requires Node 24+ and pnpm 11+. DB tests need a local Postgres. They default to `postgresql://localhost:5432/tala_test`, or set `TALA_TEST_DATABASE_URL`. **The tests drop and recreate the `tala` schema in that database**, and refuse to run unless its name contains `test`.

### Running it locally

```sh
createdb tala_dev
pnpm build
node packages/db/dist/cli.js migrate --url postgresql://localhost:5432/tala_dev

cd examples/worker
printf 'TALA_SERVICE_TOKEN=%s\nBETTER_AUTH_SECRET=%s\nPUBLIC_ORIGIN=http://localhost:8787\nADMIN_AUTH_MODE=token\n' \
  "$(openssl rand -hex 24)" "$(openssl rand -hex 24)" > .dev.vars
CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE=postgresql://localhost:5432/tala_dev pnpm dev
```

Open http://localhost:8787/admin/, sign in with the service token from `.dev.vars`, and create a business. To try built-in sign-in, remove `ADMIN_AUTH_MODE=token` and restart. Invite yourself from the Team page first: the sign-in and invitation links are printed in the `wrangler dev` log, since no `RESEND_API_KEY` is set. For admin development with hot reload, run `pnpm dev` in `packages/admin` as well (it proxies `/tala` to the worker) and use http://localhost:5173/.

## Acknowledgements

Thanks to Michael Yenny, an early contributor to the original version of Tala.

## License

[Apache-2.0](LICENSE)
