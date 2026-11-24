import { createHash } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import pg from 'pg'

/**
 * Tala's own migration runner. Consumers apply Tala's schema alongside their own without any
 * Prisma CLI and without touching their own migration history:
 *
 * - History lives in `tala._migrations` (name, checksum, applied_at).
 * - A session-level advisory lock serialises concurrent runs (parallel deploys, CI jobs).
 * - Each migration runs in its own transaction together with its history row.
 * - An applied migration whose file has changed is an error, as is a database that has
 *   migrations this version of @talajs/db doesn't know (it was migrated by a newer release).
 */

export const MIGRATIONS_TABLE = 'tala._migrations'
/** Arbitrary fixed key for pg_advisory_lock; "tala" in ASCII. */
const LOCK_KEY = 0x74616c61

const MIGRATION_FILE = /^(\d{4})_[a-z0-9_]+\.sql$/

export interface Migration {
  name: string
  checksum: string
  sql: string
}

export interface MigrationStatus {
  name: string
  checksum: string
  appliedAt: Date | null
}

export interface MigrateOptions {
  /** Postgres connection string (a direct, non-pooled URL is recommended for DDL). */
  url: string
  /** Defaults to the migrations shipped with this package. */
  migrationsDir?: string
  log?: (message: string) => void
}

export class MigrationError extends Error {
  override name = 'MigrationError'
}

const defaultMigrationsDir = () => fileURLToPath(new URL('../migrations/', import.meta.url))

export function checksum(sql: string): string {
  return createHash('sha256').update(sql.replace(/\r\n/g, '\n')).digest('hex')
}

export async function loadMigrations(dir: string = defaultMigrationsDir()): Promise<Migration[]> {
  const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort()
  const migrations: Migration[] = []
  const seen = new Set<string>()
  for (const file of files) {
    const match = MIGRATION_FILE.exec(file)
    if (!match?.[1]) throw new MigrationError(`Invalid migration file name: ${file}`)
    if (seen.has(match[1])) throw new MigrationError(`Duplicate migration number: ${match[1]}`)
    seen.add(match[1])
    const sql = await readFile(`${dir.replace(/\/?$/, '/')}${file}`, 'utf8')
    migrations.push({ name: file.replace(/\.sql$/, ''), checksum: checksum(sql), sql })
  }
  return migrations
}

async function withLockedClient<T>(url: string, fn: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: url })
  await client.connect()
  try {
    await client.query('SELECT pg_advisory_lock($1)', [LOCK_KEY])
    try {
      await client.query('CREATE SCHEMA IF NOT EXISTS tala')
      await client.query(`CREATE TABLE IF NOT EXISTS ${MIGRATIONS_TABLE} (
        name text PRIMARY KEY,
        checksum text NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now()
      )`)
      return await fn(client)
    } finally {
      await client.query('SELECT pg_advisory_unlock($1)', [LOCK_KEY])
    }
  } finally {
    await client.end()
  }
}

async function readApplied(client: pg.Client) {
  const { rows } = await client.query<{ name: string; checksum: string; applied_at: Date }>(
    `SELECT name, checksum, applied_at FROM ${MIGRATIONS_TABLE} ORDER BY name`,
  )
  return new Map(rows.map((r) => [r.name, r]))
}

function verify(migrations: Migration[], applied: Awaited<ReturnType<typeof readApplied>>) {
  const known = new Set(migrations.map((m) => m.name))
  const unknown = [...applied.keys()].filter((name) => !known.has(name))
  if (unknown.length > 0) {
    throw new MigrationError(
      `Database has migrations this version of @talajs/db does not know: ${unknown.join(', ')}. ` +
        'Upgrade @talajs/db before running against this database.',
    )
  }
  for (const m of migrations) {
    const row = applied.get(m.name)
    if (row && row.checksum !== m.checksum) {
      throw new MigrationError(`Migration ${m.name} was modified after being applied`)
    }
  }
}

/** Apply all pending migrations. Returns the names of migrations applied by this call. */
export async function migrate(options: MigrateOptions): Promise<string[]> {
  const log = options.log ?? (() => {})
  const migrations = await loadMigrations(options.migrationsDir)
  return withLockedClient(options.url, async (client) => {
    const applied = await readApplied(client)
    verify(migrations, applied)
    const pending = migrations.filter((m) => !applied.has(m.name))
    for (const m of pending) {
      log(`applying ${m.name}`)
      await client.query('BEGIN')
      try {
        await client.query(m.sql)
        await client.query(`INSERT INTO ${MIGRATIONS_TABLE} (name, checksum) VALUES ($1, $2)`, [
          m.name,
          m.checksum,
        ])
        await client.query('COMMIT')
      } catch (error) {
        await client.query('ROLLBACK')
        throw new MigrationError(`Migration ${m.name} failed: ${(error as Error).message}`, {
          cause: error,
        })
      }
    }
    log(pending.length === 0 ? 'up to date' : `applied ${pending.length} migration(s)`)
    return pending.map((m) => m.name)
  })
}

export async function status(options: Omit<MigrateOptions, 'log'>): Promise<MigrationStatus[]> {
  const migrations = await loadMigrations(options.migrationsDir)
  return withLockedClient(options.url, async (client) => {
    const applied = await readApplied(client)
    verify(migrations, applied)
    return migrations.map((m) => ({
      name: m.name,
      checksum: m.checksum,
      appliedAt: applied.get(m.name)?.applied_at ?? null,
    }))
  })
}
