// Shared contract between the simulation core, the algorithms and the shell.
// Units are SI (meters, seconds); altitude `h` is up-positive, `x` is forward,
// and the elevator command `u` is normalized to [-1, 1].

export type PlaneId = 'player' | 'wingman'

export type PlaneStatus = 'flying' | 'finished' | 'crashed'

/** Manual stick: down, centered or up. */
export type StickInput = -1 | 0 | 1

/** A ring the plane should fly through at altitude `h` when it reaches `x`. */
export interface Ring {
  readonly x: number
  readonly h: number
}

/**
 * What a controller sees on each control tick. `h` and `v` are the noisy
 * measurement or the Kalman estimate, never the true plant state.
 */
export interface ControlContext {
  /** Time since the start of the run, in seconds. */
  readonly t: number
  /** Control period, in seconds. */
  readonly T: number
  /** Altitude setpoint, in meters. */
  readonly ref: number
  /** Measured or estimated altitude, in meters. */
  readonly h: number
  /** Measured or estimated climb rate, in m/s. */
  readonly v: number
  /** Manual stick, or 0 outside Manual mode. */
  readonly input: StickInput
  /** Course reference `dt` seconds ahead of the plane. */
  refAhead(dt: number): number
}

export interface Controller {
  /** Returns the elevator command in [-1, 1]; non-finite results count as 0. */
  compute(ctx: ControlContext): number
}

export interface RingResult {
  /** Index of the ring in the course. */
  readonly ring: number
  readonly pass: boolean
  /** Absolute altitude error at the ring, in meters. */
  readonly err: number
  readonly points: number
}

/**
 * One trace column as consumers see it. Index writes are type errors; methods
 * such as `fill`, `set` or `subarray` are not blocked, so never call them on a
 * snapshot's trace.
 */
export type TraceColumn = Readonly<Float64Array>

/**
 * Recorder history for one plane, one row per control tick. Columns are
 * preallocated; only the first `length` entries are valid. They are the run's
 * own buffers, not copies; consumers must not write to them.
 */
export interface Trace {
  readonly length: number
  readonly t: TraceColumn
  readonly ref: TraceColumn
  readonly h: TraceColumn
  readonly hMeas: TraceColumn
  readonly hEst: TraceColumn
  readonly u: TraceColumn
}

export interface PlaneSnapshot {
  readonly id: PlaneId
  readonly status: PlaneStatus
  /** True altitude, in meters. */
  readonly h: number
  /** True climb rate, in m/s. */
  readonly v: number
  /** Distance along the course, in meters. */
  readonly x: number
  /** Last elevator command, in [-1, 1]. */
  readonly u: number
  /** Last altitude measurement, in meters. */
  readonly hMeas: number
  /** Last altitude estimate, in meters. */
  readonly hEst: number
  /** Current setpoint, in meters. */
  readonly ref: number
  readonly points: number
  readonly results: readonly RingResult[]
  readonly retuned: boolean
}

/** A recorder marker for a parameter change, labeled `"<key> <old> → <new>"`. */
export interface Marker {
  readonly t: number
  readonly label: string
}

export interface Snapshot {
  readonly t: number
  readonly course: number
  readonly planes: readonly PlaneSnapshot[]
  readonly rings: readonly Ring[]
  readonly markers: readonly Marker[]
  readonly trace: Readonly<Partial<Record<PlaneId, Trace>>>
}
