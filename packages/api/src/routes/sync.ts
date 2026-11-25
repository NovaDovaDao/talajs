import { createRoute } from '@hono/zod-openapi'
import {
  CreateTerminal,
  ListQuery,
  Page,
  PairingCode,
  PairRequest,
  PairResponse,
  ResolveReviewItem,
  ReviewItem,
  ReviewListQuery,
  StaffMember,
  SyncPullQuery,
  SyncPullResponse,
  SyncPushRequest,
  SyncPushResponse,
  TenantParams,
  TenantResourceParams,
  Terminal,
  UpdateTerminal,
  VerifyPin,
} from '@talajs/contracts'
import { z } from 'zod'
import { verifyPin } from '../domain/pins.js'
import * as review from '../domain/review.js'
import * as sync from '../domain/sync.js'
import * as terminals from '../domain/terminals.js'
import {
  errorResponses,
  json,
  jsonBody,
  send,
  type TalaApp,
  tenantOf,
  tenantPath,
} from '../lib/openapi.js'
import { requireRole, requireTerminal } from '../middleware/index.js'

/**
 * `POST /v1/terminal/pair` is the one unauthenticated route: the pairing code is the credential.
 * Register it before the authentication middleware so that never runs for it.
 */
export function registerPairingRoute<E>(app: TalaApp<E>) {
  app.openapi(
    createRoute({
      method: 'post',
      path: '/v1/terminal/pair',
      tags: ['Terminals'],
      summary: 'Pair a register',
      description:
        'Exchange a one-time pairing code for a terminal token. No other credential is needed. Codes expire after 15 minutes and work once.',
      security: [],
      request: jsonBody(PairRequest),
      responses: { 200: json(PairResponse, 'The token and terminal'), ...errorResponses },
    }),
    async (c) => {
      const result = await terminals.pairTerminal(c.get('db'), c.req.valid('json').pairingCode)
      return send(c, PairResponse, result)
    },
  )
}

const TerminalListQuery = ListQuery.extend({ storeId: z.uuid().optional() })

