import { describe, expect, it } from 'vitest'
import { defaultParams } from './index.ts'
import mpc, { buildModel, MODEL_STEP, solve } from './mpc.ts'
import { controlContext as ctx, fliesCourse101 } from './lib/testing.ts'

/** Dense Gaussian elimination with partial pivoting, the reference for H·U = −f. */
function denseSolve(A: number[][], b: number[]): number[] {
  const n = b.length
  const M = A.map((row, i) => [...row, b[i]!])
  for (let c = 0; c < n; c++) {
    let p = c
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r]![c]!) > Math.abs(M[p]![c]!)) p = r
    ;[M[c], M[p]] = [M[p]!, M[c]!]
    for (let r = c + 1; r < n; r++) {
      const k = M[r]![c]! / M[c]![c]!
      for (let j = c; j <= n; j++) M[r]![j]! -= k * M[c]![j]!
    }
  }
  const x = new Array<number>(n).fill(0)
  for (let i = n - 1; i >= 0; i--) {
    let s = M[i]![n]!
    for (let j = i + 1; j < n; j++) s -= M[i]![j]! * x[j]!
    x[i] = s / M[i]![i]!
  }
  return x
}

/** H and f of the QP, rebuilt from G and Φ for checking. */
function qp(model: ReturnType<typeof buildModel>, h: number, v: number, refs: number[]) {
  const { N, q, r, G, phiH, phiV } = model
  const H: number[][] = []
  for (let i = 0; i < N; i++) {
    const row: number[] = []
    for (let j = 0; j < N; j++) {
      let s = 0
      for (let k = 0; k < N; k++) s += G[k * N + i]! * G[k * N + j]!
      row.push(q * s + (i === j ? r : 0))
    }
    H.push(row)
  }
  const f: number[] = []
  for (let j = 0; j < N; j++) {
    let s = 0
    for (let k = 0; k < N; k++) s += G[k * N + j]! * (phiH[k]! * h + phiV[k]! * v - refs[k]!)
    f.push(q * s)
  }
  return { H, f }
}

describe('mpc module', () => {
  it('declares its id, modes and parameters', () => {
    expect(mpc.id).toBe('mpc')
    expect(mpc.name).toBe('MPC')
    expect(mpc.tag).toBe('Look-ahead')
    expect(mpc.modes).toEqual(['semi-auto', 'autopilot'])
    expect(mpc.params.map((s) => s.key)).toEqual(['N', 'Q', 'R', 'preview'])
    expect(mpc.params[0]).toMatchObject({ min: 5, max: 40, step: 1, default: 20 })
    expect(mpc.params[0]!.log).toBeFalsy()
    expect(mpc.params[1]).toMatchObject({ log: true, min: 0.01, max: 100, step: 0.01, default: 1 })
    expect(mpc.params[2]).toMatchObject({ log: true, min: 0.1, max: 1000, step: 0.1, default: 10 })
    expect(mpc.params[3]).toMatchObject({ toggle: true, default: 1 })
    for (const s of mpc.params) expect(s.accessibleName.length).toBeGreaterThan(0)
  })

  it('ends its lesson with the Try: sentence and no HTML', () => {
    expect(mpc.lesson).toMatch(/Try: [^.]*\.$/)
    expect(mpc.lesson.endsWith(
      'Try: switch Preview off to see what look-ahead is worth, or shrink the horizon and watch the look-ahead in the Pole readout.',
    )).toBe(true)
    expect(mpc.lesson).not.toMatch(/</)
  })

  it('uses a 0.1 s model step', () => {
    expect(MODEL_STEP).toBe(0.1)
  })
})

describe('mpc analysis', () => {
  it('looks N × 0.1 s ahead with preview on', () => {
    expect(mpc.analysis!(defaultParams(mpc))).toEqual({ lookahead: 2 })
    expect(mpc.analysis!({ ...defaultParams(mpc), N: 7 }).lookahead).toBe(0.7)
    expect(mpc.analysis!({ ...defaultParams(mpc), N: 40 }).lookahead).toBe(4)
  })

  it('looks 0 s ahead with preview off or a non-finite N', () => {
    expect(mpc.analysis!({ ...defaultParams(mpc), preview: 0 })).toEqual({ lookahead: 0 })
    expect(mpc.analysis!({ ...defaultParams(mpc), N: Number.NaN })).toEqual({ lookahead: 0 })
    expect(mpc.analysis!({ ...defaultParams(mpc), N: Number.POSITIVE_INFINITY })).toEqual({ lookahead: 0 })
  })
})

