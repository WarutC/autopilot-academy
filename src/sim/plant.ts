// The 1-D altitude plant: v' = -a·v + b·u + d, h' = v, flown at constant speed.

import { clamp } from './clamp.ts'

export const PLANT = {
  /** Climb-rate damping, 1/s. */
  a: 0.5,
  /** Elevator gain, m/s² per unit command. */
  b: 20,
  /** Forward speed, m/s. */
  speed: 20,
  /** Distance between rings, m. */
  ringGap: 160,
  /** Ring radius, m. */
  ringR: 7,
  nRings: 10,
  /** Lowest safe altitude, m. */
  hFloor: 6,
  /** Highest safe altitude, m. */
  hCeil: 110,
  /** Starting altitude, m. */
  hStart: 50,
  /** Physics step, s. */
  dt: 0.005,
  /** Control period, s. */
  Tc: 0.02,
} as const

/** The Semi-auto setpoint range: one ring radius inside the safe band, so overshoot has room before a crash. */
export const SETPOINT_MIN = PLANT.hFloor + PLANT.ringR
export const SETPOINT_MAX = PLANT.hCeil - PLANT.ringR

export interface PlantState {
  /** Altitude, m. */
  readonly h: number
  /** Climb rate, m/s. */
  readonly v: number
  /** Distance along the course, m. */
  readonly x: number
  /** Time, s. */
  readonly t: number
}

export function initialPlant(): PlantState {
  return { h: PLANT.hStart, v: 0, x: 0, t: 0 }
}

/**
 * Advances the plant by one physics step. `u` is clamped to [-1, 1] (NaN is 0);
 * a non-finite `disturbance` (m/s²) counts as 0.
 */
export function stepPlant(state: PlantState, u: number, disturbance: number): PlantState {
  const { a, b, speed, dt } = PLANT
  const cmd = clamp(u, -1, 1)
  const d = Number.isFinite(disturbance) ? disturbance : 0
  const v = state.v + (-a * state.v + b * cmd + d) * dt
  return { h: state.h + v * dt, v, x: state.x + speed * dt, t: state.t + dt }
}

/** True while the altitude is inside the safe band. */
export function inBand(h: number): boolean {
  return h >= PLANT.hFloor && h <= PLANT.hCeil
}
