// One flight: the player's plane, and optionally a wingman beside it, each a
// plant and its controller stepped on one fixed clock over the same course and
// conditions, with per-plane recorder traces, ring scoring and the crash and
// finish checks. Each plane reads its altitude through its own noisy altimeter
// and, when the Kalman filter is on, its controller sees the filter's estimate.

import { clamp } from './clamp.ts'
import { makeCourse, refAt, type Course } from './course.ts'
import { PLANT, SETPOINT_MAX, SETPOINT_MIN, inBand, initialPlant, stepPlant, type PlantState } from './plant.ts'
import {
  integrateEnergy,
  integrateError,
  ringResult,
  type PlaneResult,
  type ScoredRun,
} from './scoring.ts'
import { createKalman, stepKalman, type KalmanState } from './kalman.ts'
import { gauss, stream, type Rng } from './rng.ts'
import { createTrace, type TraceBuffer } from './trace.ts'
import type {
  Conditions,
  ControlContext,
  Controller,
  FlightMode,
  Marker,
  PlaneId,
  PlaneSnapshot,
  PlaneStatus,
  RingResult,
  Snapshot,
  StickInput,
  Trace,
} from './types.ts'

/** Physics steps per control tick. */
const CONTROL_EVERY = Math.round(PLANT.Tc / PLANT.dt)

/** Calm air and a perfect altimeter: the conditions a run flies when none are given. */
export const CALM: Readonly<Conditions> = Object.freeze({ down: 0, gusts: 0, noise: 0, kalman: 0, kq: 10, kr: 4 })

/** `base` with each finite value of a known key in `over` applied. */
function withConditions(base: Readonly<Conditions>, over: Partial<Record<string, unknown>> | undefined): Readonly<Conditions> {
  const next: Record<string, number> = { ...base }
  if (over) {
    for (const key of Object.keys(CALM)) {
      const value = over[key]
      if (typeof value === 'number' && Number.isFinite(value)) next[key] = value
    }
  }
  return Object.freeze(next as unknown as Conditions)
}

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
  /** Flight conditions; any key left out is calm. */
  readonly conditions?: Partial<Conditions>
  /**
   * A second plane flown beside the player on the same course, conditions,
   * gusts and clock. It always flies Autopilot against the course, whatever
   * `mode` says, on a copy of `params` made here; `setParam`, `setInput` and
   * `setSetpoint` never change it. Adding it never changes the player's flight.
   */
  readonly wingman?: RunPlayer
}

export interface Run extends ScoredRun {
  /**
   * Advances the flight by `n` physics steps, or fewer once no plane is flying;
   * a plane that is not flying stays frozen while the other flies on.
   */
  step(n?: number): void
  /** Planes are `[player]`, or `[player, wingman]`; `trace.wingman` exists only with a wingman. */
  snapshot(): Snapshot
  /** The plane's status (the player by default), or undefined for a plane the run does not have. */
  status(plane?: PlaneId): PlaneStatus | undefined
  /** True when no plane is flying: the player, and the wingman if there is one. */
  readonly done: boolean
  /**
   * Sets the player's parameter `key` to `value`; the controller reads it on
   * the next control tick and the plane counts as retuned. An unknown key, a
   * non-finite value, the value already set or another plane is ignored.
   */
  setParam(plane: PlaneId, key: string, value: number): void
  /** Drops a recorder marker labeled `label` at the current time; an empty label is ignored. */
  markChange(label: string): void
  /**
   * Sets the player's stick; the next control tick passes it as `ctx.input`
   * in Manual mode, and 0 in any other mode. It never counts as a retune and
   * drops no marker. A value other than -1, 0 or 1 is ignored.
   */
  setInput(stick: StickInput): void
  /**
   * Sets the player's altitude setpoint; in Semi-auto it replaces the course
   * reference from the next control tick (`ctx.ref`, `ctx.refAhead`, the
   * trace) and at once in the snapshot and the IAE. It is stored but unused in
   * other modes, never counts as a retune and drops no marker. A non-finite
   * value is ignored; others are clamped to [SETPOINT_MIN, SETPOINT_MAX].
   */
  setSetpoint(h: number): void
  /**
   * Sets the flight condition `key` (such as `gusts`) to `value`; the physics
   * uses it from the next physics step, the altimeter noise and the Kalman
   * filter from the next control tick, and the snapshot shows it at once. It
   * never counts as a retune and drops no marker. An unknown key or a
   * non-finite value is ignored.
   */
  setEnv(key: string, value: number): void
}

/** One plane: its plant, controller, estimator state, scoring and trace. */
interface Plane {
  readonly id: PlaneId
  readonly lesson: string
  readonly mode: FlightMode
  /** The params record this run owns and the controller reads. */
  readonly params: Record<string, number>
  readonly controller: Controller
  /** A parameter changed during the flight. */
  retuned: boolean
  /** The player's stick, read in Manual mode only. */
  stick: StickInput
  /** The player's target altitude, read in Semi-auto mode only. */
  setpoint: number
  status: PlaneStatus
  plant: PlantState
  u: number
  hMeas: number
  hEst: number
  vEst: number
  /** Previous measurement, or null before the first tick. */
  yPrev: number | null
  /** The plane's own altimeter noise stream, drawn once per physics step. */
  readonly sensorRng: Rng
  /** This physics step's unit-variance altimeter sample. */
  sensor: number
  /** The Kalman filter while it is on, else null. */
  kf: KalmanState | null
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

