# Releasing

All four packages (`@talajs/contracts`, `@talajs/db`, `@talajs/api`, `@talajs/admin`) share one version (Changesets "fixed" mode). Releases are published from GitHub Actions with npm trusted publishing: no npm token is stored anywhere, and every release carries a provenance attestation.

## Every release

1. In each PR that changes a package, run `pnpm changeset` and describe the change for users. Releases that add a migration are at least a minor bump, and the changeset says "run `tala-db migrate`".
2. When that's merged to `main`, the **Release** workflow opens (or updates) a "chore: version packages" PR with the new versions and changelogs.
3. Merging that PR runs the workflow again, which publishes every package whose version isn't on npm yet (`pnpm release` → `scripts/publish.mjs`), tags them and creates GitHub releases.

Try it locally without publishing: `pnpm release:dry-run`.

## One-time setup (before 0.1.0)

1. **Keep the GitHub repository public.** npm only attaches provenance to packages built from public repositories, and each package's `repository.url` must match the repository exactly (it's `git+https://github.com/NovaDovaDao/talajs.git`).
2. **First publish.** Trusted publishing is configured per package on npmjs.com. If npm doesn't let you configure it before a package exists, publish 0.1.0 once from your machine:
   ```sh
   npm login                      # an account in the @talajs org, with 2FA
   pnpm changeset version         # 0.0.0 → 0.1.0, writes CHANGELOGs
   pnpm install --lockfile-only
   git commit -am "chore: version packages"
   pnpm release                   # builds, publishes every package in dependency order, and tags them
   git push talajs HEAD:main && git push talajs --tags
   ```
3. **Trusted publishers.** This is set per package, not on the org page. Signed in to npmjs.com as a package owner, open each package's page (e.g. https://www.npmjs.com/package/@talajs/contracts), go to its **Settings** tab (`…/package/@talajs/contracts/access`), find **Trusted Publisher**, choose **GitHub Actions**, and enter organization `NovaDovaDao`, repository `talajs`, workflow filename `release.yml` (no environment). Repeat for `@talajs/db`, `@talajs/api`, `@talajs/admin` and `@talajs/auth`. A new configuration must be used for a successful publish within 2 days. Afterwards, consider *Publishing access → Require two-factor authentication and disallow tokens*.

## If something goes wrong

- A version can't be republished. Fix forward with a patch release.
- Use `npm deprecate @talajs/<pkg>@<version> "<reason>"` to warn users away from a broken version (unpublishing is only possible within 72 hours and is disruptive).

## Adding a package

npm can only set up a trusted publisher for a package that already exists, so a new package's first version is published from a maintainer's machine:

1. Add it to `order` in `scripts/publish.mjs` (after its dependencies; last if nothing depends on it), to `packages` in `scripts/publish-exports.mjs`, and to the `fixed` group in `.changeset/config.json`.
2. Merge the version PR as usual. CI publishes the existing packages and fails on the new one.
3. Pull `main`, `npm login`, and run `pnpm release`. It skips versions already on npm and publishes the new package.
4. Add the new package's trusted publisher (step 3 above).
