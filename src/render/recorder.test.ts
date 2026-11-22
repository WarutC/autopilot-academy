import { describe, expect, it } from 'vitest'
import { makeCourse, refAt } from '../sim/course.ts'
import { PLANT } from '../sim/plant.ts'
import type { Snapshot } from '../sim/types.ts'
import { LIGHT } from '../ui/theme.ts'
import { fixtureSnapshot } from './fixture.ts'
import { MARKER_ROW, PAD, RECORDER_FONT, RECORDER_LINE, draw, recorderGeometry } from './recorder.ts'

const SIZE = { width: 1000, height: 300, dpr: 1 }
const course = makeCourse(101)
const tEnd = course.endX / PLANT.speed

const withMarkers = (markers: Snapshot['markers'], s: Snapshot = fixtureSnapshot()): Snapshot => ({ ...s, markers })

/** A 2D context stand-in that records method calls, `lineWidth` and `font` sets. */
function recordingContext(): { ctx: CanvasRenderingContext2D; calls: string[] } {
  const calls: string[] = []
  const ctx = new Proxy({} as Record<string | symbol, unknown>, {
    get(target, key) {
      if (key in target) return target[key]
      return (...args: unknown[]) => {
        calls.push(String(key))
        return key === 'measureText' ? { width: String(args[0]).length * 9 } : undefined
      }
    },
    set(target, key, value) {
      if (key === 'lineWidth' || key === 'font' || key === 'strokeStyle') calls.push(`${String(key)}=${String(value)}`)
      target[key] = value
      return true
    },
  })
  return { ctx: ctx as unknown as CanvasRenderingContext2D, calls }
}

describe('recorderGeometry', () => {
  it('maps t 0 to the course end across the plot and the safe band down it', () => {
    const g = recorderGeometry(fixtureSnapshot(), SIZE)
    expect(g.tEnd).toBeCloseTo(tEnd, 12)
    expect(g.plot).toEqual({ left: PAD.left, top: PAD.top, right: SIZE.width - PAD.right, bottom: SIZE.height - PAD.bottom })
    const tr = fixtureSnapshot().trace.player!
    expect(g.altitude).toHaveLength(tr.length)
    expect(g.altitude[0]!.x).toBe(PAD.left)
    // hStart is 50 m in a 6–110 m band.
    const expectY = SIZE.height - PAD.bottom - ((50 - PLANT.hFloor) / (PLANT.hCeil - PLANT.hFloor)) * (SIZE.height - PAD.top - PAD.bottom)
    expect(g.altitude[0]!.y).toBeCloseTo(expectY, 9)
    const top = g.ticks.find((t) => t.h === PLANT.hCeil)!
    expect(top.y).toBeCloseTo(PAD.top, 9)
  })

  it('draws the target from the trace, then from the rings to the course end', () => {
    const s = fixtureSnapshot()
    const tr = s.trace.player!
    const g = recorderGeometry(s, SIZE)
    expect(g.target.length).toBeGreaterThan(tr.length)
    expect(g.target[tr.length - 1]!.x).toBe(g.altitude[tr.length - 1]!.x)
    const last = g.target[g.target.length - 1]!
    expect(last.x).toBe(SIZE.width - PAD.right)
    const lastRing = course.rings[course.rings.length - 1]!
    expect(refAt(course, course.endX)).toBe(lastRing.h)
    for (let i = 1; i < g.target.length; i++) expect(g.target[i]!.x).toBeGreaterThanOrEqual(g.target[i - 1]!.x)
  })

  it('shows the whole course reference before the flight', () => {
    const s = fixtureSnapshot()
    const empty: Snapshot = { ...s, trace: {} }
    const g = recorderGeometry(empty, SIZE)
    expect(g.altitude).toEqual([])
    expect(g.target[0]!.x).toBe(PAD.left)
    expect(g.target.length).toBeGreaterThan(100)
  })

  it('draws the rest of a Semi-auto target flat at the player setpoint, after the flown part', () => {
    const s = fixtureSnapshot()
    const tr = s.trace.player!
    const semi: Snapshot = { ...s, planes: s.planes.map((p) => ({ ...p, mode: 'semi-auto' as const, ref: 80 })) }
    const g = recorderGeometry(semi, SIZE)
    const flat = recorderGeometry({ ...semi, trace: {} }, SIZE).target[0]!.y
    // The flown part keeps the trace reference.
    for (let i = 0; i < tr.length; i++) expect(g.target[i]).toEqual(recorderGeometry(s, SIZE).target[i])
    const rest = g.target.slice(tr.length)
    expect(rest.length).toBeGreaterThan(10)
    for (const p of rest) expect(p.y).toBe(flat)
    const expectY = SIZE.height - PAD.bottom - ((80 - PLANT.hFloor) / (PLANT.hCeil - PLANT.hFloor)) * (SIZE.height - PAD.top - PAD.bottom)
    expect(flat).toBeCloseTo(expectY, 9)
    // Autopilot keeps the course reference beyond the flown part.
    const auto = recorderGeometry(s, SIZE).target.slice(tr.length)
    expect(new Set(auto.map((p) => p.y)).size).toBeGreaterThan(1)
  })

  it('places a marker at its time with a full-height line', () => {
    const g = recorderGeometry(withMarkers([{ t: tEnd / 2, label: 'Kd 0 → 0.05' }]), SIZE)
    expect(g.markers).toHaveLength(1)
    const m = g.markers[0]!
    expect(m.x).toBeCloseTo(PAD.left + (SIZE.width - PAD.left - PAD.right) / 2, 9)
    expect(m.y0).toBe(PAD.top)
    expect(m.y1).toBe(SIZE.height - PAD.bottom)
    expect(m.label).toBe('Kd 0 → 0.05')
    expect(m.labelX).toBeGreaterThan(m.x)
    expect(m.row).toBe(0)
  })

  it('staggers labels that would overlap, and keeps far apart ones on the first row', () => {
    const g = recorderGeometry(
      withMarkers([
        { t: 3.0, label: 'Kd 0 → 0.05' },
        { t: 3.4, label: 'Kp 0.2 → 0.3' },
        { t: 3.8, label: 'Ki 0.03 → 0' },
        { t: 30, label: 'Kd 0.05 → 0.1' },
      ]),
      SIZE,
    )
    expect(g.markers.map((m) => m.row)).toEqual([0, 1, 2, 0])
    expect(g.markers[1]!.labelY - g.markers[0]!.labelY).toBe(MARKER_ROW)
  })

  it('keeps every label inside the plot when many markers bunch up', () => {
    const many = Array.from({ length: 40 }, (_, i) => ({ t: 3 + i * 0.05, label: `Kd ${i} → ${i + 1}` }))
    const g = recorderGeometry(withMarkers(many), SIZE)
    expect(g.markers).toHaveLength(40)
    for (const m of g.markers) {
      expect(m.labelY).toBeLessThanOrEqual(g.plot.bottom)
      expect(m.labelY).toBeGreaterThanOrEqual(g.plot.top)
    }
  })

  it('keeps a label near the right edge on the canvas', () => {
    const g = recorderGeometry(withMarkers([{ t: tEnd, label: 'Kd 0 → 0.05' }]), SIZE)
    const m = g.markers[0]!
    expect(m.labelX).toBeLessThan(m.x)
    expect(m.labelX).toBeGreaterThanOrEqual(0)
  })
})

