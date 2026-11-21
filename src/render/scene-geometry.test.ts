import { describe, expect, it } from 'vitest'
import { defaultParams } from '../algorithms/index.ts'
import pid from '../algorithms/pid.ts'
import { makeCourse, refAt } from '../sim/course.ts'
import { PLANT } from '../sim/plant.ts'
import { createRun } from '../sim/run.ts'
import type { PlaneSnapshot, RingResult, Snapshot, Trace } from '../sim/types.ts'
import { fixtureSnapshot } from './fixture.ts'
import { FONT, LINE, altitudeY, sceneGeometry, scoreLabel, type SceneSize } from './scene-geometry.ts'

const SIZE: SceneSize = { width: 1280, height: 720, dpr: 1 }
const course = makeCourse(101)

const ready = (): Snapshot =>
  createRun({ course: 101, mode: 'autopilot', player: { algorithm: pid, params: defaultParams(pid) } }).snapshot()

function result(ring: number, pass: boolean): RingResult {
  return { ring, pass, err: pass ? 1 : 10, points: pass ? 9 : 0 }
}

function plane(over: Partial<PlaneSnapshot>): PlaneSnapshot {
  return {
    id: 'player',
    status: 'flying',
    h: 50,
    v: 0,
    x: 0,
    u: 0,
    hMeas: 50,
    hEst: 50,
    ref: 50,
    points: 0,
    results: [],
    retuned: false,
    ...over,
  }
}

function snapshotWith(p: PlaneSnapshot | null, trace?: Trace): Snapshot {
  return {
    t: 0,
    course: 101,
    planes: p ? [p] : [],
    rings: course.rings,
    markers: [],
    trace: trace ? { player: trace } : {},
  }
}

function traceOf(rows: Array<readonly [t: number, h: number]>, capacity = rows.length + 5): Trace {
  const col = () => new Float64Array(capacity)
  const tr = { length: rows.length, t: col(), ref: col(), h: col(), hMeas: col(), hEst: col(), u: col() }
  rows.forEach(([t, h], i) => {
    tr.t[i] = t
    tr.h[i] = h
  })
  return tr
}

describe('sceneGeometry: ready', () => {
  const g = sceneGeometry(ready(), SIZE)

  it('puts the plane 30% in at the start altitude', () => {
    expect(g.plane.x).toBeCloseTo(0.3 * SIZE.width, 9)
    expect(g.plane.y).toBeCloseTo(altitudeY(SIZE.height, 50), 9)
    expect(g.plane.y).toBeCloseTo(720 * 0.97 - 50 * ((720 * 0.92) / 110), 9)
    expect(g.plane.angle).toBe(0)
  })

  it('uses the prototype camera', () => {
    expect(g.camera.sx).toBeCloseTo(1280 / 230, 12)
    expect(g.camera.ky).toBeCloseTo((720 * 0.92) / 110, 12)
    expect(sceneGeometry(ready(), { width: 500, height: 375, dpr: 2 }).camera.sx).toBeCloseTo(500 / 170, 12)
  })

  it('shows every ring as pending', () => {
    // At the start the camera ends before ring 0, so look a little further along with no results.
    for (const r of g.rings) expect(r.state).toBe('pending')
    const ahead = sceneGeometry(snapshotWith(plane({ x: 150 })), SIZE)
    expect(ahead.rings.length).toBeGreaterThan(0)
    for (const r of ahead.rings) expect(r.state).toBe('pending')
  })

  it('reads the HUD and badge', () => {
    expect(g.hud.ring).toBe('Ring 1 / 10')
    expect(g.hud.altitude).toBe('Altitude 50 m, target 50 m')
    expect(g.score).toBe('0.0')
    expect(scoreLabel(ready())).toBe('0.0 points')
  })

  it('has no trail before the first tick', () => {
    expect(g.trail).toEqual([])
  })

  it('puts the ground band below 1.5 m', () => {
    expect(g.groundY).toBeCloseTo(altitudeY(720, 1.5), 9)
  })
})

