// The ring course for a course number, and the altitude reference along it.

import { PLANT } from './plant.ts'
import { stream } from './rng.ts'
import type { Ring } from './types.ts'

export interface Course {
  readonly number: number
  readonly rings: readonly Ring[]
  /** `bounds[i]` is where the reference switches to ring `i`'s altitude. */
  readonly bounds: readonly number[]
  /** Where the course ends, m. */
  readonly endX: number
}

export function makeCourse(n: number): Course {
  const rng = stream(n, 'rings')
  const rings: Ring[] = []
  let prev: number = PLANT.hStart
  for (let i = 0; i < PLANT.nRings; i++) {
    let h: number
    let tries = 0
    do {
      h = 22 + rng() * 66
      tries++
    } while ((Math.abs(h - prev) > 45 || Math.abs(h - prev) < 10) && tries < 200)
    rings.push({ x: 200 + i * PLANT.ringGap, h })
    prev = h
  }
  const bounds = rings.map((r, i) => (i === 0 ? r.x - PLANT.ringGap / 2 : (rings[i - 1].x + r.x) / 2))
  const endX = rings[rings.length - 1].x + 100
  return { number: n, rings, bounds, endX }
}

/** The altitude reference at distance `x`: `hStart`, then each ring's altitude from the boundary before it. */
export function refAt(course: Course, x: number): number {
  let ref: number = PLANT.hStart
  for (let i = 0; i < course.rings.length; i++) {
    if (x >= course.bounds[i]) ref = course.rings[i].h
    else break
  }
  return ref
}