describe('recorder draw', () => {
  it('paints nothing at size 0', () => {
    const { ctx, calls } = recordingContext()
    draw(ctx, fixtureSnapshot(), LIGHT, { width: 0, height: 300, dpr: 2 })
    expect(calls).toEqual([])
  })

  it('paints the lines and markers at the floors without writing to the snapshot', () => {
    const s = withMarkers([{ t: 3.2, label: 'Kd 0 → 0.05' }])
    const trace = s.trace.player!
    const before = {
      h: trace.h.slice(),
      ref: trace.ref.slice(),
      t: trace.t.slice(),
      length: trace.length,
      markers: s.markers.slice(),
      results: s.planes[0]!.results.slice(),
    }
    const { ctx, calls } = recordingContext()
    draw(ctx, s, LIGHT, { width: 1000, height: 300, dpr: 2 })
    expect(calls).toContain('fillText')
    expect(calls).toContain(`strokeStyle=${LIGHT.refline}`)
    expect(calls).toContain(`strokeStyle=${LIGHT.accent}`)
    expect(calls).toContain(`lineWidth=${RECORDER_LINE.marker}`)
    const fonts = calls.filter((c) => c.startsWith('font=')).map((c) => Number(/(\d+)px/.exec(c)![1]))
    expect(Math.min(...fonts)).toBeGreaterThanOrEqual(18)
    expect(RECORDER_FONT.marker).toBeGreaterThanOrEqual(18)
    for (const w of [RECORDER_LINE.target, RECORDER_LINE.altitude, RECORDER_LINE.marker]) expect(w).toBeGreaterThanOrEqual(3)
    expect(trace.h).toEqual(before.h)
    expect(trace.ref).toEqual(before.ref)
    expect(trace.t).toEqual(before.t)
    expect(trace.length).toBe(before.length)
    expect(s.markers).toEqual(before.markers)
    expect(s.planes[0]!.results).toEqual(before.results)
  })
})
