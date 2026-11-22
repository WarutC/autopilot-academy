// A two-state Kalman filter for altitude and climb rate from a noisy altimeter.
// Model, discretized at the control period T: h' = v, v' = -a·v + b·u, so
// A = [[1, T], [0, 1 - a·T]], B = [0, b·T], with white-acceleration process
// noise q·[[T³/3, T²/2], [T²/2, T]] and a scalar altitude reading of variance r.
// Pure: the Run calls `stepKalman` once per control tick.

import { clamp } from './clamp.ts'
import { PLANT } from './plant.ts'

export interface KalmanState {
  /** Estimated altitude, m. */
  readonly h: number
  /** Estimated climb rate, m/s. */
  readonly v: number
  /** Covariance entries; the matrix is symmetric, so p10 = p01. */
  readonly p00: number
  readonly p01: number
  readonly p11: number
}

/** A filter started from the first altimeter reading; a non-finite reading starts at `PLANT.hStart`. */
export function createKalman(h0: number): KalmanState {
  return { h: Number.isFinite(h0) ? h0 : PLANT.hStart, v: 0, p00: 4, p01: 0, p11: 25 }
}

/**
 * Advances the filter one control tick with command `u` (clamped to [-1, 1], NaN is 0)
 * and altimeter reading `y`. A non-finite or negative `q` or `r`, a non-finite `y`, or an
 * innovation variance that is not positive and finite skips the step and returns `state`.
 */
export function stepKalman(state: KalmanState, y: number, u: number, q: number, r: number): KalmanState {
  if (!Number.isFinite(y) || !Number.isFinite(q) || !Number.isFinite(r) || q < 0 || r < 0) return state
  const { a, b, Tc: T } = PLANT
  const cmd = clamp(u, -1, 1)
  const c = 1 - a * T

  // Predict.
  const hp = state.h + T * state.v
  const vp = c * state.v + b * T * cmd
  const m00 = state.p00 + 2 * T * state.p01 + T * T * state.p11 + q * (T * T * T) / 3
  const m01 = c * (state.p01 + T * state.p11) + q * (T * T) / 2
  const m11 = c * c * state.p11 + q * T

  // Update.
  const s = m00 + r
  if (!Number.isFinite(s) || s <= 0) return state
  const k0 = m00 / s
  const k1 = m01 / s
  const innovation = y - hp
  return {
    h: hp + k0 * innovation,
    v: vp + k1 * innovation,
    p00: (1 - k0) * m00,
    p01: (1 - k0) * m01,
    p11: m11 - k1 * m01,
  }
}
