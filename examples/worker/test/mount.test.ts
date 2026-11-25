import { exports } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'

describe('Tala mounted at /tala', () => {
  it('serves the OpenAPI document', async () => {
    const res = await exports.default.fetch('http://example.com/tala/openapi.json')
    expect(res.status).toBe(200)
    expect(((await res.json()) as { info: { title: string } }).info.title).toBe('Tala API')
  })

  it('requires authentication for the API', async () => {
    const res = await exports.default.fetch('http://example.com/tala/v1/me')
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({
      error: { code: 'unauthenticated', message: 'Authentication required' },
    })
  })

  it('leaves the consumer’s own routes alone', async () => {
    expect((await exports.default.fetch('http://example.com/health')).status).toBe(200)
  })
})

describe('admin mounted at /admin', () => {
  it('serves the app shell with its base path, for any in-app route', async () => {
    for (const path of ['/admin/', '/admin/t/123/orders']) {
      const res = await exports.default.fetch(`http://example.com${path}`)
      expect(res.status).toBe(200)
      const html = await res.text()
      expect(html).toContain('<base href="/admin/" />')
      expect(html).toContain('<div id="root">')
    }
    const redirect = await exports.default.fetch('http://example.com/admin', { redirect: 'manual' })
    expect(redirect.status).toBe(308)
  })

  it('serves runtime config from the worker', async () => {
    const res = await exports.default.fetch('https://pos.example.com/admin/tala-admin.json')
    expect(await res.json()).toEqual({
      apiBase: '/tala',
      auth: { mode: 'better-auth', methods: { magicLink: true, password: false } },
    })
    // Operators reach the same Worker on a hostname protected by Cloudflare Access.
    const ops = await exports.default.fetch('https://ops.example.com/admin/tala-admin.json')
    expect(await ops.json()).toEqual({ apiBase: '/tala', auth: { mode: 'access' } })
  })

  it('serves built assets and 404s missing files', async () => {
    const html = await (await exports.default.fetch('http://example.com/admin/')).text()
    const script = /src="\.\/(assets\/[^"]+\.js)"/.exec(html)?.[1]
    expect(script).toBeTruthy()
    const js = await exports.default.fetch(`http://example.com/admin/${script}`)
    expect(js.status).toBe(200)
    expect((await exports.default.fetch('http://example.com/admin/assets/nope.js')).status).toBe(
      404,
    )
  })
})
