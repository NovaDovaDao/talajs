# @talajs/admin

Tala's admin web app: React 19, Vite, Tailwind 4 and [shadcn/ui](https://ui.shadcn.com). It's a static build configured at runtime, so one published `dist/` works for every deployment.

## Screens

| Section | What it covers |
|---|---|
| Overview | Today's sales and tips, open tabs, out-of-stock items, the review count |
| Register | A web point of sale: item grid by category, size and modifier picker, live totals (the same `priceOrder` the server uses), charge cash with change, open a tab, or add to an existing order |
| Orders & tabs | Open tabs, open, completed and voided orders; an order page with lines, voids, cash payments, completing, refunds and the customer link |
| Customers | Search and tag filter; a customer page with contact details, notes and order history |
| Items, Categories, Modifiers, Tax rates | The menu: items with variants (sizes), categories, modifier groups with selection rules, stock links and tax |
| Inventory | Stock per store: receive, adjust, recount, and the movement history |
| Stores | Locations, and per store which items are sold and at what price |
| Registers | Pair a register with a one-time code, re-pair, revoke, last seen |
| Review queue | What registers recorded offline that needs a person: conflicts, stock below zero, payment mismatches |
| Team | Members, roles and store access (owners only) |

What a screen shows follows the signed-in member's role and stores, matching what the API allows.

## Serving it

Serve `dist/` from Workers static assets with `serveAdmin` (exported from `@talajs/admin`). It mounts the admin under any path, answers `tala-admin.json` from your Worker's env, and falls back to the app shell for in-app routes:

```ts
import { serveAdmin } from '@talajs/admin'

const admin = serveAdmin<Env>({
  basePath: '/admin',
  assets: (env) => env.ADMIN,
  config: { apiBase: '/tala', auth: { mode: 'access' } },
})
app.all('/admin/*', (c) => admin(c.req.raw, c.env))
```

```jsonc
// wrangler.jsonc
"assets": { "directory": "node_modules/@talajs/admin/dist", "binding": "ADMIN", "run_worker_first": true }
```

`run_worker_first` matters: without it, the asset layer could answer requests meant for the API or your own routes.

## Runtime config (`tala-admin.json`)

```json
{ "apiBase": "/tala", "auth": { "mode": "access" } }
```

| `auth.mode` | Sign-in |
|---|---|
| `access` | Cloudflare Access protects the admin and the API; the browser's Access cookie does the rest. |
| `oidc` | Authorization code + PKCE with any OIDC provider: `{ "mode": "oidc", "issuer": "…", "clientId": "…", "audience"?: "…" }`. Register `<admin URL>/auth/callback` as a redirect URI. |
| `token` | Paste a bearer token (a service token or an OIDC access token). For development. |

## Development

```sh
pnpm dev     # Vite on :5173, proxying /tala to the example worker on :8787
pnpm build   # dist/ (the app) and server/ (serveAdmin)
pnpm test
```

Components live in `src/components/ui` and are managed by the shadcn CLI (`pnpm exec shadcn add <component>`). The repo's `.mcp.json` registers the shadcn MCP server for Claude Code, pointed at this package.
