import { z } from 'zod'
import { Currency, divRoundHalfUp, MinorUnits, NonNegativeMinorUnits, safeMul } from './money.js'

/**
 * Order pricing. This is the single implementation used by the API *and* by offline terminals,
 * so a sale totals identically wherever it's computed.
 *
 * Rules:
 * - Amounts are integer minor units; one currency per order.
 * - A line's amount is `(unitPrice + Σ modifier deltas) × quantity`. Voided lines count as zero.
 * - Tax is computed **per tax rate, per order**: line amounts are grouped by `taxRateBps`
 *   and each group is rounded once (half away from zero). This avoids per-line rounding drift.
 * - `pricesIncludeTax = false` (US-style): prices are net; tax is added on top.
 *   `pricesIncludeTax = true` (VAT-style): prices are gross; tax is extracted from them.
 * - Invariant: `subtotalMinor + taxMinor === totalMinor`, always.
 */

/** Tax rate in basis points: 825 = 8.25%. */
export const TaxRateBps = z.number().int().min(0).max(100_000)

export const PricingLineInput = z.object({
  unitPriceMinor: NonNegativeMinorUnits,
  quantity: z.number().int().positive(),
  modifierDeltasMinor: z.array(MinorUnits).default([]),
  taxRateBps: TaxRateBps.default(0),
  voided: z.boolean().default(false),
})
export type PricingLineInput = z.input<typeof PricingLineInput>

export const PricingInput = z.object({
  currency: Currency,
  pricesIncludeTax: z.boolean(),
  lines: z.array(PricingLineInput),
})
export type PricingInput = z.input<typeof PricingInput>

export interface PricedLine {
  /** Unit price including modifier deltas. */
  unitTotalMinor: number
  /** `unitTotalMinor × quantity`, or 0 if voided. Gross when prices include tax, net otherwise. */
  lineTotalMinor: number
}

export interface TaxBreakdown {
  rateBps: number
  /** Net amount the tax applies to. */
  taxableMinor: number
  taxMinor: number
}

export interface PricingResult {
  currency: string
  lines: PricedLine[]
  /** Net of tax. */
  subtotalMinor: number
  taxMinor: number
  /** What the customer pays (before tips). */
  totalMinor: number
  taxes: TaxBreakdown[]
}

const BPS = 10_000

export function priceOrder(input: PricingInput): PricingResult {
  const { currency, pricesIncludeTax, lines } = PricingInput.parse(input)

  const pricedLines: PricedLine[] = lines.map((line) => {
    const unitTotalMinor = line.modifierDeltasMinor.reduce((sum, d) => sum + d, line.unitPriceMinor)
    if (unitTotalMinor < 0) throw new RangeError('A line cannot have a negative unit total')
    return {
      unitTotalMinor,
      lineTotalMinor: line.voided ? 0 : safeMul(unitTotalMinor, line.quantity),
    }
  })

  // Group line amounts by tax rate (stable order: ascending rate).
  const byRate = new Map<number, number>()
  lines.forEach((line, i) => {
    const amount = pricedLines[i]?.lineTotalMinor ?? 0
    byRate.set(line.taxRateBps, (byRate.get(line.taxRateBps) ?? 0) + amount)
  })

  const taxes: TaxBreakdown[] = [...byRate.entries()]
    .sort(([a], [b]) => a - b)
    .map(([rateBps, amount]) => {
      const taxMinor = pricesIncludeTax
        ? divRoundHalfUp(safeMul(amount, rateBps), BPS + rateBps)
        : divRoundHalfUp(safeMul(amount, rateBps), BPS)
      return { rateBps, taxableMinor: pricesIncludeTax ? amount - taxMinor : amount, taxMinor }
    })

  const subtotalMinor = taxes.reduce((s, t) => s + t.taxableMinor, 0)
  const taxMinor = taxes.reduce((s, t) => s + t.taxMinor, 0)

  return {
    currency,
    lines: pricedLines,
    subtotalMinor,
    taxMinor,
    totalMinor: subtotalMinor + taxMinor,
    taxes,
  }
}
