import { describe, expect, it } from 'vitest'
import { Id, uuidv7 } from './ids.js'

describe('uuidv7', () => {
  it('produces valid, version-7, time-ordered ids', () => {
    const a = uuidv7(1_700_000_000_000)
    const b = uuidv7(1_700_000_000_001)
    expect(Id.safeParse(a).success).toBe(true)
    expect(a[14]).toBe('7')
    expect(['8', '9', 'a', 'b']).toContain(a[19])
    expect(a < b).toBe(true)
    expect(a.slice(0, 13)).toBe('018bcfe5-6800')
  })

  it('is strictly increasing within a millisecond', () => {
    const ids = Array.from({ length: 10_000 }, () => uuidv7())
    for (let i = 1; i < ids.length; i++) expect((ids[i - 1] ?? '') < (ids[i] ?? '')).toBe(true)
    expect(ids.every((id) => Id.safeParse(id).success && id[14] === '7')).toBe(true)
  })

  it('stays monotonic when the clock steps backwards', () => {
    const realNow = Date.now
    try {
      const ahead = realNow() + 1000
      Date.now = () => ahead
      const before = uuidv7()
      Date.now = () => ahead - 1000
      expect(uuidv7() > before).toBe(true)
    } finally {
      Date.now = realNow
    }
  })
})
