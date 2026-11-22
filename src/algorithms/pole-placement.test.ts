import { describe, expect, it } from 'vitest'
import { PLANT } from '../sim/plant.ts'
import type { ControlContext } from '../sim/types.ts'
import { defaultParams } from './index.ts'
import { flyCourse } from './lib/fly-course.ts'
import { polyAt } from './lib/poly.ts'
import polePlacement from './pole-placement.ts'

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

describe('pole-placement module', () => {
  it('declares its id, modes and the ωn and ζ parameters', () => {
    expect(polePlacement.id).toBe('pole-placement')
    expect(polePlacement.name).toBe('Pole Placement')
    expect(polePlacement.tag).toBe('State feedback')
    expect(polePlacement.modes).toEqual(['semi-auto', 'autopilot'])
    expect(polePlacement.params).toHaveLength(2)
    expect(polePlacement.params[0]).toMatchObject({
      key: 'wn',
      label: 'Natural frequency ωn',
      accessibleName: 'omega n, natural frequency',
      unit: 'rad/s',
      min: 0.5,
      max: 6,
      step: 0.1,
      default: 2,
    })
    expect(polePlacement.params[1]).toMatchObject({
      key: 'zeta',
      label: 'Damping ratio ζ',
      accessibleName: 'zeta, damping ratio',
      min: 0.1,
      max: 1.5,
      step: 0.05,
      default: 0.8,
    })
  })

  it('ends its lesson with a Try: sentence naming ωn, ζ and the readout, with no HTML', () => {
    const lesson = polePlacement.lesson
    expect(lesson).toMatch(/Try: [^.]*\.$/)
    const tryText = lesson.slice(lesson.indexOf('Try:'))
    expect(tryText).toContain('ωn')
    expect(tryText).toContain('ζ')
    expect(tryText).toContain('Pole readout')
    expect(lesson).not.toMatch(/</)
  })
})

describe('pole-placement controller', () => {
  it('flies u = k1·(ref − h) − k2·v with the placement gains', () => {
    const c = polePlacement.create(defaultParams(polePlacement))
    const k1 = 4 / PLANT.b
    const k2 = (2 * 0.8 * 2 - PLANT.a) / PLANT.b
    expect(c.compute(ctx({ ref: 60, h: 50 }))).toBeCloseTo(10 * k1, 12)
    expect(c.compute(ctx({ v: 2 }))).toBeCloseTo(-2 * k2, 12)
    expect(c.compute(ctx())).toBe(0)
  })

  it('reads ωn and ζ live on every call', () => {
    const params: Record<string, number> = { wn: 2, zeta: 0.8 }
    const c = polePlacement.create(params)
    expect(c.compute(ctx({ ref: 51 }))).toBeCloseTo(4 / PLANT.b, 12)
    params.wn = 4
    expect(c.compute(ctx({ ref: 51 }))).toBeCloseTo(16 / PLANT.b, 12)
    params.zeta = 1
    expect(c.compute(ctx({ v: 1 }))).toBeCloseTo(-(8 - PLANT.a) / PLANT.b, 12)
  })

  it('returns 0 for non-finite inputs and never throws', () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      const p = defaultParams(polePlacement)
      expect(polePlacement.create(p).compute(ctx({ h: bad }))).toBe(0)
      expect(polePlacement.create(p).compute(ctx({ ref: bad }))).toBe(0)
      expect(polePlacement.create(p).compute(ctx({ v: bad }))).toBe(0)
      expect(polePlacement.create({ wn: bad, zeta: 0.8 }).compute(ctx({ ref: 55 }))).toBe(0)
      expect(polePlacement.create({ wn: 2, zeta: bad }).compute(ctx({ ref: 55 }))).toBe(0)
      expect(polePlacement.analysis!({ wn: bad, zeta: 0.8 })).toEqual({ poles: [], gains: {} })
      expect(polePlacement.analysis!({ wn: 2, zeta: bad })).toEqual({ poles: [], gains: {} })
    }
  })
})

describe('pole-placement analysis', () => {
  for (const [wn, zeta] of [[2, 0.8], [0.5, 0.1], [6, 1.5], [1, 1], [2, 1.5]] as const) {
    it(`places the poles at the roots of s² + 2ζωn·s + ωn² for ωn ${wn}, ζ ${zeta}`, () => {
      const chi = [1, 2 * zeta * wn, wn * wn]
      const { poles, gains } = polePlacement.analysis!({ wn, zeta })
      expect(gains).toEqual({ k1: (wn * wn) / PLANT.b, k2: (2 * zeta * wn - PLANT.a) / PLANT.b })
      expect(poles).toHaveLength(2)
      for (const s of poles!) {
        const r = polyAt(chi, s)
        expect(Math.hypot(r.re, r.im)).toBeLessThan(1e-9)
      }
      const [s1, s2] = poles!
      expect(s1!.re + s2!.re).toBeCloseTo(-2 * zeta * wn, 9)
      expect(s1!.re * s2!.re - s1!.im * s2!.im).toBeCloseTo(wn * wn, 9)
    })
  }

  it('shows the defaults as −1.6 ± 1.2j', () => {
    const poles = polePlacement.analysis!(defaultParams(polePlacement)).poles!
    expect(poles[0]!.re).toBeCloseTo(-1.6, 9)
    expect(poles[1]!.re).toBeCloseTo(-1.6, 9)
    expect(poles[0]!.im).toBeCloseTo(-1.2, 9)
    expect(poles[1]!.im).toBeCloseTo(1.2, 9)
  })

  it('gives two real poles when overdamped', () => {
    const poles = polePlacement.analysis!({ wn: 2, zeta: 1.5 }).poles!
    expect(poles.every((s) => s.im === 0)).toBe(true)
    expect(poles[0]!.re * poles[1]!.re).toBeCloseTo(4, 9)
    expect(poles[0]!.re + poles[1]!.re).toBeCloseTo(-6, 9)
  })

  it('moves the poles and gains when a parameter changes', () => {
    const before = polePlacement.analysis!({ wn: 2, zeta: 0.8 })
    const faster = polePlacement.analysis!({ wn: 3, zeta: 0.8 })
    const lighter = polePlacement.analysis!({ wn: 2, zeta: 0.5 })
    expect(faster.poles).not.toEqual(before.poles)
    expect(faster.gains!.k1).not.toBe(before.gains!.k1)
    expect(lighter.poles).not.toEqual(before.poles)
    expect(lighter.gains!.k2).not.toBe(before.gains!.k2)
  })
})

describe('pole-placement flies course 101', () => {
  it('passes at least 6 of 10 rings in Autopilot without crashing', () => {
    const flight = flyCourse(polePlacement, defaultParams(polePlacement), 'autopilot')
    expect(flight.status).not.toBe('crashed')
    expect(flight.ringsPassed).toBeGreaterThanOrEqual(6)
  })

  it('finishes Semi-auto', () => {
    expect(flyCourse(polePlacement, defaultParams(polePlacement), 'semi-auto').status).toBe('finished')
  })
})
