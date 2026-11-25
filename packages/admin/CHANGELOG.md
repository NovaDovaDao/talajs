# @talajs/admin

## 0.2.0

### Minor Changes

- ae21e81: Built-in sign-in for merchants and staff, invitations, and register PINs.
  
  - New `@talajs/auth`: optional first-party sign-in powered by Better Auth. Magic link by default (works on Workers Free), email and password opt-in (needs Workers Paid for hashing), Google wired but off. One new secret: `BETTER_AUTH_SECRET`.
  - Invitations by email (`/v1/tenants/{id}/invitations`, `/v1/invitations/accept`) for any identity source with a verified email. Sign-up is invite-only unless `allowSelfServeTenants` is set.
  - Staff PINs for registers: set in the admin, checked online with a per-register lockout (`/sync/pin`), and a `staff` sync entity plus `actorMembershipId` on mutations for offline attribution.
  - A tenant audit log for invitations, memberships, PINs and settings.
  - `Identity` gains `email`, `emailVerified` and `name`; memberships gain `email`, `displayName` and `hasPin`; `/v1/me` gains `email`, `name`, `canCreateTenant` and per-membership `membershipId` and `hasPin`.
  - Managers can now list members and invite staff to their own stores; changing members stays owner-only.
  - Migration `0002_better_auth`: run `tala-db migrate`.
  - Admin: a `better-auth` auth mode with sign-in, invitation, password reset and account screens, invitations on the Team page, and a business switcher.

## 0.1.1

### Patch Changes

- e5f4fb8: Published `package.json` files no longer declare the development-only `@talajs/source` export condition, which pointed at TypeScript sources that aren't included in the packages.

## 0.1.0

### Minor Changes

- 5ab3a14: First public release. `@talajs/api` is a mountable Hono API for Cloudflare Workers covering tenancy, catalog, inventory, customers, orders and tabs, cash payments and refunds, a domain-event queue with Resend receipts, and offline register sync with a review queue. `@talajs/db` ships the Postgres schema, migrations and the `tala-db` CLI; `@talajs/contracts` the shared Zod schemas, pricing and ids; `@talajs/admin` the React admin and `serveAdmin()`.
