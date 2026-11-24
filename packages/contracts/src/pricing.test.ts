import { describe, expect, it } from 'vitest'
import { type PricingInput, priceOrder } from './pricing.js'

const latte = { unitPriceMinor: 450, quantity: 1, taxRateBps: 825 }

describe('priceOrder (tax added on top)', () => {
  it('prices modifiers and quantities', () => {
    const r = priceOrder({
      currency: 'USD',
      pricesIncludeTax: false,
      lines: [{ ...latte, quantity: 2, modifierDeltasMinor: [75, 50] }], // oat + extra shot
    })
    expect(r.lines[0]).toEqual({ unitTotalMinor: 575, lineTotalMinor: 1150 })
    expect(r.subtotalMinor).toBe(1150)
    expect(r.taxMinor).toBe(95) // 94.875 → 95
    expect(r.totalMinor).toBe(1245)
  })

  it('rounds once per rate, not per line', () => {
    // Three lines at 8.25% on 101: per-line would be 8+8+8 = 24; per-rate is round(24.9975) = 25.
    const r = priceOrder({
      currency: 'USD',
      pricesIncludeTax: false,
      lines: Array.from({ length: 3 }, () => ({
        unitPriceMinor: 101,
        quantity: 1,
        taxRateBps: 825,
      })),
    })
    expect(r.taxMinor).toBe(25)
  })

  it('breaks down multiple rates and ignores voided lines', () => {
    const r = priceOrder({
      currency: 'USD',
      pricesIncludeTax: false,
      lines: [
        latte,
        { unitPriceMinor: 300, quantity: 1, taxRateBps: 0 }, // untaxed bag of beans
        { ...latte, voided: true },
      ],
    })
    expect(r.lines[2]?.lineTotalMinor).toBe(0)
    expect(r.taxes).toEqual([
      { rateBps: 0, taxableMinor: 300, taxMinor: 0 },
      { rateBps: 825, taxableMinor: 450, taxMinor: 37 },
    ])
    expect(r.totalMinor).toBe(787)
  })

  it('allows negative modifiers but not negative unit totals', () => {
    const base = { currency: 'USD', pricesIncludeTax: false } as const
    expect(
      priceOrder({
        ...base,
        lines: [{ unitPriceMinor: 300, quantity: 1, modifierDeltasMinor: [-50] }],
      }).totalMinor,
    ).toBe(250)
    expect(() =>
      priceOrder({
        ...base,
        lines: [{ unitPriceMinor: 30, quantity: 1, modifierDeltasMinor: [-50] }],
      }),
    ).toThrow(RangeError)
  })
})

describe('priceOrder (tax-inclusive prices)', () => {
  it('extracts tax from gross prices; total equals the sum of prices', () => {
    const r = priceOrder({
      currency: 'EUR',
      pricesIncludeTax: true,
      lines: [{ unitPriceMinor: 350, quantity: 3, taxRateBps: 1900 }],
    })
    expect(r.totalMinor).toBe(1050)
    expect(r.taxMinor).toBe(168) // 1050 × 19/119 = 167.65 → 168
    expect(r.subtotalMinor).toBe(882)
  })
})

describe('invariants', () => {
  it('subtotal + tax === total for many random orders', () => {
    let seed = 42
    const rand = (n: number) => {
      seed = (seed * 1103515245 + 12345) % 2 ** 31
      return seed % n
    }
    for (let i = 0; i < 2000; i++) {
      const input: PricingInput = {
        currency: 'USD',
        pricesIncludeTax: rand(2) === 0,
        lines: Array.from({ length: 1 + rand(6) }, () => ({
          unitPriceMinor: rand(5000),
          quantity: 1 + rand(5),
          modifierDeltasMinor: [rand(200)],
          taxRateBps: [0, 500, 825, 1000, 2000][rand(5)] ?? 0,
          voided: rand(10) === 0,
        })),
      }
      const r = priceOrder(input)
      expect(r.subtotalMinor + r.taxMinor).toBe(r.totalMinor)
      expect(r.taxes.reduce((s, t) => s + t.taxableMinor + t.taxMinor, 0)).toBe(r.totalMinor)
      if (input.pricesIncludeTax) {
        expect(r.totalMinor).toBe(r.lines.reduce((s, l) => s + l.lineTotalMinor, 0))
      }
    }
  })
})
