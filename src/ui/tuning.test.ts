import { describe, expect, it, vi } from 'vitest'
import { defaultParams, type Params } from '../algorithms/index.ts'
import manual from '../algorithms/manual.ts'
import pid from '../algorithms/pid.ts'
import { createRun } from '../sim/run.ts'
import { summarize } from '../sim/scoring.ts'
import { createFlight } from './flight.ts'
import type { StorageGetter } from './persistence.ts'
import { createStore } from './store.ts'
import { createTuningHandlers } from './tuning.ts'

function setup() {
  const items = new Map<string, string>()
  const storage = {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => void items.set(key, value),
  } as unknown as NonNullable<ReturnType<StorageGetter>>
  const store = createStore([manual, pid], () => storage)
  let params: Params = store.params('pid')
  const flight = createFlight(
    () => createRun({ course: 101, mode: 'autopilot', player: { algorithm: pid, params } }),
    store,
  )
  const marked = vi.fn()
  const handlers = createTuningHandlers({
    store,
    flight,
    lesson: () => 'pid',
    setParams(next) {
      params = next
    },
    marked,
  })
  return { store, flight, handlers, marked, params: () => params }
}

describe('createTuningHandlers', () => {
  it('retunes a running flight and tags it retuned', () => {
    const { store, flight, handlers, params } = setup()
    flight.fly()
    flight.advance(0.05)
    handlers.change('Kd', 0.1)
    expect(store.params('pid').Kd).toBe(0.1)
    expect(params().Kd).toBe(0.1)
    expect(flight.snapshot().planes[0].retuned).toBe(true)
    flight.run.step(Infinity)
    expect(summarize(flight.run)!.tags).toContain('retuned')
  })

  it('retunes a paused flight too', () => {
    const { flight, handlers } = setup()
    flight.fly()
    flight.togglePause()
    handlers.change('Kd', 0.1)
    expect(flight.snapshot().planes[0].retuned).toBe(true)
  })

  it('outside a flight only stores the value, and the next Fly flies it untagged', () => {
    const { store, flight, handlers } = setup()
    handlers.change('Kd', 0.1)
    expect(store.params('pid').Kd).toBe(0.1)
    expect(flight.snapshot().planes[0].retuned).toBe(false)
    flight.fly()
    expect(flight.snapshot().planes[0].retuned).toBe(false)
    flight.run.step(Infinity)
    expect(flight.run.result('player')!.retuned).toBe(false)
  })

  it('leaves a finished run alone and hands the next run the new value', () => {
    const { flight, handlers, params } = setup()
    flight.fly()
    flight.run.step(Infinity)
    flight.advance(0.05)
    expect(flight.phase).toBe('ended')
    const ended = flight.run
    handlers.change('Kd', 0.1)
    handlers.commit('Kd 0.05 → 0.1')
    expect(ended.result('player')!.retuned).toBe(false)
    expect(ended.snapshot().markers).toEqual([])
    expect(params()).toEqual({ ...defaultParams(pid), Kd: 0.1 })
  })

  it('drops a marker on commit only in flight, then asks for a redraw', () => {
    const { flight, handlers, marked } = setup()
    handlers.commit('Kd 0.05 → 0.1')
    expect(flight.snapshot().markers).toEqual([])
    expect(marked).not.toHaveBeenCalled()
    flight.fly()
    flight.advance(0.05)
    handlers.commit('Kd 0.05 → 0.1')
    expect(flight.snapshot().markers.map((m) => m.label)).toEqual(['Kd 0.05 → 0.1'])
    expect(marked).toHaveBeenCalledTimes(1)
  })
})
