import { describe, expect, it } from 'vitest'
import { defaultParams } from '../algorithms/index.ts'
import manual from '../algorithms/manual.ts'
import pAlgorithm from '../algorithms/p.ts'
import pid from '../algorithms/pid.ts'
import { PLANT } from '../sim/plant.ts'
import { CALM, createRun, type RunPlayer } from '../sim/run.ts'
import { summarize } from '../sim/scoring.ts'
import { createPhase } from './store.ts'
import { createStick } from './input.ts'
import {
  createFlight,
  flyLabel,
  inFlight,
  MAX_FRAME,
  pauseForInterruption,
  pauseLabel,
  playerRuns,
  type Flight,
  type Phase,
  type PlayerInputs,
  type Speed,
} from './flight.ts'

const pidRun = () =>
  createRun({ course: 101, mode: 'autopilot', player: { algorithm: pid, params: defaultParams(pid) } })

const t = (f: Flight) => f.snapshot().t

function flyToEnd(f: Flight, frames: readonly number[]): void {
  for (let i = 0; f.phase === 'running' && i < 1e6; i++) f.advance(frames[i % frames.length]!)
}

describe('createFlight', () => {
  it('starts ready on a fresh run and steps nothing', () => {
    const f = createFlight(pidRun)
    expect(f.phase).toBe('ready')
    expect(f.speed).toBe(1)
    expect(f.snapshot().planes[0]!.x).toBe(0)
    expect(f.advance(1)).toBe(0)
    expect(t(f)).toBe(0)
  })

  it('flies: 0.02 s at x1 is 4 physics steps', () => {
    const f = createFlight(pidRun)
    f.fly()
    expect(f.phase).toBe('running')
    expect(f.advance(0.02)).toBe(4)
    expect(t(f)).toBeCloseTo(0.02, 12)
  })

  it('carries the accumulator remainder', () => {
    const f = createFlight(pidRun)
    f.fly()
    expect(f.advance(0.003)).toBe(0)
    expect(f.advance(0.003)).toBe(1)
  })

  it('clamps a long frame to 0.05 s', () => {
    const f = createFlight(pidRun)
    f.fly()
    expect(f.advance(10)).toBe(10)
  })

  it('takes no steps on bad elapsed values', () => {
    const f = createFlight(pidRun)
    f.fly()
    expect(f.advance(Number.NaN)).toBe(0)
    expect(f.advance(-1)).toBe(0)
    expect(f.advance(Number.POSITIVE_INFINITY)).toBe(0)
    expect(t(f)).toBe(0)
  })

  it('multiplies steps by the speed', () => {
    const f = createFlight(pidRun)
    f.setSpeed(4)
    expect(f.speed).toBe(4)
    f.fly()
    expect(f.advance(0.02)).toBe(16)
  })

  it('ignores an unknown speed', () => {
    const f = createFlight(pidRun)
    f.setSpeed(3 as Speed)
    expect(f.speed).toBe(1)
  })

  it('pauses and resumes', () => {
    const f = createFlight(pidRun)
    f.fly()
    f.advance(0.02)
    const before = t(f)
    f.togglePause()
    expect(f.phase).toBe('paused')
    expect(f.advance(1)).toBe(0)
    expect(t(f)).toBe(before)
    f.togglePause()
    expect(f.phase).toBe('running')
    expect(f.advance(0.005)).toBe(1)
  })

  it('resets the accumulator on pause', () => {
    const f = createFlight(pidRun)
    f.fly()
    f.advance(0.003)
    f.togglePause()
    f.togglePause()
    expect(f.advance(0.003)).toBe(0)
  })

  it('does not toggle pause when ready or ended', () => {
    const f = createFlight(pidRun)
    f.togglePause()
    expect(f.phase).toBe('ready')
    f.fly()
    flyToEnd(f, [0.05])
    expect(f.phase).toBe('ended')
    f.togglePause()
    expect(f.phase).toBe('ended')
  })

  it.each(['running', 'paused'] as const)('restarts from %s with a new run', (phase) => {
    const f = createFlight(pidRun)
    f.fly()
    f.advance(0.05)
    const old = f.run
    if (phase === 'paused') f.togglePause()
    f.fly()
    expect(f.run).not.toBe(old)
    expect(f.phase).toBe('running')
    expect(t(f)).toBe(0)
  })

  it.each(['ready', 'running', 'paused', 'ended'] as const)('resets from %s to a fresh ready run', (phase) => {
    let made = 0
    const f = createFlight(() => (made++, pidRun()))
    if (phase !== 'ready') f.fly()
    if (phase === 'running' || phase === 'paused') f.advance(0.003)
    if (phase === 'paused') f.togglePause()
    if (phase === 'ended') flyToEnd(f, [0.05])
    expect(f.phase).toBe(phase)
    const old = f.run
    const before = made
    f.reset()
    expect(made).toBe(before + 1)
    expect(f.run).not.toBe(old)
    expect(f.phase).toBe('ready')
    expect(t(f)).toBe(0)
    expect(f.advance(1)).toBe(0)
  })

  it('ends when the run is done and flies again', () => {
    const f = createFlight(pidRun)
    f.fly()
    flyToEnd(f, [0.05])
    expect(f.phase).toBe('ended')
    expect(f.run.status('player')).toBe('finished')
    expect(f.advance(1)).toBe(0)
    f.fly()
    expect(f.phase).toBe('running')
    expect(t(f)).toBe(0)
  })

  it('counts only the steps taken when the last frame ends the run', () => {
    const f = createFlight(pidRun)
    f.setSpeed(4)
    f.fly()
    let total = 0
    let last = 0
    while (f.phase === 'running') {
      last = f.advance(0.05)
      total += last
    }
    expect(last).toBeLessThan(40)
    expect(total).toBe(Math.round(t(f) / PLANT.dt))
  })

  it('scores the same at every speed with uneven frames', () => {
    const frames = [0.016, 0.0167, 0.033, 0.001, 0.07, 0.0049, 0.02]
    const scores = ([1, 2, 4] as const).map((s) => {
      const f = createFlight(pidRun)
      f.setSpeed(s)
      f.fly()
      flyToEnd(f, frames)
      expect(f.phase).toBe('ended')
      return summarize(f.run, 'player')
    })
    const baseline = pidRun()
    for (let i = 0; !baseline.done && i < 1e6; i++) baseline.step(1)
    expect(scores[0]).toEqual(summarize(baseline, 'player'))
    expect(scores[1]).toEqual(scores[0])
    expect(scores[2]).toEqual(scores[0])
    expect(scores[0]!.points).toBeGreaterThan(0)
  })

  it('reads and writes the phase through its owner', () => {
    const owner = createPhase()
    owner.setPhase('ended')
    const f = createFlight(pidRun, owner)
    expect(owner.phase).toBe('ready')
    f.fly()
    expect(owner.phase).toBe('running')
    f.togglePause()
    expect(owner.phase).toBe('paused')
    owner.setPhase('running')
    expect(f.phase).toBe('running')
    flyToEnd(f, [0.05])
    expect(owner.phase).toBe('ended')
    f.reset()
    expect(owner.phase).toBe('ready')
  })

  it('keeps the sim clock in whole physics steps', () => {
    const f = createFlight(pidRun)
    f.fly()
    let steps = 0
    for (let i = 0; i < 50; i++) steps += f.advance(0.0167)
    expect(t(f)).toBeCloseTo(steps * PLANT.dt, 9)
  })
})

