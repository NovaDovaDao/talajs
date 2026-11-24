import { createRoute } from '@hono/zod-openapi'
import {
  CreateMembership,
  CreateTenant,
  ListQuery,
  Me,
  Membership,
  Page,
  Tenant,
  TenantParams,
  TenantResourceParams,
  UpdateMembership,
} from '@talajs/contracts'
import {
  createMembership,
  createTenant,
  getMe,
  getTenant,
  listMemberships,
  revokeMembership,
  updateMembership,
} from '../domain/tenancy.js'
import {
  errorResponses,
  json,
  jsonBody,
  send,
  type TalaApp,
  tenantOf,
  tenantPath,
} from '../lib/openapi.js'
import { requireRole, requireService } from '../middleware/index.js'

export function registerTenancyRoutes<E>(app: TalaApp<E>) {
  app.openapi(
    createRoute({
      method: 'get',
      path: '/v1/me',
      tags: ['Tenancy'],
      summary: 'The caller and the tenants they belong to',
      responses: { 200: json(Me, 'Current identity'), ...errorResponses },
    }),
    async (c) => send(c, Me, await getMe(c.get('db'), c.get('identity'))),
  )

  app.openapi(
    createRoute({
      method: 'post',
      path: '/v1/tenants',
      tags: ['Tenancy'],
      summary: 'Provision a tenant (service credential only)',
      request: jsonBody(CreateTenant),
      responses: { 201: json(Tenant, 'The new tenant'), ...errorResponses },
    }),
    async (c) => {
      requireService(c)
      return send(c, Tenant, await createTenant(c.get('db'), c.req.valid('json')), 201)
    },
  )

  app.openapi(
    createRoute({
      method: 'get',
      path: tenantPath(''),
      tags: ['Tenancy'],
      summary: 'Get the tenant',
      request: { params: TenantParams },
      responses: { 200: json(Tenant, 'The tenant'), ...errorResponses },
    }),
    async (c) => send(c, Tenant, await getTenant(tenantOf(c))),
  )

  app.openapi(
    createRoute({
      method: 'get',
      path: tenantPath('/memberships'),
      tags: ['Tenancy'],
      summary: 'List members',
      request: { params: TenantParams, query: ListQuery },
      responses: { 200: json(Page(Membership), 'A page of memberships'), ...errorResponses },
    }),
    async (c) => {
      requireRole(c, 'OWNER')
      return send(c, Page(Membership), await listMemberships(tenantOf(c), c.req.valid('query')))
    },
  )

  app.openapi(
    createRoute({
      method: 'post',
      path: tenantPath('/memberships'),
      tags: ['Tenancy'],
      summary: 'Add a member (or reactivate a revoked one)',
      request: { params: TenantParams, ...jsonBody(CreateMembership) },
      responses: { 201: json(Membership, 'The membership'), ...errorResponses },
    }),
    async (c) => {
      requireRole(c, 'OWNER')
      return send(c, Membership, await createMembership(tenantOf(c), c.req.valid('json')), 201)
    },
  )

  app.openapi(
    createRoute({
      method: 'patch',
      path: tenantPath('/memberships/{id}'),
      tags: ['Tenancy'],
      summary: "Change a member's role or stores",
      request: { params: TenantResourceParams, ...jsonBody(UpdateMembership) },
      responses: { 200: json(Membership, 'The membership'), ...errorResponses },
    }),
    async (c) => {
      requireRole(c, 'OWNER')
      const { id } = c.req.valid('param')
      return send(c, Membership, await updateMembership(tenantOf(c), id, c.req.valid('json')))
    },
  )

  app.openapi(
    createRoute({
      method: 'delete',
      path: tenantPath('/memberships/{id}'),
      tags: ['Tenancy'],
      summary: 'Revoke a membership',
      description: 'The last remaining owner cannot be revoked or demoted.',
      request: { params: TenantResourceParams },
      responses: { 200: json(Membership, 'The revoked membership'), ...errorResponses },
    }),
    async (c) => {
      requireRole(c, 'OWNER')
      return send(c, Membership, await revokeMembership(tenantOf(c), c.req.valid('param').id))
    },
  )
}
