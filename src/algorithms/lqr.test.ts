import { describe, expect, it } from 'vitest'
import { PLANT } from '../sim/plant.ts'
import { defaultParams } from './index.ts'
import { lqrRiccati, riccatiResidual } from './lib/state-feedback.ts'
import lqr from './lqr.ts'
import { controlContext as ctx, expectRootsOf, fliesCourse101 } from './lib/testing.ts'

const { a, b } = PLANT
const K1 = Math.sqrt(0.1)
const K2 = (Math.sqrt(a * a + (b * b * 0.01) / 10 + 2 * b * K1) - a) / b

describe('lqr module', () => {
  it('declares its id, modes and three log-scaled weights', () => {
    expect(lqr.id).toBe('lqr')
    expect(lqr.name).toBe('LQR')
    expect(lqr.tag).toBe('Optimal')
    expect(lqr.modes).toEqual(['semi-auto', 'autopilot'])
    expect(lqr.params.map((s) => s.key)).toEqual(['qh', 'qv', 'r'])
    expect(lqr.params[0]).toMatchObject({ label: 'Q altitude error', min: 0.01, max: 100, step: 0.01, default: 1, log: true })
    expect(lqr.params[1]).toMatchObject({ label: 'Q climb rate', min: 0.001, max: 10, step: 0.001, default: 0.01, log: true })
    expect(lqr.params[2]).toMatchObject({ label: 'R elevator effort', min: 0.1, max: 1000, step: 0.01, default: 10, log: true })
    for (const s of lqr.params) {
      expect(s.min).toBeGreaterThan(0)
      expect(s.step).toBeLessThanOrEqual(s.min)
      expect(s.accessibleName.length).toBeGreaterThan(0)
    }
  })

  it('ends its lesson with a Try: sentence naming the weights and the readout, with no HTML', () => {
    expect(lqr.lesson).toMatch(/Try: [^.]*\.$/)
    const tryText = lqr.lesson.slice(lqr.lesson.indexOf('Try:'))
    expect(tryText).toContain('Q altitude error')
    expect(tryText).toContain('Q climb rate')
    expect(tryText).toContain('R elevator effort')
    expect(tryText).toContain('Pole readout')
    expect(lqr.lesson).not.toMatch(/</)
  })
})

describe('lqr controller', () => {
  it('flies u = k1·(ref − h) − k2·v with the Riccati gains', () => {
    const c = lqr.create(defaultParams(lqr))
    expect(c.compute(ctx({ ref: 60, h: 50 }))).toBeCloseTo(10 * K1, 12)
    expect(c.compute(ctx({ v: 2 }))).toBeCloseTo(-2 * K2, 12)
    expect(c.compute(ctx())).toBe(0)
  })

  it('reads the weights live on every call', () => {
    const params: Record<string, number> = defaultParams(lqr)
    const c = lqr.create(params)
    expect(c.compute(ctx({ ref: 51 }))).toBeCloseTo(K1, 12)
    params.r = 1
    expect(c.compute(ctx({ ref: 51 }))).toBeCloseTo(1, 12)
    params.qh = 4
    expect(c.compute(ctx({ ref: 51 }))).toBeCloseTo(2, 12)
  })

  it('returns 0 for non-finite inputs or bad weights and never throws', () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 0, -1]) {
      for (const key of ['qh', 'qv', 'r']) {
        if (key === 'qv' && bad === 0) continue
        const params = { ...defaultParams(lqr), [key]: bad }
        expect(lqr.create(params).compute(ctx({ ref: 55 }))).toBe(0)
        expect(lqr.analysis!(params)).toEqual({ poles: [], gains: {} })
      }
    }
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(lqr.create(defaultParams(lqr)).compute(ctx({ h: bad }))).toBe(0)
      expect(lqr.create(defaultParams(lqr)).compute(ctx({ v: bad }))).toBe(0)
    }
    const params: Record<string, number> = { ...defaultParams(lqr), r: Number.NaN }
    const c = lqr.create(params)
    expect(c.compute(ctx({ ref: 51 }))).toBe(0)
    params.r = 10
    expect(c.compute(ctx({ ref: 51 }))).toBeCloseTo(K1, 12)
  })
})

describe('lqr analysis', () => {
  const sets = [
    [1, 0.01, 10],
    [0.01, 0.001, 1000],
    [100, 10, 0.1],
    [0.01, 10, 1000],
    [100, 0.001, 0.1],
  ] as const
  for (const [qh, qv, r] of sets) {
    it(`reports stable poles of the Riccati gains for qh ${qh}, qv ${qv}, r ${r}`, () => {
      const { poles, gains } = lqr.analysis!({ qh, qv, r })
      const sol = lqrRiccati(qh, qv, r)!
      expect(gains).toEqual({ k1: sol.k1, k2: sol.k2 })
      const scale = Math.max(qh, qv, ...sol.P.map(Math.abs), 1)
      expect(riccatiResidual(sol.P, qh, qv, r) / scale).toBeLessThan(1e-9)
      const chi = [1, a + b * sol.k2, b * sol.k1]
      expect(poles).toHaveLength(2)
      expectRootsOf(chi, poles!)
      for (const s of poles!) expect(s.re).toBeLessThan(0)
    })
  }

  it('gives k1 ≈ 0.316 and k2 ≈ 0.157 for the defaults', () => {
    const { gains } = lqr.analysis!(defaultParams(lqr))
    expect(gains!.k1).toBeCloseTo(0.316, 3)
    expect(gains!.k2).toBeCloseTo(0.157, 3)
    expect(gains!.k2).toBeCloseTo(K2, 12)
  })

  it('moves the poles and gains when a weight changes', () => {
    const before = lqr.analysis!(defaultParams(lqr))
    for (const [key, value] of [['qh', 10], ['qv', 1], ['r', 1]] as const) {
      const after = lqr.analysis!({ ...defaultParams(lqr), [key]: value })
      expect(after.poles).not.toEqual(before.poles)
      expect(after.gains).not.toEqual(before.gains)
    }
  })
})

describe('lqr flies course 101', () => {
  fliesCourse101(lqr)
})
