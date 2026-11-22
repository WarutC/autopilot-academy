import { describe, expect, it } from 'vitest'
import { PLANT } from '../sim/plant.ts'
import { defaultParams } from './index.ts'
import pi from './pi.ts'
import { controlContext as ctx, expectRootsOf, fliesCourse101 } from './lib/testing.ts'

describe('pi module', () => {
  it('declares its id, modes and the Kp, Ki and anti-windup parameters', () => {
    expect(pi.id).toBe('pi')
    expect(pi.name).toBe('PI')
    expect(pi.tag).toBe('Proportional-integral')
    expect(pi.modes).toEqual(['semi-auto', 'autopilot'])
    expect(pi.params).toHaveLength(3)
    expect(pi.params[0]).toMatchObject({
      key: 'Kp',
      accessibleName: 'Kp, proportional gain',
      min: 0,
      max: 1,
      step: 0.01,
      default: 0.15,
    })
    expect(pi.params[1]).toMatchObject({
      key: 'Ki',
      accessibleName: 'Ki, integral gain',
      min: 0,
      max: 0.5,
      step: 0.005,
      default: 0.01,
    })
    expect(pi.params[2]).toMatchObject({ key: 'aw', accessibleName: 'Anti-windup', default: 1, toggle: true })
  })

  it('ends its lesson with a Try: sentence naming Ki, the readout and anti-windup, with no HTML', () => {
    expect(pi.lesson).toMatch(/Try: [^.]*\.$/)
    const tryText = pi.lesson.slice(pi.lesson.indexOf('Try:'))
    expect(tryText).toContain('Ki')
    expect(tryText).toContain('Pole readout')
    expect(tryText).toContain('anti-windup')
    expect(pi.lesson).not.toMatch(/</)
  })
})

describe('pi controller', () => {
  it('pushes Kp·e plus the integral, which grows by Ki·e·T each tick', () => {
    const c = pi.create({ Kp: 0.1, Ki: 0.5, aw: 1 })
    // e = 2: first tick uses I = 0, then I = 0.5·2·0.02 = 0.02.
    expect(c.compute(ctx({ ref: 52 }))).toBeCloseTo(0.2, 12)
    expect(c.compute(ctx({ ref: 52 }))).toBeCloseTo(0.22, 12)
    expect(c.compute(ctx({ ref: 52 }))).toBeCloseTo(0.24, 12)
    // At zero error only the integral (0.06) pushes.
    expect(c.compute(ctx({ ref: 50 }))).toBeCloseTo(0.06, 12)
  })

  it('clamps the output to [−1, 1]', () => {
    const c = pi.create({ Kp: 0.5, Ki: 0, aw: 1 })
    expect(c.compute(ctx({ ref: 60 }))).toBe(1)
    expect(c.compute(ctx({ ref: 40 }))).toBe(-1)
  })

  it('holds the integral while saturated with anti-windup on', () => {
    const c = pi.create({ Kp: 0.5, Ki: 0.5, aw: 1 })
    for (let i = 0; i < 100; i++) expect(c.compute(ctx({ ref: 60 }))).toBe(1)
    // The integral never grew, so at zero error the output is 0.
    expect(c.compute(ctx({ ref: 50 }))).toBe(0)
  })

  it('keeps integrating while saturated with anti-windup off', () => {
    const c = pi.create({ Kp: 0.5, Ki: 0.5, aw: 0 })
    for (let i = 0; i < 100; i++) expect(c.compute(ctx({ ref: 60 }))).toBe(1)
    // I = 100 · 0.5 · 10 · 0.02 = 10: still saturated at zero error.
    expect(c.compute(ctx({ ref: 50 }))).toBe(1)
  })

  it('clamps the integral to ±50', () => {
    const params: Record<string, number> = { Kp: 0, Ki: 0.5, aw: 0 }
    const c = pi.create(params)
    for (let i = 0; i < 2000; i++) c.compute(ctx({ ref: 60 }))
    // Read I back without saturating: raw = 1·(50 − 99.99) + I is 0.01 only if I is exactly 50.
    params.Ki = 0
    params.Kp = 1
    expect(c.compute(ctx({ ref: 50, h: 99.99 }))).toBeCloseTo(0.01, 9)
  })

  it('reads its gains live on every call', () => {
    const params: Record<string, number> = { Kp: 0.1, Ki: 0, aw: 1 }
    const c = pi.create(params)
    expect(c.compute(ctx({ ref: 52 }))).toBeCloseTo(0.2, 12)
    params.Kp = 0.4
    expect(c.compute(ctx({ ref: 52 }))).toBeCloseTo(0.8, 12)
    params.Ki = 0.5
    c.compute(ctx({ ref: 52 }))
    params.Kp = 0
    expect(c.compute(ctx({ ref: 52 }))).toBeCloseTo(0.02, 12)
  })

  it('returns 0 for non-finite inputs and leaves the integrator untouched', () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(pi.create({ Kp: 0.1, Ki: 0.01, aw: 1 }).compute(ctx({ h: bad }))).toBe(0)
      expect(pi.create({ Kp: 0.1, Ki: 0.01, aw: 1 }).compute(ctx({ ref: bad }))).toBe(0)
      expect(pi.create({ Kp: bad, Ki: 0.01, aw: 1 }).compute(ctx({ ref: 55 }))).toBe(0)

      const params: Record<string, number> = { Kp: 0, Ki: 0.5, aw: 1 }
      const c = pi.create(params)
      c.compute(ctx({ ref: 52 })) // I = 0.02
      expect(c.compute(ctx({ h: bad }))).toBe(0)
      expect(c.compute(ctx({ ref: bad }))).toBe(0)
      params.Ki = bad
      expect(c.compute(ctx({ ref: 52 }))).toBe(0)
      params.Ki = 0
      expect(c.compute(ctx({ ref: 50 }))).toBeCloseTo(0.02, 12)
    }
  })
})

