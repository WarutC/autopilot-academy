import { describe, expect, it } from 'vitest'
import { PLANT } from '../sim/plant.ts'
import type { ControlContext } from '../sim/types.ts'
import { defaultParams } from './index.ts'
import pid from './pid.ts'
import { controlContext as ctx, expectRootsOf } from './lib/testing.ts'

// The prototype's PID `make`, inlined as the reference.
const prototypeClamp = (x: number, lo: number, hi: number) => (x < lo ? lo : x > hi ? hi : x)
function prototypeMake(p: { Kp: number; Ki: number; Kd: number; aw: boolean; dmeas: boolean }) {
  let I = 0
  let rPrev: number | null = null
  return {
    compute(c: ControlContext) {
      const e = c.ref - c.h
      const dr = rPrev === null ? 0 : (c.ref - rPrev) / c.T
      rPrev = c.ref
      const D = p.dmeas ? -p.Kd * c.v : p.Kd * (dr - c.v)
      const raw = p.Kp * e + I + D
      const u = prototypeClamp(raw, -1, 1)
      if (!(p.aw && raw !== u && Math.sign(e) === Math.sign(raw))) I += p.Ki * e * c.T
      I = prototypeClamp(I, -50, 50)
      return u
    },
  }
}

// Deterministic, varied inputs.
const tick = (k: number): ControlContext =>
  ctx({
    t: k * 0.02,
    ref: 50 + 20 * Math.sin(k * 0.05) + (k > 100 ? 15 : 0),
    h: 50 + 25 * Math.sin(k * 0.031 + 1),
    v: 8 * Math.cos(k * 0.07),
  })

describe('pid module', () => {
  it('declares its id, modes and parameters', () => {
    expect(pid.id).toBe('pid')
    expect(pid.name).toBe('PID')
    expect(pid.tag).toBe('Three-term')
    expect(pid.modes).toEqual(['semi-auto', 'autopilot'])
    expect(pid.params.map((s) => s.key)).toEqual(['Kp', 'Ki', 'Kd', 'aw', 'dmeas'])
    expect(pid.params.filter((s) => s.toggle).map((s) => s.key)).toEqual(['aw', 'dmeas'])
    expect(pid.params[0].accessibleName).toBe('Kp, proportional gain')
  })

  it('ends its lesson with a Try: sentence and no HTML', () => {
    expect(pid.lesson).toMatch(/Try: [^.]*\.$/)
    expect(pid.lesson).not.toMatch(/</)
  })
})

