import { describe, expect, it, vi } from 'vitest'
import { algorithms } from '../algorithms/index.ts'
import pid from '../algorithms/pid.ts'
import { PLANT } from '../sim/plant.ts'
import { createFlightSettings } from './flight-settings.ts'
import { createFlight, playerRuns } from './flight.ts'
import { createEndedRunStep } from './logbook.ts'
import type { StorageGetter } from './persistence.ts'
import { createStore } from './store.ts'
import { wingmanPlayer } from './wingman-card.ts'

/** A store, a flight and the card handlers wired as the page wires them. */
function setup() {
  const items = new Map<string, string>()
  const storage = {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => void items.set(key, value),
  } as unknown as NonNullable<ReturnType<StorageGetter>>
  const store = createStore(algorithms, () => storage)
  store.setLesson('pid')
  const flight = createFlight(
    playerRuns(() => ({
      course: store.course,
      mode: 'autopilot',
      player: { algorithm: pid, params: store.params('pid') },
      setpoint: PLANT.hStart,
      stick: 0,
      conditions: store.conditions,
      wingman: wingmanPlayer(algorithms, store.wingman, (id) => store.params(id)),
    })),
    store,
  )
  const clearFixture = vi.fn()
  const synced = vi.fn()
  const redraw = vi.fn()
  const handlers = createFlightSettings({ store, flight, clearFixture, synced, redraw })
  return { store, flight, handlers, clearFixture, synced, redraw }
}

const flyToEnd = (flight: ReturnType<typeof setup>['flight']) => {
  for (let i = 0; flight.phase === 'running' && i < 1e5; i++) flight.advance(0.05)
}

describe('createFlightSettings: conditions', () => {
  it('hands a running flight the store\'s clamped value at once', () => {
    const { store, flight, handlers, redraw } = setup()
    flight.fly()
    flight.advance(0.05)
    handlers.conditions.change('gusts', 99)
    expect(store.conditions.gusts).toBe(20)
    expect(flight.snapshot().conditions.gusts).toBe(20)
    handlers.conditions.change('kalman', 0.3)
    expect(flight.snapshot().conditions.kalman).toBe(1)
    expect(redraw).toHaveBeenCalledTimes(2)
  })

  it('hands a paused flight and the ready preview the new value too', () => {
    const { flight, handlers } = setup()
    handlers.conditions.change('noise', 1.5)
    expect(flight.snapshot().conditions.noise).toBe(1.5)
    flight.fly()
    flight.togglePause()
    handlers.conditions.change('down', 2)
    expect(flight.snapshot().conditions.down).toBe(2)
  })

  it('leaves an ended run as it flew and gives the next Fly the new value', () => {
    const { store, flight, handlers } = setup()
    flight.fly()
    flyToEnd(flight)
    expect(flight.phase).toBe('ended')
    const ended = flight.run
    handlers.conditions.change('down', 3)
    expect(store.conditions.down).toBe(3)
    expect(flight.run).toBe(ended)
    expect(ended.snapshot().conditions.down).toBe(0)
    flight.fly()
    expect(flight.snapshot().conditions.down).toBe(3)
  })

  it('clears the dev fixture on a change, so the ready preview shows the new conditions', () => {
    const { handlers, clearFixture } = setup()
    handlers.conditions.change('noise', 2)
    expect(clearFixture).toHaveBeenCalledTimes(1)
  })
})

describe('createFlightSettings: wingman', () => {
  it('rebuilds the ready preview with the new wingman', () => {
    const { flight, handlers, clearFixture, synced, redraw } = setup()
    const before = flight.run
    handlers.wingman.change('p')
    expect(flight.run).not.toBe(before)
    expect(flight.phase).toBe('ready')
    expect(flight.run.result('wingman')?.lesson).toBe('p')
    expect(clearFixture).toHaveBeenCalledTimes(1)
    expect(synced).toHaveBeenCalledTimes(1)
    expect(redraw).toHaveBeenCalledTimes(1)
  })

  it('leaves an ended run, its result and its trace alone; Fly again flies the new wingman', () => {
    const { store, flight, handlers, synced } = setup()
    handlers.wingman.change('p')
    flight.fly()
    flyToEnd(flight)
    expect(flight.phase).toBe('ended')
    const ended = flight.run
    const rows = ended.snapshot().trace.player!.length
    synced.mockClear()
    handlers.wingman.change(null)
    expect(store.wingman).toBeNull()
    expect(flight.phase).toBe('ended')
    expect(flight.run).toBe(ended)
    expect(ended.result('wingman')?.lesson).toBe('p')
    expect(flight.snapshot().trace.player!.length).toBe(rows)
    expect(synced).not.toHaveBeenCalled()
    flight.fly()
    expect(flight.run.result('wingman')).toBeUndefined()
  })

  it('leaves a running or paused flight alone', () => {
    const { store, flight, handlers } = setup()
    flight.fly()
    const run = flight.run
    handlers.wingman.change('p')
    flight.togglePause()
    handlers.wingman.change('lqr')
    expect(store.wingman).toBe('lqr')
    expect(flight.run).toBe(run)
    expect(run.result('wingman')).toBeUndefined()
  })
})

describe('createEndedRunStep', () => {
  it('logs a run once when it ends, never while running or paused, and refreshes both cards', () => {
    const { store, flight, handlers } = setup()
    handlers.wingman.change('p')
    const logbook = vi.fn()
    const bests = vi.fn()
    const step = createEndedRunStep(store, { logbook, bests })
    step(flight.phase, flight.run)
    flight.fly()
    flight.advance(0.05)
    step(flight.phase, flight.run)
    flight.togglePause()
    step(flight.phase, flight.run)
    expect(store.logbook).toEqual([])
    expect(logbook).not.toHaveBeenCalled()
    flight.togglePause()
    flyToEnd(flight)
    for (let i = 0; i < 3; i++) step(flight.phase, flight.run)
    expect(store.logbook.map((r) => r.lesson)).toEqual(['pid', 'p'])
    expect(logbook).toHaveBeenCalledTimes(1)
    expect(logbook).toHaveBeenCalledWith(store.logbook)
    expect(bests).toHaveBeenCalledTimes(1)
    expect(bests).toHaveBeenCalledWith(store.best)
    expect(store.best.pid).toBe(flight.run.result('player')!.points)
  })

  it('logs each new ended run, ahead of the older rows', () => {
    const { store, flight } = setup()
    const logbook = vi.fn()
    const step = createEndedRunStep(store, { logbook, bests: () => {} })
    for (let k = 0; k < 2; k++) {
      flight.fly()
      flyToEnd(flight)
      step(flight.phase, flight.run)
    }
    expect(store.logbook).toHaveLength(2)
    expect(logbook).toHaveBeenCalledTimes(2)
  })
})
