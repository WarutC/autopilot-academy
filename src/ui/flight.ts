// The flight controller: the phase, the current run, the playback speed and
// the wall-clock to physics-step accumulator. No DOM and no clock of its own;
// the frame loop feeds it elapsed seconds.

import { PLANT } from '../sim/plant.ts'
import type { Run } from '../sim/run.ts'
import type { Snapshot } from '../sim/types.ts'

export type Phase = 'ready' | 'running' | 'paused' | 'ended'
export type Speed = 1 | 2 | 4

export const SPEEDS: readonly Speed[] = [1, 2, 4]

/** Longest wall-clock frame that counts toward the sim, in seconds. */
export const MAX_FRAME = 0.05

export interface Flight {
  readonly phase: Phase
  readonly speed: Speed
  readonly run: Run
  /** Starts a new run: Fly, Restart or Fly again. */
  fly(): void
  /** Replaces the run with a fresh one that has not started; the phase becomes ready. */
  reset(): void
  /** Pauses a running flight or resumes a paused one; other phases are unchanged. */
  togglePause(): void
  setSpeed(speed: Speed): void
  /** Feeds `elapsedSec` of wall-clock time; returns the number of physics steps taken. */
  advance(elapsedSec: number): number
  snapshot(): Snapshot
}

function clampElapsed(elapsed: number): number {
  return Number.isFinite(elapsed) && elapsed > 0 ? Math.min(elapsed, MAX_FRAME) : 0
}

export function createFlight(makeRun: () => Run): Flight {
  let phase: Phase = 'ready'
  let speed: Speed = 1
  let run = makeRun()
  let acc = 0

  return {
    get phase() {
      return phase
    },
    get speed() {
      return speed
    },
    get run() {
      return run
    },
    fly() {
      run = makeRun()
      acc = 0
      phase = run.done ? 'ended' : 'running'
    },
    reset() {
      run = makeRun()
      acc = 0
      phase = 'ready'
    },
    togglePause() {
      if (phase === 'running') phase = 'paused'
      else if (phase === 'paused') phase = 'running'
      else return
      acc = 0
    },
    setSpeed(s) {
      if (SPEEDS.includes(s)) speed = s
    },
    advance(elapsedSec) {
      if (phase !== 'running') return 0
      acc += clampElapsed(elapsedSec) * speed
      // The epsilon keeps a whole number of steps from flooring one short.
      const n = Math.floor(acc / PLANT.dt + 1e-9)
      acc = Math.max(0, acc - n * PLANT.dt)
      // Step one at a time so the count stops where the run finishes or crashes.
      let taken = 0
      while (taken < n && !run.done) {
        run.step(1)
        taken++
      }
      if (run.done) phase = 'ended'
      return taken
    },
    snapshot() {
      return run.snapshot()
    },
  }
}

export function flyLabel(phase: Phase): string {
  if (phase === 'ready') return 'Fly'
  if (phase === 'ended') return 'Fly again'
  return 'Restart'
}

export function pauseLabel(phase: Phase): string {
  return phase === 'paused' ? 'Resume' : 'Pause'
}

export function pauseEnabled(phase: Phase): boolean {
  return phase === 'running' || phase === 'paused'
}

/** True while a run is flying or paused, so a parameter change retunes it; outside a run it only affects the next Fly. */
export function inFlight(phase: Phase): boolean {
  return phase === 'running' || phase === 'paused'
}
