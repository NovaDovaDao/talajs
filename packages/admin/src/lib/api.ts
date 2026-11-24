import type { ErrorBody } from '@talajs/contracts'
import type { Auth } from './auth'

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message)
  }
}

export type Query = Record<string, string | number | boolean | undefined | null>

export interface Api {
  get<T>(path: string, query?: Query): Promise<T>
  post<T>(path: string, body?: unknown): Promise<T>
  patch<T>(path: string, body: unknown): Promise<T>
  put<T>(path: string, body: unknown): Promise<T>
  del<T>(path: string): Promise<T>
}

/** A thin fetch wrapper. Response types come from `@talajs/contracts`. */
export function createApi(apiBase: string, auth: Auth, onUnauthenticated: () => void): Api {
  const base = new URL(apiBase.replace(/\/?$/, '/'), document.baseURI)

  async function request<T>(method: string, path: string, body?: unknown, query?: Query) {
    const url = new URL(path.replace(/^\//, ''), base)
    for (const [k, v] of Object.entries(query ?? {})) {
      if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v))
    }
    const headers: Record<string, string> = { ...(await auth.headers()) }
    if (body !== undefined) headers['content-type'] = 'application/json'
    const res = await fetch(url, {
      method,
      headers,
      credentials: 'include',
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    const text = await res.text()
    const json = text ? JSON.parse(text) : null
    if (!res.ok) {
      if (res.status === 401) onUnauthenticated()
      const error = (json as ErrorBody | null)?.error
      throw new ApiError(
        res.status,
        error?.code ?? 'internal_error',
        error?.message ?? res.statusText,
        error?.details,
      )
    }
    return json as T
  }

  return {
    get: (path, query) => request('GET', path, undefined, query),
    post: (path, body) => request('POST', path, body ?? {}),
    patch: (path, body) => request('PATCH', path, body),
    put: (path, body) => request('PUT', path, body),
    del: (path) => request('DELETE', path),
  }
}