describe('pid controller', () => {
  it('saturates on a 10 m step and holds the integrator under anti-windup', () => {
    const c = pid.create(defaultParams(pid))
    expect(c.compute(ctx({ ref: 60, h: 50, v: 0 }))).toBe(1)
    // With I still 0, a zero-error tick returns only the D term (v = 0).
    expect(c.compute(ctx({ ref: 60, h: 60, v: 0 }))).toBe(0)
  })

  it('integrates on a step when anti-windup is off', () => {
    const c = pid.create({ ...defaultParams(pid), aw: 0 })
    c.compute(ctx({ ref: 60, h: 50, v: 0 }))
    expect(c.compute(ctx({ ref: 60, h: 60, v: 0 }))).toBeCloseTo(0.03 * 10 * 0.02, 12)
  })

  const combos = [
    { aw: 0, dmeas: 0 },
    { aw: 1, dmeas: 0 },
    { aw: 0, dmeas: 1 },
    { aw: 1, dmeas: 1 },
  ]
  for (const { aw, dmeas } of combos) {
    it(`matches the prototype over 200 ticks (aw ${aw}, dmeas ${dmeas})`, () => {
      const params = { ...defaultParams(pid), Kp: 0.6, Ki: 0.2, Kd: 0.1, aw, dmeas }
      const ours = pid.create(params)
      const ref = prototypeMake({ ...params, aw: aw === 1, dmeas: dmeas === 1 })
      for (let k = 0; k < 200; k++) {
        const c = tick(k)
        expect(ours.compute(c)).toBeCloseTo(ref.compute(c), 12)
      }
    })
  }

  it('matches the prototype with default params', () => {
    const ours = pid.create(defaultParams(pid))
    const ref = prototypeMake({ Kp: 0.2, Ki: 0.03, Kd: 0.05, aw: true, dmeas: true })
    for (let k = 0; k < 200; k++) {
      const c = tick(k)
      const u = ours.compute(c)
      expect(u).toBeCloseTo(ref.compute(c), 12)
      expect(Math.abs(u)).toBeLessThanOrEqual(1)
    }
  })

  it('matches the prototype with default gains and toggles off', () => {
    const ours = pid.create({ ...defaultParams(pid), aw: 0, dmeas: 0 })
    const ref = prototypeMake({ Kp: 0.2, Ki: 0.03, Kd: 0.05, aw: false, dmeas: false })
    for (let k = 0; k < 200; k++) {
      const c = tick(k)
      expect(ours.compute(c)).toBeCloseTo(ref.compute(c), 12)
    }
  })

  it('reads params live on every call', () => {
    const params: Record<string, number> = { ...defaultParams(pid), Ki: 0, Kd: 0 }
    const c = pid.create(params)
    expect(c.compute(ctx({ ref: 52, h: 50 }))).toBeCloseTo(0.4, 12)
    params.Kp = 0.1
    expect(c.compute(ctx({ ref: 52, h: 50 }))).toBeCloseTo(0.2, 12)
  })

  it('returns 0 for a NaN measurement and is not poisoned', () => {
    const c = pid.create(defaultParams(pid))
    expect(c.compute(ctx({ h: Number.NaN }))).toBe(0)
    const u = c.compute(ctx({ ref: 55, h: 50 }))
    expect(Number.isFinite(u)).toBe(true)
    expect(u).toBeCloseTo(0.2 * 5, 12)
  })

  it('returns 0 for an infinite gain and recovers when it is fixed', () => {
    const params: Record<string, number> = { ...defaultParams(pid), Kp: Number.POSITIVE_INFINITY }
    const c = pid.create(params)
    expect(c.compute(ctx({ ref: 55, h: 50 }))).toBe(0)
    params.Kp = 0.1
    const u = c.compute(ctx({ ref: 55, h: 50 }))
    expect(Number.isFinite(u)).toBe(true)
    expect(u).toBeCloseTo(0.5, 12)
  })

  it('leaves a non-zero integrator untouched on a NaN measurement tick', () => {
    const params = { ...defaultParams(pid), aw: 0 }
    const a = pid.create(params)
    const b = pid.create(params)
    for (let k = 0; k < 5; k++) {
      a.compute(ctx({ ref: 60, h: 50 }))
      b.compute(ctx({ ref: 60, h: 50 }))
    }
    expect(a.compute(ctx({ ref: 60, h: Number.NaN }))).toBe(0)
    // Zero error: only the integrator is left in the output.
    const ua = a.compute(ctx({ ref: 60, h: 60 }))
    expect(ua).toBeCloseTo(5 * 0.03 * 10 * 0.02, 12)
    expect(ua).toBe(b.compute(ctx({ ref: 60, h: 60 })))
  })

  it('keeps the previous setpoint across a non-finite setpoint tick', () => {
    const params = { ...defaultParams(pid), Ki: 0, dmeas: 0 }
    const a = pid.create(params)
    const b = pid.create(params)
    a.compute(ctx({ ref: 50, h: 50 }))
    b.compute(ctx({ ref: 50, h: 50 }))
    expect(a.compute(ctx({ ref: Number.NaN, h: 50 }))).toBe(0)
    // The setpoint kick is measured from 50, the last finite setpoint.
    const ua = a.compute(ctx({ ref: 50.1, h: 50 }))
    expect(ua).toBeCloseTo(0.2 * 0.1 + 0.05 * (0.1 / 0.02), 12)
    expect(ua).toBe(b.compute(ctx({ ref: 50.1, h: 50 })))
  })

  it('never throws on non-finite inputs', () => {
    const c = pid.create(defaultParams(pid))
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(() => c.compute(ctx({ ref: bad }))).not.toThrow()
      expect(c.compute(ctx({ v: bad }))).toBe(0)
    }
    expect(Number.isFinite(c.compute(ctx({ ref: 51, h: 50 })))).toBe(true)
  })
})

describe('pid analysis', () => {
  const { a, b } = PLANT
  const sets = [
    { Kp: 0.2, Ki: 0.03, Kd: 0.05 },
    { Kp: 0.6, Ki: 0.2, Kd: 0.1 },
    { Kp: 1, Ki: 0.5, Kd: 0 },
    { Kp: 0.05, Ki: 0, Kd: 0.3 },
  ]
  for (const gains of sets) {
    it(`gives the roots of the closed-loop cubic for Kp ${gains.Kp}, Ki ${gains.Ki}, Kd ${gains.Kd}`, () => {
      const chi = [1, a + b * gains.Kd, b * gains.Kp, b * gains.Ki]
      for (const toggles of [{ aw: 0, dmeas: 0 }, { aw: 1, dmeas: 1 }]) {
        const poles = pid.analysis!({ ...gains, ...toggles }).poles!
        expect(poles).toHaveLength(3)
        expectRootsOf(chi, poles)
        // Vieta: the sum is −(a + b·Kd), the product −b·Ki.
        expect(poles.reduce((sum, s) => sum + s.re, 0)).toBeCloseTo(-(a + b * gains.Kd), 9)
        expect(poles.reduce((sum, s) => sum + s.im, 0)).toBeCloseTo(0, 9)
        const product = poles.reduce((acc, s) => ({ re: acc.re * s.re - acc.im * s.im, im: acc.re * s.im + acc.im * s.re }), { re: 1, im: 0 })
        expect(product.re).toBeCloseTo(-b * gains.Ki, 9)
      }
    })
  }

  it('puts a pole at 0 when Ki is 0', () => {
    const poles = pid.analysis!({ ...defaultParams(pid), Ki: 0 }).poles!
    expect(poles.some((s) => s.re === 0 && s.im === 0)).toBe(true)
  })

  it('gives stable default poles', () => {
    for (const s of pid.analysis!(defaultParams(pid)).poles!) expect(s.re).toBeLessThan(0)
  })
})
