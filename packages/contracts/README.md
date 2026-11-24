# @talajs/contracts

The shared vocabulary of [Tala](https://github.com/NovaDovaDao/talajs): Zod schemas and TypeScript types for every API request and response, money and tax math, ids, and the register sync protocol. It depends only on `zod` and runs anywhere: Workers, browsers, Node, and offline registers.

```sh
pnpm add @talajs/contracts
```

## Types for the API

```ts
import type { CreateOrder, Order } from '@talajs/contracts'
import { Order as OrderSchema } from '@talajs/contracts'

const order: Order = OrderSchema.parse(await res.json())
```

Every schema carries an OpenAPI id (`.meta({ id })`), and `@talajs/api` validates its responses against them, so these types are exactly what the API returns.

## Money and pricing

Amounts are integer minor units plus an ISO 4217 currency.

```ts
import { formatMoney, priceOrder } from '@talajs/contracts'

const totals = priceOrder({
  currency: 'USD',
  pricesIncludeTax: false,
  lines: [
    { unitPriceMinor: 450, quantity: 2, modifierDeltasMinor: [75], taxRateBps: 825 },
  ],
})
// { subtotalMinor: 1050, taxMinor: 87, totalMinor: 1137, ... }
formatMoney(totals.totalMinor, 'USD') // "$11.37"
```

`priceOrder` is the one pricing function used by the server, the admin and offline registers, so a sale totals the same wherever it's computed. Tax is grouped per rate and rounded once (half away from zero), and `subtotal + tax === total` always holds. Set `pricesIncludeTax` for VAT-style menus.

## Ids

```ts
import { uuidv7 } from '@talajs/contracts'

const orderId = uuidv7() // time-ordered and strictly increasing within a process
```

Registers generate ids offline; they double as idempotency keys when syncing.

## Sync protocol

The terminal pairing, push, pull and review-queue schemas are in `src/api/sync.ts`, described in [docs/sync-protocol.md](https://github.com/NovaDovaDao/talajs/blob/main/docs/sync-protocol.md).

## License

Apache-2.0
