import { describe, expect, it } from 'vitest'
import { Currency, divRoundHalfUp, formatMoney, minorUnitDigits } from './money.js'

describe('divRoundHalfUp', () => {
  it.each([
    [5, 2, 3],
    [4, 2, 2],
    [7, 3, 2],
    [8, 3, 3],
    [-5, 2, -3],
    [-7, 3, -2],
    [0, 7, 0],
  ])('%i / %i = %i', (n, d, expected) => {
    expect(divRoundHalfUp(n, d)).toBe(expected)
  })

  it('rejects non-integers and bad denominators', () => {
    expect(() => divRoundHalfUp(1.5, 2)).toThrow(RangeError)
    expect(() => divRoundHalfUp(1, 0)).toThrow(RangeError)
  })
})

describe('currency', () => {
  it('validates ISO 4217 codes', () => {
    expect(Currency.safeParse('USD').success).toBe(true)
    expect(Currency.safeParse('usd').success).toBe(false)
    expect(Currency.safeParse('XYZ').success).toBe(false)
  })

  it('knows minor-unit digits', () => {
    expect(minorUnitDigits('USD')).toBe(2)
    expect(minorUnitDigits('JPY')).toBe(0)
    expect(minorUnitDigits('KWD')).toBe(3)
  })

  it('formats minor units', () => {
    expect(formatMoney(1250, 'USD')).toBe('$12.50')
    expect(formatMoney(500, 'JPY', 'en-US')).toBe('¥500')
    expect(formatMoney(-99, 'USD')).toBe('-$0.99')
  })
})
