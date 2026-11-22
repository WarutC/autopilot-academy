// Model predictive control: on every re-plan, the controller predicts the
// altitude over the next N model steps with a discretised model of the plant,
// v' = -a·v + b·u, h' = v, and picks the elevator sequence that minimises
// q·Σ(h − r)² + r_w·Σu² subject to |u| ≤ 1. Only the first command is flown;
// it is held until the next re-plan, one model step later.
//
// The problem is a condensed, box-constrained QP over the elevator sequence:
// predicted altitudes are h = Φ·x0 + G·U, so the cost is ½·UᵀHU + fᵀU with
// H = q·GᵀG + r_w·I and f = q·Gᵀ(Φ·x0 − r) (the constant factor 2 is dropped).
// It is solved with a Cholesky solve of the unconstrained optimum; if that
// leaves the box, a few active-set refinements on the free variables, then a
// few projected coordinate sweeps (Gauss-Seidel style) as a polish.

import { clamp } from '../sim/clamp.ts'
import { PLANT } from '../sim/plant.ts'
import type { ControlContext } from '../sim/types.ts'
import type { AlgorithmModule, Params } from './index.ts'

/** Model step and re-plan period, in seconds. */
export const MODEL_STEP = 0.1

/** Longest horizon the controller builds, in model steps. */
const MAX_HORIZON = 40
/** Model steps per second, as an integer so look-ahead times come out exact. */
const STEPS_PER_SECOND = Math.round(1 / MODEL_STEP)
/** Active-set refinements tried when the unconstrained optimum leaves the box. */
const ACTIVE_SET_ITERATIONS = 25
/** Projected coordinate sweeps after the active-set refinements. */
const POLISH_ITERATIONS = 20
/** A command this close to a bound counts as on it. */
const BOUND_TOL = 1e-9
/** The active-set loop stops once no free command moves more than this. */
const CHANGE_TOL = 1e-7

/**
 * The prediction model and QP matrices for one horizon and weight pair, plus
 * working buffers every solve overwrites; the plan a solve returns is a new
 * array each time. Matrices are flat, row-major `N×N`.
 */
export interface MpcModel {
  /** Horizon, in model steps. */
  readonly N: number
  /** Altitude error weight. */
  readonly q: number
  /** Elevator effort weight. */
  readonly r: number
  /** Effect of the elevator sequence on the predicted altitudes: `G[k·N + j]`. */
  readonly G: Float64Array
  /** Effect of the initial altitude on predicted altitude k. */
  readonly phiH: Float64Array
  /** Effect of the initial climb rate on predicted altitude k. */
  readonly phiV: Float64Array
  /** QP Hessian `q·GᵀG + r·I`. */
  readonly H: Float64Array
  /** Lower Cholesky factor of `H`. */
  readonly L: Float64Array
  /** Largest absolute row sum of `H`, a bound on its largest eigenvalue. */
  readonly lip: number
  // Working buffers, overwritten by every solve.
  readonly f: Float64Array
  readonly work: Float64Array
  readonly grad: Float64Array
  readonly free: Uint8Array
  readonly freeIdx: Int32Array
  readonly Hf: Float64Array
  readonly rhs: Float64Array
  readonly sol: Float64Array
}

/** In-place Cholesky of the leading `n×n` block of `A` (row stride `stride`) into `L`. */
function cholesky(A: Float64Array, L: Float64Array, n: number, stride: number): void {
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let s = A[i * stride + j]!
      for (let k = 0; k < j; k++) s -= L[i * stride + k]! * L[j * stride + k]!
      if (i === j) L[i * stride + i] = Math.sqrt(Math.max(s, 1e-12))
      else L[i * stride + j] = s / L[j * stride + j]!
    }
  }
}

/** Solves `L·Lᵀ·x = b` for the leading `n` entries, using `y` as scratch; writes `x`. */
function choleskySolve(
  L: Float64Array,
  n: number,
  stride: number,
  b: Float64Array,
  y: Float64Array,
  x: Float64Array,
): void {
  for (let i = 0; i < n; i++) {
    let s = b[i]!
    for (let k = 0; k < i; k++) s -= L[i * stride + k]! * y[k]!
    y[i] = s / L[i * stride + i]!
  }
  for (let i = n - 1; i >= 0; i--) {
    let s = y[i]!
    for (let k = i + 1; k < n; k++) s -= L[k * stride + i]! * x[k]!
    x[i] = s / L[i * stride + i]!
  }
}

/**
 * Builds the prediction model for a horizon of `N` model steps, altitude error
 * weight `q` and elevator effort weight `r`. The plant is discretised exactly
 * with a zero-order hold at `MODEL_STEP`. Call it only when N, q or r change.
 */
