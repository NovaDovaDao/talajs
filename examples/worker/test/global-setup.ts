// Runs in Node before the workerd test pool starts: bring tala_test to the current schema.
import { migrate } from '@talajs/db/migrate'
import pg from 'pg'

export default async function setup() {
  const url = process.env.TALA_TEST_DATABASE_URL ?? 'postgresql://localhost:5432/tala_test'
  const client = new pg.Client({ connectionString: url })
  await client.connect()
  await client.query('DROP SCHEMA IF EXISTS tala, tala_auth CASCADE')
  await client.end()
  await migrate({ url })
}
