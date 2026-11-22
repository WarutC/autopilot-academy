import { describe, expect, it } from 'vitest'
import { PLANT } from '../../sim/plant.ts'
import { polyAt } from './poly.ts'
import { lqrRiccati, placementGains, riccatiResidual, stateFeedbackCommand, stateFeedbackPoles } from './state-feedback.ts'

const { a, b } = PLANT

describe('placementGains', () => {
  for (const [wn, zeta] of [[2, 0.8], [0.5, 0.1], [6, 1.5], [3, 1]] as const) {
    it(`gives the closed loop s² + 2ζωn·s + ωn² for ωn ${wn}, ζ ${zeta}`, () => {
      const g = placementGains(wn, zeta)!
      expect(a + b * g.k2).toBeCloseTo(2 * zeta * wn, 12)
      expect(b * g.k1).toBeCloseTo(wn * wn, 12)
    })
  }

  it('is undefined for non-finite input', () => {
    expect(placementGains(Number.NaN, 0.8)).toBeUndefined()
    expect(placementGains(2, Number.POSITIVE_INFINITY)).toBeUndefined()
  })
})

describe('lqrRiccati', () => {
  const sets = [
    [1, 0.01, 10],
    [0.01, 0.001, 1000],
    [100, 10, 0.1],
    [0.01, 10, 0.1],
    [100, 0.001, 1000],
    [3, 0.5, 2],
  ] as const
  for (const [qh, qv, r] of sets) {
    it(`solves the Riccati equation with P positive definite for qh ${qh}, qv ${qv}, r ${r}`, () => {
      const sol = lqrRiccati(qh, qv, r)!
      const [p11, p12, p22] = sol.P
      const scale = Math.max(qh, qv, Math.abs(p11), Math.abs(p12), Math.abs(p22), 1)
      expect(riccatiResidual(sol.P, qh, qv, r) / scale).toBeLessThan(1e-9)
      expect(p11).toBeGreaterThan(0)
      expect(p11 * p22 - p12 * p12).toBeGreaterThan(0)
      // K = R⁻¹BᵀP = (b/r)·[p12, p22].
      expect(sol.k1).toBeCloseTo((b / r) * p12, 12)
      expect(sol.k2).toBeCloseTo((b / r) * p22, 12)
      const poles = stateFeedbackPoles(sol.k1, sol.k2)
      expect(poles).toHaveLength(2)
      for (const s of poles) expect(s.re).toBeLessThan(0)
    })
  }

  it('matches the known default case', () => {
    const sol = lqrRiccati(1, 0.01, 10)!
    expect(sol.k1).toBeCloseTo(Math.sqrt(0.1), 12)
    expect(sol.k1).toBeCloseTo(0.316, 3)
    expect(sol.k2).toBeCloseTo(0.157, 3)
  })

  it('is undefined for bad weights', () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(lqrRiccati(bad, 0.01, 10)).toBeUndefined()
      expect(lqrRiccati(1, bad, 10)).toBeUndefined()
      expect(lqrRiccati(1, 0.01, bad)).toBeUndefined()
    }
    expect(lqrRiccati(1, 0.01, 0)).toBeUndefined()
    expect(lqrRiccati(1, 0.01, -1)).toBeUndefined()
    expect(lqrRiccati(0, 0.01, 10)).toBeUndefined()
    expect(lqrRiccati(1, -1, 10)).toBeUndefined()
  })
})

describe('riccatiResidual', () => {
  it('is non-zero for a wrong P and NaN for bad input', () => {
    expect(riccatiResidual([1, 1, 1], 1, 0.01, 10)).toBeGreaterThan(0.1)
    expect(riccatiResidual([Number.NaN, 1, 1], 1, 0.01, 10)).toBeNaN()
  })
})

describe('stateFeedbackPoles', () => {
  it('gives the roots of s² + (a + b·k2)·s + b·k1', () => {
    const chi = [1, a + b * 0.157, b * 0.316]
    const poles = stateFeedbackPoles(0.316, 0.157)
    expect(poles).toHaveLength(2)
    for (const s of poles) {
      const r = polyAt(chi, s)
      expect(Math.hypot(r.re, r.im)).toBeLessThan(1e-9)
    }
  })

  it('gives no poles for non-finite gains', () => {
    expect(stateFeedbackPoles(Number.NaN, 0.1)).toEqual([])
    expect(stateFeedbackPoles(0.1, Number.POSITIVE_INFINITY)).toEqual([])
  })
})

describe('stateFeedbackCommand', () => {
  it('is k1·(ref − h) − k2·v and 0 for missing gains or non-finite results', () => {
    expect(stateFeedbackCommand({ k1: 0.2, k2: 0.1 }, 60, 50, 3)).toBeCloseTo(1.7, 12)
    expect(stateFeedbackCommand(undefined, 60, 50, 3)).toBe(0)
    expect(stateFeedbackCommand({ k1: 0.2, k2: 0.1 }, Number.NaN, 50, 3)).toBe(0)
  })
})
