import { app, type TestApp, tenantWithOwner } from './helpers.js'

/** A small café: a taxed latte (two sizes, milk choice, required shots), croissants in stock. */
export async function cafe({
  pricesIncludeTax = false,
  target = app,
}: {
  pricesIncludeTax?: boolean
  target?: TestApp
} = {}) {
  const t = await tenantWithOwner('USD', target)
  const api = t.as(t.owner.caller)
  const store = (
    await api.post('/stores', { name: 'Main', slug: 'main', currency: 'USD', pricesIncludeTax })
  ).body
  const tax = (await api.post('/tax-rates', { name: 'Sales tax', rateBps: 825 })).body
  const croissants = (
    await api.post('/stock-levels', { storeId: store.id, name: 'Croissants', onHand: 5 })
  ).body
  const oatMilk = (
    await api.post('/stock-levels', {
      storeId: store.id,
      name: 'Oat milk',
      onHand: 2,
      trackStrictly: false,
    })
  ).body
  const milk = (
    await api.post('/modifier-groups', {
      name: 'Milk',
      minSelect: 0,
      maxSelect: 1,
      modifiers: [
        { name: 'Whole', priceDeltaMinor: 0 },
        { name: 'Oat', priceDeltaMinor: 75, stockLevelId: oatMilk.id },
      ],
    })
  ).body
  const shots = (
    await api.post('/modifier-groups', {
      name: 'Shots',
      minSelect: 1,
      maxSelect: 1,
      modifiers: [
        { name: 'Single', priceDeltaMinor: 0 },
        { name: 'Double', priceDeltaMinor: 100 },
      ],
    })
  ).body
  const latte = (
    await api.post('/items', {
      name: 'Latte',
      taxRateId: tax.id,
      variants: [
        { name: '12oz', priceMinor: 450 },
        { name: '16oz', priceMinor: 525 },
      ],
      modifierGroupIds: [milk.id, shots.id],
    })
  ).body
  const croissant = (
    await api.post('/items', {
      name: 'Croissant',
      taxRateId: tax.id,
      variants: [{ name: 'Regular', priceMinor: 350, stockLevelId: croissants.id }],
    })
  ).body

  const [whole, oat] = milk.modifiers.map((m: { id: string }) => m.id)
  const [single, double] = shots.modifiers.map((m: { id: string }) => m.id)
  const ids = {
    latte12: latte.variants[0].id as string,
    latte16: latte.variants[1].id as string,
    croissant: croissant.variants[0].id as string,
    whole,
    oat,
    single,
    double,
  }
  const onHand = async (levelId: string) =>
    (await api.get(`/stock-levels/${levelId}`)).body.onHand as number
  return { t, api, store, tax, croissants, oatMilk, latte, croissant, ids, onHand }
}