describe('pi analysis', () => {
  for (const [Kp, Ki] of [
    [0.15, 0.01],
    [0.1, 0],
    [0.5, 0.2],
    [1, 0.5],
    [0.02, 0.005],
  ] as const) {
    it(`gives the roots of s³ + a·s² + b·Kp·s + b·Ki for Kp ${Kp}, Ki ${Ki}`, () => {
      const chi = [1, PLANT.a, PLANT.b * Kp, PLANT.b * Ki]
      const poles = pi.analysis!({ Kp, Ki, aw: 1 }).poles!
      expect(poles).toHaveLength(3)
      expectRootsOf(chi, poles)
      // Vieta: the sum is −a, the product −b·Ki.
      const sumRe = poles.reduce((acc, s) => acc + s.re, 0)
      const sumIm = poles.reduce((acc, s) => acc + s.im, 0)
      expect(sumRe).toBeCloseTo(-PLANT.a, 9)
      expect(sumIm).toBeCloseTo(0, 9)
      const product = poles.reduce(
        (acc, s) => ({ re: acc.re * s.re - acc.im * s.im, im: acc.re * s.im + acc.im * s.re }),
        { re: 1, im: 0 },
      )
      expect(product.re).toBeCloseTo(-PLANT.b * Ki, 9)
      expect(product.im).toBeCloseTo(0, 9)
    })
  }

  it('gives a pole at 0 for Ki 0', () => {
    const poles = pi.analysis!({ Kp: 0.1, Ki: 0, aw: 1 }).poles!
    expect(poles.some((s) => s.re === 0 && s.im === 0)).toBe(true)
  })

  it('shows a slow real pole for the defaults', () => {
    const poles = pi.analysis!(defaultParams(pi)).poles!
    const real = poles.filter((s) => s.im === 0)
    expect(real).toHaveLength(1)
    expect(real[0]!.re).toBeLessThan(0)
    expect(real[0]!.re).toBeGreaterThan(-0.2)
  })

  it('gives no poles for a non-finite gain', () => {
    expect(pi.analysis!({ Kp: Number.NaN, Ki: 0.01, aw: 1 }).poles).toEqual([])
    expect(pi.analysis!({ Kp: 0.1, Ki: Number.POSITIVE_INFINITY, aw: 1 }).poles).toEqual([])
  })
})

describe('pi flies course 101', () => {
  fliesCourse101(pi)
})
