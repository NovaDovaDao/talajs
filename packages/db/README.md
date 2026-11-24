# @talajs/db

Tala's Postgres schema (everything lives in the `tala` schema), SQL migrations, the `tala-db` migration CLI, and a tenant-scoped Prisma client.

## Applying migrations (consumers)

```sh
npx tala-db migrate --url "$DIRECT_DATABASE_URL"   # or set TALA_DATABASE_URL
npx tala-db status
```

History is recorded in `tala._migrations`. Tala never reads or writes your own migration tables, so run `tala-db migrate` alongside your own tool, in either order. Use a direct (non-pooled) connection for DDL. Releases that add migrations say so in the changelog.

From code (Node):

```ts
import { migrate } from '@talajs/db/migrate'
await migrate({ url, log: console.log })
```

## Using the client

```ts
import { createDb } from '@talajs/db'          // resolves the workerd client under wrangler

const db = createDb({ url: env.HYPERDRIVE.connectionString })  // driver: 'pg' | 'neon'
try {
  const t = db.forTenant(tenantId)           // every query is scoped to this tenant
  await t.item.findMany()
} finally {
  ctx.waitUntil(db.dispose())
}
```

`db.client` is unscoped. Reserve it for system work such as webhook ingestion and tenant provisioning. The tenant boundary is described in `src/tenant.ts`.

## Changing the schema (Tala contributors)

1. Edit `prisma/schema.prisma`.
2. Bring a scratch database to the current release: `TALA_DATABASE_URL=… pnpm exec tala-db migrate` (after `pnpm build`).
3. Generate the next migration from that database:
   `TALA_DEV_DATABASE_URL=… pnpm migration:diff > migrations/000N_<name>.sql`.
4. Review the SQL, and add any CHECK constraints or data backfills by hand.
5. Never edit a migration that has been released. The runner refuses to run if a checksum changes.

Tests (`pnpm test`) need a Postgres database whose name contains `test`. They default to `postgresql://localhost:5432/tala_test`, or set `TALA_TEST_DATABASE_URL`. The tests drop and recreate the `tala` schema in it.
