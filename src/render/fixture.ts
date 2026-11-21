// A mid-flight snapshot for looking at the scene during development.
// Loaded only through a dynamic import guarded by `import.meta.env.DEV`.

import { makeCourse, refAt } from '../sim/course.ts'
import { PLANT } from '../sim/plant.ts'
import { ringResult } from '../sim/scoring.ts'
import type { RingResult, Snapshot, Trace } from '../sim/types.ts'

export const FIXTURE_ID = 'scene-fixture'

const COURSE = 101
/** The plane is this far past the last ring flown, m. */
const PAST_RING = 40
/**
 * Altitude offsets at each ring; beyond the ring radius is a miss. Only the
 * last ring flown is in view behind the plane, so `fixtureSnapshot(2)` shows a
 * missed ring and the default shows a passed one.
 */
const RING_ERRORS = [1.5, -9, 9.5, 2, -1, 12, 0.5, -3, 8.5, 1]

/** Rings flown by default. */
export const FIXTURE_FLOWN = 4

/** A snapshot with the plane just past the `flown`-th ring (clamped to 1–9). */
export function fixtureSnapshot(flown: number = FIXTURE_FLOWN): Snapshot {
  const course = makeCourse(COURSE)
  const { rings } = course
  const n = Number.isFinite(flown) ? Math.min(rings.length - 1, Math.max(1, Math.floor(flown))) : FIXTURE_FLOWN
  const errors = RING_ERRORS.slice(0, n)
  const results: RingResult[] = errors.map((offset, i) => ringResult(i, rings[i], rings[i].h + offset))
  const x = rings[n - 1].x + PAST_RING

  // A smooth path through the start and each flown ring at its offset.
  const knots: Array<readonly [x: number, h: number]> = [
    [0, PLANT.hStart],
    ...errors.map((offset, i) => [rings[i].x, rings[i].h + offset] as const),
    [rings[n].x, rings[n].h],
  ]
  const altitude = (at: number): number => {
    let k = 0
    while (k < knots.length - 2 && at > knots[k + 1][0]) k++
    const [xa, ha] = knots[k]
    const [xb, hb] = knots[k + 1]
    const s = Math.min(1, Math.max(0, (at - xa) / (xb - xa)))
    return ha + (hb - ha) * (s * s * (3 - 2 * s))
  }

  const rows = Math.floor(x / PLANT.speed / PLANT.Tc) + 1
  const trace: Trace = {
    length: rows,
    t: new Float64Array(rows),
    ref: new Float64Array(rows),
    h: new Float64Array(rows),
    hMeas: new Float64Array(rows),
    hEst: new Float64Array(rows),
    u: new Float64Array(rows),
  }
  for (let i = 0; i < rows; i++) {
    const t = i * PLANT.Tc
    const h = altitude(PLANT.speed * t)
    trace.t[i] = t
    trace.ref[i] = refAt(course, PLANT.speed * t)
    trace.h[i] = h
    trace.hMeas[i] = h
    trace.hEst[i] = h
  }

  const h = altitude(x)
  const dx = 1
  const v = ((altitude(x) - altitude(x - dx)) / dx) * PLANT.speed
  const points = results.reduce((sum, r) => sum + r.points, 0)
  return {
    t: x / PLANT.speed,
    course: COURSE,
    planes: [
      {
        id: 'player',
        status: 'flying',
        h,
        v,
        x,
        u: 0,
        hMeas: h,
        hEst: h,
        ref: refAt(course, x),
        points,
        results,
        retuned: false,
      },
    ],
    rings,
    markers: [],
    trace: { player: trace },
  }
}
