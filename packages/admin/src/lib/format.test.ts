import { describe, expect, it } from 'vitest'
import { parseMoney, toMoneyInput } from './format'

describe('money input', () => {
  it('parses decimal amounts into minor units', () => {
    expect(parseMoney('4.50', 'USD')).toBe(450)
    expect(parseMoney('4.5', 'USD')).toBe(450)
    expect(parseMoney('$12', 'USD')).toBe(1200)
    expect(parseMoney('0.07', 'USD')).toBe(7)
    expect(parseMoney('1500', 'JPY')).toBe(1500)
  })

  it('rejects what is not an amount', () => {
    expect(parseMoney('', 'USD')).toBeNull()
    expect(parseMoney('4.505', 'USD')).toBeNull()
    expect(parseMoney('1.2.3', 'USD')).toBeNull()
    expect(parseMoney('12.5', 'JPY')).toBeNull()
  })

  it('round-trips', () => {
    expect(toMoneyInput(450, 'USD')).toBe('4.50')
    expect(parseMoney(toMoneyInput(1999, 'EUR'), 'EUR')).toBe(1999)
    expect(toMoneyInput(1500, 'JPY')).toBe('1500')
  })
})
