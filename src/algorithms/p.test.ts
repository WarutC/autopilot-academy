import { describe, expect, it } from 'vitest'
import { PLANT } from '../sim/plant.ts'
import { defaultParams } from './index.ts'
import p from './p.ts'
import { controlContext as ctx, expectRootsOf, fliesCourse101 } from './lib/testing.ts'

describe('p module', () => {
  it('declares its id, modes and one Kp parameter', () => {
    expect(p.id).toBe('p')
    expect(p.name).toBe('P')
    expect(p.tag).toBe('Proportional')
    expect(p.modes).toEqual(['semi-auto', 'autopilot'])
    expect(p.params).toHaveLength(1)
    expect(p.params[0]).toMatchObject({
      key: 'Kp',
      accessibleName: 'Kp, proportional gain',
      min: 0,
      max: 1,
      step: 0.01,
      default: 0.1,
    })
  })

  it('ends its lesson with a Try: sentence naming Kp and the readout, with no HTML', () => {
    expect(p.lesson).toMatch(/Try: [^.]*\.$/)
    const tryText = p.lesson.slice(p.lesson.indexOf('Try:'))
    expect(tryText).toContain('Kp')
    expect(tryText).toContain('Pole readout')
    expect(p.lesson).not.toMatch(/</)
  })
})

describe('p controller', () => {
  it('pushes in proportion to the error', () => {
    const c = p.create(defaultParams(p))
    expect(c.compute(ctx({ ref: 60, h: 50 }))).toBeCloseTo(1, 12)
    expect(c.compute(ctx({ ref: 50, h: 53 }))).toBeCloseTo(-0.3, 12)
    expect(c.compute(ctx({ ref: 50, h: 50, v: 5 }))).toBe(0)
  })

  it('reads Kp live on every call', () => {
    const params: Record<string, number> = { Kp: 0.1 }
    const c = p.create(params)
    expect(c.compute(ctx({ ref: 52, h: 50 }))).toBeCloseTo(0.2, 12)
    params.Kp = 0.4
    expect(c.compute(ctx({ ref: 52, h: 50 }))).toBeCloseTo(0.8, 12)
  })

  it('returns 0 for non-finite inputs and never throws', () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(p.create({ Kp: 0.1 }).compute(ctx({ h: bad }))).toBe(0)
      expect(p.create({ Kp: 0.1 }).compute(ctx({ ref: bad }))).toBe(0)
      expect(p.create({ Kp: bad }).compute(ctx({ ref: 55, h: 50 }))).toBe(0)
    }
    const params: Record<string, number> = { Kp: Number.NaN }
    const c = p.create(params)
    expect(c.compute(ctx({ ref: 55 }))).toBe(0)
    params.Kp = 0.1
    expect(c.compute(ctx({ ref: 55 }))).toBeCloseTo(0.5, 12)
  })
})

describe('p analysis', () => {
  for (const Kp of [0.001, 0.02, 0.1, 0.5, 1]) {
    it(`gives the roots of s² + a·s + b·Kp for Kp ${Kp}`, () => {
      const chi = [1, PLANT.a, PLANT.b * Kp]
      const poles = p.analysis!({ Kp }).poles!
      expect(poles).toHaveLength(2)
      expectRootsOf(chi, poles)
      // Vieta: the sum is −a, the product b·Kp.
      const [s1, s2] = poles as [typeof poles[0], typeof poles[0]]
      expect(s1.re + s2.re).toBeCloseTo(-PLANT.a, 9)
      expect(s1.im + s2.im).toBeCloseTo(0, 9)
      expect(s1.re * s2.re - s1.im * s2.im).toBeCloseTo(PLANT.b * Kp, 9)
    })
  }

  it('shows the default as an underdamped pair near −0.25 ± 1.39j', () => {
    const poles = p.analysis!(defaultParams(p)).poles!
    expect(poles.map((s) => s.re)).toEqual([-0.25, -0.25])
    expect(poles[1]!.im).toBeCloseTo(1.39, 2)
    expect(poles[0]!.im).toBe(-poles[1]!.im)
  })

  it('gives a pole at 0 for Kp 0 and none for a non-finite Kp', () => {
    const poles = p.analysis!({ Kp: 0 }).poles!
    expect(poles.map((s) => s.re)).toEqual([-PLANT.a, 0])
    expect(p.analysis!({ Kp: Number.NaN }).poles).toEqual([])
  })
})

describe('p flies course 101', () => {
  fliesCourse101(p)
})