export function buildModel(N: number, q: number, r: number): MpcModel {
  const { a, b } = PLANT
  const T = MODEL_STEP
  const e = Math.exp(-a * T)
  // x[k+1] = A·x[k] + B·u[k], x = (h, v).
  const A00 = 1
  const A01 = (1 - e) / a
  const A10 = 0
  const A11 = e
  const B0 = (b / a) * (T - (1 - e) / a)
  const B1 = (b / a) * (1 - e)

  // Walk the powers of A: hB[m] is the altitude row of A^m·B, phi is the altitude row of A^(k+1).
  const hB = new Float64Array(N)
  const phiH = new Float64Array(N)
  const phiV = new Float64Array(N)
  let p00 = 1
  let p01 = 0
  let p10 = 0
  let p11 = 1
  for (let m = 0; m < N; m++) {
    hB[m] = p00 * B0 + p01 * B1
    const n00 = p00 * A00 + p01 * A10
    const n01 = p00 * A01 + p01 * A11
    const n10 = p10 * A00 + p11 * A10
    const n11 = p10 * A01 + p11 * A11
    p00 = n00
    p01 = n01
    p10 = n10
    p11 = n11
    phiH[m] = p00
    phiV[m] = p01
  }

  const G = new Float64Array(N * N)
  for (let k = 0; k < N; k++) for (let j = 0; j <= k; j++) G[k * N + j] = hB[k - j]!

  const H = new Float64Array(N * N)
  for (let i = 0; i < N; i++) {
    for (let j = i; j < N; j++) {
      let s = 0
      // G is lower triangular: only rows k ≥ max(i, j) contribute.
      for (let k = j; k < N; k++) s += G[k * N + i]! * G[k * N + j]!
      const v = q * s + (i === j ? r : 0)
      H[i * N + j] = v
      H[j * N + i] = v
    }
  }
  const L = new Float64Array(N * N)
  cholesky(H, L, N, N)

  let lip = 0
  for (let i = 0; i < N; i++) {
    let s = 0
    for (let j = 0; j < N; j++) s += Math.abs(H[i * N + j]!)
    lip = Math.max(lip, s)
  }

  return {
    N,
    q,
    r,
    G,
    phiH,
    phiV,
    H,
    L,
    lip,
    f: new Float64Array(N),
    work: new Float64Array(N),
    grad: new Float64Array(N),
    free: new Uint8Array(N),
    freeIdx: new Int32Array(N),
    Hf: new Float64Array(N * N),
    rhs: new Float64Array(N),
    sol: new Float64Array(N),
  }
}

/**
 * Plans the elevator sequence from altitude `h` and climb rate `v` toward the
 * reference altitudes `refs` (entry k is the target one model step later than
 * entry k − 1, the first one model step ahead; at least `model.N` entries).
 * Returns a new array of `model.N` commands, every one clamped to [-1, 1].
 * Inputs must be finite; the controller checks them before calling.
 */
export function solve(model: MpcModel, h: number, v: number, refs: ArrayLike<number>): Float64Array {
  const { N, q, G, phiH, phiV, H, L, f, work, grad, free, freeIdx, Hf, rhs, sol } = model

  // f = q·Gᵀ·(Φ·x0 − r); `work` holds the free-response error first.
  for (let k = 0; k < N; k++) work[k] = phiH[k]! * h + phiV[k]! * v - refs[k]!
  for (let j = 0; j < N; j++) {
    let s = 0
    for (let k = j; k < N; k++) s += G[k * N + j]! * work[k]!
    f[j] = q * s
  }

  // Unconstrained optimum: H·U = −f.
  const U = new Float64Array(N)
  for (let i = 0; i < N; i++) rhs[i] = -f[i]!
  choleskySolve(L, N, N, rhs, work, U)
  let inside = true
  for (let i = 0; i < N; i++) {
    if (!(Math.abs(U[i]!) <= 1)) {
      inside = false
      break
    }
  }
  if (inside) return U

  for (let i = 0; i < N; i++) U[i] = clamp(U[i]!, -1, 1)

  // Active-set refinement: free every command not held at a bound by its
  // gradient, solve for the free ones with the rest fixed, clamp, repeat.
  for (let it = 0; it < ACTIVE_SET_ITERATIONS; it++) {
    for (let i = 0; i < N; i++) {
      let s = f[i]!
      for (let j = 0; j < N; j++) s += H[i * N + j]! * U[j]!
      grad[i] = s
    }
    let n = 0
    for (let i = 0; i < N; i++) {
      const atLow = U[i]! <= -1 + BOUND_TOL && grad[i]! > 0
      const atHigh = U[i]! >= 1 - BOUND_TOL && grad[i]! < 0
      const isFree = !atLow && !atHigh
      free[i] = isFree ? 1 : 0
      if (isFree) freeIdx[n++] = i
    }
    if (n === 0) break

    for (let p = 0; p < n; p++) {
      const i = freeIdx[p]!
      for (let c = 0; c < n; c++) Hf[p * n + c] = H[i * N + freeIdx[c]!]!
      let s = -f[i]!
      for (let j = 0; j < N; j++) if (free[j] === 0) s -= H[i * N + j]! * U[j]!
      rhs[p] = s
    }
    // Factor in place: each entry is read before it is overwritten.
    cholesky(Hf, Hf, n, n)
    choleskySolve(Hf, n, n, rhs, work, sol)

    let change = 0
    for (let p = 0; p < n; p++) {
      const i = freeIdx[p]!
      const next = clamp(sol[p]!, -1, 1)
      change = Math.max(change, Math.abs(next - U[i]!))
      U[i] = next
    }
    if (!(change >= CHANGE_TOL)) break
  }

  // Projected coordinate sweeps with step 1/lip: each command moves against its
  // gradient from the latest values of the others, then is clamped.
  const step = 1 / model.lip
  for (let it = 0; it < POLISH_ITERATIONS; it++) {
    for (let i = 0; i < N; i++) {
      let s = f[i]!
      for (let j = 0; j < N; j++) s += H[i * N + j]! * U[j]!
      U[i] = clamp(U[i]! - step * s, -1, 1)
    }
  }
  return U
}

