import { z } from 'zod'

/**
 * Runtime configuration, fetched from `tala-admin.json` next to `index.html`. The same build
 * works for every deployment; only this file differs.
 */
export const AdminConfig = z.object({
  /** Where the Tala API is mounted, e.g. `/tala` or `https://api.example.com/tala`. */
  apiBase: z.string().default('/tala'),
  auth: z.discriminatedUnion('mode', [
    /** Behind Cloudflare Access: the browser's Access cookie authenticates every request. */
    z.object({ mode: z.literal('access') }),
    /** Any OIDC provider, using the authorization code flow with PKCE. */
    z.object({
      mode: z.literal('oidc'),
      issuer: z.url(),
      clientId: z.string().min(1),
      scope: z.string().default('openid profile email'),
      /** Some providers (Auth0) need an audience to issue a JWT access token. */
      audience: z.string().optional(),
    }),
    /** Paste a bearer token (a service token or an OIDC access token). For development. */
    z.object({ mode: z.literal('token') }),
  ]),
})
export type AdminConfig = z.infer<typeof AdminConfig>

export async function loadConfig(): Promise<AdminConfig> {
  const res = await fetch(new URL('tala-admin.json', document.baseURI), { cache: 'no-store' })
  if (!res.ok) throw new Error(`Could not load tala-admin.json (${res.status})`)
  return AdminConfig.parse(await res.json())
}

/** The path the admin is mounted at (from `<base href>`), e.g. `/admin/`. */
export const basePath = () => new URL(document.baseURI).pathname
