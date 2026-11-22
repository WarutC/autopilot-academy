import { describe, expect, it } from 'vitest'
import fuzzy, { fuzzyRules } from './fuzzy.ts'
import { BUILT_IN_ORDER, algorithms, findAlgorithm } from './index.ts'
import { controlContext as ctx, fliesCourse101 } from './lib/testing.ts'

describe('fuzzy module', () => {
  it('declares its id, modes and three parameters', () => {
    expect(fuzzy.id).toBe('fuzzy')
    expect(fuzzy.name).toBe('Fuzzy')
    expect(fuzzy.tag).toBe('Rule-based')
    expect(fuzzy.modes).toEqual(['semi-auto', 'autopilot'])
    expect(fuzzy.params).toHaveLength(3)
    expect(fuzzy.params[0]).toMatchObject({
      key: 'Ne',
      label: 'Error span',
      accessibleName: 'Error span, meters of error that count as large',
      unit: 'm',
      min: 2,
      max: 40,
      step: 1,
      default: 10,
    })
    expect(fuzzy.params[1]).toMatchObject({
      key: 'Nv',
      label: 'Climb span',
      accessibleName: 'Climb span, climb rate that counts as fast',
      unit: 'm/s',
      min: 2,
      max: 40,
      step: 1,
      default: 25,
    })
    expect(fuzzy.params[2]).toMatchObject({
      key: 'Ku',
      label: 'Output gain',
      accessibleName: 'Output gain',
      min: 0,
      max: 1,
      step: 0.05,
      default: 0.8,
    })
  })

  it('ends its lesson with a Try: sentence naming a parameter, with no HTML', () => {
    expect(fuzzy.lesson).toMatch(/Try: [^.]*\.$/)
    const tryText = fuzzy.lesson.slice(fuzzy.lesson.indexOf('Try:'))
    expect(fuzzy.params.some((spec) => tryText.includes(spec.label))).toBe(true)
    expect(fuzzy.lesson).not.toMatch(/</)
  })

  it('has no analysis, so the Pole readout stays hidden', () => {
    expect(fuzzy.analysis).toBeUndefined()
    expect('analysis' in fuzzy).toBe(false)
  })

  it('is registered as a built-in in its teaching-order slot', () => {
    const found = findAlgorithm('fuzzy')
    expect(found).toBeDefined()
    expect(found!.community).toBe(false)
    const ids = algorithms.map((m) => m.id)
    const at = ids.indexOf('fuzzy')
    const slot = BUILT_IN_ORDER.indexOf('fuzzy')
    expect(slot).toBeGreaterThanOrEqual(0)
    for (const id of ids.filter((i) => i !== 'fuzzy' && BUILT_IN_ORDER.includes(i))) {
      if (BUILT_IN_ORDER.indexOf(id) < slot) expect(ids.indexOf(id)).toBeLessThan(at)
      else expect(ids.indexOf(id)).toBeGreaterThan(at)
    }
  })
})

