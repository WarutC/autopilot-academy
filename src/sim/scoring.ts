// The single home for scoring: ring points, IAE, energy and the logbook row.

import { PLANT } from './plant.ts'
import type { PlaneId, PlaneStatus, Ring, RingResult } from './types.ts'

/** How a plane is flown; algorithm modules list their modes with this union. */
export type FlightMode = 'manual' | 'semi-auto' | 'autopilot'

/** One logbook row for one plane. */
export interface LogEntry {
  /** Algorithm id. */
  readonly lesson: string
  readonly mode: FlightMode
  readonly course: number
  readonly points: number
  /** Rings passed. */
  readonly rings: number
  readonly ringsTotal: number
  /** Integral of the absolute altitude error, m·s. */
  readonly iae: number
  /** Integral of u², s. */
  readonly energy: number
  readonly tags: readonly string[]
}

/** What a run exposes about one plane for scoring. */
export interface PlaneResult {
  /** Algorithm id. */
  readonly lesson: string
  readonly mode: FlightMode
  readonly course: number
  readonly status: PlaneStatus
  readonly points: number
  readonly results: readonly RingResult[]
  readonly ringsTotal: number
  readonly iae: number
  readonly energy: number
}

/** Anything that can report per-plane results, such as a `Run`. */
export interface ScoredRun {
  result(plane: PlaneId): PlaneResult | undefined
}

/** Points for a ring flown with altitude error `err`: 10 at the center, 4 at the rim, 0 outside. */
export function ringPoints(err: number): number {
  if (!(err <= PLANT.ringR)) return 0
  return 4 + 6 * (1 - Math.max(0, err) / PLANT.ringR)
}

/** Scores ring `index` crossed at altitude `h`. */
export function ringResult(index: number, ring: Ring, h: number): RingResult {
  const err = Math.abs(h - ring.h)
  const pass = err <= PLANT.ringR
  return { ring: index, pass, err, points: ringPoints(err) }
}

export function ringsPassed(results: readonly RingResult[]): number {
  let n = 0
  for (const r of results) if (r.pass) n++
  return n
}

/** Adds `|ref − h|·dt` to the IAE; a non-finite increment adds nothing. */
export function integrateError(iae: number, ref: number, h: number, dt: number): number {
  const inc = Math.abs(ref - h) * dt
  return Number.isFinite(inc) ? iae + inc : iae
}

/** Adds `u²·dt` to the control energy; a non-finite increment adds nothing. */
export function integrateEnergy(energy: number, u: number, dt: number): number {
  const inc = u * u * dt
  return Number.isFinite(inc) ? energy + inc : energy
}

/** The logbook row for `plane`, or undefined when the run has no such plane. */
export function summarize(run: ScoredRun, plane: PlaneId = 'player'): LogEntry | undefined {
  const r = run.result(plane)
  if (!r) return undefined
  const tags: string[] = []
  if (r.status === 'crashed') tags.push('crashed')
  return {
    lesson: r.lesson,
    mode: r.mode,
    course: r.course,
    points: r.points,
    rings: ringsPassed(r.results),
    ringsTotal: r.ringsTotal,
    iae: r.iae,
    energy: r.energy,
    tags,
  }
}
