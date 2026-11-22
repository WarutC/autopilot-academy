// One flight: the plant and its controller stepped on a fixed clock, with the
// recorder trace, ring scoring and the crash and finish checks.

import { clamp } from './clamp.ts'
import { makeCourse, refAt, type Course } from './course.ts'
import { PLANT, inBand, initialPlant, stepPlant, type PlantState } from './plant.ts'
import {
  integrateEnergy,
  integrateError,
  ringResult,
  type PlaneResult,
  type ScoredRun,
} from './scoring.ts'
import { createTrace, type TraceBuffer } from './trace.ts'
import type {
  ControlContext,
  Controller,
  FlightMode,
  PlaneId,
  PlaneSnapshot,
  PlaneStatus,
  RingResult,
  Snapshot,
  Trace,
} from './types.ts'

/** Physics steps per control tick. */
const CONTROL_EVERY = Math.round(PLANT.Tc / PLANT.dt)

/** What a run needs from an algorithm; an algorithm module satisfies it. */
export interface RunAlgorithm {
  readonly id: string
  create(params: Readonly<Record<string, number>>): Controller
}

export interface RunPlayer {
  readonly algorithm: RunAlgorithm
  readonly params: Readonly<Record<string, number>>
}

export interface RunOptions {
  /** Course number. */
  readonly course: number
  readonly mode: FlightMode
  readonly player: RunPlayer
}

export interface Run extends ScoredRun {
  /** Advances the flight by `n` physics steps; planes that are not flying stay frozen. */
  step(n?: number): void
  snapshot(): Snapshot
  status(plane?: PlaneId): PlaneStatus | undefined
  /** True when no plane is flying. */
  readonly done: boolean
}

/** One plane: its plant, controller, estimator state, scoring and trace. */
interface Plane {
  readonly id: PlaneId
  readonly lesson: string
  readonly mode: FlightMode
  /** The params record this run owns and the controller reads. */
  readonly params: Record<string, number>
  readonly controller: Controller
  status: PlaneStatus
  plant: PlantState
  u: number
  hMeas: number
  hEst: number
  vEst: number
  /** Previous measurement, or null before the first tick. */
  yPrev: number | null
  ringIdx: number
  readonly results: RingResult[]
  points: number
  iae: number
  energy: number
  readonly trace: TraceBuffer
}

export function createRun(options: RunOptions): Run {
  const course: Course = makeCourse(options.course)
  const { speed, dt, Tc } = PLANT
  const rows = Math.ceil(course.endX / speed / Tc) + 2

  const params: Record<string, number> = { ...options.player.params }
  const player: Plane = {
    id: 'player',
    lesson: options.player.algorithm.id,
    mode: options.mode,
    params,
    controller: options.player.algorithm.create(params),
    status: 'flying',
    plant: initialPlant(),
    u: 0,
    hMeas: PLANT.hStart,
    hEst: PLANT.hStart,
    vEst: 0,
    yPrev: null,
    ringIdx: 0,
    results: [],
    points: 0,
    iae: 0,
    energy: 0,
    trace: createTrace(rows),
  }
  const planes: readonly Plane[] = [player]

  /** Physics steps taken so far; the clock is `k·dt`. */
  let k = 0

  function controlTick(p: Plane, t: number): void {
    const x = p.plant.x
    // No sensor noise yet: the measurement is the true altitude.
    const y = p.plant.h
    p.vEst = p.yPrev === null ? 0 : (y - p.yPrev) / Tc
    p.yPrev = y
    p.hMeas = y
    p.hEst = y
    const ref = refAt(course, x)
    const ctx: ControlContext = Object.freeze({
      t,
      T: Tc,
      ref,
      h: p.hEst,
      v: p.vEst,
      input: 0 as const,
      refAhead: (ahead: number) => refAt(course, x + speed * ahead),
    })
    const raw: unknown = p.controller.compute(ctx)
    p.u = typeof raw === 'number' && Number.isFinite(raw) ? clamp(raw, -1, 1) : 0

    const tr = p.trace
    if (tr.length < tr.t.length) {
      const i = tr.length
      tr.t[i] = t
      tr.ref[i] = ref
      tr.h[i] = p.plant.h
      tr.hMeas[i] = p.hMeas
      tr.hEst[i] = p.hEst
      tr.u[i] = p.u
      tr.length = i + 1
    }
  }

  function stepPlane(p: Plane, tick: boolean, t: number): void {
    if (p.status !== 'flying') return
    if (tick) controlTick(p, t)
    p.plant = stepPlant(p.plant, p.u, 0)
    const { h, x } = p.plant
    p.iae = integrateError(p.iae, refAt(course, x), h, dt)
    p.energy = integrateEnergy(p.energy, p.u, dt)

    const ring = course.rings[p.ringIdx]
    if (ring && x >= ring.x) {
      const result = ringResult(p.ringIdx, ring, h)
      p.results.push(result)
      p.points += result.points
      p.ringIdx++
    }

    if (!inBand(h)) {
      p.plant = { ...p.plant, h: clamp(h, PLANT.hFloor, PLANT.hCeil) }
      p.status = 'crashed'
    } else if (x >= course.endX) {
      p.status = 'finished'
    }
  }

  function isDone(): boolean {
    return planes.every((p) => p.status !== 'flying')
  }

  function physicsStep(): void {
    const tick = k % CONTROL_EVERY === 0
    const t = k * dt
    for (const p of planes) stepPlane(p, tick, t)
    k++
  }

  function find(plane: PlaneId): Plane | undefined {
    return planes.find((p) => p.id === plane)
  }

  function planeSnapshot(p: Plane): PlaneSnapshot {
    return {
      id: p.id,
      status: p.status,
      h: p.plant.h,
      v: p.plant.v,
      x: p.plant.x,
      u: p.u,
      hMeas: p.hMeas,
      hEst: p.hEst,
      ref: refAt(course, p.plant.x),
      points: p.points,
      results: p.results.slice(),
      retuned: false,
    }
  }

  // The columns are the run's own preallocated buffers, not copies; `Trace`
  // rejects index writes to them. Rows below `length` never change.
  function traceView(tr: TraceBuffer): Trace {
    return { ...tr }
  }

  return {
    step(n = 1) {
      const count = Number.isNaN(n) ? 0 : Math.max(0, Math.floor(n))
      for (let i = 0; i < count && !isDone(); i++) physicsStep()
    },
    snapshot() {
      return {
        t: k * dt,
        course: course.number,
        planes: planes.map(planeSnapshot),
        rings: course.rings,
        markers: [],
        trace: { player: traceView(player.trace) },
      }
    },
    status(plane: PlaneId = 'player') {
      return find(plane)?.status
    },
    get done() {
      return isDone()
    },
    result(plane: PlaneId): PlaneResult | undefined {
      const p = find(plane)
      if (!p) return undefined
      return {
        lesson: p.lesson,
        mode: p.mode,
        course: course.number,
        status: p.status,
        points: p.points,
        results: p.results.slice(),
        ringsTotal: course.rings.length,
        iae: p.iae,
        energy: p.energy,
      }
    },
  }
}
