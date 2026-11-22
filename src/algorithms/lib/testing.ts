// Shared helpers for the module tests: a default control context, a check that
// reported poles are roots of a stated polynomial, and the course-101 flight
// pair every flying module must pass. For tests only; it imports the test
// runner. This folder is not scanned by the algorithm registry, so nothing
// here is ever mistaken for an algorithm module.

import { expect, it } from 'vitest'
import type { ControlContext } from '../../sim/types.ts'
import { defaultParams, type AlgorithmModule, type Complex } from '../index.ts'
import { flyCourse } from './fly-course.ts'
import { polyAt } from './poly.ts'

/** A level, resting plane at the 50 m setpoint, with `over` applied on top. */
export function controlContext(over: Partial<ControlContext> = {}): ControlContext {
  return {
    t: 0,
    T: 0.02,
    ref: 50,
    h: 50,
    v: 0,
    input: 0,
    refAhead: () => 50,
    ...over,
  }
}

/** Expects every pole to be a root of `chi` (highest power first) within 1e-9. */
export function expectRootsOf(chi: readonly number[], poles: readonly Complex[]): void {
  for (const s of poles) {
    const r = polyAt(chi, s)
    expect(Math.hypot(r.re, r.im)).toBeLessThan(1e-9)
  }
}

/**
 * Registers the two course-101 flight tests for `module` with its default
 * parameters, inside the caller's `describe`.
 */
export function fliesCourse101(module: AlgorithmModule): void {
  it('passes at least 6 of 10 rings in Autopilot without crashing', () => {
    const flight = flyCourse(module, defaultParams(module), 'autopilot')
    expect(flight.status).not.toBe('crashed')
    expect(flight.ringsPassed).toBeGreaterThanOrEqual(6)
  })

  it('finishes Semi-auto', () => {
    expect(flyCourse(module, defaultParams(module), 'semi-auto').status).toBe('finished')
  })
}
