import { describe, it, expect } from 'vitest'
import { formatZAR, formatZARCompact } from './money'

// en-ZA groups with a non-breaking space; compare with plain spaces.
const plain = (s: string) => s.replace(/\s/g, ' ')

describe('formatZAR', () => {
  // FB-015 (UAT-05-S02): Today printed R5 169 while Planning printed R 5 168,78 for the same day, and its chart
  // axis a third shape. One format: whole rands, no space after the R, en-ZA grouping (rubric UX-4).
  it('prints whole rands the way Today always has', () => {
    expect(plain(formatZAR(5168.78))).toBe('R5 169')
    expect(plain(formatZAR(36603.61))).toBe('R36 604')
    expect(formatZAR(600)).toBe('R600')
    expect(formatZAR(0)).toBe('R0')
  })

  it('keeps the sign of a negative amount in front of the R', () => {
    expect(plain(formatZAR(-1250.4))).toBe('-R1 250')
  })

  // FB-015 review: a missing amount is not zero takings, so null must not read "R0", nor NaN "RNaN".
  it('prints a dash for a missing or non-finite amount', () => {
    for (const missing of [NaN, undefined, null, Infinity, -Infinity]) {
      expect(formatZAR(missing)).toBe('—')
      expect(formatZARCompact(missing)).toBe('—')
    }
  })
})

describe('formatZARCompact', () => {
  it('compacts thousands only from ten thousand up, in the same shape', () => {
    expect(formatZARCompact(600)).toBe('R600')
    expect(plain(formatZARCompact(2400))).toBe('R2 400')
    expect(formatZARCompact(20000)).toBe('R20k')
    expect(formatZARCompact(-20000)).toBe('-R20k')
  })
})
