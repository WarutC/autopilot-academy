import { describe, expect, it } from 'vitest'
import type { Complex } from '../index.ts'
import { polyAt, polyRoots } from './poly.ts'

const near = (got: readonly Complex[], want: readonly Complex[]) => {
  expect(got).toHaveLength(want.length)
  got.forEach((r, i) => {
    expect(r.re).toBeCloseTo(want[i]!.re, 9)
    expect(r.im).toBeCloseTo(want[i]!.im, 9)
  })
}

describe('polyRoots', () => {
  it('finds two real roots, sorted by real part', () => {
    near(polyRoots([1, -3, 2]), [
      { re: 1, im: 0 },
      { re: 2, im: 0 },
    ])
    for (const r of polyRoots([1, -3, 2])) expect(r.im).toBe(0)
  })

  it('finds ±j as an exact conjugate pair', () => {
    const roots = polyRoots([1, 0, 1])
    near(roots, [
      { re: 0, im: -1 },
      { re: 0, im: 1 },
    ])
    expect(roots[0]!.re).toBe(roots[1]!.re)
    expect(roots[0]!.im).toBe(-roots[1]!.im)
  })

  it('drops leading zeros', () => {
    near(polyRoots([0, 1, -2]), [{ re: 2, im: 0 }])
    near(polyRoots([0, 0, 1, -3, 2]), [
      { re: 1, im: 0 },
      { re: 2, im: 0 },
    ])
  })

  it('gives no roots for a constant or empty polynomial', () => {
    expect(polyRoots([5])).toEqual([])
    expect(polyRoots([0, 0, 5])).toEqual([])
    expect(polyRoots([])).toEqual([])
    expect(polyRoots([0])).toEqual([])
  })

  it('gives [] for any non-finite coefficient', () => {
    expect(polyRoots([1, Number.NaN, 2])).toEqual([])
    expect(polyRoots([Number.POSITIVE_INFINITY, 1])).toEqual([])
    expect(polyRoots([1, 2, Number.NEGATIVE_INFINITY])).toEqual([])
  })

  it('gives exact roots at 0 for trailing zeros, never -0', () => {
    const roots = polyRoots([1, 3, 0])
    near(roots, [
      { re: -3, im: 0 },
      { re: 0, im: 0 },
    ])
    expect(Object.is(roots[1]!.re, 0)).toBe(true)
    expect(Object.is(roots[1]!.im, 0)).toBe(true)
  })

  it('solves a linear polynomial directly', () => {
    near(polyRoots([2, 4]), [{ re: -2, im: 0 }])
  })

  it('finds a mixed cubic with small residuals and snapped real parts', () => {
    // (s + 2)(s² + 2s + 5): −2 and −1 ± 2j.
    const coeffs = [1, 4, 9, 10]
    const roots = polyRoots(coeffs)
    near(roots, [
      { re: -2, im: 0 },
      { re: -1, im: -2 },
      { re: -1, im: 2 },
    ])
    expect(roots[0]!.im).toBe(0)
    expect(roots[1]!.re).toBe(roots[2]!.re)
    expect(roots[1]!.im).toBe(-roots[2]!.im)
    for (const r of roots) {
      const v = polyAt(coeffs, r)
      expect(Math.hypot(v.re, v.im)).toBeLessThan(1e-9)
    }
  })

  it('handles a quartic with two complex pairs', () => {
    // (s² + 1)(s² + 4): ±j, ±2j.
    const roots = polyRoots([1, 0, 5, 0, 4])
    expect(roots).toHaveLength(4)
    const ims = roots.map((r) => r.im).sort((a, b) => a - b)
    ;[-2, -1, 1, 2].forEach((w, i) => expect(ims[i]).toBeCloseTo(w, 9))
    for (const r of roots) expect(Math.abs(r.re)).toBeLessThan(1e-9)
  })

  it('finds a double root closely enough', () => {
    const roots = polyRoots([1, 2, 1])
    expect(roots).toHaveLength(2)
    for (const r of roots) {
      expect(r.re).toBeCloseTo(-1, 6)
      expect(Math.abs(r.im)).toBeLessThan(1e-6)
    }
  })

  it('never writes to its input', () => {
    const coeffs = Object.freeze([0, 1, -3, 2])
    expect(() => polyRoots(coeffs)).not.toThrow()
    expect(coeffs).toEqual([0, 1, -3, 2])
  })
})

describe('polyAt', () => {
  it('evaluates with Horner at a complex point', () => {
    // s² + 1 at j is 0; at 1 + j is 1 + 2j.
    expect(polyAt([1, 0, 1], { re: 0, im: 1 })).toEqual({ re: 0, im: 0 })
    expect(polyAt([1, 0, 1], { re: 1, im: 1 })).toEqual({ re: 1, im: 2 })
    expect(polyAt([], { re: 3, im: 1 })).toEqual({ re: 0, im: 0 })
  })
})
