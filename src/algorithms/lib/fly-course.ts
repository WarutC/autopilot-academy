// A whole flight of course 101 with one algorithm, for tests that check a
// module actually flies. Pure and free of test-runner imports, so any module
// test can import it.

import { PLANT } from '../../sim/plant.ts'
import { createRun } from '../../sim/run.ts'
import { ringsPassed } from '../../sim/scoring.ts'
import type { PlaneStatus, RingResult } from '../../sim/types.ts'
import type { AlgorithmModule, Params } from '../index.ts'

/** The course every module is checked on. */
export const FLY_COURSE = 101
/** Semi-auto: the setpoint starts here, m. */
export const SEMI_AUTO_HIGH = 80
/** Semi-auto: the setpoint alternates with this one, m. */
export const SEMI_AUTO_LOW = 30
/** Semi-auto: seconds between setpoint steps. */
export const SEMI_AUTO_PERIOD = 5

/** Physics steps per batch; the Semi-auto setpoint is updated between batches. */
const BATCH = 4
/** Stops a flight that never ends; far longer than any course takes. */
const MAX_STEPS = 1_000_000

/** How one `flyCourse` flight ended. */
export interface CourseFlight {
  /** Rings flown through. */
  readonly ringsPassed: number
  /** Rings on the course. */
  readonly ringsTotal: number
  /** `finished` or `crashed`; `flying` only if the step cap was hit. */
  readonly status: PlaneStatus
  /** Per-ring results, in course order. */
  readonly results: readonly RingResult[]
}

/** The Semi-auto setpoint at time `t`: `SEMI_AUTO_HIGH`, then `SEMI_AUTO_LOW`, switching every `SEMI_AUTO_PERIOD` s. */
export function semiAutoSetpoint(t: number): number {
  return Math.floor(t / SEMI_AUTO_PERIOD) % 2 === 0 ? SEMI_AUTO_HIGH : SEMI_AUTO_LOW
}

/**
 * Flies `module` with `params` over course `FLY_COURSE` in `mode` until the
 * plane finishes or crashes. In Semi-auto the setpoint follows
 * `semiAutoSetpoint`. Returns the rings passed, the ring count, the final
 * status and the per-ring results.
 */
export function flyCourse(
  module: AlgorithmModule,
  params: Params,
  mode: 'semi-auto' | 'autopilot',
): CourseFlight {
  const run = createRun({ course: FLY_COURSE, mode, player: { algorithm: module, params } })
  for (let steps = 0; !run.done && steps < MAX_STEPS; steps += BATCH) {
    if (mode === 'semi-auto') run.setSetpoint(semiAutoSetpoint(steps * PLANT.dt))
    run.step(BATCH)
  }
  const result = run.result('player')!
  return {
    ringsPassed: ringsPassed(result.results),
    ringsTotal: result.ringsTotal,
    status: result.status,
    results: result.results,
  }
}
