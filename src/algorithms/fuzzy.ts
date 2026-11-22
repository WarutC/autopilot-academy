import { clamp } from '../sim/clamp.ts'
import type { ControlContext } from '../sim/types.ts'
import type { AlgorithmModule, Params } from './index.ts'

/** Centers of the five sets: negative big, negative small, zero, positive small, positive big. */
const CENTERS = [-1, -0.5, 0, 0.5, 1] as const
/** Half-width of every triangle. */
const HALF_WIDTH = 0.5
/** Points on [-1, 1] used to find the centroid. */
const SAMPLES = 101

/** How true it is that `x` belongs to set `i`; the outer two sets stay at 1 beyond ±1. */
function membership(x: number, i: number): number {
  const c = CENTERS[i]!
  if (i === 0 && x <= c) return 1
  if (i === CENTERS.length - 1 && x >= c) return 1
  return Math.max(0, 1 - Math.abs(x - c) / HALF_WIDTH)
}

function infer(E: number, V: number): number {
  // Rule (error set i, climb set j) → output set i − j, clamped to the outer sets:
  // the error says climb, the climb rate says brake.
  const strength = [0, 0, 0, 0, 0]
  for (let i = 0; i < CENTERS.length; i++) {
    for (let j = 0; j < CENTERS.length; j++) {
      const w = Math.min(membership(E, i), membership(V, j))
      const k = clamp(i - j, -2, 2) + 2
      if (w > strength[k]!) strength[k] = w
    }
  }
  let num = 0
  let den = 0
  for (let n = 0; n < SAMPLES; n++) {
    const y = -1 + (2 * n) / (SAMPLES - 1)
    let m = 0
    for (let k = 0; k < CENTERS.length; k++) {
      const clipped = Math.min(strength[k]!, Math.max(0, 1 - Math.abs(y - CENTERS[k]!) / HALF_WIDTH))
      if (clipped > m) m = clipped
    }
    num += m * y
    den += m
  }
  return den > 0 ? num / den : 0
}

/** The raw output when only the positive-big rule fires fully; its centroid sits below 1 because the set is cut at 1. */
const FULL_CLIMB = infer(1, 0)

/**
 * The rule table on normalized inputs: `E` is the altitude error and `V` the
 * climb rate, each in [-1, 1]. Returns the crisp output in [-1, 1], scaled
 * so the full climb rule (`E = 1`, `V = 0`) gives exactly 1, and exactly odd:
 * `fuzzyRules(-E, -V) === -fuzzyRules(E, V)`.
 */
export function fuzzyRules(E: number, V: number): number {
  // Averaging with the mirrored case removes rounding differences between the two.
  return (infer(E, V) - infer(-E, -V)) / 2 / FULL_CLIMB + 0
}

/** Fuzzy control: a 5×5 table of if–then rules on the error and climb rate, blended by how true each is. */
const fuzzy: AlgorithmModule = {
  id: 'fuzzy',
  name: 'Fuzzy',
  tag: 'Rule-based',
  lesson:
    'Instead of a formula, the autopilot follows rules such as "far below and not climbing, so climb hard" or "near the target and climbing fast, so push down". ' +
    'Every rule is partly true at once, and the elevator is the blend of their answers weighted by how true each one is. ' +
    'Try: lower the Climb span and watch the plane brake earlier as it nears each ring.',
  modes: ['semi-auto', 'autopilot'],
  params: [
    {
      key: 'Ne',
      label: 'Error span',
      accessibleName: 'Error span, meters of error that count as large',
      unit: 'm',
      min: 2,
      max: 40,
      step: 1,
      default: 10,
    },
    {
      key: 'Nv',
      label: 'Climb span',
      accessibleName: 'Climb span, climb rate that counts as fast',
      unit: 'm/s',
      min: 2,
      max: 40,
      step: 1,
      default: 25,
    },
    { key: 'Ku', label: 'Output gain', accessibleName: 'Output gain', min: 0, max: 1, step: 0.05, default: 0.8 },
  ],
  create(params: Params) {
    return {
      compute(ctx: ControlContext): number {
        const { Ne, Nv, Ku } = params
        if (![ctx.ref, ctx.h, ctx.v, Ne, Nv, Ku].every(Number.isFinite)) return 0
        // A zero span gives ±Infinity, clamped to ±1, or 0/0 = NaN, which clamp treats as 0.
        const E = clamp((ctx.ref - ctx.h) / Ne!, -1, 1)
        const V = clamp(ctx.v / Nv!, -1, 1)
        const u = clamp(Ku! * fuzzyRules(E, V), -1, 1) + 0
        return Number.isFinite(u) ? u : 0
      },
    }
  },
}

export default fuzzy
