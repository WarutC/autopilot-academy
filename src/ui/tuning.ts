// The autopilot card's tuning handlers: a parameter change is stored for the
// next Fly and, during a flight, retunes the run; a finished change drops a
// recorder marker only during a flight.

import type { Params } from '../algorithms/index.ts'
import type { AutopilotCardHandlers } from './autopilot-card.ts'
import { inFlight, type Flight } from './flight.ts'
import type { Store } from './store.ts'

export interface TuningOptions {
  readonly store: Pick<Store, 'params' | 'setParam'>
  readonly flight: Pick<Flight, 'phase' | 'run'>
  /** The selected lesson's id. */
  lesson(): string
  /** Receives the lesson's new params, for the next run. */
  setParams(params: Params): void
  /** Called after a marker is dropped, so the recorder redraws. */
  marked(): void
}

export function createTuningHandlers(options: TuningOptions): Pick<AutopilotCardHandlers, 'change' | 'commit'> {
  const { store, flight } = options
  return {
    change(key, value) {
      const id = options.lesson()
      // The store hands out a new record each time, so a finished run's params are never touched.
      store.setParam(id, key, value)
      const params = store.params(id)
      options.setParams(params)
      if (inFlight(flight.phase)) flight.run.setParam('player', key, params[key] ?? value)
    },
    commit(label) {
      if (!inFlight(flight.phase)) return
      flight.run.markChange(label)
      options.marked()
    },
  }
}
