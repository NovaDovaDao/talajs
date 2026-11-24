import pg from 'pg'

export const TEST_URL =
  process.env.TALA_TEST_DATABASE_URL ?? 'postgresql://localhost:5432/tala_test'

/** Drop everything Tala owns. Only ever pointed at a dedicated test database. */
export async function resetTalaSchema(url = TEST_URL): Promise<void> {
  if (!/test/i.test(new URL(url).pathname)) {
    throw new Error(`Refusing to reset a database whose name does not contain "test": ${url}`)
  }
  const client = new pg.Client({ connectionString: url })
  await client.connect()
  try {
    await client.query('DROP SCHEMA IF EXISTS tala CASCADE')
  } finally {
    await client.end()
  }
}

export async function query<T extends pg.QueryResultRow>(sql: string, params: unknown[] = []) {
  const client = new pg.Client({ connectionString: TEST_URL })
  await client.connect()
  try {
    return (await client.query<T>(sql, params)).rows
  } finally {
    await client.end()
  }
}
