/**
 * Serve the Tala admin from a Worker's static assets, under any path, with its runtime config
 * coming from the Worker (so one build fits every deployment).
 *
 *     // wrangler.jsonc: "assets": { "directory": "node_modules/@talajs/admin/dist",
 *     //                             "binding": "ADMIN", "run_worker_first": true }
 *     const admin = serveAdmin<Env>({
 *       basePath: '/admin',
 *       assets: (env) => env.ADMIN,
 *       config: () => ({ apiBase: '/tala', auth: { mode: 'access' } }),
 *     })
 *     app.all('/admin/*', (c) => admin(c.req.raw, c.env))
 *
 * Use `run_worker_first: true`, so the asset layer never answers paths outside `basePath`.
 */

/** Mirrors the admin's `tala-admin.json` schema. */
export interface AdminRuntimeConfig {
  /** Where the Tala API is mounted, relative to the admin or absolute. */
  apiBase: string
  auth:
    | { mode: 'access' }
    | { mode: 'oidc'; issuer: string; clientId: string; scope?: string; audience?: string }
    | { mode: 'token' }
    | {
        /** Built-in sign-in with @talajs/auth, on the same origin. */
        mode: 'better-auth'
        /** Where the auth handler is mounted. Default `<apiBase>/auth`. */
        baseURL?: string
        /** Match `createTalaAuth`'s `methods`. Default: magic link only. */
        methods?: { magicLink?: boolean; password?: boolean; google?: boolean }
      }
}

/** Structurally compatible with Cloudflare's `Fetcher` (the assets binding). */
export interface AssetsBinding {
  fetch(request: Request): Promise<Response>
}

export interface ServeAdminOptions<E> {
  /** Where the admin is mounted, e.g. `/admin` (default `/`). */
  basePath?: string
  assets: (env: E) => AssetsBinding
  config: AdminRuntimeConfig | ((env: E) => AdminRuntimeConfig)
}

const looksLikeFile = (path: string) => /\.[a-z0-9]+$/i.test(path)

export function serveAdmin<E>(options: ServeAdminOptions<E>) {
  const base = `/${(options.basePath ?? '/').replace(/^\/+|\/+$/g, '')}/`.replace('//', '/')

  return async (request: Request, env: E): Promise<Response> => {
    const url = new URL(request.url)
    if (url.pathname === base.slice(0, -1)) return Response.redirect(new URL(base, url).href, 308)
    if (!url.pathname.startsWith(base)) return new Response('Not found', { status: 404 })
    const rest = url.pathname.slice(base.length)

    if (rest === 'tala-admin.json') {
      const config = typeof options.config === 'function' ? options.config(env) : options.config
      return Response.json(config, { headers: { 'cache-control': 'no-store' } })
    }

    const assets = options.assets(env)
    // A fresh request with only what asset caching needs: copying the incoming request also
    // copies routing metadata that makes the assets binding answer 404.
    const forwarded = new Headers()
    for (const name of [
      'accept',
      'accept-encoding',
      'if-none-match',
      'if-modified-since',
      'range',
    ]) {
      const value = request.headers.get(name)
      if (value) forwarded.set(name, value)
    }
    const method = request.method === 'HEAD' ? 'HEAD' : 'GET'
    const assetRequest = (path: string) =>
      new Request(new URL(path, url.origin), { method, headers: forwarded })
    let res = await assets.fetch(assetRequest(`/${rest}`))
    // In-app routes (/admin/orders/123) get the app shell.
    if ((res.status === 404 || rest === '') && !looksLikeFile(rest)) {
      res = await assets.fetch(assetRequest('/index.html'))
    }
    if (!(res.headers.get('content-type') ?? '').includes('text/html')) return res

    const html = (await res.text()).replace('<base href="/" />', `<base href="${base}" />`)
    const headers = new Headers(res.headers)
    headers.delete('content-length')
    headers.set('cache-control', 'no-cache')
    return new Response(html, { status: res.status === 404 ? 200 : res.status, headers })
  }
}
