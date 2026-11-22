import { describe, expect, it } from 'vitest'
import { makeCourse, refAt } from '../sim/course.ts'
import { PLANT } from '../sim/plant.ts'
import { createTrace } from '../sim/trace.ts'
import type { Snapshot, Trace } from '../sim/types.ts'
import { fixtureSnapshot } from './fixture.ts'
import {
  BAND_GAP,
  BAND_MIN,
  LEGEND_ROW,
  MARKER_ROW,
  PAD,
  RING_BAR_WIDTH,
  labelWidth,
  recorderGeometry,
  type RecorderGeometry,
} from './recorder-geometry.ts'

const SIZE = { width: 1000, height: 300, dpr: 1 }
const course = makeCourse(101)
const tEnd = course.endX / PLANT.speed

const withMarkers = (markers: Snapshot['markers'], s: Snapshot = fixtureSnapshot()): Snapshot => ({ ...s, markers })

/** y of altitude `h` in the plot of `g`. */
const plotY = (g: RecorderGeometry, h: number): number =>
  g.plot.bottom - ((h - PLANT.hFloor) / (PLANT.hCeil - PLANT.hFloor)) * (g.plot.bottom - g.plot.top)

/** A copy of `trace` with its `u` column replaced by `u`, cycled over the rows. */
function withU(trace: Trace, u: readonly number[]): Trace {
  const copy = createTrace(trace.length)
  copy.length = trace.length
  for (let i = 0; i < trace.length; i++) {
    copy.t[i] = trace.t[i]
    copy.ref[i] = trace.ref[i]
    copy.h[i] = trace.h[i]
    copy.hMeas[i] = trace.hMeas[i]
    copy.hEst[i] = trace.hEst[i]
    copy.u[i] = u[i % u.length]
  }
  return copy
}

