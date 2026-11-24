#!/usr/bin/env node
// Publish every public workspace package whose current version isn't on npm yet.
//
// Each package is packed with pnpm (which rewrites `workspace:*` to real versions) and the
// tarball is published with the npm CLI, which supports npm trusted publishing (GitHub OIDC,
// with provenance) and falls back to a token or `npm login` locally.
//
// Prints `New tag: <name>@<version>` lines so changesets/action creates git tags and releases.
//
//   node scripts/publish.mjs            publish
//   node scripts/publish.mjs --dry-run  pack and run `npm publish --dry-run`
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dryRun = process.argv.includes('--dry-run')
// Dependency order: a package is published after the packages it depends on.
const order = ['contracts', 'db', 'api', 'admin']
const out = mkdtempSync(join(tmpdir(), 'talajs-pack-'))
const run = (cmd, args, opts = {}) =>
  execFileSync(cmd, args, { stdio: ['ignore', 'pipe', 'inherit'], encoding: 'utf8', ...opts })

function published(name, version) {
  try {
    const out = execFileSync('npm', ['view', `${name}@${version}`, 'version'], {
      stdio: ['ignore', 'pipe', 'ignore'],
      encoding: 'utf8',
    })
    return out.trim() === version
  } catch {
    return false // E404: never published
  }
}

for (const dir of order) {
  const cwd = join('packages', dir)
  const {
    name,
    version,
    private: isPrivate,
  } = JSON.parse(readFileSync(join(cwd, 'package.json'), 'utf8'))
  if (isPrivate) continue
  if (published(name, version)) {
    console.log(`${name}@${version} is already on npm; skipping`)
    continue
  }
  const tarball = run('pnpm', ['pack', '--pack-destination', out], { cwd })
    .trim()
    .split('\n')
    .at(-1)
  const tag = version.includes('-') ? 'next' : 'latest'
  console.log(`${dryRun ? 'Would publish' : 'Publishing'} ${name}@${version} (${tag})`)
  execFileSync(
    'npm',
    ['publish', tarball, '--access', 'public', '--tag', tag, ...(dryRun ? ['--dry-run'] : [])],
    {
      stdio: 'inherit',
    },
  )
  if (!dryRun) console.log(`New tag: ${name}@${version}`)
}
