import { describe, expect, it } from 'vitest'
import { defaultParams } from '../algorithms/index.ts'
import pid from '../algorithms/pid.ts'
import { PLANT } from '../sim/plant.ts'
import { createRun } from '../sim/run.ts'
import { summarize } from '../sim/scoring.ts'
import { createFlight, flyLabel, pauseEnabled, pauseLabel, type Flight, type Phase, type Speed } from './flight.ts'

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

  it('keeps the sim clock in whole physics steps', () => {
    const f = createFlight(pidRun)
    f.fly()
    let steps = 0
    for (let i = 0; i < 50; i++) steps += f.advance(0.0167)
    expect(t(f)).toBeCloseTo(steps * PLANT.dt, 9)
  })
})

describe('labels', () => {
  const cases: [Phase, string, string, boolean][] = [
    ['ready', 'Fly', 'Pause', false],
    ['running', 'Restart', 'Pause', true],
    ['paused', 'Restart', 'Resume', true],
    ['ended', 'Fly again', 'Pause', false],
  ]
  it.each(cases)('%s: %s, %s, enabled %s', (phase, fly, pause, enabled) => {
    expect(flyLabel(phase)).toBe(fly)
    expect(pauseLabel(phase)).toBe(pause)
    expect(pauseEnabled(phase)).toBe(enabled)
  })
})
