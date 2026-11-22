import { describe, expect, it } from 'vitest'
import { PLANT } from '../sim/plant.ts'
import type { ControlContext } from '../sim/types.ts'
import { defaultParams } from './index.ts'
import { flyCourse } from './lib/fly-course.ts'
import { polyAt } from './lib/poly.ts'
import pd from './pd.ts'

const ctx = (over: Partial<ControlContext> = {}): ControlContext => ({
  t: 0,
  T: 0.02,
  ref: 50,
  h: 50,
  v: 0,
  input: 0,
  refAhead: () => 50,
  ...over,
})

describe('pd module', () => {
  it('declares its id, modes and the Kp and Kd parameters', () => {
    expect(pd.id).toBe('pd')
    expect(pd.name).toBe('PD')
    expect(pd.tag).toBe('Proportional-derivative')
    expect(pd.modes).toEqual(['semi-auto', 'autopilot'])
    expect(pd.params).toHaveLength(2)
    expect(pd.params[0]).toMatchObject({
      key: 'Kp',
      accessibleName: 'Kp, proportional gain',
      min: 0,
      max: 1,
      step: 0.01,
      default: 0.2,
    })
    expect(pd.params[1]).toMatchObject({
      key: 'Kd',
      accessibleName: 'Kd, derivative gain',
      min: 0,
      max: 0.3,
      step: 0.005,
      default: 0.05,
    })
  })

  it('ends its lesson with a Try: sentence naming Kd and the readout, with no HTML', () => {
    expect(pd.lesson).toMatch(/Try: [^.]*\.$/)
    const tryText = pd.lesson.slice(pd.lesson.indexOf('Try:'))
    expect(tryText).toContain('Kd')
    expect(tryText).toContain('Pole readout')
    expect(pd.lesson).not.toMatch(/</)
  })
})

describe('pd controller', () => {
  it('pushes Kp·e and brakes with Kd times the climb rate', () => {
    const c = pd.create(defaultParams(pd))
    expect(c.compute(ctx({ ref: 55, h: 50 }))).toBeCloseTo(1, 12)
    expect(c.compute(ctx({ ref: 50, h: 52 }))).toBeCloseTo(-0.4, 12)
    expect(c.compute(ctx({ ref: 55, h: 50, v: 4 }))).toBeCloseTo(0.8, 12)
  })

  it('brakes on the climb rate alone at zero error', () => {
    const c = pd.create(defaultParams(pd))
    expect(c.compute(ctx({ v: 6 }))).toBeCloseTo(-0.3, 12)
    expect(c.compute(ctx({ v: -6 }))).toBeCloseTo(0.3, 12)
  })

  it('gives no kick when the setpoint steps', () => {
    const c = pd.create({ Kp: 0, Kd: 0.3 })
    c.compute(ctx({ ref: 50 }))
    expect(c.compute(ctx({ ref: 90 }))).toBe(0)
  })

  it('reads its gains live on every call', () => {
    const params: Record<string, number> = { Kp: 0.1, Kd: 0 }
    const c = pd.create(params)
    expect(c.compute(ctx({ ref: 52, v: 2 }))).toBeCloseTo(0.2, 12)
    params.Kd = 0.1
    expect(c.compute(ctx({ ref: 52, v: 2 }))).toBeCloseTo(0, 12)
    params.Kp = 0.4
    expect(c.compute(ctx({ ref: 52, v: 2 }))).toBeCloseTo(0.6, 12)
  })

  it('returns 0 for non-finite inputs and never throws', () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(pd.create({ Kp: 0.2, Kd: 0.05 }).compute(ctx({ h: bad }))).toBe(0)
      expect(pd.create({ Kp: 0.2, Kd: 0.05 }).compute(ctx({ ref: bad }))).toBe(0)
      expect(pd.create({ Kp: 0.2, Kd: 0.05 }).compute(ctx({ v: bad }))).toBe(0)
      expect(pd.create({ Kp: bad, Kd: 0.05 }).compute(ctx({ ref: 55 }))).toBe(0)
      expect(pd.create({ Kp: 0.2, Kd: bad }).compute(ctx({ ref: 55, v: 1 }))).toBe(0)
    }
    const params: Record<string, number> = { Kp: Number.NaN, Kd: 0.05 }
    const c = pd.create(params)
    expect(c.compute(ctx({ ref: 55 }))).toBe(0)
    params.Kp = 0.1
    expect(c.compute(ctx({ ref: 55 }))).toBeCloseTo(0.5, 12)
  })
})

describe('pd analysis', () => {
  for (const [Kp, Kd] of [
    [0.2, 0.05],
    [0.1, 0],
    [0.01, 0.3],
    [1, 0.1],
    [0.5, 0.005],
  ] as const) {
    it(`gives the roots of s² + (a + b·Kd)·s + b·Kp for Kp ${Kp}, Kd ${Kd}`, () => {
      const chi = [1, PLANT.a + PLANT.b * Kd, PLANT.b * Kp]
      const poles = pd.analysis!({ Kp, Kd }).poles!
      expect(poles).toHaveLength(2)
      for (const s of poles) {
        const r = polyAt(chi, s)
        expect(Math.hypot(r.re, r.im)).toBeLessThan(1e-9)
      }
      // Vieta: the sum is −(a + b·Kd), the product b·Kp.
      const [s1, s2] = poles as [typeof poles[0], typeof poles[0]]
      expect(s1.re + s2.re).toBeCloseTo(-(PLANT.a + PLANT.b * Kd), 9)
      expect(s1.im + s2.im).toBeCloseTo(0, 9)
      expect(s1.re * s2.re - s1.im * s2.im).toBeCloseTo(PLANT.b * Kp, 9)
    })
  }

  it('shows the default as a damped pair near −0.75 ± 1.85j', () => {
    const poles = pd.analysis!(defaultParams(pd)).poles!
    expect(poles).toHaveLength(2)
    expect(poles[0]!.re).toBeCloseTo(-0.75, 9)
    expect(poles[1]!.re).toBeCloseTo(-0.75, 9)
    expect(poles[1]!.im).toBeCloseTo(1.85, 2)
    expect(poles[0]!.im).toBe(-poles[1]!.im)
  })

  it('gives no poles for a non-finite gain', () => {
    expect(pd.analysis!({ Kp: Number.NaN, Kd: 0.05 }).poles).toEqual([])
    expect(pd.analysis!({ Kp: 0.2, Kd: Number.POSITIVE_INFINITY }).poles).toEqual([])
  })
})

describe('pd flies course 101', () => {
  it('passes at least 6 of 10 rings in Autopilot without crashing', () => {
    const flight = flyCourse(pd, defaultParams(pd), 'autopilot')
    expect(flight.status).not.toBe('crashed')
    expect(flight.ringsPassed).toBeGreaterThanOrEqual(6)
  })

  it('finishes Semi-auto', () => {
    expect(flyCourse(pd, defaultParams(pd), 'semi-auto').status).toBe('finished')
  })
})
