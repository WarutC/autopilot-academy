import { describe, expect, it } from 'vitest'
import { createKalman, stepKalman, type KalmanState } from './kalman.ts'
import { PLANT, initialPlant, stepPlant, type PlantState } from './plant.ts'
import { gauss, mulberry32 } from './rng.ts'

// The prototype's makeKF, inlined as the reference: full 2x2 matrices, mutable state.
function makeKF(h0: number, Q: number, R: number) {
  const T = 0.02, a = 0.5, b = 20
  let x = [h0, 0]
  let P = [[4, 0], [0, 25]]
  const A = [[1, T], [0, 1 - a * T]]
  const Qm = [[Q * T ** 3 / 3, Q * T ** 2 / 2], [Q * T ** 2 / 2, Q * T]]
  return {
    get x() { return x },
    step(y: number, u: number) {
      const xp = [x[0] + T * x[1], (1 - a * T) * x[1] + b * T * u]
      const AP = [
        [A[0][0] * P[0][0] + A[0][1] * P[1][0], A[0][0] * P[0][1] + A[0][1] * P[1][1]],
        [A[1][0] * P[0][0] + A[1][1] * P[1][0], A[1][0] * P[0][1] + A[1][1] * P[1][1]],
      ]
      const Pp = [
        [AP[0][0] * A[0][0] + AP[0][1] * A[0][1] + Qm[0][0], AP[0][0] * A[1][0] + AP[0][1] * A[1][1] + Qm[0][1]],
        [AP[1][0] * A[0][0] + AP[1][1] * A[0][1] + Qm[1][0], AP[1][0] * A[1][0] + AP[1][1] * A[1][1] + Qm[1][1]],
      ]
      const S = Pp[0][0] + R
      const K = [Pp[0][0] / S, Pp[1][0] / S]
      const innov = y - xp[0]
      x = [xp[0] + K[0] * innov, xp[1] + K[1] * innov]
      P = [
        [(1 - K[0]) * Pp[0][0], (1 - K[0]) * Pp[0][1]],
        [Pp[1][0] - K[1] * Pp[0][0], Pp[1][1] - K[1] * Pp[0][1]],
      ]
    },
  }
}

/** A command profile: climb, hold, descend, hold, with some wiggle. */
function command(i: number): number {
  if (i < 150) return 0.4
  if (i < 300) return 0.025 + 0.1 * Math.sin(i / 10)
  if (i < 450) return -0.3
  return 0.05 * Math.sin(i / 25)
}

/** The true plant flown for one control tick (4 physics steps) with the command held. */
function tick(state: PlantState, u: number, d = 0): PlantState {
  let s = state
  for (let k = 0; k < PLANT.Tc / PLANT.dt; k++) s = stepPlant(s, u, d)
  return s
}

interface Sample { h: number; v: number; y: number; est: KalmanState }

/** Flies the true plant under `cmd` and disturbance `d`, reading y = h + sigma·gauss, filtering with Q and R. */
function fly(n: number, cmd: (i: number) => number, sigma: number, q: number, r: number, seed = 7, d = 0): Sample[] {
  const rng = mulberry32(seed)
  let truth = initialPlant()
  let est = createKalman(truth.h + sigma * gauss(rng))
  const out: Sample[] = []
  for (let i = 0; i < n; i++) {
    const u = cmd(i)
    truth = tick(truth, u, d)
    const y = truth.h + sigma * gauss(rng)
    est = stepKalman(est, y, u, q, r)
    out.push({ h: truth.h, v: truth.v, y, est })
  }
  return out
}

const rms = (xs: number[]) => Math.sqrt(xs.reduce((s, x) => s + x * x, 0) / xs.length)

describe('createKalman', () => {
  it('starts at the reading, level, with P0 = diag(4, 25)', () => {
    expect(createKalman(42)).toEqual({ h: 42, v: 0, p00: 4, p01: 0, p11: 25 })
  })

  for (const bad of [NaN, Infinity, -Infinity]) {
    it(`falls back to hStart for a first reading of ${bad}`, () => {
      expect(createKalman(bad)).toEqual({ h: PLANT.hStart, v: 0, p00: 4, p01: 0, p11: 25 })
    })
  }
})

