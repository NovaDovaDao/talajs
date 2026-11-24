import { userInfo } from 'node:os'
import { cloudflareTest } from '@cloudflare/vitest-plugin'
import { defineConfig } from 'vitest/config'

// Miniflare's Hyperdrive needs credentials in the URL; trust-auth local installs get the OS
// user and a placeholder password.
const databaseUrl = (() => {
  const url = new URL(process.env.TALA_TEST_DATABASE_URL ?? 'postgresql://localhost:5432/tala_test')
  if (!url.username) url.username = userInfo().username
  if (!url.password) url.password = 'unused'
  return url.toString()
})()

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './test/wrangler.jsonc' },
      miniflare: { hyperdrives: { HYPERDRIVE: databaseUrl } },
    }),
  ],
  test: {
    include: ['test/**/*.test.ts'],
    globalSetup: ['test/global-setup.ts'],
    testTimeout: 30_000,
  },
})