describe('labels', () => {
  const cases: [Phase, string, string][] = [
    ['ready', 'Fly', 'Pause'],
    ['running', 'Restart', 'Pause'],
    ['paused', 'Restart', 'Resume'],
    ['ended', 'Fly again', 'Pause'],
  ]
  it.each(cases)('%s: %s, %s', (phase, fly, pause) => {
    expect(flyLabel(phase)).toBe(fly)
    expect(pauseLabel(phase)).toBe(pause)
  })
})

describe('inFlight', () => {
  it('holds only while a run is running or paused', () => {
    expect((['ready', 'running', 'paused', 'ended'] as Phase[]).map(inFlight)).toEqual([false, true, true, false])
  })
})

describe('pauseForInterruption', () => {
  /** A flight in `phase` and a stick holding climb. */
  function setup(phase: Phase) {
    const f = createFlight(pidRun)
    if (phase !== 'ready') f.fly()
    if (phase === 'paused') f.togglePause()
    if (phase === 'ended') flyToEnd(f, [MAX_FRAME])
    expect(f.phase).toBe(phase)
    const stick = createStick(() => {})
    stick.press('climb', 'key:w')
    return { f, stick }
  }

  it('pauses a running flight and releases the stick', () => {
    const { f, stick } = setup('running')
    expect(pauseForInterruption(f, stick)).toBe(true)
    expect(f.phase).toBe('paused')
    expect(stick.value).toBe(0)
  })

  it.each(['ready', 'paused', 'ended'] as const)('leaves a %s flight as it is and still releases the stick', (phase) => {
    const { f, stick } = setup(phase)
    expect(pauseForInterruption(f, stick)).toBe(false)
    expect(f.phase).toBe(phase)
    expect(stick.value).toBe(0)
  })
})

