# @talajs/contracts

## 0.1.1

### Patch Changes

- e5f4fb8: Published `package.json` files no longer declare the development-only `@talajs/source` export condition, which pointed at TypeScript sources that aren't included in the packages.

## 0.1.0

### Minor Changes

- 5ab3a14: First public release. `@talajs/api` is a mountable Hono API for Cloudflare Workers covering tenancy, catalog, inventory, customers, orders and tabs, cash payments and refunds, a domain-event queue with Resend receipts, and offline register sync with a review queue. `@talajs/db` ships the Postgres schema, migrations and the `tala-db` CLI; `@talajs/contracts` the shared Zod schemas, pricing and ids; `@talajs/admin` the React admin and `serveAdmin()`.