describe('mpc solver', () => {
  it('returns the unconstrained optimum when it is inside the box', () => {
    const model = buildModel(6, 1, 10)
    const refs = [50.2, 50.4, 50.5, 50.6, 50.6, 50.6]
    const U = solve(model, 50, 0.1, refs)
    const { H, f } = qp(model, 50, 0.1, refs)
    const ref = denseSolve(H, f.map((x) => -x))
    for (const u of U) expect(Math.abs(u)).toBeLessThan(1)
    for (let i = 0; i < U.length; i++) expect(U[i]).toBeCloseTo(ref[i]!, 9)
  })

  it('satisfies the box KKT sign conditions when clamped', () => {
    for (const [h, v, target] of [
      [50, 0, 90],
      [90, 5, 20],
      [30, -8, 60],
    ] as const) {
      const model = buildModel(20, 1, 10)
      const refs = new Array<number>(20).fill(target)
      const U = solve(model, h, v, refs)
      const { H, f } = qp(model, h, v, refs)
      let clamped = 0
      for (let i = 0; i < U.length; i++) {
        const u = U[i]!
        expect(Math.abs(u)).toBeLessThanOrEqual(1)
        let g = f[i]!
        for (let j = 0; j < U.length; j++) g += H[i]![j]! * U[j]!
        const scale = 1e-4 * (1 + Math.abs(f[i]!))
        if (u >= 1 - 1e-9) {
          clamped++
          expect(g).toBeLessThanOrEqual(scale) // pushing past +1 would still lower the cost
        } else if (u <= -1 + 1e-9) {
          clamped++
          expect(g).toBeGreaterThanOrEqual(-scale)
        } else {
          expect(Math.abs(g)).toBeLessThanOrEqual(scale)
        }
      }
      expect(clamped).toBeGreaterThan(0)
    }
  })

  it('solves in under 2 ms on average at the defaults', () => {
    const model = buildModel(20, 1, 10)
    const refs = new Float64Array(20)
    const runs = 500
    for (let k = 0; k < 50; k++) solve(model, 50, 0, refs.fill(50 + k)) // warm up
    const start = performance.now()
    for (let k = 0; k < runs; k++) {
      for (let i = 0; i < 20; i++) refs[i] = 50 + 40 * Math.sin(k * 0.1 + i * 0.05)
      solve(model, 50 + 10 * Math.sin(k), 5 * Math.cos(k), refs)
    }
    const mean = (performance.now() - start) / runs
    expect(mean).toBeLessThan(2)
  })
})

