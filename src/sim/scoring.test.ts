import { describe, expect, it } from 'vitest'
import { createRun, type RunAlgorithm } from './run.ts'
import {
  integrateEnergy,
  isBestEligible,
  integrateError,
  ringPoints,
  ringResult,
  ringsPassed,
  summarize,
  type PlaneResult,
} from './scoring.ts'

describe('ringPoints', () => {
  it('gives 10 at the center, 4 at the rim and 0 outside', () => {
    expect(ringPoints(0)).toBe(10)
    expect(ringPoints(3.5)).toBe(7)
    expect(ringPoints(7)).toBe(4)
    expect(ringPoints(7.01)).toBe(0)
  })

  it('gives 0 for a non-finite error', () => {
    expect(ringPoints(NaN)).toBe(0)
    expect(ringPoints(Infinity)).toBe(0)
  })
})

describe('ringResult', () => {
  it('scores the absolute altitude error at the ring', () => {
    expect(ringResult(2, { x: 520, h: 40 }, 43.5)).toEqual({ ring: 2, pass: true, err: 3.5, points: 7 })
    expect(ringResult(0, { x: 200, h: 40 }, 30)).toEqual({ ring: 0, pass: false, err: 10, points: 0 })
  })
})

describe('ringsPassed', () => {
  it('counts passed results', () => {
    const results = [
      ringResult(0, { x: 0, h: 50 }, 50),
      ringResult(1, { x: 0, h: 50 }, 80),
      ringResult(2, { x: 0, h: 50 }, 55),
    ]
    expect(ringsPassed(results)).toBe(2)
    expect(ringsPassed([])).toBe(0)
  })
})

describe('integrators', () => {
  it('accumulates |ref − h|·dt and u²·dt', () => {
    expect(integrateError(1, 50, 48, 0.5)).toBe(2)
    expect(integrateEnergy(1, -0.5, 2)).toBe(1.5)
  })

  it('ignores non-finite increments', () => {
    expect(integrateError(1, NaN, 48, 0.5)).toBe(1)
    expect(integrateEnergy(1, Infinity, 0.5)).toBe(1)
  })
})

describe('summarize', () => {
  const base: PlaneResult = {
    lesson: 'pid',
    mode: 'autopilot',
    course: 101,
    status: 'finished',
    points: 17,
    results: [ringResult(0, { x: 0, h: 50 }, 50), ringResult(1, { x: 0, h: 50 }, 80), ringResult(2, { x: 0, h: 50 }, 53.5)],
    ringsTotal: 10,
    iae: 12.5,
    energy: 0.75,
    retuned: false,
  }
  const runOf = (r: PlaneResult, wingman?: PlaneResult) => ({
    result: (plane: string) => (plane === 'player' ? r : plane === 'wingman' ? wingman : undefined),
  })

  it('builds the logbook row', () => {
    expect(summarize(runOf(base), 'player')).toEqual({
      lesson: 'pid',
      mode: 'autopilot',
      course: 101,
      points: 17,
      rings: 2,
      ringsTotal: 10,
      iae: 12.5,
      energy: 0.75,
      tags: [],
    })
  })

  it('tags a crashed plane', () => {
    expect(summarize(runOf({ ...base, status: 'crashed' }), 'player')?.tags).toEqual(['crashed'])
  })

  it('tags a retuned plane after crashed', () => {
    expect(summarize(runOf({ ...base, retuned: true }), 'player')?.tags).toEqual(['retuned'])
    expect(summarize(runOf({ ...base, status: 'crashed', retuned: true }), 'player')?.tags).toEqual(['crashed', 'retuned'])
  })

  it('tags a Semi-auto run after crashed and retuned', () => {
    expect(summarize(runOf({ ...base, mode: 'semi-auto' }), 'player')?.tags).toEqual(['semi-auto'])
    expect(
      summarize(runOf({ ...base, mode: 'semi-auto', status: 'crashed', retuned: true }), 'player')?.tags,
    ).toEqual(['crashed', 'retuned', 'semi-auto'])
  })

  it('returns undefined for a missing plane', () => {
    expect(summarize(runOf(base), 'wingman')).toBeUndefined()
  })

  it('tags a wingman row first, before crashed and retuned', () => {
    expect(summarize(runOf(base, base), 'wingman')?.tags).toEqual(['wingman'])
    expect(summarize(runOf(base, { ...base, status: 'crashed', retuned: true }), 'wingman')?.tags).toEqual([
      'wingman',
      'crashed',
      'retuned',
    ])
    expect(summarize(runOf(base, base), 'player')?.tags).toEqual([])
  })
})

describe('isBestEligible', () => {
  const base: PlaneResult = {
    lesson: 'pid',
    mode: 'autopilot',
    course: 101,
    status: 'finished',
    points: 60,
    results: [],
    ringsTotal: 10,
    iae: 120,
    energy: 3,
    retuned: false,
  }

  it('accepts a finished, un-retuned Autopilot or Manual player flight', () => {
    expect(isBestEligible(base, 'player')).toBe(true)
    expect(isBestEligible({ ...base, mode: 'manual' }, 'player')).toBe(true)
  })

  it('refuses crashed, unfinished, retuned, Semi-auto, wingman and missing results', () => {
    expect(isBestEligible({ ...base, status: 'crashed' }, 'player')).toBe(false)
    expect(isBestEligible({ ...base, status: 'flying' }, 'player')).toBe(false)
    expect(isBestEligible({ ...base, retuned: true }, 'player')).toBe(false)
    expect(isBestEligible({ ...base, mode: 'semi-auto' }, 'player')).toBe(false)
    expect(isBestEligible(base, 'wingman')).toBe(false)
    expect(isBestEligible(undefined, 'player')).toBe(false)
  })
})

describe('Semi-auto IAE', () => {
  const hold: RunAlgorithm = { id: 'hold', create: () => ({ compute: () => 0 }) }

  function flown(mode: 'semi-auto' | 'autopilot') {
    const run = createRun({ course: 101, mode, player: { algorithm: hold, params: {} } })
    run.setSetpoint(60)
    for (let guard = 0; !run.done && guard < 1e6; guard++) run.step()
    return run
  }

  it('integrates the error against the setpoint, not the course', () => {
    const run = flown('semi-auto')
    const result = run.result('player')!
    expect(result.status).toBe('finished')
    // The plane holds 50 m with u = 0 while the setpoint is 60 m.
    expect(result.iae).toBeCloseTo(10 * run.snapshot().t, 6)
    const row = summarize(run, 'player')!
    expect(row.iae).toBe(result.iae)
    expect(row.tags).toEqual(['semi-auto'])
    expect(isBestEligible(result, 'player')).toBe(false)
  })

  it('differs from the same controller flown in Autopilot', () => {
    const semi = flown('semi-auto').result('player')!
    const auto = flown('autopilot').result('player')!
    expect(auto.iae).not.toBeCloseTo(semi.iae, 0)
  })
})
