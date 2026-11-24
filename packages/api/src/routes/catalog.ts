import { createRoute } from '@hono/zod-openapi'
import {
  Category,
  CreateCategory,
  CreateItem,
  CreateModifier,
  CreateModifierGroup,
  CreateStore,
  CreateTaxRate,
  CreateVariant,
  Item,
  ItemListQuery,
  Modifier,
  ModifierGroup,
  PutStoreItem,
  Store,
  StoreItem,
  TaxRate,
  TenantResourceParams,
  UpdateCategory,
  UpdateItem,
  UpdateModifier,
  UpdateModifierGroup,
  UpdateStore,
  UpdateTaxRate,
  UpdateVariant,
  Variant,
} from '@talajs/contracts'
import { z } from 'zod'
import * as categories from '../domain/categories.js'
import * as items from '../domain/items.js'
import * as modifiers from '../domain/modifiers.js'
import * as stores from '../domain/stores.js'
import * as taxRates from '../domain/tax-rates.js'
import {
  errorResponses,
  json,
  jsonBody,
  NestedParams,
  registerCrud,
  send,
  type TalaApp,
  tenantOf,
  tenantPath,
  valid,
} from '../lib/openapi.js'
import { requireRole } from '../middleware/index.js'

export function registerCatalogRoutes<E>(app: TalaApp<E>) {
  registerCrud(app, {
    tag: 'Stores',
    path: '/stores',
    noun: 'store',
    item: Store,
    create: CreateStore,
    update: UpdateStore,
    writeRole: 'MANAGER',
    archiveRole: 'OWNER',
    handlers: {
      list: stores.listStores,
      get: stores.getStore,
      create: stores.createStore,
      update: stores.updateStore,
      archive: stores.setStoreArchived,
    },
  })

  registerCrud(app, {
    tag: 'Tax rates',
    path: '/tax-rates',
    noun: 'tax rate',
    item: TaxRate,
    create: CreateTaxRate,
    update: UpdateTaxRate,
    writeRole: 'MANAGER',
    handlers: {
      list: taxRates.listTaxRates,
      get: taxRates.getTaxRate,
      create: taxRates.createTaxRate,
      update: taxRates.updateTaxRate,
      archive: taxRates.setTaxRateArchived,
    },
  })

  registerCrud(app, {
    tag: 'Categories',
    path: '/categories',
    noun: 'category',
    item: Category,
    create: CreateCategory,
    update: UpdateCategory,
    writeRole: 'MANAGER',
    handlers: {
      list: categories.listCategories,
      get: categories.getCategory,
      create: categories.createCategory,
      update: categories.updateCategory,
      archive: categories.setCategoryArchived,
    },
  })

  registerCrud(app, {
    tag: 'Items',
    path: '/items',
    noun: 'item',
    item: Item,
    create: CreateItem,
    update: UpdateItem,
    listQuery: ItemListQuery,
    writeRole: 'MANAGER',
    handlers: {
      list: items.listItems,
      get: items.getItem,
      create: items.createItem,
      update: items.updateItem,
      archive: items.setItemArchived,
    },
  })

  registerCrud(app, {
    tag: 'Modifiers',
    path: '/modifier-groups',
    noun: 'modifier group',
    item: ModifierGroup,
    create: CreateModifierGroup,
    update: UpdateModifierGroup,
    writeRole: 'MANAGER',
    handlers: {
      list: modifiers.listModifierGroups,
      get: modifiers.getModifierGroup,
      create: modifiers.createModifierGroup,
      update: modifiers.updateModifierGroup,
      archive: modifiers.setModifierGroupArchived,
    },
  })

  registerChildren(app, {
    tag: 'Items',
    parent: '/items',
    child: 'variants',
    key: 'variantId',
    noun: 'variant',
    item: Variant,
    create: CreateVariant,
    update: UpdateVariant,
    handlers: {
      create: items.createVariant,
      update: items.updateVariant,
      archive: items.setVariantArchived,
    },
  })

  registerChildren(app, {
    tag: 'Modifiers',
    parent: '/modifier-groups',
    child: 'modifiers',
    key: 'modifierId',
    noun: 'modifier',
    item: Modifier,
    create: CreateModifier,
    update: UpdateModifier,
    handlers: {
      create: modifiers.createModifier,
      update: modifiers.updateModifier,
      archive: modifiers.setModifierArchived,
    },
  })

  app.openapi(
    createRoute({
      method: 'get',
      path: tenantPath('/stores/{id}/items'),
      tags: ['Stores'],
      summary: 'Per-store availability and price overrides',
      request: { params: TenantResourceParams },
      responses: {
        200: json(z.object({ data: z.array(StoreItem) }), 'Store item settings'),
        ...errorResponses,
      },
    }),
    async (c) => {
      requireRole(c, 'STAFF')
      const data = await stores.listStoreItems(tenantOf(c), c.req.valid('param').id)
      return send(c, z.object({ data: z.array(StoreItem) }), { data })
    },
  )

  app.openapi(
    createRoute({
      method: 'put',
      path: tenantPath('/stores/{id}/items/{itemId}'),
      tags: ['Stores'],
      summary: "Set an item's availability or price override at a store",
      request: { params: NestedParams('itemId'), ...jsonBody(PutStoreItem) },
      responses: { 200: json(StoreItem, 'Store item setting'), ...errorResponses },
    }),
    async (c) => {
      requireRole(c, 'MANAGER')
      const { id, itemId } = c.req.valid('param')
      return send(
        c,
        StoreItem,
        await stores.putStoreItem(tenantOf(c), id, itemId, c.req.valid('json')),
      )
    },
  )
}

