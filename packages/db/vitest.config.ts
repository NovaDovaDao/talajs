import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: { conditions: ['@talajs/source'] },
  test: {
    include: ['src/**/*.test.ts'],
    // Tests share one database; run files serially.
    fileParallelism: false,
    testTimeout: 30_000,
  },
})