describe('sceneGeometry: mid-flight', () => {
  const x = course.rings[1].x + 20
  const results = [result(0, true), result(1, false)]
  const s = snapshotWith(plane({ x, h: 40, ref: refAt(course, x), results }))
  const g = sceneGeometry(s, SIZE)

  it('colors rings by result', () => {
    const state = new Map(g.rings.map((r) => [r.index, r.state]))
    expect(state.get(1)).toBe('miss')
    expect(state.get(2)).toBe('pending')
    for (const [i, st] of state) if (i > 1) expect(st).toBe('pending')
    // Ring 0 is behind the left edge once the plane is past ring 1; check its color from closer.
    const near = sceneGeometry(snapshotWith(plane({ x: 240, results })), SIZE)
    expect(new Map(near.rings.map((r) => [r.index, r.state])).get(0)).toBe('pass')
  })

  it('counts the next ring in the HUD', () => {
    expect(g.hud.ring).toBe('Ring 3 / 10')
    expect(g.hud.altitude).toBe(`Altitude 40 m, target ${refAt(course, x).toFixed(0)} m`)
  })

  it('caps the ring count at 10', () => {
    const all = snapshotWith(plane({ x: course.endX, results: course.rings.map((_, i) => result(i, true)) }))
    expect(sceneGeometry(all, SIZE).hud.ring).toBe('Ring 10 / 10')
  })

  it('formats the score', () => {
    const scored = snapshotWith(plane({ points: 12.34 }))
    expect(sceneGeometry(scored, SIZE).score).toBe('12.3')
    expect(scoreLabel(scored)).toBe('12.3 points')
  })

  it('tilts the plane nose-up when climbing', () => {
    expect(sceneGeometry(snapshotWith(plane({ v: 5 })), SIZE).plane.angle).toBeGreaterThan(0)
  })
})

describe('sceneGeometry: trail', () => {
  it('runs from the rows in view to the plane and leaves the trace untouched', () => {
    const x = 600
    const rows: Array<readonly [number, number]> = []
    for (let t = 0; t * PLANT.speed < x; t += 0.5) rows.push([t, 50 + t])
    const trace = traceOf(rows)
    const before = { t: trace.t.slice(), h: trace.h.slice(), length: trace.length }
    const s = snapshotWith(plane({ x, h: 70 }), trace)
    const g = sceneGeometry(s, SIZE)

    const camX = g.camera.camX
    const inView = rows.filter(([t]) => PLANT.speed * t >= camX - 5)
    expect(g.trail).toHaveLength(inView.length + 1)
    inView.forEach(([t, h], i) => {
      expect(g.trail[i].x).toBeCloseTo((PLANT.speed * t - camX) * g.camera.sx, 9)
      expect(g.trail[i].y).toBeCloseTo(altitudeY(720, h), 9)
    })
    expect(g.trail[g.trail.length - 1]).toEqual({ x: g.plane.x, y: g.plane.y })

    expect(trace.t).toEqual(before.t)
    expect(trace.h).toEqual(before.h)
    expect(trace.length).toBe(before.length)
  })

  it('ignores rows past length', () => {
    const trace = traceOf([[0, 50], [1, 51]])
    trace.t[2] = 2
    trace.h[2] = 99
    const g = sceneGeometry(snapshotWith(plane({ x: 40, h: 52 }), trace), SIZE)
    expect(g.trail).toHaveLength(3)
  })

  it('is empty for an empty trace', () => {
    const g = sceneGeometry(snapshotWith(plane({ x: 300 }), traceOf([])), SIZE)
    expect(g.trail).toEqual([])
  })
})

describe('sceneGeometry: target line', () => {
  it('follows the reference rule across the view', () => {
    const x = 500
    const g = sceneGeometry(snapshotWith(plane({ x })), SIZE)
    const { camX, sx } = g.camera
    expect(g.target[0].x).toBeCloseTo(0, 9)
    expect(g.target[g.target.length - 1].x).toBeCloseTo(SIZE.width, 9)
    for (const p of g.target) {
      const cx = camX + p.x / sx
      expect(p.y).toBeCloseTo(altitudeY(720, refAt(course, cx)), 9)
    }
    expect(g.target.some((p) => p.y === altitudeY(720, course.rings[2].h))).toBe(true)
  })

  it('clamps to the start and the course end', () => {
    const atStart = sceneGeometry(snapshotWith(plane({ x: 0 })), SIZE)
    const { camX, sx } = atStart.camera
    expect(camX).toBeLessThan(0)
    expect(atStart.target[0].x).toBeCloseTo(-camX * sx, 9)
    expect(atStart.target[0].y).toBeCloseTo(altitudeY(720, PLANT.hStart), 9)

    const atEnd = sceneGeometry(snapshotWith(plane({ x: course.endX })), SIZE)
    const last = atEnd.target[atEnd.target.length - 1]
    expect(last.x).toBeCloseTo((course.endX - atEnd.camera.camX) * atEnd.camera.sx, 9)
    expect(last.x).toBeLessThan(SIZE.width)
  })
})

