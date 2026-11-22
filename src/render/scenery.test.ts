import { describe, expect, it, vi } from 'vitest'
import { BUILT_IN_ORDER, algorithms, defaultParams } from '../algorithms/index.ts'
import { makeCourse } from '../sim/course.ts'
import * as rng from '../sim/rng.ts'
import { createRun } from '../sim/run.ts'
import {
  CLOUD_PERIOD,
  PARALLAX,
  TERRAIN_DAY,
  TERRAIN_NIGHT,
  layerOffsets,
  periodStarts,
  ridgeHeight,
  sceneryFor,
  terrainColors,
} from './scenery.ts'

vi.mock('../sim/rng.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../sim/rng.ts')>()
  return { ...actual, stream: vi.fn(actual.stream) }
})

const SAMPLES = [
  [101, 'afternoon', 'coast'],
  [7, 'night', 'city'],
  [8, 'sunset', 'desert'],
  [14, 'morning', 'mountains'],
] as const

describe('sceneryFor', () => {
  it('gives the same scenery for the same course', () => {
    expect(sceneryFor(101)).toEqual(sceneryFor(101))
  })

  it('reads randomness only from the course scenery stream', () => {
    const spy = vi.mocked(rng.stream)
    for (const n of [101, 7, 4242]) {
      spy.mockClear()
      sceneryFor(n)
      expect(spy).toHaveBeenCalled()
      for (const call of spy.mock.calls) expect(call).toEqual([n, 'scenery'])
    }
  })

  it.each(SAMPLES)('shows course %i as %s over %s', (course, time, terrain) => {
    const s = sceneryFor(course)
    expect(s.time).toBe(time)
    expect(s.terrain).toBe(terrain)
  })

  it('covers every time of day and every terrain with the four sample courses', () => {
    const all = SAMPLES.map(([n]) => sceneryFor(n))
    expect(new Set(all.map((s) => s.time)).size).toBe(4)
    expect(new Set(all.map((s) => s.terrain)).size).toBe(4)
  })

  it('places features in meters and fractions of the scene, never in pixels', () => {
    for (const n of [1, 7, 8, 14, 101, 4242]) {
      const s = sceneryFor(n)
      expect(s.clouds.length).toBeGreaterThan(0)
      for (const c of s.clouds) {
        expect(c.x).toBeGreaterThanOrEqual(0)
        expect(c.x).toBeLessThan(CLOUD_PERIOD)
        for (const f of [c.y, c.size]) {
          expect(f).toBeGreaterThan(0)
          expect(f).toBeLessThan(1)
        }
      }
      for (const layer of [s.city.far, s.city.near]) {
        for (const b of layer.buildings) {
          expect(b.x).toBeGreaterThanOrEqual(0)
          expect(b.x + b.width).toBeLessThanOrEqual(layer.period)
          expect(b.height).toBeGreaterThan(0)
          expect(b.height).toBeLessThan(1)
          expect(b.lit).toHaveLength(b.cols * b.rows)
        }
      }
      for (const star of s.stars) {
        for (const f of [star.x, star.y]) {
          expect(f).toBeGreaterThanOrEqual(0)
          expect(f).toBeLessThan(1)
        }
      }
    }
  })

  it('leaves the course rings unchanged', () => {
    sceneryFor(101)
    expect(makeCourse(101).rings.map((r) => r.h)).toEqual([
      66.65258437674493, 23.89941192837432, 66.32025621831417, 54.19208866264671, 80.37898861570284,
      62.72705052699894, 22.825694946106523, 44.619856676552445, 57.482498216442764, 34.03771034022793,
    ])
  })

  // Points each built-in lesson scores on course 101 with its default
  // parameters. The scenery reads only its own stream, so building it never
  // changes a flight.
  const BASELINE: Record<string, number> = {
    manual: 11.795229726204916,
    'on-off': 54.439954662027084,
    p: 59.25905397662555,
    pi: 47.03620377168636,
    pd: 86.3586314124062,
    pid: 83.78203374249364,
    'cascade-pid': 89.86982915152086,
    'pole-placement': 98.70692021321797,
    lqr: 99.2851183305402,
    fuzzy: 83.33818117801178,
    mpc: 99.92726957803184,
  }

  it.each(BUILT_IN_ORDER)('leaves the %s lesson scoring its baseline on course 101', (id) => {
    sceneryFor(101)
    const algorithm = algorithms.find((a) => a.id === id)!
    expect(algorithm).toBeDefined()
    const mode = id === 'manual' ? 'manual' : 'autopilot'
    const run = createRun({ course: 101, mode, player: { algorithm, params: defaultParams(algorithm) } })
    for (let guard = 0; !run.done && guard < 1e6; guard++) run.step(1)
    expect(run.snapshot().planes[0]!.points).toBeCloseTo(BASELINE[id]!, 9)
  })
})

describe('terrainColors', () => {
  it('picks the night colors at night and the day colors otherwise', () => {
    expect(terrainColors({ time: 'night', terrain: 'city' })).toBe(TERRAIN_NIGHT.city)
    expect(terrainColors({ time: 'sunset', terrain: 'city' })).toBe(TERRAIN_DAY.city)
    expect(TERRAIN_NIGHT.city).not.toEqual(TERRAIN_DAY.city)
    for (const time of ['morning', 'afternoon'] as const) expect(terrainColors({ time, terrain: 'mountains' })).toBe(TERRAIN_DAY.mountains)
  })
})

describe('layerOffsets', () => {
  it('moves each layer by its parallax factor', () => {
    const o = layerOffsets(900, false)
    for (const [layer, f] of Object.entries(PARALLAX)) expect(o[layer as keyof typeof o]).toBeCloseTo(f * 900, 9)
    expect(o.clouds).not.toBe(o.far)
    expect(o.far).not.toBe(o.near)
  })

  it('moves every layer together at the near terrain rate under reduced motion', () => {
    expect(Object.values(layerOffsets(0, true))).toEqual([0, 0, 0])
    for (const v of Object.values(layerOffsets(900, true))) expect(v).toBeCloseTo(PARALLAX.near * 900, 9)
  })
})

describe('ridgeHeight', () => {
  it('stays between 0 and 1', () => {
    for (let u = -500; u < 3000; u += 7) {
      const h = ridgeHeight(u, [1, 2, 3])
      expect(h).toBeGreaterThanOrEqual(0)
      expect(h).toBeLessThanOrEqual(1)
    }
  })
})

describe('periodStarts', () => {
  it('covers the span with every period that can reach it', () => {
    expect(periodStarts(250, 650, 200)).toEqual([0, 200, 400, 600])
    expect(periodStarts(-50, 10, 100)).toEqual([-200, -100, 0])
    expect(periodStarts(0, 10, 0)).toEqual([])
  })
})
