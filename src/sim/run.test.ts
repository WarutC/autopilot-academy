import { describe, expect, it } from 'vitest'
import { defaultParams } from '../algorithms/index.ts'
import pid from '../algorithms/pid.ts'
import { makeCourse } from './course.ts'
import { PLANT } from './plant.ts'
import { createRun, type Run, type RunAlgorithm } from './run.ts'
import { ringsPassed, summarize } from './scoring.ts'
import type { ControlContext, Snapshot } from './types.ts'

const pidRun = () =>
  createRun({ course: 101, mode: 'autopilot', player: { algorithm: pid, params: defaultParams(pid) } })

/** An algorithm whose controller returns `compute(ctx, call)`. */
function fixed(compute: (ctx: ControlContext, call: number) => number): RunAlgorithm {
  return {
    id: 'test',
    create: () => {
      let call = 0
      return { compute: (ctx) => compute(ctx, call++) }
    },
  }
}

const runWith = (algorithm: RunAlgorithm, params: Record<string, number> = {}) =>
  createRun({ course: 101, mode: 'autopilot', player: { algorithm, params } })

function flyToEnd(run: Run, perCall = 1): void {
  for (let guard = 0; !run.done && guard < 1e6; guard++) run.step(perCall)
}

const traceColumns = (s: Snapshot) => {
  const tr = s.trace.player!
  return (['t', 'ref', 'h', 'hMeas', 'hEst', 'u'] as const).map((c) => Array.from(tr[c].subarray(0, tr.length)))
}

describe('Run with PID on course 101', () => {
  it('finishes, scores rings and summarizes', () => {
    const run = pidRun()
    flyToEnd(run)
    expect(run.done).toBe(true)
    expect(run.status('player')).toBe('finished')
    const plane = run.snapshot().planes[0]
    expect(plane.status).toBe('finished')
    expect(plane.points).toBeGreaterThan(0)
    expect(plane.results).toHaveLength(10)
    expect(plane.retuned).toBe(false)
    const row = summarize(run, 'player')!
    expect(row.lesson).toBe('pid')
    expect(row.mode).toBe('autopilot')
    expect(row.course).toBe(101)
    expect(row.ringsTotal).toBe(10)
    expect(row.rings).toBe(ringsPassed(plane.results))
    expect(row.rings).toBeGreaterThan(0)
    expect(row.points).toBe(plane.points)
    expect(row.iae).toBeGreaterThan(0)
    expect(row.energy).toBeGreaterThan(0)
    expect(row.tags).not.toContain('crashed')
  })

  it('fills the preallocated trace without overflowing', () => {
    const run = pidRun()
    flyToEnd(run)
    const s = run.snapshot()
    const tr = s.trace.player!
    const course = makeCourse(101)
    expect(tr.t.length).toBe(Math.ceil(course.endX / PLANT.speed / PLANT.Tc) + 2)
    expect(tr.length).toBeGreaterThan(0)
    expect(tr.length).toBeLessThanOrEqual(tr.t.length)
    expect(s.rings).toEqual(course.rings)
    expect(s.markers).toEqual([])
    expect(s.course).toBe(101)
  })

  it('types the trace columns against index writes (checked by tsc)', () => {
    const run = pidRun()
    run.step(8)
    const tr = run.snapshot().trace.player!
    // Never called: the typecheck fails if this write stops being an error.
    const _write = () => {
      // @ts-expect-error snapshot trace columns are the run's live buffers
      tr.h[0] = 0
    }
    void _write
    expect(tr.length).toBe(2)
  })

  it('gives identical results however the steps are batched', () => {
    const runs = [1, 2, 4].map((n) => {
      const run = pidRun()
      flyToEnd(run, n)
      return run
    })
    const [a, ...rest] = runs.map((run) => ({ row: summarize(run, 'player'), snap: run.snapshot() }))
    for (const b of rest) {
      expect(b.row).toEqual(a.row)
      expect(b.snap.planes[0].results).toEqual(a.snap.planes[0].results)
      expect(b.snap.trace.player!.length).toBe(a.snap.trace.player!.length)
      expect(traceColumns(b.snap)).toEqual(traceColumns(a.snap))
    }
  })
})

describe('Run with a full dive', () => {
  it('crashes at the floor, freezes and is done', () => {
    const run = runWith(fixed(() => -1))
    flyToEnd(run)
    expect(run.done).toBe(true)
    expect(run.status()).toBe('crashed')
    const before = run.snapshot()
    expect(before.planes[0].h).toBe(PLANT.hFloor)
    expect(before.planes[0].x).toBeLessThan(makeCourse(101).endX)
    expect(summarize(run, 'player')!.tags).toContain('crashed')
    const columnsBefore = traceColumns(before)
    run.step()
    run.step(100)
    const after = run.snapshot()
    expect(after).toEqual(before)
    expect(traceColumns(after)).toEqual(columnsBefore)
  })
})