describe('sceneGeometry: off-screen rings', () => {
  it('omits rings outside [-40, W + 40]', () => {
    const g = sceneGeometry(snapshotWith(plane({ x: 900 })), SIZE)
    const { camX, sx } = g.camera
    const expected = course.rings
      .map((r, i) => ({ i, x: (r.x - camX) * sx }))
      .filter(({ x }) => x >= -40 && x <= SIZE.width + 40)
      .map(({ i }) => i)
    expect(g.rings.map((r) => r.index)).toEqual(expected)
    expect(expected.length).toBeLessThan(course.rings.length)
  })

  it('marks rings near the plane for their front half', () => {
    const g = sceneGeometry(snapshotWith(plane({ x: course.rings[0].x })), SIZE)
    expect(g.rings.find((r) => r.index === 0)!.front).toBe(true)
    expect(g.rings.find((r) => r.index === 1)?.front ?? false).toBe(false)
  })
})

describe('sceneGeometry: no player plane', () => {
  it('draws the start plane and never throws', () => {
    const s = snapshotWith(null)
    const g = sceneGeometry(s, SIZE)
    expect(g.plane.x).toBeCloseTo(0.3 * SIZE.width, 9)
    expect(g.plane.y).toBeCloseTo(altitudeY(720, 50), 9)
    expect(g.plane.angle).toBe(0)
    expect(g.hud.ring).toBe('Ring 1 / 10')
    expect(g.hud.altitude).toBe('Altitude 50 m, target 50 m')
    expect(g.score).toBe('0.0')
    expect(scoreLabel(s)).toBe('0.0 points')
  })
})

describe('sceneGeometry: size 0', () => {
  it('does not throw', () => {
    expect(() => sceneGeometry(ready(), { width: 0, height: 0, dpr: 1 })).not.toThrow()
    expect(() => sceneGeometry(ready(), { width: 1280, height: 0, dpr: 1 })).not.toThrow()
  })
})

describe('floors', () => {
  it('keeps every stroke at 3 px or more', () => {
    for (const w of Object.values(LINE)) expect(w).toBeGreaterThanOrEqual(3)
    for (const size of [SIZE, { width: 320, height: 240, dpr: 3 }, { width: 1920, height: 1080, dpr: 1 }]) {
      for (const r of sceneGeometry(ready(), size).rings) expect(r.width).toBeGreaterThanOrEqual(3)
    }
  })

  it('keeps every text at 18 px or more, with the score at 32 px', () => {
    for (const f of Object.values(FONT)) expect(f).toBeGreaterThanOrEqual(18)
    expect(FONT.score).toBe(32)
  })
})

describe('fixtureSnapshot', () => {
  it('is mid-flight with passed and missed rings and a trail', () => {
    const s = fixtureSnapshot()
    const p = s.planes[0]
    expect(p.results.length).toBeGreaterThanOrEqual(3)
    expect(p.results.some((r) => r.pass)).toBe(true)
    expect(p.results.some((r) => !r.pass)).toBe(true)
    expect(p.x).toBeGreaterThan(s.rings[2].x)
    const g = sceneGeometry(s, SIZE)
    expect(g.trail.length).toBeGreaterThan(2)
    expect(g.rings.some((r) => r.state !== 'pending')).toBe(true)
    expect(g.rings.some((r) => r.state === 'pending')).toBe(true)
    expect(g.hud.ring).toBe(`Ring ${p.results.length + 1} / 10`)
  })

  it('shows the last ring flown as passed by default and as missed after two rings', () => {
    const behind = (s: Snapshot) => sceneGeometry(s, SIZE).rings.filter((r) => r.state !== 'pending')
    expect(behind(fixtureSnapshot()).map((r) => r.state)).toEqual(['pass'])
    expect(behind(fixtureSnapshot(2)).map((r) => r.state)).toEqual(['miss'])
    expect(fixtureSnapshot(2).planes[0].results).toHaveLength(2)
  })

  it('clamps the rings flown', () => {
    expect(fixtureSnapshot(0).planes[0].results).toHaveLength(1)
    expect(fixtureSnapshot(99).planes[0].results).toHaveLength(9)
    expect(fixtureSnapshot(Number.NaN).planes[0].results).toHaveLength(4)
  })
})
