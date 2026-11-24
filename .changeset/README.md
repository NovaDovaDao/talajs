# Changesets

All published `@talajs/*` packages are versioned in lockstep (see `docs/PLAN.md` §3).
Run `pnpm changeset` to describe a change. Any change that adds a SQL migration
must be at least a `minor` bump and say "run `tala-db migrate`".