  /** A fresh plane at the start, flying `from`'s algorithm on the run's own copy of its params. */
  function makePlane(id: PlaneId, mode: FlightMode, from: RunPlayer): Plane {
    const params: Record<string, number> = { ...from.params }
    return {
      id,
      lesson: from.algorithm.id,
      mode,
      params,
      controller: from.algorithm.create(params),
      retuned: false,
      stick: 0,
      setpoint: PLANT.hStart,
      status: 'flying',
      plant: initialPlant(),
      u: 0,
      hMeas: PLANT.hStart,
      hEst: PLANT.hStart,
      vEst: 0,
      yPrev: null,
      sensorRng: stream(course.number, `sensor:${id}`),
      sensor: 0,
      kf: null,
      ringIdx: 0,
      results: [],
      points: 0,
      iae: 0,
      energy: 0,
      trace: createTrace(rows),
    }
  }

  // The player is made first, so its controller never depends on the wingman's.
  const player = makePlane('player', options.mode, options.player)
  // The wingman always flies Autopilot: its reference is the course.
  const wingman = options.wingman ? makePlane('wingman', 'autopilot', options.wingman) : undefined
  const planes: readonly Plane[] = wingman ? [player, wingman] : [player]
  const markers: Marker[] = []
  /** Replaced, never mutated, on each change, so a snapshot's record stays as it was. */
  let conditions: Readonly<Conditions> = withConditions(CALM, options.conditions)
  // One gust process per run, advanced once per physics step whatever the
  // conditions say, so its sequence depends only on the course.
  const gustRng = stream(course.number, 'gusts')
  /** The unit-variance gust state. */
  let gust = 0

  /** Physics steps taken so far; the clock is `k·dt`. */
  let k = 0

  /** The plane's reference at `x`: its setpoint in Semi-auto, else the course. */
  function refOf(p: Plane, x: number): number {
    return p.mode === 'semi-auto' ? p.setpoint : refAt(course, x)
  }

  function controlTick(p: Plane, t: number): void {
    const x = p.plant.x
    // The altimeter reading: the true altitude plus this step's noise sample.
    const y = p.plant.h + conditions.noise * p.sensor
    if (conditions.kalman) {
      // Started from the current reading, then stepped with the previous command.
      p.kf = stepKalman(p.kf ?? createKalman(y), y, p.u, conditions.kq, conditions.kr)
      p.hEst = p.kf.h
      p.vEst = p.kf.v
    } else {
      p.kf = null
      p.hEst = y
      p.vEst = p.yPrev === null ? 0 : (y - p.yPrev) / Tc
    }
    p.yPrev = y
    p.hMeas = y
    const ref = refOf(p, x)
    const ctx: ControlContext = Object.freeze({
      t,
      T: Tc,
      ref,
      h: p.hEst,
      v: p.vEst,
      input: p.mode === 'manual' ? p.stick : 0,
      refAhead: (ahead: number) => refOf(p, x + speed * ahead),
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
      tr.noise[i] = conditions.noise
      tr.kalman[i] = p.kf ? 1 : 0
      tr.length = i + 1
    }
  }

  function stepPlane(p: Plane, tick: boolean, t: number, disturbance: number): void {
    if (p.status !== 'flying') return
    if (tick) controlTick(p, t)
    p.plant = stepPlant(p.plant, p.u, disturbance)
    const { h, x } = p.plant
    p.iae = integrateError(p.iae, refOf(p, x), h, dt)
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
    gust += -gust * dt + Math.sqrt(2 * dt) * gauss(gustRng)
    // Drawn once per step, before any plane steps: every plane flies the same air.
    const disturbance = -conditions.down + conditions.gusts * gust
    // One altimeter sample per plane per step, whatever the noise and whether the
    // plane still flies, so each plane's sequence depends only on the course.
    for (const p of planes) p.sensor = gauss(p.sensorRng)
    for (const p of planes) stepPlane(p, tick, t, disturbance)
    k++
  }

  function find(plane: PlaneId): Plane | undefined {
    return planes.find((p) => p.id === plane)
  }

  function planeSnapshot(p: Plane): PlaneSnapshot {
    return {
      id: p.id,
      mode: p.mode,
      status: p.status,
      h: p.plant.h,
      v: p.plant.v,
      x: p.plant.x,
      u: p.u,
      hMeas: p.hMeas,
      hEst: p.hEst,
      ref: refOf(p, p.plant.x),
      points: p.points,
      results: p.results.slice(),
      retuned: p.retuned,
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
        markers: markers.slice(),
        trace: wingman
          ? { player: traceView(player.trace), wingman: traceView(wingman.trace) }
          : { player: traceView(player.trace) },
        conditions,
      }
    },
    status(plane: PlaneId = 'player') {
      return find(plane)?.status
    },
    get done() {
      return isDone()
    },
    setParam(plane, key, value) {
      const p = find(plane)
      if (plane !== 'player' || !p || !Object.hasOwn(p.params, key)) return
      if (!Number.isFinite(value) || p.params[key] === value) return
      p.params[key] = value
      p.retuned = true
    },
    markChange(label) {
      if (typeof label !== 'string' || label === '') return
      markers.push({ t: k * dt, label })
    },
    setInput(stick) {
      if (stick !== -1 && stick !== 0 && stick !== 1) return
      player.stick = stick === 0 ? 0 : stick // never -0
    },
    setSetpoint(h) {
      if (typeof h !== 'number' || !Number.isFinite(h)) return
      player.setpoint = clamp(h, SETPOINT_MIN, SETPOINT_MAX)
    },
    setEnv(key, value) {
      if (typeof key !== 'string' || !Object.hasOwn(CALM, key)) return
      if (typeof value !== 'number' || !Number.isFinite(value)) return
      conditions = withConditions(conditions, { [key]: value })
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
        retuned: p.retuned,
      }
    },
  }
}
