import { describe, expect, it } from 'vitest'
import { clamp } from './clamp.ts'

describe('clamp', () => {
  it('keeps values inside the range', () => {
    expect(clamp(0.25, -1, 1)).toBe(0.25)
  })

  it('pins values outside the range to the nearest bound', () => {
    expect(clamp(3, -1, 1)).toBe(1)
    expect(clamp(-Infinity, -1, 1)).toBe(-1)
  })

  it('maps NaN to 0, or the bound nearest 0', () => {
    expect(clamp(NaN, -1, 1)).toBe(0)
    expect(clamp(NaN, 2, 5)).toBe(2)
  })
})
