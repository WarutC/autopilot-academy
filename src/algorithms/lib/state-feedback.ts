// Design math for full state feedback on the altitude plant, shared by the
// Pole Placement and LQR lessons. Both fly u = k1·(ref − h) − k2·v on the
// continuous, unsaturated model h' = v, v' = −a·v + b·u, so the closed loop is
// s² + (a + b·k2)·s + b·k1.
//
// This folder is not scanned by the algorithm registry, so helpers here are
// never mistaken for algorithm modules.

import { PLANT } from '../../sim/plant.ts'
import type { Complex } from '../index.ts'
import { polyRoots } from './poly.ts'

/** State-feedback gains: k1 on altitude error, k2 on climb rate. */
export interface StateFeedbackGains {
  readonly k1: number
  readonly k2: number
}

/** A Riccati solution: the symmetric matrix P as [p11, p12, p22] and its gains. */
export interface RiccatiSolution extends StateFeedbackGains {
  readonly P: readonly [number, number, number]
}

const finite = (...xs: number[]) => xs.every(Number.isFinite)

/**
 * Gains that put the closed-loop poles at the roots of s² + 2ζωn·s + ωn²:
 * k1 = ωn²/b and k2 = (2ζωn − a)/b. Undefined for a non-finite input.
 *
 * @example placementGains(2, 0.8) // poles −1.6 ± 1.2j
 */
export function placementGains(wn: number, zeta: number): StateFeedbackGains | undefined {
  if (!finite(wn, zeta)) return undefined
  const k1 = (wn * wn) / PLANT.b
  const k2 = (2 * zeta * wn - PLANT.a) / PLANT.b
  return finite(k1, k2) ? { k1, k2 } : undefined
}

/**
 * The stabilizing solution of the continuous algebraic Riccati equation
 * AᵀP + PA − PBR⁻¹BᵀP + Q = 0 for A = [[0, 1], [0, −a]], B = [0, b]ᵀ,
 * Q = diag(qh, qv) and R = r, in closed form, with K = R⁻¹BᵀP = [k1, k2].
 * Undefined for a non-finite weight, qh ≤ 0, qv < 0 or r ≤ 0.
 */
export function lqrRiccati(qh: number, qv: number, r: number): RiccatiSolution | undefined {
  if (!finite(qh, qv, r) || qh <= 0 || qv < 0 || r <= 0) return undefined
  const { a, b } = PLANT
  // Entry (1,1) fixes k1, entry (2,2) then gives k2, entry (1,2) gives p11.
  const k1 = Math.sqrt(qh / r)
  const k2 = (Math.sqrt(a * a + (b * b * qv) / r + 2 * b * k1) - a) / b
  const p12 = (r * k1) / b
  const p22 = (r * k2) / b
  const p11 = p12 * (a + b * k2)
  return finite(k1, k2, p11, p12, p22) ? { P: [p11, p12, p22], k1, k2 } : undefined
}

/**
 * The largest absolute entry of AᵀP + PA − PBR⁻¹BᵀP + Q for the symmetric
 * P = [p11, p12, p22]; 0 means P solves the Riccati equation. NaN for bad input.
 */
export function riccatiResidual(P: readonly [number, number, number], qh: number, qv: number, r: number): number {
  const [p11, p12, p22] = P
  const { a, b } = PLANT
  const g = (b * b) / r
  const e11 = qh - g * p12 * p12
  const e12 = p11 - a * p12 - g * p12 * p22
  const e22 = 2 * (p12 - a * p22) - g * p22 * p22 + qv
  const out = Math.max(Math.abs(e11), Math.abs(e12), Math.abs(e22))
  return Number.isFinite(out) ? out : Number.NaN
}

/** Closed-loop poles for gains k1, k2: the roots of s² + (a + b·k2)·s + b·k1; `[]` if non-finite. */
export function stateFeedbackPoles(k1: number, k2: number): Complex[] {
  if (!finite(k1, k2)) return []
  return polyRoots([1, PLANT.a + PLANT.b * k2, PLANT.b * k1])
}

/** The state-feedback command k1·(ref − h) − k2·v, or 0 when anything is non-finite. */
export function stateFeedbackCommand(gains: StateFeedbackGains | undefined, ref: number, h: number, v: number): number {
  if (!gains) return 0
  const u = gains.k1 * (ref - h) - gains.k2 * v
  return Number.isFinite(u) ? u : 0
}
