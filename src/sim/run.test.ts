import { describe, expect, it } from 'vitest'
import { defaultParams } from '../algorithms/index.ts'
import manual from '../algorithms/manual.ts'
import pAlgorithm from '../algorithms/p.ts'
import pid from '../algorithms/pid.ts'
import { makeCourse, refAt } from './course.ts'
import { createKalman, stepKalman, type KalmanState } from './kalman.ts'
import { gauss, stream } from './rng.ts'
import { PLANT, SETPOINT_MAX, SETPOINT_MIN } from './plant.ts'
import { CALM, createRun, type Run, type RunAlgorithm, type RunOptions } from './run.ts'
import { ringsPassed, summarize } from './scoring.ts'
import type { Conditions, ControlContext, PlaneId, Snapshot } from './types.ts'

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

const traceColumns = (s: Snapshot, plane: PlaneId = 'player') => {
  const tr = s.trace[plane]!
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

  it('settles the oscillation after Kd 0 is raised to 0.05 at 2 s, before the first ring', () => {
    const steady = pidWith({ Kd: 0 })
    const raised = pidWith({ Kd: 0 })
    raised.step(Math.round(2 / PLANT.dt))
    raised.setParam('player', 'Kd', 0.05)
    flyToEnd(steady)
    flyToEnd(raised)
    expect(summarize(steady)!.rings).toBe(7)
    expect(summarize(raised)!.rings).toBe(10)
    expect(raised.status()).toBe('finished')
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

const manualWith = (algorithm: RunAlgorithm) =>
  createRun({ course: 101, mode: 'manual', player: { algorithm, params: {} } })

describe('Run setInput', () => {
  it('passes the stick as ctx.input on the next control tick in Manual mode', () => {
    const inputs: number[] = []
    const run = manualWith(fixed((ctx) => (inputs.push(ctx.input), 0)))
    run.step(4)
    run.setInput(1)
    run.step(4)
    run.setInput(-1)
    run.step(4)
    run.setInput(0)
    run.step(4)
    expect(inputs).toEqual([0, 1, -1, 0])
    const s = run.snapshot()
    expect(s.planes[0].retuned).toBe(false)
    expect(s.markers).toEqual([])
    expect(run.result('player')!.retuned).toBe(false)
  })

  it('uses a stick set before the first step on the first control tick', () => {
    const inputs: number[] = []
    const run = manualWith(fixed((ctx) => (inputs.push(ctx.input), 0)))
    run.setInput(1)
    run.step(1)
    expect(inputs).toEqual([1])
  })

  it('keeps ctx.input at 0 outside Manual mode', () => {
    const inputs: number[] = []
    const run = runWith(fixed((ctx) => (inputs.push(ctx.input), 0)))
    run.setInput(1)
    run.step(8)
    expect(inputs).toEqual([0, 0])
  })

  it('ignores values other than -1, 0 and 1, without throwing', () => {
    const inputs: number[] = []
    const run = manualWith(fixed((ctx) => (inputs.push(ctx.input), 0)))
    run.setInput(1)
    expect(() => {
      for (const bad of [0.5, NaN, 2, Infinity]) run.setInput(bad as never)
    }).not.toThrow()
    run.step(1)
    expect(inputs).toEqual([1])
  })

  it('climbs above hStart within 1 s with the Manual lesson holding ▲', () => {
    const run = createRun({ course: 101, mode: 'manual', player: { algorithm: manual, params: {} } })
    run.setInput(1)
    run.step(Math.round(1 / PLANT.dt))
    expect(run.snapshot().planes[0].h).toBeGreaterThan(PLANT.hStart)
    expect(run.status()).toBe('flying')
  })
})

const semiWith = (algorithm: RunAlgorithm, params: Record<string, number> = {}) =>
  createRun({ course: 101, mode: 'semi-auto', player: { algorithm, params } })

describe('Run setSetpoint', () => {
  it('drives ctx.ref, refAhead and the trace from the next tick, and the snapshot at once, in Semi-auto', () => {
    const seen: ControlContext[] = []
    const run = semiWith(fixed((ctx) => (seen.push(ctx), 0)))
    run.step(4)
    run.setSetpoint(80)
    expect(run.snapshot().planes[0].ref).toBe(80)
    expect(run.snapshot().planes[0].mode).toBe('semi-auto')
    run.step(4)
    expect(seen).toHaveLength(2)
    expect(seen[0].ref).toBe(PLANT.hStart)
    expect(seen[1].ref).toBe(80)
    expect(seen[1].refAhead(2)).toBe(80)
    expect(seen[1].refAhead(140 / PLANT.speed)).toBe(80)
    const tr = run.snapshot().trace.player!
    expect(tr.ref[0]).toBe(PLANT.hStart)
    expect(tr.ref[1]).toBe(80)
    const s = run.snapshot()
    expect(s.planes[0].retuned).toBe(false)
    expect(s.markers).toEqual([])
    expect(run.result('player')!.retuned).toBe(false)
  })

  it('defaults to hStart in a new Semi-auto run', () => {
    const seen: ControlContext[] = []
    const run = semiWith(fixed((ctx) => (seen.push(ctx), 0)))
    expect(run.snapshot().planes[0].ref).toBe(PLANT.hStart)
    // Past the first course boundary the reference stays at hStart.
    run.step(1400)
    expect(seen.at(-1)!.ref).toBe(PLANT.hStart)
    expect(seen.at(-1)!.refAhead(7)).toBe(PLANT.hStart)
    // u = 0 holds hStart, so the IAE stays zero.
    expect(run.result('player')!.iae).toBe(0)
  })

  it('is stored but unused outside Semi-auto', () => {
    const seen: ControlContext[] = []
    const run = runWith(fixed((ctx) => (seen.push(ctx), 0)))
    run.setSetpoint(80)
    run.step(4)
    expect(seen[0].ref).toBe(PLANT.hStart)
    expect(seen[0].refAhead(140 / PLANT.speed)).toBe(makeCourse(101).rings[0].h)
    expect(run.snapshot().planes[0].ref).toBe(PLANT.hStart)
    expect(run.snapshot().planes[0].mode).toBe('autopilot')
  })

  it('ignores non-finite values and clamps one ring radius inside the safe band, without throwing', () => {
    const run = semiWith(fixed(() => 0))
    run.setSetpoint(70)
    expect(() => {
      run.setSetpoint(NaN)
      run.setSetpoint(Infinity)
      run.setSetpoint(-Infinity)
    }).not.toThrow()
    expect(run.snapshot().planes[0].ref).toBe(70)
    run.setSetpoint(500)
    expect(run.snapshot().planes[0].ref).toBe(103)
    run.setSetpoint(-3)
    expect(run.snapshot().planes[0].ref).toBe(13)
    run.setSetpoint(PLANT.hCeil)
    expect(run.snapshot().planes[0].ref).toBe(SETPOINT_MAX)
    run.setSetpoint(PLANT.hFloor)
    expect(run.snapshot().planes[0].ref).toBe(SETPOINT_MIN)
  })

  it('measures the IAE against the setpoint in Semi-auto', () => {
    const run = semiWith(fixed(() => 0))
    run.setSetpoint(60)
    run.step(100)
    expect(run.result('player')!.iae).toBeCloseTo(10 * PLANT.dt * 100, 9)
  })

  it('brings PID to within 2 m of a 70 m setpoint after 6 s', () => {
    const run = createRun({ course: 101, mode: 'semi-auto', player: { algorithm: pid, params: defaultParams(pid) } })
    run.setSetpoint(70)
    run.step(Math.round(6 / PLANT.dt))
    expect(run.status()).toBe('flying')
    expect(Math.abs(run.snapshot().planes[0].h - 70)).toBeLessThanOrEqual(2)
    expect(summarize(run, 'player')!.tags).toEqual(['semi-auto'])
  })
})

describe('Run conditions', () => {
  const pidOn = (course: number, conditions?: Partial<Conditions>, mode: RunOptions['mode'] = 'autopilot') =>
    createRun({ course, mode, player: { algorithm: pid, params: defaultParams(pid) }, conditions })
  const heights = (run: Run) => {
    const tr = run.snapshot().trace.player!
    return Array.from(tr.h.subarray(0, tr.length))
  }

  it('flies calm conditions exactly like a run without conditions', () => {
    const a = pidRun()
    const b = pidOn(101, { ...CALM })
    flyToEnd(a)
    flyToEnd(b)
    expect(traceColumns(b.snapshot())).toEqual(traceColumns(a.snapshot()))
    expect(b.result('player')).toEqual(a.result('player'))
    expect(b.status()).toBe(a.status())
  })

  it('shows the calm defaults in the snapshot, with given keys merged and bad ones dropped', () => {
    expect(pidRun().snapshot().conditions).toEqual(CALM)
    const conditions = { gusts: 5, down: NaN, nope: 3 } as unknown as Partial<Conditions>
    expect(pidOn(101, conditions).snapshot().conditions).toEqual({ ...CALM, gusts: 5 })
  })

  it('draws the same gusts however the steps are batched', () => {
    const runs = [1, 2, 4].map((n) => {
      const run = pidOn(101, { gusts: 10 })
      flyToEnd(run, n)
      return heights(run)
    })
    expect(runs[1]).toEqual(runs[0])
    expect(runs[2]).toEqual(runs[0])
    expect(heights(pidRun())).not.toEqual(runs[0])
  })

  it('draws different gusts on different courses', () => {
    const a = pidOn(101, { gusts: 10 }, 'semi-auto')
    const b = pidOn(202, { gusts: 10 }, 'semi-auto')
    a.step(2000)
    b.step(2000)
    expect(heights(b)).not.toEqual(heights(a))
  })

  it('advances the gusts whatever the slider says, so a late change picks up the same sequence', () => {
    const a = pidOn(101)
    const b = pidOn(101, { gusts: 0 })
    const fromStart = pidOn(101, { gusts: 10 })
    for (const run of [a, b, fromStart]) run.step(400)
    expect(heights(fromStart)).not.toEqual(heights(a))
    a.setEnv('gusts', 10)
    b.setEnv('gusts', 10)
    flyToEnd(a, 1)
    flyToEnd(b, 3)
    expect(heights(b)).toEqual(heights(a))
    expect(b.result('player')).toEqual(a.result('player'))
  })

  it('advances the gust state on every physics step while gusts are 0', () => {
    const N = 400
    const run = createRun({ course: 101, mode: 'autopilot', player: { algorithm: fixed(() => 0), params: {} } })
    run.step(N)
    expect(run.snapshot().planes[0]!.v).toBe(0)
    run.setEnv('gusts', 10)
    run.step(1)
    // The (N+1)-th draw of the course's gust stream, not the first.
    const rng = stream(101, 'gusts')
    let g = 0
    for (let i = 0; i < N + 1; i++) g += -g * PLANT.dt + Math.sqrt(2 * PLANT.dt) * gauss(rng)
    expect(run.snapshot().planes[0]!.v).toBeCloseTo(10 * g * PLANT.dt, 12)
  })

  it('holds P below the target in a steady downdraft, and PID takes the error away', () => {
    const flyHold = (algorithm: RunAlgorithm, params: Record<string, number>) => {
      const run = createRun({ course: 101, mode: 'semi-auto', player: { algorithm, params }, conditions: { down: 5 } })
      run.step(Math.round(20 / PLANT.dt))
      const plane = run.snapshot().planes[0]!
      return plane.ref - plane.h
    }
    const pError = flyHold(pAlgorithm, defaultParams(pAlgorithm))
    const pidError = flyHold(pid, defaultParams(pid))
    // P settles where b·Kp·e balances the downdraft: 5 / (20 · 0.1) = 2.5 m low.
    expect(pError).toBeGreaterThan(1.5)
    expect(Math.abs(pidError)).toBeLessThan(pError / 10)
  })

  it('ignores an unknown key and non-finite values in setEnv', () => {
    const run = pidOn(101, { gusts: 3 })
    const before = run.snapshot().conditions
    run.setEnv('nope', 1)
    run.setEnv('gusts', NaN)
    run.setEnv('gusts', Infinity)
    expect(run.snapshot().conditions).toEqual(before)
  })

  it('never retunes or marks on setEnv, and replaces the record it handed out', () => {
    const run = pidRun()
    run.step(200)
    const before = run.snapshot()
    run.setEnv('gusts', 5)
    const after = run.snapshot()
    expect(after.conditions.gusts).toBe(5)
    expect(before.conditions.gusts).toBe(0)
    expect(after.planes[0]!.retuned).toBe(false)
    expect(after.markers).toEqual([])
    expect(run.result('player')!.retuned).toBe(false)
  })
})

describe('Run wingman', () => {
  const pidPlayer = () => ({ algorithm: pid, params: defaultParams(pid) })
  const withWingman = (wingman: RunOptions['wingman'], extra: Partial<RunOptions> = {}) =>
    createRun({ course: 101, mode: 'autopilot', player: pidPlayer(), wingman, ...extra })

  it('leaves the player unchanged in calm air', () => {
    const lone = pidRun()
    const paired = withWingman({ algorithm: pAlgorithm, params: defaultParams(pAlgorithm) })
    flyToEnd(lone)
    flyToEnd(paired)
    expect(traceColumns(paired.snapshot())).toEqual(traceColumns(lone.snapshot()))
    expect(paired.result('player')).toEqual(lone.result('player'))
    expect(summarize(paired, 'player')).toEqual(summarize(lone, 'player'))
    expect(paired.status('player')).toBe(lone.status('player'))
  })

  it('leaves the player unchanged in gusts, however the steps are batched', () => {
    const conditions = { gusts: 10 }
    const lone = createRun({ course: 101, mode: 'autopilot', player: pidPlayer(), conditions })
    flyToEnd(lone)
    const loneP = createRun({
      course: 101,
      mode: 'autopilot',
      player: { algorithm: pAlgorithm, params: defaultParams(pAlgorithm) },
      conditions,
    })
    flyToEnd(loneP)
    for (const n of [1, 2, 4]) {
      const paired = withWingman({ algorithm: pAlgorithm, params: defaultParams(pAlgorithm) }, { conditions })
      flyToEnd(paired, n)
      expect(traceColumns(paired.snapshot())).toEqual(traceColumns(lone.snapshot()))
      expect(paired.result('player')).toEqual(lone.result('player'))
      // The wingman flies the same gusts as a lone run of its algorithm.
      expect(traceColumns(paired.snapshot(), 'wingman')).toEqual(traceColumns(loneP.snapshot()))
      expect(paired.result('wingman')).toEqual(loneP.result('player'))
    }
  })

  it('flies the wingman on the course while the player flies Semi-auto', () => {
    const course = makeCourse(101)
    const playerSeen: ControlContext[] = []
    const wingSeen: ControlContext[] = []
    const run = createRun({
      course: 101,
      mode: 'semi-auto',
      player: { algorithm: fixed((ctx) => (playerSeen.push(ctx), 0)), params: {} },
      wingman: { algorithm: fixed((ctx) => (wingSeen.push(ctx), 0)), params: {} },
    })
    run.setSetpoint(60)
    // Track the zero-output wingman's IAE against the course, step by step.
    let iae = 0
    for (let i = 0; i < 2000 && run.status('wingman') === 'flying'; i++) {
      run.step()
      const w = run.snapshot().planes[1]
      iae += Math.abs(refAt(course, w.x) - w.h) * PLANT.dt
    }
    expect(wingSeen.length).toBeGreaterThan(10)
    for (const ctx of wingSeen) expect(ctx.input).toBe(0)
    const last = wingSeen.at(-1)!
    const s = run.snapshot()
    const w = s.planes[1]
    expect(w.mode).toBe('autopilot')
    expect(w.ref).toBe(refAt(course, w.x))
    expect(s.planes[0].mode).toBe('semi-auto')
    expect(playerSeen.at(-1)!.ref).toBe(60)
    // The last tick was at the wingman's x then; check the course ahead of it too.
    const xTick = s.trace.wingman!.t[s.trace.wingman!.length - 1] * PLANT.speed
    expect(last.ref).toBe(refAt(course, xTick))
    expect(last.refAhead(2)).toBe(refAt(course, xTick + PLANT.speed * 2))
    expect(last.ref).not.toBe(PLANT.hStart)
    expect(run.result('wingman')!.iae).toBeCloseTo(iae, 9)
    expect(run.result('wingman')!.mode).toBe('autopilot')
  })

  it('passes the stick to the player only in Manual mode', () => {
    const playerSeen: ControlContext[] = []
    const wingSeen: ControlContext[] = []
    const run = createRun({
      course: 101,
      mode: 'manual',
      player: { algorithm: fixed((ctx) => (playerSeen.push(ctx), 0)), params: {} },
      wingman: { algorithm: fixed((ctx) => (wingSeen.push(ctx), 0)), params: {} },
    })
    run.setInput(1)
    run.step(8)
    expect(playerSeen.at(-1)!.input).toBe(1)
    expect(wingSeen.length).toBeGreaterThan(0)
    for (const ctx of wingSeen) expect(ctx.input).toBe(0)
    expect(run.snapshot().planes[1].mode).toBe('autopilot')
    expect(run.snapshot().planes[0].mode).toBe('manual')
  })

  it('freezes a crashed wingman while the player flies on', () => {
    const lone = pidRun()
    const run = withWingman({ algorithm: fixed(() => -1), params: {} })
    for (let i = 0; i < 1e5 && run.status('wingman') === 'flying'; i++) run.step()
    expect(run.status('wingman')).toBe('crashed')
    expect(run.status('player')).toBe('flying')
    expect(run.done).toBe(false)
    const before = run.snapshot()
    const wingBefore = before.planes[1]
    const columnsBefore = traceColumns(before, 'wingman')
    const resultBefore = run.result('wingman')
    run.step(200)
    const after = run.snapshot()
    expect(after.planes[1]).toEqual(wingBefore)
    expect(after.trace.wingman!.length).toBe(before.trace.wingman!.length)
    expect(traceColumns(after, 'wingman')).toEqual(columnsBefore)
    expect(run.result('wingman')).toEqual(resultBefore)
    expect(after.planes[0].x).toBeGreaterThan(before.planes[0].x)
    flyToEnd(run)
    flyToEnd(lone)
    expect(run.done).toBe(true)
    expect(run.result('player')).toEqual(lone.result('player'))
    expect(summarize(run, 'wingman')!.tags).toEqual(['wingman', 'crashed'])
  })

  it('flies the wingman on after the player crashes', () => {
    const run = createRun({
      course: 101,
      mode: 'autopilot',
      player: { algorithm: fixed(() => -1), params: {} },
      wingman: pidPlayer(),
    })
    for (let i = 0; i < 1e5 && run.status('player') === 'flying'; i++) run.step()
    expect(run.status('player')).toBe('crashed')
    expect(run.status('wingman')).toBe('flying')
    expect(run.done).toBe(false)
    flyToEnd(run)
    expect(run.status('wingman')).toBe('finished')
    expect(run.done).toBe(true)
  })

  it('ignores setParam on the wingman', () => {
    const a = withWingman(pidPlayer())
    const b = withWingman(pidPlayer())
    a.step(500)
    b.step(500)
    b.setParam('wingman', 'Kd', 0.1)
    flyToEnd(a)
    flyToEnd(b)
    expect(b.result('wingman')).toEqual(a.result('wingman'))
    expect(b.result('wingman')!.retuned).toBe(false)
    expect(b.result('player')!.retuned).toBe(false)
    expect(b.snapshot().planes.map((p) => p.retuned)).toEqual([false, false])
  })

  it('flies the wingman on its own copy of the params', () => {
    const given = { ...defaultParams(pid) }
    let received: Readonly<Record<string, number>> | undefined
    const spy: RunAlgorithm = {
      id: 'pid',
      create: (params) => ((received = params), pid.create(params)),
    }
    const reference = withWingman(pidPlayer())
    const run = withWingman({ algorithm: spy, params: given })
    expect(received).toBeDefined()
    expect(received).not.toBe(given)
    expect(received).toEqual(given)
    for (const key of Object.keys(given)) given[key] = given[key] * 3 + 1
    flyToEnd(reference)
    flyToEnd(run)
    expect(run.result('wingman')).toEqual(reference.result('wingman'))
  })

  it('gives each plane its own controller when both fly the same algorithm', () => {
    const lone = pidRun()
    const run = withWingman(pidPlayer())
    flyToEnd(lone)
    flyToEnd(run)
    const { lesson: _l, ...loneRest } = lone.result('player')!
    expect(run.result('player')).toEqual(lone.result('player'))
    const { lesson, ...wingRest } = run.result('wingman')!
    expect(lesson).toBe('pid')
    expect(wingRest).toEqual(loneRest)
    expect(traceColumns(run.snapshot(), 'wingman')).toEqual(traceColumns(lone.snapshot()))
  })

  it('reports both planes in the snapshot, and only the player without a wingman', () => {
    const run = withWingman({ algorithm: pAlgorithm, params: defaultParams(pAlgorithm) })
    run.step(40)
    const s = run.snapshot()
    expect(s.planes.map((p) => p.id)).toEqual(['player', 'wingman'])
    expect(Object.keys(s.trace)).toEqual(['player', 'wingman'])
    expect(s.trace.wingman!.length).toBeGreaterThan(0)
    expect(s.trace.wingman!.h).not.toBe(s.trace.player!.h)
    // The views are the run's live buffers, not copies.
    run.step(40)
    expect(run.snapshot().trace.wingman!.h).toBe(s.trace.wingman!.h)
    const lone = pidRun()
    lone.step(40)
    const ls = lone.snapshot()
    expect(ls.planes).toHaveLength(1)
    expect(Object.keys(ls.trace)).toEqual(['player'])
    expect('wingman' in ls.trace).toBe(false)
  })

  it('has no wingman result or status without a wingman', () => {
    const run = pidRun()
    flyToEnd(run)
    expect(run.result('wingman')).toBeUndefined()
    expect(run.status('wingman')).toBeUndefined()
    expect(summarize(run, 'wingman')).toBeUndefined()
  })

  it('reports the wingman result and summarizes it as a wingman row', () => {
    const run = createRun({
      course: 101,
      mode: 'semi-auto',
      player: pidPlayer(),
      wingman: { algorithm: pAlgorithm, params: defaultParams(pAlgorithm) },
    })
    flyToEnd(run)
    const r = run.result('wingman')!
    expect(r.lesson).toBe(pAlgorithm.id)
    expect(r.mode).toBe('autopilot')
    expect(r.course).toBe(101)
    expect(r.ringsTotal).toBe(10)
    expect(r.retuned).toBe(false)
    expect(r.status).toBe(run.status('wingman'))
    expect(r.points).toBe(run.snapshot().planes[1].points)
    expect(r.energy).toBeGreaterThan(0)
    const row = summarize(run, 'wingman')!
    expect(row.lesson).toBe(pAlgorithm.id)
    expect(row.tags[0]).toBe('wingman')
    expect(row.tags).not.toContain('semi-auto')
    expect(row.rings).toBe(ringsPassed(r.results))
  })
})

describe('Run altimeter noise and Kalman filter', () => {
  const CONTROL_EVERY = Math.round(PLANT.Tc / PLANT.dt)
  const pidOn = (conditions?: Partial<Conditions>, wingman = false) =>
    createRun({
      course: 101,
      mode: 'autopilot',
      player: { algorithm: pid, params: defaultParams(pid) },
      wingman: wingman ? { algorithm: pAlgorithm, params: defaultParams(pAlgorithm) } : undefined,
      conditions,
    })
  /** PID that records the context of every call. */
  function recording(): { algorithm: RunAlgorithm; seen: ControlContext[] } {
    const seen: ControlContext[] = []
    return {
      seen,
      algorithm: {
        id: 'pid',
        create: (params) => {
          const inner = pid.create(params)
          return {
            compute: (ctx) => {
              seen.push(ctx)
              return inner.compute(ctx)
            },
          }
        },
      },
    }
  }
  const recordedRun = (conditions: Partial<Conditions>) => {
    const rec = recording()
    const run = createRun({ course: 101, mode: 'autopilot', player: { algorithm: rec.algorithm, params: defaultParams(pid) }, conditions })
    return { run, seen: rec.seen }
  }
  /** The player's unit samples at each control tick: draws 1, 5, 9 … of its sensor stream. */
  function tickSamples(ticks: number): number[] {
    const rng = stream(101, 'sensor:player')
    const out: number[] = []
    for (let step = 0; out.length < ticks; step++) {
      const sample = gauss(rng)
      if (step % CONTROL_EVERY === 0) out.push(sample)
    }
    return out
  }
  const rms = (a: number[], b: number[]) => Math.sqrt(a.reduce((sum, x, i) => sum + (x - b[i]!) ** 2, 0) / a.length)

  it('reads the true altitude with zero noise, so the trace and score are unchanged', () => {
    const { run, seen } = recordedRun({ ...CALM })
    const base = pidRun()
    flyToEnd(run)
    flyToEnd(base)
    const [, , h, hMeas, hEst] = traceColumns(run.snapshot())
    expect(hMeas).toEqual(h)
    expect(hEst).toEqual(h)
    expect(seen.map((c) => c.h)).toEqual(h)
    expect(traceColumns(run.snapshot())).toEqual(traceColumns(base.snapshot()))
    expect(run.result('player')).toEqual(base.result('player'))
  })

  it('hands the controller the noisy reading and its finite difference without the filter', () => {
    const { run, seen } = recordedRun({ noise: 2 })
    run.step(CONTROL_EVERY * 200)
    const [, , h, hMeas, hEst] = traceColumns(run.snapshot())
    expect(seen.map((c) => c.h)).toEqual(hMeas)
    expect(hEst).toEqual(hMeas)
    const samples = tickSamples(hMeas.length)
    hMeas.forEach((y, i) => expect(y - h[i]!).toBeCloseTo(2 * samples[i]!, 9))
    expect(hMeas.filter((y, i) => y !== h[i]).length).toBe(hMeas.length)
    expect(seen[0]!.v).toBe(0)
    for (let i = 1; i < seen.length; i++) expect(seen[i]!.v).toBeCloseTo((hMeas[i]! - hMeas[i - 1]!) / PLANT.Tc, 9)
  })

  it('hands the controller the Kalman estimate, which beats the raw reading', () => {
    const { run, seen } = recordedRun({ noise: 2, kalman: 1 })
    flyToEnd(run)
    const [, , h, hMeas, hEst, u] = traceColumns(run.snapshot())
    let kf: KalmanState | null = null
    hMeas.forEach((y, i) => {
      kf = stepKalman(kf ?? createKalman(y), y, i === 0 ? 0 : u[i - 1]!, 10, 4)
      expect(seen[i]!.h).toBe(kf.h)
      expect(seen[i]!.v).toBe(kf.v)
      expect(hEst[i]).toBe(kf.h)
      // The first step starts at the reading with no climb, so it lands on it exactly.
      if (i === 0) expect(hEst[i]).toBe(y)
      else expect(hEst[i]).not.toBe(y)
    })
    expect(rms(hEst, h)).toBeLessThan(rms(hMeas, h))
  })

  it('starts the filter from the current reading when it is turned on mid-flight', () => {
    const { run, seen } = recordedRun({ noise: 2 })
    const N = 50
    run.step(CONTROL_EVERY * N)
    run.setEnv('kalman', 1)
    run.step(1)
    const [, , , hMeas, hEst, u] = traceColumns(run.snapshot())
    expect(hMeas.length).toBe(N + 1)
    const expected = stepKalman(createKalman(hMeas[N]!), hMeas[N]!, u[N - 1]!, 10, 4)
    expect(hEst[N]).toBe(expected.h)
    expect(seen[N]!.v).toBe(expected.v)
    expect(hEst.slice(0, N)).toEqual(hMeas.slice(0, N))
  })

  it('restarts the filter from the current reading after it is turned off and on', () => {
    const { run } = recordedRun({ noise: 2, kalman: 1 })
    run.step(CONTROL_EVERY * 20)
    run.setEnv('kalman', 0)
    run.step(CONTROL_EVERY * 5)
    run.setEnv('kalman', 1)
    run.step(1)
    const [, , , hMeas, hEst, u] = traceColumns(run.snapshot())
    const i = hMeas.length - 1
    expect(hEst.slice(20, 25)).toEqual(hMeas.slice(20, 25))
    expect(hEst[i]).toBe(stepKalman(createKalman(hMeas[i]!), hMeas[i]!, u[i - 1]!, 10, 4).h)
  })

  it('leaves the player unchanged by a wingman under noise, with or without the filter', () => {
    for (const conditions of [{ noise: 2 }, { noise: 2, kalman: 1 }]) {
      const lone = pidOn(conditions)
      const paired = pidOn(conditions, true)
      flyToEnd(lone)
      flyToEnd(paired)
      expect(traceColumns(paired.snapshot())).toEqual(traceColumns(lone.snapshot()))
      expect(paired.result('player')).toEqual(lone.result('player'))
    }
  })

  it('draws the sensor samples while noise is 0, so a late change picks up the same sequence', () => {
    const N = CONTROL_EVERY * 100
    const late = pidOn()
    const fromStart = pidOn({ noise: 2 })
    late.step(N)
    fromStart.step(N)
    late.setEnv('noise', 2)
    late.step(1)
    fromStart.step(1)
    const lateTr = traceColumns(late.snapshot())
    const startTr = traceColumns(fromStart.snapshot())
    const i = lateTr[3]!.length - 1
    const samples = tickSamples(i + 1)
    expect(lateTr[3]![i]! - lateTr[2]![i]!).toBeCloseTo(2 * samples[i]!, 9)
    expect(startTr[3]![i]! - startTr[2]![i]!).toBeCloseTo(2 * samples[i]!, 9)
  })

  it('records per row the noise each reading had and whether the filter ran', () => {
    const run = pidOn()
    run.step(CONTROL_EVERY * 10)
    run.setEnv('noise', 1.5)
    run.step(CONTROL_EVERY * 10)
    run.setEnv('kalman', 1)
    run.step(CONTROL_EVERY * 10)
    run.setEnv('noise', 0)
    run.setEnv('kalman', 0)
    run.step(CONTROL_EVERY * 10)
    const tr = run.snapshot().trace.player!
    const col = (c: Float64Array | Readonly<Float64Array>) => Array.from(c.subarray(0, tr.length))
    const blocks = (a: number, b: number, c: number, d: number) => [a, b, c, d].flatMap((v) => Array<number>(10).fill(v))
    expect(col(tr.noise)).toEqual(blocks(0, 1.5, 1.5, 0))
    expect(col(tr.kalman)).toEqual(blocks(0, 0, 1, 0))
  })

  it('records the same flight however the steps are batched', () => {
    const runs = [1, 2, 4].map((n) => {
      const run = pidOn({ noise: 2, kalman: 1 })
      flyToEnd(run, n)
      return traceColumns(run.snapshot())
    })
    expect(runs[1]).toEqual(runs[0])
    expect(runs[2]).toEqual(runs[0])
  })
})
