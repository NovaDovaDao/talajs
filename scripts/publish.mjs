#!/usr/bin/env node
// Publish every public workspace package whose current version isn't on npm yet.
//
// Each package is packed with pnpm (which rewrites `workspace:*` to real versions) and the
// tarball is published with the npm CLI, which supports npm trusted publishing (GitHub OIDC,
// with provenance) and falls back to a token or `npm login` locally.
//
// Creates a git tag `<name>@<version>` for each published package and prints `New tag:` lines,
// so changesets/action pushes the tags and creates GitHub releases.
//
//   node scripts/publish.mjs            publish
//   node scripts/publish.mjs --dry-run  pack and run `npm publish --dry-run`
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'

const dryRun = process.argv.includes('--dry-run')
const ci = process.env.GITHUB_ACTIONS === 'true'

// Enough context to debug a failed publish from the CI log, without printing any secret values.
if (ci) {
  const has = (name) => (process.env[name] ? 'set' : 'missing')
  console.log('publish environment:')
  console.log(
    `  node ${process.version}, npm ${execFileSync('npm', ['-v'], { encoding: 'utf8' }).trim()}`,
  )
  console.log(
    `  OIDC: ACTIONS_ID_TOKEN_REQUEST_URL ${has('ACTIONS_ID_TOKEN_REQUEST_URL')}, ACTIONS_ID_TOKEN_REQUEST_TOKEN ${has('ACTIONS_ID_TOKEN_REQUEST_TOKEN')}`,
  )
  console.log(`  NPM_TOKEN ${has('NPM_TOKEN')}, NODE_AUTH_TOKEN ${has('NODE_AUTH_TOKEN')}`)
  const npmConfig = Object.keys(process.env).filter((k) =>
    k.toLowerCase().startsWith('npm_config_'),
  )
  console.log(`  npm_config_* names: ${npmConfig.join(', ') || 'none'}`)
  for (const file of [join(homedir(), '.npmrc'), '.npmrc']) {
    console.log(`  ${file}: ${existsSync(file) ? 'exists' : 'absent'}`)
  }
}
// Dependency order: a package is published after the packages it depends on.
// auth last: nothing depends on it, so a failed first publish (no trusted publisher yet) blocks nothing.
const order = ['contracts', 'db', 'api', 'admin', 'auth']
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
    [
      'publish',
      tarball,
      '--access',
      'public',
      '--tag',
      tag,
      // In CI, log npm's trusted-publishing (OIDC) exchange so auth failures are diagnosable.
      ...(ci ? ['--loglevel', 'verbose'] : []),
      ...(dryRun ? ['--dry-run'] : []),
    ],
    {
      stdio: 'inherit',
    },
  )
  if (dryRun) continue
  // Tag the release commit like `changeset publish` does; changesets/action pushes the tags
  // listed on "New tag:" lines and creates GitHub releases from them.
  const tagName = `${name}@${version}`
  const existing = run('git', ['tag', '--list', tagName]).trim()
  if (!existing) execFileSync('git', ['tag', tagName], { stdio: 'inherit' })
  console.log(`New tag: ${tagName}`)
}
