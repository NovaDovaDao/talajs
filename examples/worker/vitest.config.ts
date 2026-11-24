import { userInfo } from 'node:os'
import { cloudflareTest } from '@cloudflare/vitest-plugin'
import { defineConfig } from 'vitest/config'

// Miniflare's Hyperdrive requires credentials in the URL. Local Postgres installs often use
// trust auth for the OS user, so fill in that user and a placeholder password (ignored by trust).
const databaseUrl = (() => {
  const url = new URL(process.env.TALA_TEST_DATABASE_URL ?? 'postgresql://localhost:5432/tala_test')
  if (!url.username) url.username = userInfo().username
  if (!url.password) url.password = 'unused'
  return url.toString()
})()

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.jsonc' },
      miniflare: { hyperdrives: { HYPERDRIVE: databaseUrl } },
    }),
  ],
  test: {
    include: ['test/**/*.test.ts'],
    globalSetup: ['test/global-setup.ts'],
    testTimeout: 30_000,
  },
})
