import { describe, expect, it } from 'vitest'
import { serveAdmin } from './index'

const files: Record<string, [string, string]> = {
  '/index.html': [
    '<html><head><base href="/" /></head><body></body></html>',
    'text/html; charset=utf-8',
  ],
  '/assets/app.js': ['console.log(1)', 'text/javascript'],
}
const assets = {
  async fetch(req: Request) {
    const path = new URL(req.url).pathname
    const file = files[path === '/' ? '/index.html' : path]
    return file
      ? new Response(file[0], { headers: { 'content-type': file[1] } })
      : new Response('Not found', { status: 404 })
  },
}
const handler = serveAdmin({
  basePath: '/admin/',
  assets: () => assets,
  config: () => ({ apiBase: '/tala', auth: { mode: 'access' } }),
})
const get = (path: string) => handler(new Request(`https://cafe.test${path}`), {})

describe('serveAdmin', () => {
  it('serves the shell with the base path rewritten, for any in-app route', async () => {
    for (const path of ['/admin/', '/admin/t/1/orders/2']) {
      const res = await get(path)
      expect(res.status).toBe(200)
      expect(await res.text()).toContain('<base href="/admin/" />')
      expect(res.headers.get('cache-control')).toBe('no-cache')
    }
  })

  it('serves assets as they are and 404s missing files', async () => {
    expect(await (await get('/admin/assets/app.js')).text()).toBe('console.log(1)')
    expect((await get('/admin/assets/missing.js')).status).toBe(404)
  })

  it('serves runtime config, redirects the bare path and ignores other paths', async () => {
    const config = await get('/admin/tala-admin.json')
    expect(await config.json()).toEqual({ apiBase: '/tala', auth: { mode: 'access' } })
    expect(config.headers.get('cache-control')).toBe('no-store')
    const redirect = await get('/admin')
    expect(redirect.status).toBe(308)
    expect(redirect.headers.get('location')).toBe('https://cafe.test/admin/')
    expect((await get('/tala/v1/me')).status).toBe(404)
  })

  it('mounts at the root too', async () => {
    const root = serveAdmin({
      assets: () => assets,
      config: { apiBase: '/tala', auth: { mode: 'token' } },
    })
    const res = await root(new Request('https://cafe.test/orders'), {})
    expect(await res.text()).toContain('<base href="/" />')
  })
})
