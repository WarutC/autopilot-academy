import { afterEach, describe, expect, it, vi } from 'vitest'
import manual from '../algorithms/manual.ts'
import pid from '../algorithms/pid.ts'
import { createRun } from '../sim/run.ts'
import { createFlight } from './flight.ts'
import type { StorageGetter } from './persistence.ts'
import { createRedraw, type Redraw } from './redraw.ts'
import { createStore } from './store.ts'
import { watchTheme } from './theme.ts'
import { createTuningHandlers } from './tuning.ts'

/** A redraw whose first frame has already drawn everything. */
function settled(): Redraw {
  const redraw = createRedraw()
  redraw.takeDraw()
  redraw.takeReadout()
  return redraw
}

/** Runs `count` frames the way the app does: draw when asked or `stepped`, and rebuild the readout during that draw when marked. */
function frames(redraw: Redraw, count: number, stepped = false): { draws: number; readouts: number } {
  let draws = 0
  let readouts = 0
  for (let i = 0; i < count; i++) {
    if (!redraw.takeDraw(stepped)) continue
    draws++
    if (redraw.takeReadout()) readouts++
  }
  return { draws, readouts }
}

/** Tuning handlers whose new params ask for the readout and whose marker asks only for a draw. */
function tuning(redraw: Redraw) {
  const items = new Map<string, string>()
  const storage = {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => void items.set(key, value),
  } as unknown as NonNullable<ReturnType<StorageGetter>>
  const store = createStore([manual, pid], () => storage)
  const flight = createFlight(
    () => createRun({ course: 101, mode: 'autopilot', player: { algorithm: pid, params: store.params('pid') } }),
    store,
  )
  const handlers = createTuningHandlers({
    store,
    flight,
    lesson: () => 'pid',
    setParams: redraw.requestReadout,
    marked: redraw.request,
  })
  return { flight, handlers }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('createRedraw', () => {
  it('draws everything on the first frame, then nothing until asked', () => {
    const redraw = createRedraw()
    expect(frames(redraw, 1)).toEqual({ draws: 1, readouts: 1 })
    expect(frames(redraw, 5)).toEqual({ draws: 0, readouts: 0 })
  })

  it('marks the readout for one redraw after a parameter change', () => {
    const redraw = settled()
    const { handlers } = tuning(redraw)
    handlers.change('Kp', 0.5)
    expect(frames(redraw, 5)).toEqual({ draws: 1, readouts: 1 })
  })

  it('marks the readout for one redraw after a single readout request', () => {
    const redraw = settled()
    redraw.requestReadout()
    expect(frames(redraw, 5)).toEqual({ draws: 1, readouts: 1 })
  })

  it('marks the readout for one redraw when a theme watcher given requestReadout fires', () => {
    let listener: (() => void) | undefined
    vi.stubGlobal('matchMedia', () => ({
      addEventListener: (_type: string, fn: () => void) => {
        listener = fn
      },
      removeEventListener: () => {},
    }))
    const redraw = settled()
    watchTheme(redraw.requestReadout)
    expect(frames(redraw, 3)).toEqual({ draws: 0, readouts: 0 })
    listener!()
    expect(frames(redraw, 5)).toEqual({ draws: 1, readouts: 1 })
  })

  it('coalesces several changes before a frame into one rebuild', () => {
    const redraw = settled()
    const { handlers } = tuning(redraw)
    handlers.change('Kp', 0.5)
    handlers.change('Kd', 0.1)
    redraw.requestReadout()
    expect(frames(redraw, 5)).toEqual({ draws: 1, readouts: 1 })
  })

  it('never marks the readout for a plain draw request or a recorder marker', () => {
    const redraw = settled()
    redraw.request()
    expect(frames(redraw, 5)).toEqual({ draws: 1, readouts: 0 })
    const { flight, handlers } = tuning(redraw)
    flight.fly()
    handlers.commit('Kp 0.5')
    expect(flight.snapshot().markers).toHaveLength(1)
    expect(frames(redraw, 5)).toEqual({ draws: 1, readouts: 0 })
  })

  it('draws every stepped frame but rebuilds the readout only once per mark', () => {
    const redraw = settled()
    expect(frames(redraw, 5, true)).toEqual({ draws: 5, readouts: 0 })
    redraw.requestReadout()
    expect(frames(redraw, 5, true)).toEqual({ draws: 5, readouts: 1 })
  })

  it('takes a pending request on a stepped frame, so the next still frame does not draw again', () => {
    const redraw = settled()
    redraw.request()
    expect(frames(redraw, 1, true)).toEqual({ draws: 1, readouts: 0 })
    expect(frames(redraw, 1)).toEqual({ draws: 0, readouts: 0 })
  })
})