export function registerSyncRoutes<E>(app: TalaApp<E>) {
  const tags = ['Terminals']
  const terminalPath = tenantPath('/terminals/{id}')

  app.openapi(
    createRoute({
      method: 'get',
      path: tenantPath('/terminals'),
      tags,
      summary: 'List terminals',
      description: 'Revoked terminals are hidden unless `includeArchived=true`.',
      request: { params: TenantParams, query: TerminalListQuery },
      responses: { 200: json(Page(Terminal), 'A page of terminals'), ...errorResponses },
    }),
    async (c) => {
      requireRole(c, 'MANAGER')
      return send(
        c,
        Page(Terminal),
        await terminals.listTerminals(tenantOf(c), c.req.valid('query')),
      )
    },
  )

  app.openapi(
    createRoute({
      method: 'get',
      path: terminalPath,
      tags,
      summary: 'Get a terminal',
      request: { params: TenantResourceParams },
      responses: { 200: json(Terminal, 'The terminal'), ...errorResponses },
    }),
    async (c) => {
      requireRole(c, 'MANAGER')
      return send(c, Terminal, await terminals.getTerminal(tenantOf(c), c.req.valid('param').id))
    },
  )

  app.openapi(
    createRoute({
      method: 'post',
      path: tenantPath('/terminals'),
      tags,
      summary: 'Create a terminal',
      description: 'Returns a one-time pairing code to enter on the register.',
      request: { params: TenantParams, ...jsonBody(CreateTerminal) },
      responses: { 201: json(PairingCode, 'The terminal and its pairing code'), ...errorResponses },
    }),
    async (c) => {
      requireRole(c, 'MANAGER')
      return send(
        c,
        PairingCode,
        await terminals.createTerminal(tenantOf(c), c.req.valid('json')),
        201,
      )
    },
  )

  app.openapi(
    createRoute({
      method: 'patch',
      path: terminalPath,
      tags,
      summary: 'Rename a terminal',
      request: { params: TenantResourceParams, ...jsonBody(UpdateTerminal) },
      responses: { 200: json(Terminal, 'The terminal'), ...errorResponses },
    }),
    async (c) => {
      requireRole(c, 'MANAGER')
      const { id } = c.req.valid('param')
      return send(c, Terminal, await terminals.updateTerminal(tenantOf(c), id, c.req.valid('json')))
    },
  )

  app.openapi(
    createRoute({
      method: 'post',
      path: `${terminalPath}/pairing-code`,
      tags,
      summary: 'Issue a new pairing code',
      description:
        'For new hardware or a lost token. The current token keeps working until the new code is used.',
      request: { params: TenantResourceParams },
      responses: { 200: json(PairingCode, 'A new pairing code'), ...errorResponses },
    }),
    async (c) => {
      requireRole(c, 'MANAGER')
      return send(
        c,
        PairingCode,
        await terminals.repairTerminal(tenantOf(c), c.req.valid('param').id),
      )
    },
  )

  app.openapi(
    createRoute({
      method: 'post',
      path: `${terminalPath}/revoke`,
      tags,
      summary: 'Revoke a terminal',
      description: 'Permanent. Its token stops working immediately.',
      request: { params: TenantResourceParams },
      responses: { 200: json(Terminal, 'The revoked terminal'), ...errorResponses },
    }),
    async (c) => {
      requireRole(c, 'MANAGER')
      return send(c, Terminal, await terminals.revokeTerminal(tenantOf(c), c.req.valid('param').id))
    },
  )

  app.openapi(
    createRoute({
      method: 'post',
      path: tenantPath('/sync/push'),
      tags: ['Sync'],
      summary: 'Push offline mutations',
      description:
        'Terminal token only. Mutations apply in order, each on its own; results line up with the input. Pushing the same mutation again returns `DUPLICATE`.',
      request: { params: TenantParams, ...jsonBody(SyncPushRequest) },
      responses: { 200: json(SyncPushResponse, 'One result per mutation'), ...errorResponses },
    }),
    async (c) => {
      const terminal = requireTerminal(c)
      const { mutations } = c.req.valid('json')
      return send(c, SyncPushResponse, await sync.pushMutations(tenantOf(c), terminal, mutations))
    },
  )

  app.openapi(
    createRoute({
      method: 'get',
      path: tenantPath('/sync/pull'),
      tags: ['Sync'],
      summary: 'Pull catalog changes',
      description:
        'Terminal token only. Start without a cursor for a full load, then pass the returned cursor. Pull again at once while `hasMore` is true.',
      request: { params: TenantParams, query: SyncPullQuery },
      responses: { 200: json(SyncPullResponse, 'Changes since the cursor'), ...errorResponses },
    }),
    async (c) => {
      requireTerminal(c)
      return send(c, SyncPullResponse, await sync.pullChanges(tenantOf(c), c.req.valid('query')))
    },
  )

  app.openapi(
    createRoute({
      method: 'post',
      path: tenantPath('/sync/pin'),
      tags: ['Sync'],
      summary: 'Check a staff PIN at a register',
      description:
        "Terminal token only. Returns the person the PIN belongs to in this store. A wrong PIN is 403 `invalid_pin`; after 5 in a row the register's PIN entry is locked for 15 minutes (423 `pin_locked`).",
      request: { params: TenantParams, ...jsonBody(VerifyPin) },
      responses: { 200: json(StaffMember, 'The staff member'), ...errorResponses },
    }),
    async (c) => {
      const terminal = requireTerminal(c)
      return send(c, StaffMember, await verifyPin(tenantOf(c), terminal, c.req.valid('json').pin))
    },
  )

  app.openapi(
    createRoute({
      method: 'get',
      path: tenantPath('/review-items'),
      tags: ['Review'],
      summary: 'List review items, newest first',
      request: { params: TenantParams, query: ListQuery.extend(ReviewListQuery.shape) },
      responses: { 200: json(Page(ReviewItem), 'A page of review items'), ...errorResponses },
    }),
    async (c) => {
      requireRole(c, 'MANAGER')
      return send(
        c,
        Page(ReviewItem),
        await review.listReviewItems(tenantOf(c), c.req.valid('query')),
      )
    },
  )

  app.openapi(
    createRoute({
      method: 'get',
      path: tenantPath('/review-items/{id}'),
      tags: ['Review'],
      summary: 'Get a review item',
      request: { params: TenantResourceParams },
      responses: { 200: json(ReviewItem, 'The review item'), ...errorResponses },
    }),
    async (c) => {
      requireRole(c, 'MANAGER')
      return send(c, ReviewItem, await review.getReviewItem(tenantOf(c), c.req.valid('param').id))
    },
  )

  app.openapi(
    createRoute({
      method: 'post',
      path: tenantPath('/review-items/{id}/resolve'),
      tags: ['Review'],
      summary: 'Resolve or dismiss a review item',
      request: { params: TenantResourceParams, ...jsonBody(ResolveReviewItem) },
      responses: { 200: json(ReviewItem, 'The closed review item'), ...errorResponses },
    }),
    async (c) => {
      requireRole(c, 'MANAGER')
      const { id } = c.req.valid('param')
      return send(
        c,
        ReviewItem,
        await review.resolveReviewItem(tenantOf(c), id, c.req.valid('json')),
      )
    },
  )
}
