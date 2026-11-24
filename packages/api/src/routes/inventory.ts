import { createRoute } from '@hono/zod-openapi'
import {
  CreateStockLevel,
  ListQuery,
  Page,
  StockAdjustment,
  StockLevel,
  StockLevelListQuery,
  StockMovement,
  TenantResourceParams,
  UpdateStockLevel,
} from '@talajs/contracts'
import { z } from 'zod'
import * as stock from '../domain/stock.js'
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

const AdjustmentResult = z
  .object({ stockLevel: StockLevel, movement: StockMovement })
  .meta({ id: 'StockAdjustmentResult' })

export function registerInventoryRoutes<E>(app: TalaApp<E>) {
  registerCrud(app, {
    tag: 'Inventory',
    path: '/stock-levels',
    noun: 'stock level',
    item: StockLevel,
    create: CreateStockLevel,
    update: UpdateStockLevel,
    listQuery: StockLevelListQuery,
    writeRole: 'MANAGER',
    handlers: {
      list: stock.listStockLevels,
      get: stock.getStockLevel,
      create: stock.createStockLevel,
      update: stock.updateStockLevel,
    },
  })

  app.openapi(
    createRoute({
      method: 'post',
      path: tenantPath('/stock-levels/{id}/adjustments'),
      tags: ['Inventory'],
      summary: 'Receive, adjust or recount stock',
      description:
        'Atomic. A negative adjustment on a strictly tracked level fails with `insufficient_stock` instead of going below zero.',
      request: { params: TenantResourceParams, ...jsonBody(StockAdjustment) },
      responses: {
        201: json(AdjustmentResult, 'The new level and ledger entry'),
        ...errorResponses,
      },
    }),
    async (c) => {
      requireRole(c, 'STAFF')
      const result = await stock.adjustStock(
        tenantOf(c),
        c.req.valid('param').id,
        c.req.valid('json'),
      )
      return send(c, AdjustmentResult, result, 201)
    },
  )

  app.openapi(
    createRoute({
      method: 'get',
      path: tenantPath('/stock-levels/{id}/movements'),
      tags: ['Inventory'],
      summary: 'Stock ledger, newest first',
      request: { params: TenantResourceParams, query: ListQuery },
      responses: { 200: json(Page(StockMovement), 'A page of movements'), ...errorResponses },
    }),
    async (c) => {
      requireRole(c, 'STAFF')
      const page = await stock.listStockMovements(
        tenantOf(c),
        c.req.valid('param').id,
        c.req.valid('query'),
      )
      return send(c, Page(StockMovement), page)
    },
  )
}
