import { createRoute, type OpenAPIHono } from '@hono/zod-openapi'
import {
  ErrorBody,
  ListQuery,
  type MemberRole,
  Page,
  TenantParams,
  TenantResourceParams,
} from '@talajs/contracts'
import type { Context } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import { z } from 'zod'
import { requireRole } from '../middleware/index.js'
import type { TalaEnv, TenantContext } from '../types.js'
import { toJson } from './json.js'

export type TalaApp<E> = OpenAPIHono<TalaEnv<E>>

export function json<S extends z.ZodType>(schema: S, description: string) {
  return { description, content: { 'application/json': { schema } } }
}

export const errorResponses = {
  400: json(ErrorBody, 'Invalid request'),
  401: json(ErrorBody, 'Not authenticated'),
  403: json(ErrorBody, 'Not allowed'),
  404: json(ErrorBody, 'Not found'),
  409: json(ErrorBody, 'Conflict'),
  422: json(ErrorBody, 'Invalid reference or constraint violation'),
} as const

export const jsonBody = <S extends z.ZodType>(schema: S) => ({
  body: { required: true, content: { 'application/json': { schema } } },
})

/**
 * Serialise and validate a response against its contract. This keeps every response honest to
 * @talajs/contracts (and strips fields the contract doesn't declare) at negligible cost.
 */
export function send<S extends z.ZodType, Status extends ContentfulStatusCode = 200>(
  c: Context,
  schema: S,
  value: unknown,
  status?: Status,
) {
  return c.json(schema.parse(toJson(value)) as z.output<S>, (status ?? 200) as Status)
}

/**
 * `c.req.valid()` for generic route helpers, where Hono can't infer the request targets.
 * The values were validated by the route's schemas before the handler ran.
 */
export function valid<T>(c: Context, target: 'json' | 'param' | 'query'): T {
  return (c.req as unknown as { valid(target: string): T }).valid(target)
}

export const tenantOf = <E>(c: Context<TalaEnv<E>>): TenantContext => c.get('tenant')

const T = '/v1/tenants/{tenantId}'
export const tenantPath = (path: string) => `${T}${path}`

export interface CrudDefinition<
  S extends z.ZodType,
  C extends z.ZodType,
  U extends z.ZodType,
  Q extends z.ZodObject,
> {
  tag: string
  /** e.g. `/stores` */
  path: string
  noun: string
  item: S
  create: C
  update: U
  /** Extra list filters merged into the standard ListQuery. */
  listQuery?: Q
  /** Minimum role to read (default STAFF), write (create/update) and archive. */
  readRole?: MemberRole
  writeRole: MemberRole
  archiveRole?: MemberRole
  handlers: {
    list(ctx: TenantContext, query: z.output<typeof ListQuery> & z.output<Q>): Promise<unknown>
    get(ctx: TenantContext, id: string): Promise<unknown>
    create(ctx: TenantContext, input: z.output<C>): Promise<unknown>
    update(ctx: TenantContext, id: string, input: z.output<U>): Promise<unknown>
    /** Omit for resources that can't be archived. */
    archive?(ctx: TenantContext, id: string, archived: boolean): Promise<unknown>
  }
}

/** list / get / create / update / archive (DELETE) / restore for a tenant resource. */
export function registerCrud<
  E,
  S extends z.ZodType,
  C extends z.ZodType,
  U extends z.ZodType,
  Q extends z.ZodObject = z.ZodObject<Record<string, never>>,
>(app: TalaApp<E>, def: CrudDefinition<S, C, U, Q>) {
  const { tag, noun, item, handlers } = def
  const collection = tenantPath(def.path)
  const member = `${collection}/{id}`
  const read = def.readRole ?? 'STAFF'
  const archiveRole = def.archiveRole ?? def.writeRole
  const query = def.listQuery ? ListQuery.extend(def.listQuery.shape) : ListQuery

  app.openapi(
    createRoute({
      method: 'get',
      path: collection,
      tags: [tag],
      summary: `List ${noun}s`,
      request: { params: TenantParams, query },
      responses: { 200: json(Page(item), `A page of ${noun}s`), ...errorResponses },
    }),
    async (c) => {
      requireRole(c, read)
      const q = valid<z.output<typeof ListQuery> & z.output<Q>>(c, 'query')
      return send(c, Page(item), await handlers.list(tenantOf(c), q))
    },
  )

  app.openapi(
    createRoute({
      method: 'get',
      path: member,
      tags: [tag],
      summary: `Get a ${noun}`,
      request: { params: TenantResourceParams },
      responses: { 200: json(item, `The ${noun}`), ...errorResponses },
    }),
    async (c) => {
      requireRole(c, read)
      return send(c, item, await handlers.get(tenantOf(c), valid<{ id: string }>(c, 'param').id))
    },
  )

  app.openapi(
    createRoute({
      method: 'post',
      path: collection,
      tags: [tag],
      summary: `Create a ${noun}`,
      request: { params: TenantParams, ...jsonBody(def.create) },
      responses: { 201: json(item, `The created ${noun}`), ...errorResponses },
    }),
    async (c) => {
      requireRole(c, def.writeRole)
      const input = valid<z.output<C>>(c, 'json')
      return send(c, item, await handlers.create(tenantOf(c), input), 201)
    },
  )

  app.openapi(
    createRoute({
      method: 'patch',
      path: member,
      tags: [tag],
      summary: `Update a ${noun}`,
      request: { params: TenantResourceParams, ...jsonBody(def.update) },
      responses: { 200: json(item, `The updated ${noun}`), ...errorResponses },
    }),
    async (c) => {
      requireRole(c, def.writeRole)
      const input = valid<z.output<U>>(c, 'json')
      return send(
        c,
        item,
        await handlers.update(tenantOf(c), valid<{ id: string }>(c, 'param').id, input),
      )
    },
  )

  const archive = handlers.archive
  if (!archive) return

  app.openapi(
    createRoute({
      method: 'delete',
      path: member,
      tags: [tag],
      summary: `Archive a ${noun}`,
      description:
        'Archived records are hidden from lists (unless `includeArchived=true`) but kept for history.',
      request: { params: TenantResourceParams },
      responses: { 200: json(item, `The archived ${noun}`), ...errorResponses },
    }),
    async (c) => {
      requireRole(c, archiveRole)
      return send(c, item, await archive(tenantOf(c), valid<{ id: string }>(c, 'param').id, true))
    },
  )

  app.openapi(
    createRoute({
      method: 'post',
      path: `${member}/restore`,
      tags: [tag],
      summary: `Restore an archived ${noun}`,
      request: { params: TenantResourceParams },
      responses: { 200: json(item, `The restored ${noun}`), ...errorResponses },
    }),
    async (c) => {
      requireRole(c, archiveRole)
      return send(c, item, await archive(tenantOf(c), valid<{ id: string }>(c, 'param').id, false))
    },
  )
}

export const NestedParams = <K extends string>(key: K) =>
  TenantResourceParams.extend({ [key]: z.uuid() } as Record<K, z.ZodUUID>)
