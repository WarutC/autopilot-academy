// The flight controller: the phase transitions, the current run, the playback
// speed and the wall-clock to physics-step accumulator. The phase itself lives
// in a phase owner (the store in the app). No DOM and no clock of its own;
// the frame loop feeds it elapsed seconds.

import { PLANT } from '../sim/plant.ts'
import { createRun, type Run, type RunPlayer } from '../sim/run.ts'
import type { Conditions, FlightMode, Snapshot, StickInput } from '../sim/types.ts'
import type { Stick } from './input.ts'
import { createPhase, type Phase, type PhaseOwner } from './store.ts'

export type { Phase } from './store.ts'
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

/** `owner` holds the phase; the flight reads and writes it there and keeps only the transitions. */
export function createFlight(makeRun: () => Run, owner: PhaseOwner = createPhase()): Flight {
  owner.setPhase('ready')
  let speed: Speed = 1
  let run = makeRun()
  let acc = 0

  return {
    get phase() {
      return owner.phase
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
      owner.setPhase(run.done ? 'ended' : 'running')
    },
    reset() {
      run = makeRun()
      acc = 0
      owner.setPhase('ready')
    },
    togglePause() {
      if (owner.phase === 'running') owner.setPhase('paused')
      else if (owner.phase === 'paused') owner.setPhase('running')
      else return
      acc = 0
    },
    setSpeed(s) {
      if (SPEEDS.includes(s)) speed = s
    },
    advance(elapsedSec) {
      if (owner.phase !== 'running') return 0
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
      if (run.done) owner.setPhase('ended')
      return taken
    },
    snapshot() {
      return run.snapshot()
    },
  }
}

/** The player's live inputs a new run starts from. */
export interface PlayerInputs {
  readonly course: number
  readonly mode: FlightMode
  readonly player: RunPlayer
  readonly setpoint: number
  readonly stick: StickInput
  readonly conditions: Conditions
  /** A second autopilot flown beside the player, or none. */
  readonly wingman?: RunPlayer
}

/**
 * The `makeRun` for `createFlight`: every new run takes the player's live
 * inputs, so a button held across Fly counts from the first step and the
 * setpoint and the flight conditions hold across runs.
 */
export function playerRuns(inputs: () => PlayerInputs): () => Run {
  return () => {
    const { course, mode, player, setpoint, stick, conditions, wingman } = inputs()
    const run = createRun({ course, mode, player, conditions, wingman })
    run.setSetpoint(setpoint)
    run.setInput(stick)
    return run
  }
}

/**
 * The player looked away (a hidden tab, a rotation, the drawer opening):
 * releases the stick and pauses a running flight; any other phase is left as
 * it is. Returns true when it paused.
 */
export function pauseForInterruption(flight: Flight, stick: Pick<Stick, 'releaseAll'>): boolean {
  stick.releaseAll()
  if (flight.phase !== 'running') return false
  flight.togglePause()
  return true
}

export function flyLabel(phase: Phase): string {
  if (phase === 'ready') return 'Fly'
  if (phase === 'ended') return 'Fly again'
  return 'Restart'
}

export function pauseLabel(phase: Phase): string {
  return phase === 'paused' ? 'Resume' : 'Pause'
}

/** True while a run is flying or paused, so a parameter change retunes it; outside a run it only affects the next Fly. */
export function inFlight(phase: Phase): boolean {
  return phase === 'running' || phase === 'paused'
}
