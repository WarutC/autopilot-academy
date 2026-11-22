import { describe, expect, it } from 'vitest'
import { PLANT } from '../sim/plant.ts'
import { createRun } from '../sim/run.ts'
import type { ControlContext } from '../sim/types.ts'
import cascadePid, { climbRateCommand } from './cascade-pid.ts'
import { defaultParams } from './index.ts'
import { FLY_COURSE, flyCourse, semiAutoSetpoint } from './lib/fly-course.ts'
import { controlContext as ctx, fliesCourse101 } from './lib/testing.ts'

/** Flies course 101 with a wrapper that records the commanded and measured climb rate each tick. */
function recordFlight(params: Record<string, number>, mode: 'semi-auto' | 'autopilot') {
  const commands: number[] = []
  const rates: number[] = []
  const recorder = {
    id: 'cascade-pid',
    create(p: Readonly<Record<string, number>>) {
      const inner = cascadePid.create(p)
      return {
        compute(c: ControlContext) {
          const u = inner.compute(c)
          commands.push(inner.climbRate)
          rates.push(c.v)
          return u
        },
      }
    },
  }
  const run = createRun({ course: FLY_COURSE, mode, player: { algorithm: recorder, params } })
  for (let steps = 0; !run.done && steps < 1_000_000; steps += 4) {
    if (mode === 'semi-auto') run.setSetpoint(semiAutoSetpoint(steps * PLANT.dt))
    run.step(4)
  }
  return { commands, rates, status: run.result('player')!.status }
}

describe('cascade-pid module', () => {
  it('declares its id, modes and four parameters in order, defaults in range', () => {
    expect(cascadePid.id).toBe('cascade-pid')
    expect(cascadePid.name).toBe('Cascade PID')
    expect(cascadePid.tag).toBe('Two loops')
    expect(cascadePid.modes).toEqual(['semi-auto', 'autopilot'])
    expect(cascadePid.params.map((s) => s.key)).toEqual(['Kh', 'vmax', 'Kv', 'Ki'])
    expect(cascadePid.params[0]).toMatchObject({ min: 0, max: 3, step: 0.05, default: 0.8, unit: '1/s' })
    expect(cascadePid.params[1]).toMatchObject({ min: 1, max: 30, step: 0.5, default: 12, unit: 'm/s' })
    expect(cascadePid.params[2]).toMatchObject({ min: 0, max: 0.5, step: 0.005, default: 0.1 })
    expect(cascadePid.params[3]).toMatchObject({ min: 0, max: 0.5, step: 0.005, default: 0.05 })
    for (const s of cascadePid.params) {
      expect(s.label.length).toBeGreaterThan(0)
      expect(s.accessibleName.length).toBeGreaterThan(0)
      expect(s.default).toBeGreaterThanOrEqual(s.min)
      expect(s.default).toBeLessThanOrEqual(s.max)
    }
  })

  it('has no analysis, so the Pole readout hides', () => {
    expect(cascadePid.analysis).toBeUndefined()
  })

  it('ends its lesson with a Try: sentence naming the climb-rate limit and flatter climbs, with no HTML', () => {
    expect(cascadePid.lesson).toMatch(/Try: [^.]*\.$/)
    const tryText = cascadePid.lesson.slice(cascadePid.lesson.indexOf('Try:'))
    expect(tryText).toContain('climb-rate limit')
    expect(tryText).toContain('flatter')
    expect(cascadePid.lesson).not.toMatch(/</)
  })
})

