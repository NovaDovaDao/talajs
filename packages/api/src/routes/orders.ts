import { createRoute } from '@hono/zod-openapi'
import {
  AddLines,
  CompleteOrder,
  CreateOrder,
  CreatePayment,
  CreateRefund,
  ListQuery,
  Order,
  OrderHeader,
  OrderLineParams,
  OrderListQuery,
  Page,
  TenantParams,
  TenantResourceParams,
  UpdateOrder,
  VoidRequest,
} from '@talajs/contracts'
import * as orders from '../domain/orders.js'
import {
  errorResponses,
  json,
  jsonBody,
  send,
  type TalaApp,
  tenantOf,
  tenantPath,
} from '../lib/openapi.js'
import { requireRole } from '../middleware/index.js'

const tags = ['Orders']
const orderPath = tenantPath('/orders/{id}')

export function registerOrderRoutes<E>(app: TalaApp<E>) {
  app.openapi(
    createRoute({
      method: 'get',
      path: tenantPath('/orders'),
      tags,
      summary: 'List orders, newest first',
      request: { params: TenantParams, query: ListQuery.extend(OrderListQuery.shape) },
      responses: { 200: json(Page(OrderHeader), 'A page of orders'), ...errorResponses },
    }),
    async (c) => {
      requireRole(c, 'STAFF')
      return send(c, Page(OrderHeader), await orders.listOrders(tenantOf(c), c.req.valid('query')))
    },
  )

  app.openapi(
    createRoute({
      method: 'get',
      path: orderPath,
      tags,
      summary: 'Get an order with its lines and payments',
      request: { params: TenantResourceParams },
      responses: { 200: json(Order, 'The order'), ...errorResponses },
    }),
    async (c) => {
      requireRole(c, 'STAFF')
      return send(c, Order, await orders.getOrder(tenantOf(c), c.req.valid('param').id))
    },
  )

  app.openapi(
    createRoute({
      method: 'post',
      path: tenantPath('/orders'),
      tags,
      summary: 'Open an order or tab',
      description:
        'Lines are optional. Stock is taken for any lines given. Repeating the request with the same `id` returns the existing order with 200.',
      request: { params: TenantParams, ...jsonBody(CreateOrder) },
      responses: {
        201: json(Order, 'The new order'),
        200: json(Order, 'An order with this id already existed'),
        ...errorResponses,
      },
    }),
    async (c) => {
      requireRole(c, 'STAFF')
      const { order, created } = await orders.createOrder(tenantOf(c), c.req.valid('json'))
      return created ? send(c, Order, order, 201) : send(c, Order, order, 200)
    },
  )

  app.openapi(
    createRoute({
      method: 'patch',
      path: orderPath,
      tags,
      summary: 'Update an open order',
      request: { params: TenantResourceParams, ...jsonBody(UpdateOrder) },
      responses: { 200: json(Order, 'The updated order'), ...errorResponses },
    }),
    async (c) => {
      requireRole(c, 'STAFF')
      const { id } = c.req.valid('param')
      return send(c, Order, await orders.updateOrder(tenantOf(c), id, c.req.valid('json')))
    },
  )

  app.openapi(
    createRoute({
      method: 'post',
      path: `${orderPath}/lines`,
      tags,
      summary: 'Add lines to an open order or tab',
      description:
        'All or nothing: if any line is unavailable or out of strictly tracked stock, nothing is added.',
      request: { params: TenantResourceParams, ...jsonBody(AddLines) },
      responses: { 200: json(Order, 'The updated order'), ...errorResponses },
    }),
    async (c) => {
      requireRole(c, 'STAFF')
      const { id } = c.req.valid('param')
      return send(c, Order, await orders.addLines(tenantOf(c), id, c.req.valid('json')))
    },
  )

  app.openapi(
    createRoute({
      method: 'post',
      path: `${orderPath}/lines/{lineId}/void`,
      tags,
      summary: 'Void a line on an open order',
      description: 'The line is kept for history, counts as zero, and its stock is put back.',
      request: { params: OrderLineParams, ...jsonBody(VoidRequest) },
      responses: { 200: json(Order, 'The updated order'), ...errorResponses },
    }),
    async (c) => {
      requireRole(c, 'STAFF')
      const { id, lineId } = c.req.valid('param')
      return send(c, Order, await orders.voidLine(tenantOf(c), id, lineId, c.req.valid('json')))
    },
  )

  app.openapi(
    createRoute({
      method: 'post',
      path: `${orderPath}/void`,
      tags,
      summary: 'Void an open order',
      description: 'Only before payment; stock for every line is put back.',
      request: { params: TenantResourceParams, ...jsonBody(VoidRequest) },
      responses: { 200: json(Order, 'The voided order'), ...errorResponses },
    }),
    async (c) => {
      requireRole(c, 'STAFF')
      const { id } = c.req.valid('param')
      return send(c, Order, await orders.voidOrder(tenantOf(c), id, c.req.valid('json')))
    },
  )

  app.openapi(
    createRoute({
      method: 'post',
      path: `${orderPath}/complete`,
      tags,
      summary: 'Complete a paid order',
      description: 'Fails with `balance_due` until successful payments cover the total.',
      request: { params: TenantResourceParams, ...jsonBody(CompleteOrder) },
      responses: { 200: json(Order, 'The completed order'), ...errorResponses },
    }),
    async (c) => {
      requireRole(c, 'STAFF')
      const { id } = c.req.valid('param')
      return send(c, Order, await orders.completeOrder(tenantOf(c), id, c.req.valid('json')))
    },
  )

  app.openapi(
    createRoute({
      method: 'post',
      path: `${orderPath}/payments`,
      tags,
      summary: 'Take a payment',
      description:
        'Cash only for now. Repeating the request with the same payment `id` returns the order unchanged with 200.',
      request: { params: TenantResourceParams, ...jsonBody(CreatePayment) },
      responses: {
        201: json(Order, 'The order with the new payment'),
        200: json(Order, 'A payment with this id already existed'),
        ...errorResponses,
      },
    }),
    async (c) => {
      requireRole(c, 'STAFF')
      const { id } = c.req.valid('param')
      const { order, created } = await orders.createPayment(tenantOf(c), id, c.req.valid('json'))
      return created ? send(c, Order, order, 201) : send(c, Order, order, 200)
    },
  )

  app.openapi(
    createRoute({
      method: 'post',
      path: `${orderPath}/refunds`,
      tags,
      summary: 'Refund a payment',
      description:
        'Managers only. Part or all of a successful payment, on an open or completed order. Repeating the request with the same refund `id` returns the order unchanged with 200.',
      request: { params: TenantResourceParams, ...jsonBody(CreateRefund) },
      responses: {
        201: json(Order, 'The order with the new refund'),
        200: json(Order, 'A refund with this id already existed'),
        ...errorResponses,
      },
    }),
    async (c) => {
      requireRole(c, 'MANAGER')
      const { id } = c.req.valid('param')
      const { order, created } = await orders.createRefund(tenantOf(c), id, c.req.valid('json'))
      return created ? send(c, Order, order, 201) : send(c, Order, order, 200)
    },
  )
}
