import { z } from 'zod'

/** ISO 4217 alphabetic currency code, e.g. `USD`, `EUR`, `JPY`. */
export const Currency = z
  .string()
  .regex(/^[A-Z]{3}$/, 'Expected an ISO 4217 currency code such as "USD"')
  .refine(isKnownCurrency, 'Unknown ISO 4217 currency code')
export type Currency = z.infer<typeof Currency>

/** An amount in the currency's minor unit (cents for USD, yen for JPY). Always an integer. */
export const MinorUnits = z.number().int().refine(Number.isSafeInteger, 'Amount is out of range')
export type MinorUnits = z.infer<typeof MinorUnits>

/** A non-negative amount in minor units (prices, totals). */
export const NonNegativeMinorUnits = MinorUnits.refine((n) => n >= 0, 'Amount must be >= 0')

export const Money = z.object({ amountMinor: MinorUnits, currency: Currency })
export type Money = z.infer<typeof Money>

let knownCurrencies: Set<string> | undefined

function isKnownCurrency(code: string): boolean {
  knownCurrencies ??= new Set(Intl.supportedValuesOf('currency'))
  return knownCurrencies.has(code)
}

/** Number of decimal places of the currency's minor unit (USD → 2, JPY → 0, KWD → 3). */
export function minorUnitDigits(currency: Currency): number {
  return (
    new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions()
      .maximumFractionDigits ?? 2
  )
}

/** Format minor units for display, e.g. `formatMoney(1250, 'USD')` → `$12.50`. */
export function formatMoney(amountMinor: number, currency: Currency, locale = 'en-US'): string {
  assertSafeInteger(amountMinor)
  const digits = minorUnitDigits(currency)
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(amountMinor / 10 ** digits)
}

/**
 * Integer division rounded half away from zero (`roundHalfUp(5, 2) === 3`, `roundHalfUp(-5, 2) === -3`).
 * `numerator` and `denominator` must be safe integers and `denominator > 0`.
 */
export function divRoundHalfUp(numerator: number, denominator: number): number {
  assertSafeInteger(numerator)
  assertSafeInteger(denominator)
  if (denominator <= 0) throw new RangeError('denominator must be > 0')
  const sign = numerator < 0 ? -1 : 1
  const n = Math.abs(numerator)
  const q = Math.floor(n / denominator)
  const r = n - q * denominator
  return sign * (r * 2 >= denominator ? q + 1 : q)
}

export function assertSafeInteger(n: number): void {
  if (!Number.isSafeInteger(n)) throw new RangeError(`Expected a safe integer, got ${n}`)
}

/** Multiply checking that the result stays a safe integer. */
export function safeMul(a: number, b: number): number {
  const r = a * b
  assertSafeInteger(r)
  return r
}
