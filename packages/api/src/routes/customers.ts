import { createRoute } from '@hono/zod-openapi'
import {
  CreateCustomer,
  CreateCustomerNote,
  Customer,
  CustomerListQuery,
  CustomerNote,
  ListQuery,
  OrderSummary,
  Page,
  Tag,
  TenantParams,
  TenantResourceParams,
  UpdateCustomer,
} from '@talajs/contracts'
import { z } from 'zod'
import * as customers from '../domain/customers.js'
import {
  errorResponses,
  json,
  jsonBody,
  registerCrud,
  send,
  type TalaApp,
  tenantOf,
  tenantPath,
} from '../lib/openapi.js'
import { requireRole } from '../middleware/index.js'

export function registerCustomerRoutes<E>(app: TalaApp<E>) {
  registerCrud(app, {
    tag: 'Customers',
    path: '/customers',
    noun: 'customer',
    item: Customer,
    create: CreateCustomer,
    update: UpdateCustomer,
    listQuery: CustomerListQuery,
    // Staff look up and add customers at the register; archiving is a manager action.
    writeRole: 'STAFF',
    archiveRole: 'MANAGER',
    handlers: {
      list: customers.listCustomers,
      get: customers.getCustomer,
      create: customers.createCustomer,
      update: customers.updateCustomer,
      archive: customers.setCustomerArchived,
    },
  })

  app.openapi(
    createRoute({
      method: 'get',
      path: tenantPath('/customers/{id}/notes'),
      tags: ['Customers'],
      summary: 'Notes on a customer, newest first',
      request: { params: TenantResourceParams, query: ListQuery },
      responses: { 200: json(Page(CustomerNote), 'A page of notes'), ...errorResponses },
    }),
    async (c) => {
      requireRole(c, 'STAFF')
      const page = await customers.listCustomerNotes(
        tenantOf(c),
        c.req.valid('param').id,
        c.req.valid('query'),
      )
      return send(c, Page(CustomerNote), page)
    },
  )

  app.openapi(
    createRoute({
      method: 'post',
      path: tenantPath('/customers/{id}/notes'),
      tags: ['Customers'],
      summary: 'Add a note',
      request: { params: TenantResourceParams, ...jsonBody(CreateCustomerNote) },
      responses: { 201: json(CustomerNote, 'The note'), ...errorResponses },
    }),
    async (c) => {
      requireRole(c, 'STAFF')
      const note = await customers.createCustomerNote(
        tenantOf(c),
        c.req.valid('param').id,
        c.req.valid('json'),
      )
      return send(c, CustomerNote, note, 201)
    },
  )

  app.openapi(
    createRoute({
      method: 'get',
      path: tenantPath('/customers/{id}/orders'),
      tags: ['Customers'],
      summary: 'Order history, newest first',
      request: { params: TenantResourceParams, query: ListQuery },
      responses: { 200: json(Page(OrderSummary), 'A page of orders'), ...errorResponses },
    }),
    async (c) => {
      requireRole(c, 'STAFF')
      const page = await customers.listCustomerOrders(
        tenantOf(c),
        c.req.valid('param').id,
        c.req.valid('query'),
      )
      return send(c, Page(OrderSummary), page)
    },
  )

  app.openapi(
    createRoute({
      method: 'get',
      path: tenantPath('/tags'),
      tags: ['Customers'],
      summary: 'Customer tags with usage counts',
      request: { params: TenantParams },
      responses: { 200: json(z.object({ data: z.array(Tag) }), 'All tags'), ...errorResponses },
    }),
    async (c) => {
      requireRole(c, 'STAFF')
      return send(c, z.object({ data: z.array(Tag) }), {
        data: await customers.listTags(tenantOf(c)),
      })
    },
  )
}
