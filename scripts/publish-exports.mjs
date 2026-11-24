#!/usr/bin/env node
// `exports` carries a dev-only `@talajs/source` condition pointing at TypeScript sources, which
// the workspace resolves during development. Published packages must not point at files they
// don't ship, so each package's `publishConfig.exports` (which pnpm swaps in when packing) is
// `exports` with that condition removed.
//
//   node scripts/publish-exports.mjs          write publishConfig.exports
//   node scripts/publish-exports.mjs --check  fail if any package is out of date
import { readFileSync, writeFileSync } from 'node:fs'

const DEV_CONDITION = '@talajs/source'
const packages = ['contracts', 'db', 'api', 'admin']
const check = process.argv.includes('--check')

const strip = (value) => {
  if (typeof value !== 'object' || value === null) return value
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => key !== DEV_CONDITION)
      .map(([key, v]) => [key, strip(v)]),
  )
}

let stale = 0
for (const dir of packages) {
  const file = `packages/${dir}/package.json`
  const pkg = JSON.parse(readFileSync(file, 'utf8'))
  const wanted = strip(pkg.exports)
  if (JSON.stringify(pkg.publishConfig?.exports) === JSON.stringify(wanted)) continue
  if (check) {
    console.error(
      `${file}: publishConfig.exports is out of date; run node scripts/publish-exports.mjs`,
    )
    stale++
    continue
  }
  pkg.publishConfig = { ...pkg.publishConfig, exports: wanted }
  writeFileSync(file, `${JSON.stringify(pkg, null, 2)}\n`)
  console.log(`updated ${file}`)
}
if (stale) process.exit(1)