describe('recorderGeometry', () => {
  it('maps t 0 to the course end across the plot and the safe band down it', () => {
    const g = recorderGeometry(fixtureSnapshot(), SIZE)
    expect(g.tEnd).toBeCloseTo(tEnd, 12)
    expect(g.plot.left).toBe(PAD.left)
    expect(g.plot.right).toBe(SIZE.width - PAD.right)
    expect(g.plot.top).toBe(PAD.top + LEGEND_ROW)
    expect(g.plot.bottom).toBeGreaterThan(g.plot.top)
    const tr = fixtureSnapshot().trace.player!
    expect(g.altitude).toHaveLength(tr.length)
    expect(g.altitude[0]!.x).toBe(PAD.left)
    // hStart is 50 m in a 6–110 m band.
    expect(g.altitude[0]!.y).toBeCloseTo(plotY(g, 50), 9)
    const top = g.ticks.find((t) => t.h === PLANT.hCeil)!
    expect(top.y).toBeCloseTo(g.plot.top, 9)
    expect(g.ticks.map((t) => t.h)).toEqual([20, 50, 80, 110])
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
    const flatG = recorderGeometry({ ...semi, trace: {} }, SIZE)
    const flat = flatG.target[0]!.y
    // The flown part keeps the trace reference.
    for (let i = 0; i < tr.length; i++) expect(g.target[i]).toEqual(recorderGeometry(s, SIZE).target[i])
    const rest = g.target.slice(tr.length)
    expect(rest.length).toBeGreaterThan(10)
    for (const p of rest) expect(p.y).toBeCloseTo(plotY(g, 80), 9)
    expect(flat).toBeCloseTo(plotY(flatG, 80), 9)
    // Autopilot keeps the course reference beyond the flown part.
    const auto = recorderGeometry(s, SIZE).target.slice(tr.length)
    expect(new Set(auto.map((p) => p.y)).size).toBeGreaterThan(1)
  })

  it('places a marker at its time with a line from the plot top to the band bottom', () => {
    const g = recorderGeometry(withMarkers([{ t: tEnd / 2, label: 'Kd 0 → 0.05' }]), SIZE)
    expect(g.markers).toHaveLength(1)
    const m = g.markers[0]!
    expect(m.x).toBeCloseTo(PAD.left + (SIZE.width - PAD.left - PAD.right) / 2, 9)
    expect(m.y0).toBe(g.plot.top)
    expect(m.y1).toBe(g.band.bottom)
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

  it('keeps every label inside the altitude plot when many markers bunch up', () => {
    const many = Array.from({ length: 40 }, (_, i) => ({ t: 3 + i * 0.05, label: `Kd ${i} → ${i + 1}` }))
    for (const size of [SIZE, { width: 1000, height: 240, dpr: 1 }]) {
      const g = recorderGeometry(withMarkers(many), size)
      expect(g.markers).toHaveLength(40)
      for (const m of g.markers) {
        expect(m.labelY).toBeLessThanOrEqual(g.plot.bottom)
        expect(m.labelY).toBeGreaterThanOrEqual(g.plot.top)
      }
    }
  })

  it('keeps a label near the right edge on the canvas', () => {
    const g = recorderGeometry(withMarkers([{ t: tEnd, label: 'Kd 0 → 0.05' }]), SIZE)
    const m = g.markers[0]!
    expect(m.labelX).toBeLessThan(m.x)
    expect(m.labelX).toBeGreaterThanOrEqual(0)
  })

  it('puts the elevator band below the plot with a gap and no overlap', () => {
    for (const height of [240, 300, 600]) {
      const g = recorderGeometry(fixtureSnapshot(), { width: 1000, height, dpr: 1 })
      expect(g.band.top - g.plot.bottom).toBeCloseTo(BAND_GAP, 9)
      expect(g.band.bottom).toBeCloseTo(height - PAD.bottom, 9)
      expect(g.band.bottom - g.band.top).toBeGreaterThanOrEqual(BAND_MIN)
      expect(g.band.mid).toBeCloseTo((g.band.top + g.band.bottom) / 2, 9)
      expect(g.plot.bottom - g.plot.top).toBeGreaterThan(0)
    }
  })
})

describe('recorderGeometry: before Fly', () => {
  const empty: Snapshot = { ...fixtureSnapshot(), planes: fixtureSnapshot().planes.map((p) => ({ ...p, results: [] })), trace: {} }
  const g = recorderGeometry(empty, SIZE)

  it('shows Target only in the legend, dashed', () => {
    expect(g.legend.map((e) => e.label)).toEqual(['Target'])
    expect(g.legend[0]!.dashed).toBe(true)
  })

  it('draws 10 gold bars and no altitude or elevator points', () => {
    expect(g.ringBars).toHaveLength(10)
    for (const bar of g.ringBars) expect(bar.state).toBe('pending')
    expect(g.altitude).toEqual([])
    expect(g.elevator).toEqual([])
  })

  it('has no legend at all without rings or a trace', () => {
    const blank = recorderGeometry({ ...empty, rings: [] }, SIZE)
    expect(blank.legend).toEqual([])
    expect(blank.ringBars).toEqual([])
    expect(blank.plot.bottom).toBeGreaterThan(blank.plot.top)
  })
})

describe('recorderGeometry: mid-flight', () => {
  const s = fixtureSnapshot()
  const g = recorderGeometry(s, SIZE)

  it('marks bars 0–3 by result and the rest pending', () => {
    expect(g.ringBars.map((b) => b.state)).toEqual([
      'pass',
      'miss',
      'miss',
      'pass',
      'pending',
      'pending',
      'pending',
      'pending',
      'pending',
      'pending',
    ])
    expect(g.ringBars.map((b) => b.index)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])
  })

  it('has one elevator point per trace row', () => {
    expect(g.elevator).toHaveLength(s.trace.player!.length)
    for (let i = 0; i < g.elevator.length; i++) expect(g.elevator[i]!.x).toBe(g.altitude[i]!.x)
  })

  it('lists exactly Target, Altitude and Elevator, with only Target dashed', () => {
    expect(g.legend.map((e) => e.label)).toEqual(['Target', 'Altitude', 'Elevator'])
    expect(g.legend.map((e) => e.key)).toEqual(['target', 'altitude', 'elevator'])
    expect(g.legend.map((e) => e.dashed)).toEqual([true, false, false])
  })

  it('keeps every legend entry inside the canvas width and in the legend row', () => {
    for (const e of g.legend) {
      expect(e.swatchX0).toBeGreaterThanOrEqual(0)
      expect(e.swatchX1).toBeGreaterThan(e.swatchX0)
      expect(e.x).toBeGreaterThan(e.swatchX1)
      expect(e.x + labelWidth(e.label)).toBeLessThanOrEqual(SIZE.width)
      expect(e.y).toBe(PAD.top + LEGEND_ROW / 2)
      expect(e.y).toBeLessThan(g.plot.top)
    }
    for (let i = 1; i < g.legend.length; i++) {
      expect(g.legend[i]!.swatchX0).toBeGreaterThan(g.legend[i - 1]!.x + labelWidth(g.legend[i - 1]!.label))
    }
  })

  it('leaves Altitude and Elevator out for a single-row trace', () => {
    const tr = s.trace.player!
    const one = createTrace(1)
    one.length = 1
    one.t[0] = tr.t[0]
    one.ref[0] = tr.ref[0]
    one.h[0] = tr.h[0]
    const g1 = recorderGeometry({ ...s, trace: { player: one } }, SIZE)
    expect(g1.legend.map((e) => e.label)).toEqual(['Target'])
  })
})

describe('recorderGeometry: elevator mapping', () => {
  const base = fixtureSnapshot()
  const tr = base.trace.player!

  it('maps u = 1, 0 and -1 to the band top, middle and bottom', () => {
    const g = recorderGeometry({ ...base, trace: { player: withU(tr, [1, 0, -1]) } }, SIZE)
    expect(g.elevator[0]!.y).toBeCloseTo(g.band.top, 9)
    expect(g.elevator[1]!.y).toBeCloseTo(g.band.mid, 9)
    expect(g.elevator[2]!.y).toBeCloseTo(g.band.bottom, 9)
  })

  it('clamps u to [-1, 1] and draws a non-finite u as 0', () => {
    const g = recorderGeometry(
      { ...base, trace: { player: withU(tr, [3, -2.5, Number.NaN, Number.POSITIVE_INFINITY, 0.5]) } },
      SIZE,
    )
    expect(g.elevator[0]!.y).toBeCloseTo(g.band.top, 9)
    expect(g.elevator[1]!.y).toBeCloseTo(g.band.bottom, 9)
    expect(g.elevator[2]!.y).toBeCloseTo(g.band.mid, 9)
    expect(g.elevator[3]!.y).toBeCloseTo(g.band.mid, 9)
    expect(g.elevator[4]!.y).toBeCloseTo((g.band.top + g.band.mid) / 2, 9)
  })

  it('leaves the fixture trace untouched', () => {
    for (let i = 0; i < tr.length; i++) expect(tr.u[i]).toBe(0)
  })
})

describe('recorderGeometry: narrow canvas', () => {
  const NARROW = { width: 360, height: 240, dpr: 1 }
  const g = recorderGeometry(fixtureSnapshot(), NARROW)

  it('wraps the legend to a second row and keeps it inside the width', () => {
    const rows = new Set(g.legend.map((e) => e.y))
    expect(rows.size).toBe(2)
    expect(g.plot.top).toBe(PAD.top + 2 * LEGEND_ROW)
    for (const e of g.legend) {
      expect(e.swatchX0).toBeGreaterThanOrEqual(0)
      expect(e.x + labelWidth(e.label)).toBeLessThanOrEqual(NARROW.width)
      expect(e.y).toBeLessThan(g.plot.top)
    }
  })

  it('keeps the plot and the band at positive height', () => {
    expect(g.plot.bottom - g.plot.top).toBeGreaterThan(0)
    expect(g.band.bottom - g.band.top).toBeGreaterThan(0)
    expect(g.band.top).toBeGreaterThan(g.plot.bottom)
  })

  it('keeps the plot and band in place from before Fly to mid-flight', () => {
    const s = fixtureSnapshot()
    const before = recorderGeometry({ ...s, planes: s.planes.map((p) => ({ ...p, results: [] })), trace: {} }, NARROW)
    expect(before.legend.map((e) => e.label)).toEqual(['Target'])
    expect(before.plot).toEqual(g.plot)
    expect(before.band).toEqual(g.band)
  })

  it('uses one legend row when the measured labels fit', () => {
    const tight = recorderGeometry(fixtureSnapshot(), NARROW, (t) => t.length * 4)
    expect(new Set(tight.legend.map((e) => e.y)).size).toBe(1)
  })
})

describe('recorderGeometry: ring bars', () => {
  const g = recorderGeometry(fixtureSnapshot(), SIZE)
  const X = (t: number): number => g.plot.left + (t / g.tEnd) * (g.plot.right - g.plot.left)

  it('centers each bar at its ring time and spans the ring radius, 8 px wide', () => {
    course.rings.forEach((ring, i) => {
      const bar = g.ringBars[i]!
      expect(bar.width).toBe(RING_BAR_WIDTH)
      expect(bar.x).toBeCloseTo(X(ring.x / PLANT.speed), 9)
      expect(bar.top).toBeCloseTo(Math.max(g.plot.top, plotY(g, ring.h + PLANT.ringR)), 9)
      expect(bar.bottom).toBeCloseTo(Math.min(g.plot.bottom, plotY(g, ring.h - PLANT.ringR)), 9)
      expect(bar.bottom).toBeGreaterThan(bar.top)
    })
  })

  it('clips a bar to the plot', () => {
    const s = fixtureSnapshot()
    const high: Snapshot = { ...s, rings: s.rings.map((r, i) => (i === 0 ? { ...r, h: PLANT.hCeil } : r)) }
    const bar = recorderGeometry(high, SIZE).ringBars[0]!
    expect(bar.top).toBe(g.plot.top)
    expect(bar.bottom).toBeCloseTo(plotY(g, PLANT.hCeil - PLANT.ringR), 9)
  })
})