describe('fuzzy controller', () => {
  const params = { Ne: 10, Nv: 25, Ku: 0.8 }
  const grid = [-100, -12, -10, -7, -3, -0.4, 0, 0.4, 3, 7, 10, 12, 100]

  it('gives 0 at the target and level', () => {
    expect(fuzzy.create(params).compute(ctx({ ref: 50, h: 50, v: 0 }))).toBe(0)
  })

  it('fires the full climb rule, times the output gain, when far below and level', () => {
    const c = fuzzy.create(params)
    expect(fuzzyRules(1, 0)).toBeCloseTo(1, 12)
    expect(c.compute(ctx({ ref: 60, h: 50 }))).toBeCloseTo(0.8, 12)
    expect(c.compute(ctx({ ref: 500, h: 50 }))).toBeCloseTo(0.8, 12)
    for (let a = -1; a <= 1; a += 0.1) {
      for (let b = -1; b <= 1; b += 0.1) expect(Math.abs(fuzzyRules(a, b))).toBeLessThanOrEqual(1 + 1e-12)
    }
  })

  it('is odd: flipping error and climb rate flips the output', () => {
    const c = fuzzy.create(params)
    for (const e of grid) {
      for (const v of grid) {
        const u = c.compute(ctx({ ref: 50 + e, h: 50, v }))
        const m = c.compute(ctx({ ref: 50 - e, h: 50, v: -v }))
        expect(Math.abs(u + m)).toBeLessThan(1e-12)
      }
    }
    for (let a = -1; a <= 1; a += 0.05) {
      for (let b = -1; b <= 1; b += 0.05) {
        expect(Math.abs(fuzzyRules(a, b) + fuzzyRules(-a, -b))).toBeLessThan(1e-12)
      }
    }
  })

  it('gives 0 when the error and climb rate cancel', () => {
    const c = fuzzy.create(params)
    for (const r of [-1, -0.8, -0.5, -0.3, 0, 0.2, 0.5, 0.75, 1]) {
      expect(Math.abs(c.compute(ctx({ ref: 50 + r * params.Ne, h: 50, v: r * params.Nv })))).toBeLessThan(1e-12)
    }
  })

  it('stays in [-1, 1] for any finite input and params in range', () => {
    for (const Ne of [2, 10, 40]) {
      for (const Nv of [2, 25, 40]) {
        for (const Ku of [0, 0.5, 1]) {
          const c = fuzzy.create({ Ne, Nv, Ku })
          for (const e of grid) {
            for (const v of grid) {
              const u = c.compute(ctx({ ref: 50 + e, h: 50, v }))
              expect(u).toBeGreaterThanOrEqual(-1)
              expect(u).toBeLessThanOrEqual(1)
            }
          }
        }
      }
    }
  })

  it('never pushes less as the error rises with the plane level', () => {
    const c = fuzzy.create(params)
    let last = -Infinity
    for (let e = -20; e <= 20; e += 0.25) {
      const u = c.compute(ctx({ ref: 50 + e, h: 50, v: 0 }))
      expect(u).toBeGreaterThanOrEqual(last - 1e-12)
      last = u
    }
  })

  it('reads params live on every call', () => {
    const live: Record<string, number> = { Ne: 10, Nv: 25, Ku: 0.8 }
    const c = fuzzy.create(live)
    expect(c.compute(ctx({ ref: 60, h: 50 }))).toBeCloseTo(0.8 * fuzzyRules(1, 0), 12)
    live.Ku = 0.4
    expect(c.compute(ctx({ ref: 60, h: 50 }))).toBeCloseTo(0.4 * fuzzyRules(1, 0), 12)
    live.Ne = 20
    expect(c.compute(ctx({ ref: 60, h: 50 }))).toBeCloseTo(0.4 * fuzzyRules(0.5, 0), 12)
  })

  it('returns 0 for non-finite inputs or params and never throws', () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      const c = fuzzy.create(params)
      expect(c.compute(ctx({ h: bad }))).toBe(0)
      expect(c.compute(ctx({ ref: bad }))).toBe(0)
      expect(c.compute(ctx({ ref: 60, v: bad }))).toBe(0)
    }
    for (const key of ['Ne', 'Nv', 'Ku']) {
      expect(fuzzy.create({ ...params, [key]: Number.NaN }).compute(ctx({ ref: 60, h: 50, v: 3 }))).toBe(0)
    }
    expect(fuzzy.create({}).compute(ctx({ ref: 60 }))).toBe(0)
  })

  it('gives a finite output in [-1, 1] with a zero span', () => {
    for (const span of [{ Ne: 0 }, { Nv: 0 }, { Ne: 0, Nv: 0 }]) {
      const c = fuzzy.create({ ...params, ...span })
      for (const e of [-5, 0, 5]) {
        for (const v of [-5, 0, 5]) {
          const u = c.compute(ctx({ ref: 50 + e, h: 50, v }))
          expect(Number.isFinite(u)).toBe(true)
          expect(u).toBeGreaterThanOrEqual(-1)
          expect(u).toBeLessThanOrEqual(1)
        }
      }
    }
  })
})

describe('fuzzy flies course 101', () => {
  fliesCourse101(fuzzy)
})