describe('Run control rate', () => {
  it('ticks the controller on steps 0 and 4 of the first 8', () => {
    const calls: number[] = []
    const run = runWith(fixed((ctx) => (calls.push(ctx.t), 0)))
    const ticked: number[] = []
    for (let step = 0; step < 8; step++) {
      const n = calls.length
      run.step()
      if (calls.length > n) ticked.push(step)
    }
    expect(ticked).toEqual([0, 4])
    const tr = run.snapshot().trace.player!
    expect(tr.length).toBe(2)
    expect(tr.t[0]).toBe(0)
    expect(tr.t[1]).toBe(0.02)
  })
})

describe('Run control context', () => {
  it('is frozen and holds only the context fields', () => {
    let kept: ControlContext | undefined
    let wrote: boolean | undefined
    const run = runWith(
      fixed((ctx) => {
        kept ??= ctx
        wrote ??= Reflect.set(ctx, 'h', 999)
        return 0
      }),
    )
    run.step(4)
    expect(wrote).toBe(false)
    expect(kept).toBeDefined()
    expect(Object.isFrozen(kept)).toBe(true)
    expect(kept!.h).toBe(PLANT.hStart)
    expect(Object.keys(kept!).sort()).toEqual(['T', 'h', 'input', 'ref', 'refAhead', 't', 'v'])
    expect(kept!.T).toBe(PLANT.Tc)
    expect(kept!.input).toBe(0)
    expect(kept!.v).toBe(0)
    expect(kept!.refAhead(0)).toBe(kept!.ref)
    // From x = 0, 7 s ahead is x = 140, past the first boundary at 120 m.
    expect(kept!.refAhead(140 / PLANT.speed)).toBe(makeCourse(101).rings[0].h)
    expect(kept!.refAhead(100 / PLANT.speed)).toBe(PLANT.hStart)
    // The kept context does not follow the plane.
    run.step(40)
    expect(kept!.t).toBe(0)
  })

  it('estimates v as the measurement difference over Tc after the first tick', () => {
    const seen: ControlContext[] = []
    const run = runWith(fixed((ctx) => (seen.push(ctx), 1)))
    run.step(12)
    expect(seen).toHaveLength(3)
    expect(seen[0].v).toBe(0)
    expect(seen[2].v).toBeCloseTo((seen[2].h - seen[1].h) / PLANT.Tc, 12)
    expect(seen[1].v).toBeGreaterThan(0)
  })
})

describe('Run totals', () => {
  it('integrates u² over every physics step for energy', () => {
    const run = runWith(fixed(() => 0.5))
    run.step(40)
    expect(run.result('player')!.energy).toBeCloseTo(0.25 * PLANT.dt * 40, 12)
  })

  it('integrates the absolute altitude error for IAE', () => {
    // With u = 0 the plane holds hStart; the error is zero until the first
    // boundary at 120 m, then the gap to ring 0 on every step after it.
    const run = runWith(fixed(() => 0))
    const steps = 1400
    run.step(steps)
    const gap = Math.abs(makeCourse(101).rings[0].h - PLANT.hStart)
    const stepsPast = steps - 120 / (PLANT.speed * PLANT.dt)
    const expected = gap * PLANT.dt * stepsPast
    expect(run.status()).toBe('flying')
    expect(Math.abs(run.result('player')!.iae - expected)).toBeLessThanOrEqual(gap * PLANT.dt)
  })
})

describe('Run params', () => {
  it('passes the controller a copy the run owns', () => {
    let received: Readonly<Record<string, number>> | undefined
    const callerParams = { Kp: 0.2 }
    const run = createRun({
      course: 101,
      mode: 'autopilot',
      player: {
        algorithm: {
          id: 'test',
          create: (p) => {
            received = p
            return { compute: () => 0 }
          },
        },
        params: callerParams,
      },
    })
    callerParams.Kp = 0.9
    run.step()
    expect(received).not.toBe(callerParams)
    expect(received).toEqual({ Kp: 0.2 })
  })
})

describe('Run bad controller output', () => {
  it('stores NaN as 0 and clamps out-of-range output, without throwing', () => {
    const run = runWith(fixed((_ctx, call) => (call === 0 ? NaN : 5)))
    expect(() => run.step(1)).not.toThrow()
    expect(run.snapshot().planes[0].u).toBe(0)
    run.step(4)
    expect(run.snapshot().planes[0].u).toBe(1)
    const tr = run.snapshot().trace.player!
    expect(Array.from(tr.u.subarray(0, tr.length))).toEqual([0, 1])
  })

  it('ignores a NaN or negative step count, and runs Infinity until done', () => {
    const run = pidRun()
    run.step(NaN)
    run.step(-3)
    expect(run.snapshot().t).toBe(0)
    run.step(Infinity)
    expect(run.done).toBe(true)
  })
})