describe('cascade-pid controller', () => {
  it('commands the climb-rate limit for a big altitude error', () => {
    const c = cascadePid.create(defaultParams(cascadePid))
    expect(c.climbRate).toBe(0)
    const u = c.compute(ctx({ ref: 100, h: 20, v: 0 }))
    expect(c.climbRate).toBe(12)
    expect(u).toBeGreaterThan(0)
  })

  it('commands Kh·e for a small error and pushes Kv times the climb-rate error', () => {
    const c = cascadePid.create(defaultParams(cascadePid))
    const u = c.compute(ctx({ ref: 51, h: 50, v: 0 }))
    expect(c.climbRate).toBeCloseTo(0.8, 12)
    expect(u).toBeCloseTo(0.08, 12)
    expect(climbRateCommand(defaultParams(cascadePid), 1)).toBeCloseTo(0.8, 12)
    expect(climbRateCommand(defaultParams(cascadePid), -100)).toBe(-12)
  })

  it('outputs only the integrator when climbing at the limit', () => {
    const c = cascadePid.create(defaultParams(cascadePid))
    // Build up some integrator first: 1 m/s climb-rate error for 10 ticks.
    for (let k = 0; k < 10; k++) c.compute(ctx({ ref: 100, h: 20, v: 11 }))
    const I = 10 * 0.05 * 1 * 0.02
    expect(c.compute(ctx({ ref: 100, h: 20, v: 12 }))).toBeCloseTo(I, 12)
    // Inner error 0 leaves the integrator where it was.
    expect(c.compute(ctx({ ref: 100, h: 20, v: 12 }))).toBeCloseTo(I, 12)
  })

  it('reads vmax live on every call', () => {
    const params: Record<string, number> = defaultParams(cascadePid)
    const c = cascadePid.create(params)
    c.compute(ctx({ ref: 100, h: 20 }))
    expect(c.climbRate).toBe(12)
    params.vmax = 4
    c.compute(ctx({ ref: 100, h: 20 }))
    expect(c.climbRate).toBe(4)
  })

  it('does not wind up the integrator while saturated and pushing further', () => {
    const params: Record<string, number> = defaultParams(cascadePid)
    params.Kv = 0.5
    const c = cascadePid.create(params)
    for (let k = 0; k < 500; k++) expect(c.compute(ctx({ ref: 100, h: 20, v: -20 }))).toBe(1)
    // With no integrator, zero climb-rate error gives zero elevator.
    expect(c.compute(ctx({ ref: 100, h: 20, v: 12 }))).toBe(0)
  })

  it('keeps the integrator within the elevator range', () => {
    const params: Record<string, number> = { Kh: 0.8, vmax: 12, Kv: 0, Ki: 0.5 }
    const c = cascadePid.create(params)
    for (let k = 0; k < 2000; k++) c.compute(ctx({ ref: 100, h: 20, v: 0 }))
    expect(c.compute(ctx({ ref: 100, h: 20, v: 12 }))).toBe(1)
    // A wound-up integrator would hold 1 for a long time; a bounded one unwinds at once.
    expect(c.compute(ctx({ ref: 100, h: 20, v: 24 }))).toBe(1)
    expect(c.compute(ctx({ ref: 100, h: 20, v: 24 }))).toBeCloseTo(1 - 0.5 * 12 * 0.02, 12)
  })

  it('returns 0 for non-finite inputs, keeps its state and never throws', () => {
    const bads = [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]
    for (const bad of bads) {
      for (const key of ['h', 'v', 'ref'] as const) {
        const c = cascadePid.create(defaultParams(cascadePid))
        c.compute(ctx({ ref: 51, h: 50 }))
        const before = c.climbRate
        expect(c.compute(ctx({ [key]: bad }))).toBe(0)
        expect(c.climbRate).toBe(before)
        // Integrator unchanged: the next finite tick matches a fresh controller fed the same two ticks.
        const ref = cascadePid.create(defaultParams(cascadePid))
        ref.compute(ctx({ ref: 51, h: 50 }))
        expect(c.compute(ctx({ ref: 52, h: 50 }))).toBe(ref.compute(ctx({ ref: 52, h: 50 })))
      }
      for (const key of ['Kh', 'vmax', 'Kv', 'Ki']) {
        const params: Record<string, number> = defaultParams(cascadePid)
        const c = cascadePid.create(params)
        c.compute(ctx({ ref: 51, h: 50 }))
        const before = c.climbRate
        const good = params[key]!
        params[key] = bad
        expect(() => c.compute(ctx({ ref: 55 }))).not.toThrow()
        expect(c.compute(ctx({ ref: 55 }))).toBe(0)
        expect(c.climbRate).toBe(before)
        params[key] = good
        const ref = cascadePid.create(defaultParams(cascadePid))
        ref.compute(ctx({ ref: 51, h: 50 }))
        expect(c.compute(ctx({ ref: 52, h: 50 }))).toBe(ref.compute(ctx({ ref: 52, h: 50 })))
      }
    }
  })
})

describe('cascade-pid flies course 101', () => {
  fliesCourse101(cascadePid)

  for (const mode of ['autopilot', 'semi-auto'] as const) {
    it(`never commands a climb rate beyond the limit in ${mode}`, () => {
      const params = defaultParams(cascadePid)
      const flight = recordFlight(params, mode)
      expect(flight.status).not.toBe('crashed')
      expect(flight.commands.length).toBeGreaterThan(100)
      for (const cmd of flight.commands) expect(Math.abs(cmd)).toBeLessThanOrEqual(params.vmax!)
    })
  }

  it('climbs flatter with a lower climb-rate limit', () => {
    const peak = (rates: number[]) => Math.max(...rates.map(Math.abs))
    const fast = recordFlight(defaultParams(cascadePid), 'autopilot')
    const slow = recordFlight({ ...defaultParams(cascadePid), vmax: 4 }, 'autopilot')
    expect(peak(slow.rates)).toBeLessThan(peak(fast.rates))
    const lowRings = flyCourse(cascadePid, { ...defaultParams(cascadePid), vmax: 4 }, 'autopilot').ringsPassed
    const highRings = flyCourse(cascadePid, defaultParams(cascadePid), 'autopilot').ringsPassed
    expect(lowRings).toBeLessThan(highRings)
  })
})
