// The Flight conditions and Wingman card handlers. A condition change is
// stored and reaches the current run at once, unless the run has ended; a
// wingman change is stored for the next Fly and rebuilds only the ready
// preview. A finished run keeps the conditions and the wingman it flew, so
// its banner, logbook rows and recorder stay as they were.

import type { Conditions } from '../sim/types.ts'
import type { ConditionsCardHandlers } from './conditions-card.ts'
import type { Flight } from './flight.ts'
import type { Store } from './store.ts'
import type { WingmanCardHandlers } from './wingman-card.ts'

export interface FlightSettingsOptions {
  readonly store: Pick<Store, 'conditions' | 'setCondition' | 'setWingman'>
  readonly flight: Pick<Flight, 'phase' | 'run' | 'reset'>
  /** Drops the dev fixture, so the ready preview shows the run. */
  clearFixture(): void
  /** Reflects a replaced run into the toolbar, cards and banner. */
  synced(): void
  /** Asks for a redraw of the scene and the recorder. */
  redraw(): void
}

export function createFlightSettings(options: FlightSettingsOptions): {
  readonly conditions: ConditionsCardHandlers
  readonly wingman: WingmanCardHandlers
} {
  const { store, flight } = options
  return {
    conditions: {
      change(key, value) {
        store.setCondition(key, value)
        // The run takes the store's clamped value; the ready preview takes it too, so its snapshot stays current.
        if (flight.phase !== 'ended') flight.run.setEnv(key, store.conditions[key as keyof Conditions])
        options.clearFixture()
        options.redraw()
      },
    },
    wingman: {
      change(id) {
        store.setWingman(id)
        // Only the ready preview shows the new wingman; Fly again builds the next run with it.
        if (flight.phase !== 'ready') return
        options.clearFixture()
        flight.reset()
        options.synced()
        options.redraw()
      },
    },
  }
}