describe('mpc controller', () => {
  it('keeps the command in [-1, 1] far below and above the target', () => {
    for (const N of [5, 20, 40]) {
      for (const Q of [0.01, 1, 100]) {
        for (const R of [0.1, 10, 1000]) {
          for (const preview of [0, 1]) {
            for (const h of [6, 110]) {
              const c = mpc.create({ N, Q, R, preview })
              for (let k = 0; k < 12; k++) {
                const u = c.compute(ctx({ h, v: k - 6, ref: 116 - h, refAhead: () => 116 - h }))
                expect(Number.isFinite(u)).toBe(true)
                expect(Math.abs(u)).toBeLessThanOrEqual(1)
              }
            }
          }
        }
      }
    }
    // Far below with a light effort weight saturates.
    expect(mpc.create({ N: 20, Q: 100, R: 0.1, preview: 1 }).compute(ctx({ h: 6, ref: 100, refAhead: () => 100 }))).toBe(1)
  })

  it('ignores refAhead entirely with preview off', () => {
    const params = { ...defaultParams(mpc), preview: 0 }
    const sane = mpc.create(params)
    const nan = mpc.create(params)
    const throwing = mpc.create(params)
    let calls = 0
    for (let k = 0; k < 100; k++) {
      const base = { t: k * 0.02, ref: 50 + (k > 30 ? 20 : 0), h: 50 + 0.1 * k, v: Math.sin(k * 0.1) }
      const u = sane.compute(ctx({ ...base, refAhead: () => base.ref }))
      expect(nan.compute(ctx({ ...base, refAhead: () => { calls++; return Number.NaN } }))).toBe(u)
      expect(throwing.compute(ctx({ ...base, refAhead: () => { calls++; throw new Error('no') } }))).toBe(u)
    }
    expect(calls).toBe(0)
  })

  it('plans for a step it sees ahead with preview on', () => {
    const step = (ahead: number) => (ahead >= 1 ? 70 : 50)
    const on = mpc.create(defaultParams(mpc)).compute(ctx({ refAhead: step }))
    const off = mpc.create({ ...defaultParams(mpc), preview: 0 }).compute(ctx({ refAhead: step }))
    expect(off).toBe(0)
    expect(on).toBeGreaterThan(0)
  })

  it('asks refAhead for one point per model step with preview on', () => {
    const asked: number[] = []
    mpc.create({ ...defaultParams(mpc), N: 5 }).compute(ctx({ refAhead: (a) => { asked.push(a); return 50 } }))
    expect(asked).toEqual([1, 2, 3, 4, 5].map((i) => i * MODEL_STEP))
  })

  it('holds the command for 5 ticks at T = 0.02, then re-plans', () => {
    const c = mpc.create({ ...defaultParams(mpc), preview: 0 })
    const out: number[] = []
    for (let k = 0; k < 11; k++) out.push(c.compute(ctx({ ref: 50.5, h: 50 + 0.1 * k, v: 0 })))
    expect(out.slice(0, 5)).toEqual(new Array(5).fill(out[0]))
    expect(out[0]).not.toBe(0)
    expect(out[5]).not.toBe(out[0])
    expect(out.slice(5, 10)).toEqual(new Array(5).fill(out[5]))
    expect(out[10]).not.toBe(out[5])
  })

  it('re-plans at once when N, Q or R change', () => {
    for (const change of [{ N: 10 }, { Q: 5 }, { R: 1 }]) {
      const params: Record<string, number> = { ...defaultParams(mpc), preview: 0 }
      const c = mpc.create(params)
      const first = c.compute(ctx({ ref: 50.5 }))
      expect(Math.abs(first)).toBeLessThan(1)
      Object.assign(params, change)
      const second = c.compute(ctx({ ref: 50.5 }))
      expect(second).not.toBe(first)
      expect(second).toBe(mpc.create(params).compute(ctx({ ref: 50.5 })))
    }
  })

  it('reads the preview toggle live at the next re-plan', () => {
    const params: Record<string, number> = { ...defaultParams(mpc) }
    const c = mpc.create(params)
    let calls = 0
    const refAhead = () => {
      calls++
      return 50
    }
    for (let k = 0; k < 5; k++) c.compute(ctx({ refAhead }))
    expect(calls).toBe(20)
    params.preview = 0
    for (let k = 0; k < 5; k++) c.compute(ctx({ refAhead }))
    expect(calls).toBe(20)
  })

  it('returns 0 for non-finite inputs or params and never throws', () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      for (const over of [{ h: bad }, { v: bad }, { ref: bad }]) {
        const c = mpc.create(defaultParams(mpc))
        expect(() => c.compute(ctx({ ref: 60, ...over }))).not.toThrow()
        expect(mpc.create(defaultParams(mpc)).compute(ctx({ ref: 60, ...over }))).toBe(0)
      }
      for (const key of ['N', 'Q', 'R']) {
        expect(mpc.create({ ...defaultParams(mpc), [key]: bad }).compute(ctx({ ref: 60 }))).toBe(0)
      }
      // A non-finite preview point fails the solve.
      expect(mpc.create(defaultParams(mpc)).compute(ctx({ ref: 60, refAhead: () => bad }))).toBe(0)
    }
    expect(mpc.create(defaultParams(mpc)).compute(ctx({ ref: 60, refAhead: () => { throw new Error('x') } }))).toBe(0)
  })

  it('recovers after a non-finite tick or param', () => {
    const params: Record<string, number> = { ...defaultParams(mpc), Q: Number.NaN }
    const c = mpc.create(params)
    expect(c.compute(ctx({ ref: 60, refAhead: () => 60 }))).toBe(0)
    params.Q = 1
    expect(c.compute(ctx({ h: Number.NaN }))).toBe(0)
    const u = c.compute(ctx({ ref: 60, refAhead: () => 60 }))
    expect(u).toBe(mpc.create(defaultParams(mpc)).compute(ctx({ ref: 60, refAhead: () => 60 })))
    expect(u).toBeGreaterThan(0)
  })
})

describe('mpc flies course 101', () => {
  fliesCourse101(mpc)
})
