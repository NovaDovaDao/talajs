import { cp, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeEach, describe, expect, it } from 'vitest'
import { loadMigrations, MigrationError, migrate, status } from './migrate.js'
import { query, resetTalaSchema, TEST_URL } from './test/db.js'

const shipped = fileURLToPath(new URL('../migrations/', import.meta.url))

async function copyOfMigrations() {
  const dir = await mkdtemp(join(tmpdir(), 'tala-migrations-'))
  await cp(shipped, dir, { recursive: true })
  return dir
}

describe('tala-db migrate', () => {
  beforeEach(() => resetTalaSchema())

  it('applies shipped migrations once and records them in tala._migrations', async () => {
    const all = (await loadMigrations()).map((m) => m.name)
    expect(all[0]).toBe('0001_init')

    expect(await migrate({ url: TEST_URL })).toEqual(all)
    expect(await migrate({ url: TEST_URL })).toEqual([])

    const rows = await query<{ name: string }>('SELECT name FROM tala._migrations ORDER BY name')
    expect(rows.map((r) => r.name)).toEqual(all)
    // Tala never touches a consumer's Prisma history table.
    const prismaTables = await query(
      "SELECT 1 FROM information_schema.tables WHERE table_name = '_prisma_migrations'",
    )
    expect(prismaTables).toHaveLength(0)
  })

  it('serialises concurrent runs with an advisory lock', async () => {
    const results = await Promise.all([1, 2, 3].map(() => migrate({ url: TEST_URL })))
    expect(results.flat()).toEqual(['0001_init'])
  })

  it('reports status', async () => {
    expect((await status({ url: TEST_URL }))[0]?.appliedAt).toBeNull()
    await migrate({ url: TEST_URL })
    expect((await status({ url: TEST_URL }))[0]?.appliedAt).toBeInstanceOf(Date)
  })

  it('refuses when an applied migration has changed', async () => {
    const dir = await copyOfMigrations()
    await migrate({ url: TEST_URL, migrationsDir: dir })
    await writeFile(join(dir, '0001_init.sql'), '-- edited\nSELECT 1;')
    await expect(migrate({ url: TEST_URL, migrationsDir: dir })).rejects.toThrow(/modified/)
  })

  it('refuses when the database is ahead of this package', async () => {
    const dir = await copyOfMigrations()
    await writeFile(join(dir, '0002_future.sql'), 'SELECT 1;')
    await migrate({ url: TEST_URL, migrationsDir: dir })
    await expect(migrate({ url: TEST_URL })).rejects.toThrow(/does not know: 0002_future/)
  })

  it('rolls back a failing migration entirely', async () => {
    const dir = await copyOfMigrations()
    await writeFile(join(dir, '0002_broken.sql'), 'CREATE TABLE tala.half (id int); SELECT nope;')
    await expect(migrate({ url: TEST_URL, migrationsDir: dir })).rejects.toBeInstanceOf(
      MigrationError,
    )
    expect(
      await query("SELECT 1 FROM information_schema.tables WHERE table_name = 'half'"),
    ).toEqual([])
    const names = await query<{ name: string }>('SELECT name FROM tala._migrations')
    expect(names.map((r) => r.name)).toEqual(['0001_init'])
  })

  it('rejects badly named files', async () => {
    const dir = await copyOfMigrations()
    await writeFile(join(dir, 'oops.sql'), 'SELECT 1;')
    await expect(loadMigrations(dir)).rejects.toThrow(/Invalid migration file name/)
  })
})
