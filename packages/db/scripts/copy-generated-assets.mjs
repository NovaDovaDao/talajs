// tsc only emits .ts sources; the generated Prisma clients also contain .js/.wasm runtime
// assets (the workerd query compiler) that must sit next to the compiled output.
import { cpSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const src = new URL('../src/generated/', import.meta.url).pathname
const dist = new URL('../dist/generated/', import.meta.url).pathname

function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) walk(path)
    else if (/\.(wasm|js|mjs)$/.test(entry)) cpSync(path, join(dist, relative(src, path)))
  }
}
walk(src)
