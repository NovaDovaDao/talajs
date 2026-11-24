import { resolve } from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defaultClientConditions, defineConfig } from 'vite'

export default defineConfig({
  // Relative asset URLs: the same build works under any path. `index.html` carries a
  // `<base href="/">` that `serveAdmin` rewrites to the mount path.
  base: './',
  plugins: [react(), tailwindcss()],
  // Screens are lazy-loaded; the entry chunk (React, router, Radix, zod) is ~150 kB gzipped.
  build: { chunkSizeWarningLimit: 700 },
  resolve: {
    alias: { '@': resolve(import.meta.dirname, './src') },
    // Use workspace sources (not dist) for @talajs/contracts during development.
    conditions: ['@talajs/source', ...defaultClientConditions],
  },
  server: {
    // `pnpm dev` here and `wrangler dev` in examples/worker: API calls go to the worker.
    proxy: { '/tala': 'http://localhost:8787' },
  },
})
