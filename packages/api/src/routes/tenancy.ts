import { createRoute } from '@hono/zod-openapi'
import {
  AcceptedInvitation,
  AcceptInvitation,
  AuditEntry,
  AuditListQuery,
  CreateInvitation,
  CreateMembership,
  CreateTenant,
  Invitation,
  InvitationListQuery,
  InvitationPreview,
  InvitationToken,
  ListQuery,
  Me,
  Membership,
  Page,
  SentInvitation,
  SetPin,
  Tenant,
  TenantParams,
  TenantResourceParams,
  UpdateMembership,
  UpdateTenant,
} from '@talajs/contracts'
import { z } from 'zod'
import { listAudit } from '../domain/audit.js'
import {
  acceptInvitation,
  createInvitation,
  type InvitationSettings,
  listInvitations,
  previewInvitation,
  resendInvitation,
  revokeInvitation,
} from '../domain/invitations.js'
import { clearPin, setPin } from '../domain/pins.js'
import {
  createMembership,
  createTenant,
  getMe,
  getTenant,
  listMemberships,
  revokeMembership,
  updateMembership,
  updateTenant,
} from '../domain/tenancy.js'
import { HttpError } from '../errors.js'
import {
  errorResponses,
  json,
  jsonBody,
  send,
  type TalaApp,
  tenantOf,
  tenantPath,
} from '../lib/openapi.js'
import { clientIp, consumeRateLimit } from '../lib/rate-limit.js'
import { requireRole } from '../middleware/index.js'
import type { TalaContext } from '../types.js'

export interface TeamSettings<E> {
  /** OWNER memberships one person may self-serve create, or null when self-serve is off. */
  selfServeTenants: number | null
  /** Null when invitations aren't configured. */
  invitations: ((c: TalaContext<E>) => InvitationSettings) | null
}

const invitationsOf = <E>(settings: TeamSettings<E>, c: TalaContext<E>) => {
  if (!settings.invitations) {
    throw new HttpError(404, 'not_found', 'Invitations are not enabled on this server')
  }
  return settings.invitations(c)
}

const TokenParams = z.object({ token: InvitationToken })

/** Unauthenticated: registered before the auth middleware, like terminal pairing. */
export function registerInvitationPreviewRoute<E>(app: TalaApp<E>) {
  app.openapi(
    createRoute({
      method: 'get',
      path: '/v1/invitations/{token}',
      tags: ['Team'],
      summary: 'Preview an invitation',
      description:
        'What the accept screen may show before the person signs in: the business, the role and the invited email, masked. Rate limited per IP.',
      security: [],
      request: { params: TokenParams },
      responses: { 200: json(InvitationPreview, 'The invitation'), ...errorResponses },
    }),
    async (c) => {
      const db = c.get('db')
      const limit = await consumeRateLimit(
        db,
        `invitation-preview:${clientIp(c.req.raw.headers)}`,
        {
          window: 60,
          max: 20,
        },
      )
      if (!limit.allowed) {
        c.header('retry-after', String(limit.retryAfter))
        throw new HttpError(429, 'too_many_requests', 'Too many requests')
      }
      return send(c, InvitationPreview, await previewInvitation(db, c.req.valid('param').token))
    },
  )
}