interface ChildDefinition<S extends z.ZodType, C extends z.ZodType, U extends z.ZodType> {
  tag: string
  parent: string
  child: string
  key: string
  noun: string
  item: S
  create: C
  update: U
  handlers: {
    create(ctx: ReturnType<typeof tenantOf>, parentId: string, input: z.output<C>): Promise<unknown>
    update(
      ctx: ReturnType<typeof tenantOf>,
      parentId: string,
      id: string,
      input: z.output<U>,
    ): Promise<unknown>
    archive(
      ctx: ReturnType<typeof tenantOf>,
      parentId: string,
      id: string,
      archived: boolean,
    ): Promise<unknown>
  }
}

/** Child resources (variants of an item, modifiers of a group): create / update / archive / restore. */
function registerChildren<E, S extends z.ZodType, C extends z.ZodType, U extends z.ZodType>(
  app: TalaApp<E>,
  def: ChildDefinition<S, C, U>,
) {
  const collection = tenantPath(`${def.parent}/{id}/${def.child}`)
  const member = `${collection}/{${def.key}}`
  const params = NestedParams(def.key)
  const childId = (p: Record<string, string>) => p[def.key] ?? ''

  app.openapi(
    createRoute({
      method: 'post',
      path: collection,
      tags: [def.tag],
      summary: `Add a ${def.noun}`,
      request: { params: TenantResourceParams, ...jsonBody(def.create) },
      responses: { 201: json(def.item, `The ${def.noun}`), ...errorResponses },
    }),
    async (c) => {
      requireRole(c, 'MANAGER')
      const input = valid<z.output<C>>(c, 'json')
      const parentId = valid<{ id: string }>(c, 'param').id
      return send(c, def.item, await def.handlers.create(tenantOf(c), parentId, input), 201)
    },
  )

  app.openapi(
    createRoute({
      method: 'patch',
      path: member,
      tags: [def.tag],
      summary: `Update a ${def.noun}`,
      request: { params, ...jsonBody(def.update) },
      responses: { 200: json(def.item, `The ${def.noun}`), ...errorResponses },
    }),
    async (c) => {
      requireRole(c, 'MANAGER')
      const p = valid<Record<string, string>>(c, 'param')
      const input = valid<z.output<U>>(c, 'json')
      return send(
        c,
        def.item,
        await def.handlers.update(tenantOf(c), p.id ?? '', childId(p), input),
      )
    },
  )

  for (const [method, suffix, archived] of [
    ['delete', '', true],
    ['post', '/restore', false],
  ] as const) {
    app.openapi(
      createRoute({
        method,
        path: `${member}${suffix}`,
        tags: [def.tag],
        summary: `${archived ? 'Archive' : 'Restore'} a ${def.noun}`,
        request: { params },
        responses: { 200: json(def.item, `The ${def.noun}`), ...errorResponses },
      }),
      async (c) => {
        requireRole(c, 'MANAGER')
        const p = valid<Record<string, string>>(c, 'param')
        return send(
          c,
          def.item,
          await def.handlers.archive(tenantOf(c), p.id ?? '', childId(p), archived),
        )
      },
    )
  }
}
