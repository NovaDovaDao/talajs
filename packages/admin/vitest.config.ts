import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: { conditions: ['@talajs/source'] },
  test: { include: ['src/**/*.test.ts', 'serve/**/*.test.ts'] },
})