/** The horizon in model steps for an `N` parameter, or 0 when it is not usable. */
function horizonSteps(N: number): number {
  if (!Number.isFinite(N)) return 0
  return clamp(Math.round(N), 1, MAX_HORIZON)
}

/** Control ticks the planned command is held for at control period `T`. */
function holdTicks(T: number): number {
  return Number.isFinite(T) && T > 0 ? Math.max(1, Math.round(MODEL_STEP / T)) : 1
}

/** Model predictive control: plans the elevator over a horizon of 0.1 s steps and re-plans every 0.1 s. */
const mpc: AlgorithmModule = {
  id: 'mpc',
  name: 'MPC',
  tag: 'Look-ahead',
  lesson:
    'Plans the next N steps of 0.1 s with a model of the aircraft and the rings it can see ahead, ' +
    'picks the elevator moves that keep it closest to the target without pushing past the elevator limit, ' +
    'flies only the first move, then re-plans every 0.1 s. ' +
    'Q weighs altitude error and R weighs elevator effort. ' +
    'Try: switch Preview off to see what look-ahead is worth, or with Preview on, shrink the horizon and watch the look-ahead in the Pole readout.',
  modes: ['semi-auto', 'autopilot'],
  params: [
    {
      key: 'N',
      label: 'Horizon N (steps of 0.1 s)',
      accessibleName: 'N, prediction horizon in steps of 0.1 seconds',
      min: 5,
      max: MAX_HORIZON,
      step: 1,
      default: 20,
    },
    { key: 'Q', label: 'Q, altitude error weight', accessibleName: 'Q, altitude error weight', min: 0.01, max: 100, step: 0.01, default: 1, log: true },
    { key: 'R', label: 'R, elevator effort weight', accessibleName: 'R, elevator effort weight', min: 0.1, max: 1000, step: 0.1, default: 10, log: true },
    { key: 'preview', label: 'Preview upcoming rings', accessibleName: 'Preview upcoming rings', min: 0, max: 1, step: 1, default: 1, toggle: true },
  ],
  create(params: Params) {
    // The model is rebuilt only when N, Q or R change; the planned command is
    // held between re-plans. Params are read from the record on every call.
    let model: MpcModel | null = null
    let refs = new Float64Array(0)
    let u = 0
    let ticksLeft = 0
    return {
      compute(ctx: ControlContext): number {
        if (!Number.isFinite(ctx.h) || !Number.isFinite(ctx.v) || !Number.isFinite(ctx.ref)) {
          ticksLeft = 0
          return 0
        }
        const n = horizonSteps(params.N)
        const q = params.Q
        const r = params.R
        if (n === 0 || !Number.isFinite(q) || !Number.isFinite(r) || q < 0 || r <= 0) {
          ticksLeft = 0
          return 0
        }
        if (model === null || model.N !== n || model.q !== q || model.r !== r) {
          model = buildModel(n, q, r)
          refs = new Float64Array(n)
          ticksLeft = 0
        }
        if (ticksLeft <= 0) {
          try {
            if (params.preview) {
              for (let i = 0; i < n; i++) {
                const ref = ctx.refAhead((i + 1) * MODEL_STEP)
                if (!Number.isFinite(ref)) return 0
                refs[i] = ref
              }
            } else {
              refs.fill(ctx.ref)
            }
            const first = solve(model, ctx.h, ctx.v, refs)[0]!
            if (!Number.isFinite(first)) return 0 // defensive: `solve` always clamps
            // `|| 0` turns −0 into 0.
            u = clamp(first, -1, 1) || 0
          } catch {
            return 0
          }
          ticksLeft = holdTicks(ctx.T)
        }
        ticksLeft--
        return u
      },
    }
  },
  analysis(params: Params) {
    // Each model step is 0.1 s, so the plan reaches N·0.1 s ahead; with preview
    // off it assumes the target stays where it is now.
    return { lookahead: params.preview ? horizonSteps(params.N) / STEPS_PER_SECOND : 0 }
  },
}

export default mpc