export function registerTenancyRoutes<E>(app: TalaApp<E>, settings: TeamSettings<E>) {
  app.openapi(
    createRoute({
      method: 'get',
      path: '/v1/me',
      tags: ['Tenancy'],
      summary: 'The caller and the tenants they belong to',
      responses: { 200: json(Me, 'Current identity'), ...errorResponses },
    }),
    async (c) =>
      send(c, Me, await getMe(c.get('db'), c.get('identity'), settings.selfServeTenants)),
  )

  app.openapi(
    createRoute({
      method: 'post',
      path: '/v1/tenants',
      tags: ['Tenancy'],
      summary: 'Create a tenant',
      description:
        'A service credential provisions a tenant for `ownerSubject`. With `allowSelfServeTenants`, a person with a verified email creates one and becomes its owner.',
      request: jsonBody(CreateTenant),
      responses: { 201: json(Tenant, 'The new tenant'), ...errorResponses },
    }),
    async (c) => {
      const tenant = await createTenant(
        c.get('db'),
        c.get('identity'),
        c.req.valid('json'),
        settings.selfServeTenants,
      )
      return send(c, Tenant, tenant, 201)
    },
  )

  app.openapi(
    createRoute({
      method: 'post',
      path: '/v1/invitations/accept',
      tags: ['Team'],
      summary: 'Accept an invitation',
      description:
        'Joins the business. The caller must be signed in with the invited email, verified; otherwise 403 `email_mismatch` or `email_unverified`. Each invitation works once.',
      request: jsonBody(AcceptInvitation),
      responses: { 200: json(AcceptedInvitation, 'The new membership'), ...errorResponses },
    }),
    async (c) => {
      const result = await acceptInvitation(
        c.get('db'),
        c.get('identity'),
        c.req.valid('json').token,
      )
      return send(c, AcceptedInvitation, result)
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
      method: 'patch',
      path: tenantPath(''),
      tags: ['Tenancy'],
      summary: "Change the tenant's name or PIN length",
      request: { params: TenantParams, ...jsonBody(UpdateTenant) },
      responses: { 200: json(Tenant, 'The tenant'), ...errorResponses },
    }),
    async (c) => {
      requireRole(c, 'OWNER')
      return send(c, Tenant, await updateTenant(tenantOf(c), c.req.valid('json')))
    },
  )

  app.openapi(
    createRoute({
      method: 'get',
      path: tenantPath('/memberships'),
      tags: ['Team'],
      summary: 'List members',
      request: { params: TenantParams, query: ListQuery },
      responses: { 200: json(Page(Membership), 'A page of memberships'), ...errorResponses },
    }),
    async (c) => {
      requireRole(c, 'MANAGER')
      return send(c, Page(Membership), await listMemberships(tenantOf(c), c.req.valid('query')))
    },
  )

  app.openapi(
    createRoute({
      method: 'post',
      path: tenantPath('/memberships'),
      tags: ['Team'],
      summary: 'Add a member by subject (or reactivate a revoked one)',
      description: 'For identity sources without email. Prefer invitations for people.',
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
      tags: ['Team'],
      summary: "Change a member's role, stores or display name",
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
      tags: ['Team'],
      summary: 'Revoke a membership',
      description:
        'Takes effect on the next request. The last remaining owner cannot be revoked or demoted.',
      request: { params: TenantResourceParams },
      responses: { 200: json(Membership, 'The revoked membership'), ...errorResponses },
    }),
    async (c) => {
      requireRole(c, 'OWNER')
      return send(c, Membership, await revokeMembership(tenantOf(c), c.req.valid('param').id))
    },
  )

  app.openapi(
    createRoute({
      method: 'put',
      path: tenantPath('/memberships/{id}/pin'),
      tags: ['Team'],
      summary: 'Set a register PIN',
      description:
        "Your own, or a staff member's as a manager (any member's as an owner). PINs are unique within a store and have the tenant's `pinLength` digits.",
      request: { params: TenantResourceParams, ...jsonBody(SetPin) },
      responses: { 204: { description: 'PIN set' }, ...errorResponses },
    }),
    async (c) => {
      await setPin(tenantOf(c), c.req.valid('param').id, c.req.valid('json').pin)
      return c.body(null, 204)
    },
  )

  app.openapi(
    createRoute({
      method: 'delete',
      path: tenantPath('/memberships/{id}/pin'),
      tags: ['Team'],
      summary: 'Clear a register PIN',
      request: { params: TenantResourceParams },
      responses: { 204: { description: 'PIN cleared' }, ...errorResponses },
    }),
    async (c) => {
      await clearPin(tenantOf(c), c.req.valid('param').id)
      return c.body(null, 204)
    },
  )

  app.openapi(
    createRoute({
      method: 'get',
      path: tenantPath('/invitations'),
      tags: ['Team'],
      summary: 'List invitations, newest first',
      request: { params: TenantParams, query: InvitationListQuery },
      responses: { 200: json(Page(Invitation), 'A page of invitations'), ...errorResponses },
    }),
    async (c) => {
      requireRole(c, 'MANAGER')
      return send(c, Page(Invitation), await listInvitations(tenantOf(c), c.req.valid('query')))
    },
  )

  app.openapi(
    createRoute({
      method: 'post',
      path: tenantPath('/invitations'),
      tags: ['Team'],
      summary: 'Invite someone by email',
      description:
        'Managers may invite STAFF to their own stores; only owners may invite MANAGERs or OWNERs. One pending invitation per email.',
      request: { params: TenantParams, ...jsonBody(CreateInvitation) },
      responses: { 201: json(SentInvitation, 'The invitation'), ...errorResponses },
    }),
    async (c) => {
      const result = await createInvitation(
        tenantOf(c),
        invitationsOf(settings, c),
        c.req.valid('json'),
      )
      return send(c, SentInvitation, result, 201)
    },
  )

  app.openapi(
    createRoute({
      method: 'post',
      path: tenantPath('/invitations/{id}/resend'),
      tags: ['Team'],
      summary: 'Re-send an invitation',
      description: 'Issues a new link (the old one stops working) and a new expiry.',
      request: { params: TenantResourceParams },
      responses: { 200: json(SentInvitation, 'The invitation'), ...errorResponses },
    }),
    async (c) => {
      const result = await resendInvitation(
        tenantOf(c),
        invitationsOf(settings, c),
        c.req.valid('param').id,
      )
      return send(c, SentInvitation, result)
    },
  )

  app.openapi(
    createRoute({
      method: 'post',
      path: tenantPath('/invitations/{id}/revoke'),
      tags: ['Team'],
      summary: 'Revoke an invitation',
      request: { params: TenantResourceParams },
      responses: { 200: json(Invitation, 'The invitation'), ...errorResponses },
    }),
    async (c) => send(c, Invitation, await revokeInvitation(tenantOf(c), c.req.valid('param').id)),
  )

  app.openapi(
    createRoute({
      method: 'get',
      path: tenantPath('/audit-log'),
      tags: ['Team'],
      summary: 'Access changes in this tenant, newest first',
      description: 'Invitations, memberships, PINs and tenant settings.',
      request: { params: TenantParams, query: AuditListQuery },
      responses: { 200: json(Page(AuditEntry), 'A page of entries'), ...errorResponses },
    }),
    async (c) => {
      requireRole(c, 'OWNER')
      return send(c, Page(AuditEntry), await listAudit(tenantOf(c), c.req.valid('query')))
    },
  )
}