const pidWith = (overrides: Record<string, number>) =>
  createRun({ course: 101, mode: 'autopilot', player: { algorithm: pid, params: { ...defaultParams(pid), ...overrides } } })

describe('Run tuning on course 101', () => {
  it('misses at least three rings with PID at Kd 0, without crashing', () => {
    const run = pidWith({ Kd: 0 })
    flyToEnd(run)
    expect(run.status()).toBe('finished')
    const row = summarize(run)!
    expect(row.ringsTotal - row.rings).toBeGreaterThanOrEqual(3)
  })

  it('passes all ten rings with the PID defaults', () => {
    const run = pidRun()
    flyToEnd(run)
    expect(run.status()).toBe('finished')
    expect(summarize(run)!.rings).toBe(10)
  })
})

describe('Run setParam', () => {
  it('uses the new value on the next control tick and marks the plane retuned', () => {
    const seen: number[] = []
    const reading = runWith(
      { id: 'test', create: (p) => ({ compute: () => (seen.push(p.g), p.g) }) },
      { g: 0.1 },
    )
    const other = runWith(fixed(() => 0), { g: 0.1 })
    reading.step(4)
    expect(reading.snapshot().planes[0].u).toBe(0.1)
    reading.setParam('player', 'g', 0.5)
    reading.step(1)
    expect(seen).toEqual([0.1, 0.5])
    expect(reading.snapshot().planes[0].u).toBe(0.5)
    expect(reading.snapshot().planes[0].retuned).toBe(true)
    expect(reading.result('player')!.retuned).toBe(true)
    expect(summarize(reading)!.tags).toContain('retuned')
    // Another run is untouched.
    expect(other.snapshot().planes[0].retuned).toBe(false)
  })

  it('retunes PID mid-flight: Kd 0.05 applies from the next tick', () => {
    const run = pidWith({ Kd: 0 })
    const ref = pidWith({ Kd: 0 })
    // At t = 11 s the plane climbs at about 9 m/s, unsaturated, so D changes u.
    run.step(2200)
    ref.step(2200)
    run.setParam('player', 'Kd', 0.05)
    run.step(4)
    ref.step(4)
    const a = run.snapshot()
    const b = ref.snapshot()
    expect(a.planes[0].retuned).toBe(true)
    expect(b.planes[0].retuned).toBe(false)
    expect(a.planes[0].u).not.toBe(b.planes[0].u)
    flyToEnd(run)
    expect(summarize(run)!.tags).toEqual(['retuned'])
  })

  it('ignores the value already set', () => {
    const run = pidRun()
    run.setParam('player', 'Kd', defaultParams(pid).Kd)
    expect(run.snapshot().planes[0].retuned).toBe(false)
    expect(run.result('player')!.retuned).toBe(false)
  })

  it('ignores an unknown key, a non-finite value and the wingman, without throwing', () => {
    const run = pidRun()
    expect(() => {
      run.setParam('player', 'Kx', 1)
      run.setParam('player', 'toString', 1)
      run.setParam('player', 'Kd', NaN)
      run.setParam('player', 'Kd', Infinity)
      run.setParam('wingman', 'Kd', 0.1)
    }).not.toThrow()
    expect(run.snapshot().planes[0].retuned).toBe(false)
    flyToEnd(run)
    expect(summarize(run)!.tags).toEqual([])
  })

  it('gives the same result at every batching after the same retune', () => {
    const rows = [1, 2, 4].map((n) => {
      const run = pidWith({ Kd: 0 })
      run.step(2200)
      run.setParam('player', 'Kd', 0.05)
      flyToEnd(run, n)
      return summarize(run)
    })
    expect(rows[1]).toEqual(rows[0])
    expect(rows[2]).toEqual(rows[0])
  })
})

describe('Run markChange', () => {
  it('appends a marker at the current time and leaves earlier snapshots alone', () => {
    const run = pidRun()
    run.step(640)
    const before = run.snapshot()
    run.markChange('Kd 0 → 0.05')
    const after = run.snapshot()
    expect(before.markers).toEqual([])
    expect(after.markers).toEqual([{ t: 640 * PLANT.dt, label: 'Kd 0 → 0.05' }])
    expect(after.markers[0].t).toBeCloseTo(3.2, 12)
    run.step(4)
    run.markChange('Kp 0.2 → 0.3')
    expect(after.markers).toHaveLength(1)
    expect(run.snapshot().markers.map((m) => m.label)).toEqual(['Kd 0 → 0.05', 'Kp 0.2 → 0.3'])
  })

  it('ignores an empty label and does not mark the plane retuned', () => {
    const run = pidRun()
    run.markChange('')
    expect(run.snapshot().markers).toEqual([])
    run.markChange('Kd 0 → 0.05')
    expect(run.snapshot().planes[0].retuned).toBe(false)
  })
})
