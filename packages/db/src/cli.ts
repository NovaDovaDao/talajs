#!/usr/bin/env node
import { parseArgs } from 'node:util'
import { MigrationError, migrate, status } from './migrate.js'

const USAGE = `Usage: tala-db <command> [--url <postgres-url>]

Commands:
  migrate   Apply pending Tala migrations (history in tala._migrations)
  status    List Tala migrations and whether each is applied

The URL defaults to $TALA_DATABASE_URL, then $DATABASE_URL.
Use a direct (non-pooled) connection for migrations.`

async function main(): Promise<number> {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: { url: { type: 'string' }, help: { type: 'boolean', short: 'h' } },
  })
  const command = positionals[0]
  if (values.help || !command) {
    console.log(USAGE)
    return command || values.help ? 0 : 1
  }
  const url = values.url ?? process.env.TALA_DATABASE_URL ?? process.env.DATABASE_URL
  if (!url) {
    console.error('No database URL: pass --url or set TALA_DATABASE_URL / DATABASE_URL')
    return 1
  }

  switch (command) {
    case 'migrate':
      await migrate({ url, log: (m) => console.log(`tala-db: ${m}`) })
      return 0
    case 'status':
      for (const m of await status({ url })) {
        console.log(`${m.appliedAt ? 'applied' : 'pending'}  ${m.name}`)
      }
      return 0
    default:
      console.error(`Unknown command: ${command}\n\n${USAGE}`)
      return 1
  }
}

main().then(
  (code) => {
    process.exitCode = code
  },
  (error: unknown) => {
    console.error(error instanceof MigrationError ? `tala-db: ${error.message}` : error)
    process.exitCode = 1
  },
)