describe('playerRuns', () => {
  const pPlayer: RunPlayer = { algorithm: pAlgorithm, params: defaultParams(pAlgorithm) }
  const manualPlayer: RunPlayer = { algorithm: manual, params: {} }
  const player = (run: ReturnType<ReturnType<typeof playerRuns>>) => run.snapshot().planes[0]!

  it('makes a run on the course and in the mode given, with the setpoint applied', () => {
    const run = playerRuns(() => ({ course: 202, mode: 'semi-auto', player: pPlayer, setpoint: 80, stick: 0, conditions: CALM }))()
    expect(run.snapshot().course).toBe(202)
    expect(player(run).mode).toBe('semi-auto')
    expect(player(run).ref).toBe(80)
  })

  it('counts a stick held across Fly from the first step', () => {
    const run = playerRuns(() => ({ course: 101, mode: 'manual', player: manualPlayer, setpoint: 50, stick: 1, conditions: CALM }))()
    run.step(1)
    expect(player(run).u).toBe(1)
  })

  it('reads the live inputs on every call', () => {
    let inputs: PlayerInputs = { course: 101, mode: 'manual', player: manualPlayer, setpoint: 50, stick: 1, conditions: CALM }
    const makeRun = playerRuns(() => inputs)
    const first = makeRun()
    first.step(1)
    expect(first.snapshot().course).toBe(101)
    expect(player(first).mode).toBe('manual')
    expect(player(first).u).toBe(1)

    const created: string[] = []
    const seen: number[] = []
    const tracked: RunPlayer = {
      algorithm: {
        id: 'tracked',
        create(params) {
          created.push('tracked')
          const p = pAlgorithm.create(params)
          return { compute: (ctx) => (seen.push(ctx.input), p.compute(ctx)) }
        },
      },
      params: defaultParams(pAlgorithm),
    }
    inputs = { course: 303, mode: 'semi-auto', player: tracked, setpoint: 30, stick: 1, conditions: CALM }
    const second = makeRun()
    second.step(1)
    expect(created).toEqual(['tracked'])
    expect(second.snapshot().course).toBe(303)
    expect(player(second).mode).toBe('semi-auto')
    expect(player(second).ref).toBe(30)
    // The stick only reaches the controller in Manual: held up here, the P player sees it released and dives toward 30 m.
    expect(seen.length).toBeGreaterThan(0)
    expect(seen.every((input) => input === 0)).toBe(true)
    expect(player(second).u).toBeLessThan(0)

    inputs = { ...inputs, mode: 'manual', player: manualPlayer, stick: -1 }
    const third = makeRun()
    third.step(1)
    expect(player(third).u).toBe(-1)
  })

  it('passes the conditions to the new run', () => {
    const conditions = { ...CALM, gusts: 6, down: 1.5 }
    const run = playerRuns(() => ({ course: 101, mode: 'autopilot', player: pPlayer, setpoint: 50, stick: 0, conditions }))()
    expect(run.snapshot().conditions).toEqual(conditions)
  })
})