describe('stepKalman', () => {
  for (const [q, r] of [[10, 4], [1, 0.4], [50, 40]]) {
    it(`matches the prototype's makeKF to 1e-9 (Q = ${q}, R = ${r})`, () => {
      const rng = mulberry32(11)
      let truth = initialPlant()
      const y0 = truth.h + 2 * gauss(rng)
      let est = createKalman(y0)
      const ref = makeKF(y0, q, r)
      for (let i = 0; i < 400; i++) {
        const u = command(i)
        truth = tick(truth, u)
        const y = truth.h + 2 * gauss(rng)
        est = stepKalman(est, y, u, q, r)
        ref.step(y, u)
        expect(Math.abs(est.h - ref.x[0])).toBeLessThanOrEqual(1e-9)
        expect(Math.abs(est.v - ref.x[1])).toBeLessThanOrEqual(1e-9)
      }
    })
  }

  it('is deterministic: two identical runs give identical estimates', () => {
    expect(fly(500, command, 2, 10, 4)).toEqual(fly(500, command, 2, 10, 4))
  })

  it('does not mutate its input state', () => {
    const state = Object.freeze(createKalman(50))
    const copy = { ...state }
    const next = stepKalman(state, 53, 0.5, 10, 4)
    expect(state).toEqual(copy)
    expect(next).not.toBe(state)
  })

  it('beats the raw reading and the finite difference on a noisy climb (sigma = 2, Q = 10, R = 4)', () => {
    const sigma = 2
    const run = fly(600, command, sigma, 10, sigma * sigma).slice(50)
    const estH = rms(run.map((s) => s.est.h - s.h))
    const rawH = rms(run.map((s) => s.y - s.h))
    const estV = rms(run.map((s) => s.est.v - s.v))
    const fdV = rms(run.slice(1).map((s, i) => (s.y - run[i].y) / PLANT.Tc - s.v))
    expect(estH).toBeLessThanOrEqual(0.6 * rawH)
    expect(estV).toBeLessThanOrEqual(0.2 * fdV)
  })

  it('trades jitter for lag as R grows (R = 0.4 vs R = 40)', () => {
    // A steady climb under an unmodelled -3 m/s² disturbance, so the estimate has something to lag behind.
    const climb = () => 0.3
    const jitter = (run: Sample[]) => rms(run.slice(1).map((s, i) => (s.est.h - run[i].est.h) - (s.h - run[i].h)))
    const lag = (run: Sample[]) => Math.abs(run.reduce((sum, s) => sum + (s.h - s.est.h), 0) / run.length)
    const low = fly(500, climb, 2, 10, 0.4, 7, -3).slice(100)
    const high = fly(500, climb, 2, 10, 40, 7, -3).slice(100)
    expect(jitter(high)).toBeLessThan(jitter(low))
    expect(lag(high)).toBeGreaterThan(2 * lag(low))
  })

  it('converges to the true h and v without noise (Q = 10, R = 0.1)', () => {
    const run = fly(500, command, 0, 10, 0.1)
    for (const s of run.slice(100)) {
      expect(Math.abs(s.est.h - s.h)).toBeLessThan(0.05)
      expect(Math.abs(s.est.v - s.v)).toBeLessThan(0.5)
    }
  })

  const bad: [string, number, number, number][] = [
    ['y = NaN', NaN, 10, 4], ['y = Infinity', Infinity, 10, 4], ['y = -Infinity', -Infinity, 10, 4],
    ['Q = NaN', 51, NaN, 4], ['Q = Infinity', 51, Infinity, 4], ['Q = -Infinity', 51, -Infinity, 4], ['Q < 0', 51, -1, 4],
    ['R = NaN', 51, 10, NaN], ['R = Infinity', 51, 10, Infinity], ['R = -Infinity', 51, 10, -Infinity], ['R < 0', 51, 10, -1],
  ]
  for (const [name, y, q, r] of bad) {
    it(`skips the step for ${name}`, () => {
      const state = stepKalman(createKalman(50), 50.5, 0.2, 10, 4)
      const next = stepKalman(state, y, 0.2, q, r)
      expect(next).toBe(state)
      expect(Number.isFinite(next.h) && Number.isFinite(next.v)).toBe(true)
    })
  }

  it('skips the step when the innovation variance is not positive', () => {
    const state: KalmanState = { h: 50, v: 0, p00: 0, p01: 0, p11: 0 }
    expect(stepKalman(state, 51, 0, 0, 0)).toBe(state)
  })

  it('accepts R = 0 with a positive prior variance (perfect sensor)', () => {
    const next = stepKalman(createKalman(50), 51, 0, 10, 0)
    expect(next.h).toBeCloseTo(51, 12)
    expect(next.p00).toBeCloseTo(0, 12)
  })

  for (const [u, as] of [[NaN, 0], [Infinity, 1], [-Infinity, -1]]) {
    it(`treats a command of ${u} as ${as}`, () => {
      const state = createKalman(50)
      const next = stepKalman(state, 50.3, u, 10, 4)
      expect(next).toEqual(stepKalman(state, 50.3, as, 10, 4))
      expect(Number.isFinite(next.h) && Number.isFinite(next.v)).toBe(true)
    })
  }
})
