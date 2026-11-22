// Everything the flight recorder draws, worked out from a snapshot and the
// canvas size in CSS pixels: a legend row, the altitude plot with the target,
// the altitude flown, ring bars and parameter markers, and a lower band for
// the elevator command. Pure: the renderer only strokes and fills what this returns.

import { courseFromRings, refAt } from '../sim/course.ts'
import { PLANT } from '../sim/plant.ts'
import type { Snapshot } from '../sim/types.ts'
import type { Point, RingState, SceneSize } from './scene-geometry.ts'

/** Stroke widths in CSS px. Plot lines hold the 3 px floor; the grid is a hairline. */
export const RECORDER_LINE = {
  target: 3,
  altitude: 3,
  elevator: 3,
  marker: 3,
  /** Outline of a missed ring bar. */
  ringMiss: 3,
  /** Legend swatch line. */
  swatch: 3,
  axis: 1,
} as const

/** Text sizes in CSS px; none is below the 18 px floor. */
export const RECORDER_FONT = {
  marker: 18,
  axis: 18,
  legend: 18,
} as const

/** Space around the recorder content for the axis labels, CSS px. */
export const PAD = { left: 48, right: 12, top: 8, bottom: 8 } as const

/** Height of one marker label row, CSS px. */
export const MARKER_ROW = 24

/** Height of one legend row, CSS px. */
export const LEGEND_ROW = 28

/** Legend swatch length, the gap after it, and the space between entries, CSS px. */
export const LEGEND_SWATCH = 24
export const LEGEND_GAP = 8
export const LEGEND_SPACING = 16

/** Gap between the altitude plot and the elevator band, CSS px. */
export const BAND_GAP = 8

/** The elevator band takes this share of the height below the legend, and at least `BAND_MIN` px. */
export const BAND_SHARE = 0.25
export const BAND_MIN = 40

/** Width of a ring bar, CSS px. */
export const RING_BAR_WIDTH = 8

/** Gap kept between two labels on one row, CSS px. */
const LABEL_GAP = 8

/** Course time between samples of the target ahead of the plane, s. */
const TARGET_STEP_T = 0.1

/** Text width estimate per character at the 18 px font, CSS px. */
const CHAR_WIDTH = 0.56 * RECORDER_FONT.marker

export interface MarkerShape {
  readonly x: number
  /** Top and bottom of the vertical line, CSS px. */
  readonly y0: number
  readonly y1: number
  readonly label: string
  /** Left edge and baseline of the label, CSS px. */
  readonly labelX: number
  readonly labelY: number
  readonly row: number
}

export interface RingBar {
  /** Index of the ring in the course. */
  readonly index: number
  /** Center of the bar, CSS px. */
  readonly x: number
  readonly top: number
  readonly bottom: number
  readonly width: number
  readonly state: RingState
}

export type LegendKey = 'target' | 'altitude' | 'elevator'

export interface LegendEntry {
  readonly key: LegendKey
  readonly label: string
  /** Left edge of the label and the middle of its row, CSS px. */
  readonly x: number
  readonly y: number
  /** Ends of the swatch line, CSS px; it sits at `y`. */
  readonly swatchX0: number
  readonly swatchX1: number
  readonly dashed: boolean
}

export interface RecorderGeometry {
  readonly width: number
  readonly height: number
  /** The altitude plot area, CSS px. */
  readonly plot: { readonly left: number; readonly top: number; readonly right: number; readonly bottom: number }
  /** The elevator band: y of u = 1, 0 and -1, CSS px. */
  readonly band: { readonly top: number; readonly mid: number; readonly bottom: number }
  /** Course time at the right edge, s. */
  readonly tEnd: number
  readonly target: readonly Point[]
  readonly altitude: readonly Point[]
  readonly elevator: readonly Point[]
  readonly ringBars: readonly RingBar[]
  readonly markers: readonly MarkerShape[]
  readonly legend: readonly LegendEntry[]
  /** Altitude grid values with their y, CSS px. */
  readonly ticks: readonly { readonly h: number; readonly y: number }[]
}

const LEGEND_LABEL: Record<LegendKey, string> = {
  target: 'Target',
  altitude: 'Altitude',
  elevator: 'Elevator',
}

/** Estimated width of `text` at the 18 px font, CSS px; `measure` overrides it. */
export function labelWidth(text: string, measure?: (text: string) => number): number {
  const w = measure?.(text)
  return typeof w === 'number' && Number.isFinite(w) && w >= 0 ? w : text.length * CHAR_WIDTH
}

/** Lays out the legend entries left to right from `PAD.left`, wrapping past `W - PAD.right`. */
function layoutLegend(
  keys: readonly LegendKey[],
  W: number,
  measure?: (text: string) => number,
): { entries: LegendEntry[]; rows: number } {
  const entries: LegendEntry[] = []
  const right = W - PAD.right
  let x = PAD.left
  let row = 0
  for (const key of keys) {
    const label = LEGEND_LABEL[key]
    const w = LEGEND_SWATCH + LEGEND_GAP + labelWidth(label, measure)
    if (x > PAD.left && x + w > right) {
      row++
      x = PAD.left
    }
    // A single entry wider than the room left of `right` starts further left.
    const x0 = Math.max(0, Math.min(x, W - w))
    entries.push({
      key,
      label,
      x: x0 + LEGEND_SWATCH + LEGEND_GAP,
      y: PAD.top + row * LEGEND_ROW + LEGEND_ROW / 2,
      swatchX0: x0,
      swatchX1: x0 + LEGEND_SWATCH,
      dashed: key === 'target',
    })
    x = x0 + w + LEGEND_SPACING
  }
  return { entries, rows: Math.max(1, row + 1) }
}

/**
 * Everything the recorder draws, for `snapshot` on a canvas `size` CSS px.
 * In the plot, x spans t = 0 to the course end and y spans the safe band.
 * Labels that would overlap move down a row.
 */
export function recorderGeometry(
  snapshot: Snapshot,
  size: SceneSize,
  measure?: (text: string) => number,
): RecorderGeometry {
  const W = size.width
  const H = size.height
  const course = courseFromRings(snapshot.course, snapshot.rings)
  const tEnd = course.endX > 0 ? course.endX / PLANT.speed : 1
  const trace = snapshot.trace.player
  const n = trace?.length ?? 0

  // The target is drawn when it has at least 2 points: from the course rings,
  // or from a trace of 2 rows or more.
  const hasTarget = course.endX > 0 || n >= 2
  const hasTrace = n >= 2
  const keys: LegendKey[] = []
  if (hasTarget) keys.push('target')
  if (hasTrace) keys.push('altitude', 'elevator')
  const { entries: legend } = layoutLegend(keys, W, measure)
  // Reserve the rows the full legend needs, so the plot does not move when
  // the altitude and elevator entries appear.
  const { rows } = layoutLegend(['target', 'altitude', 'elevator'], W, measure)

  // Top to bottom: legend rows, altitude plot, gap, elevator band.
  const legendBottom = PAD.top + rows * LEGEND_ROW
  const below = Math.max(0, H - PAD.bottom - legendBottom)
  const bandHeight = Math.min(below, Math.max(BAND_MIN, BAND_SHARE * below))
  const bandBottom = legendBottom + below
  const bandTop = bandBottom - bandHeight
  const plotTop = legendBottom
  const plotBottom = Math.max(plotTop, bandTop - BAND_GAP)
  const plot = { left: PAD.left, top: plotTop, right: Math.max(PAD.left, W - PAD.right), bottom: plotBottom }
  const band = { top: bandTop, mid: (bandTop + bandBottom) / 2, bottom: bandBottom }

  const X = (t: number): number => plot.left + (t / tEnd) * (plot.right - plot.left)
  const Y = (h: number): number =>
    plot.bottom - ((h - PLANT.hFloor) / (PLANT.hCeil - PLANT.hFloor)) * (plot.bottom - plot.top)
  const U = (u: number): number => {
    const c = Number.isFinite(u) ? Math.min(1, Math.max(-1, u)) : 0
    return band.mid - c * (band.mid - band.top)
  }

  const target: Point[] = []
  const altitude: Point[] = []
  const elevator: Point[] = []
  let tFlown = 0
  if (trace && n > 0) {
    for (let i = 0; i < n; i++) {
      const x = X(trace.t[i])
      target.push({ x, y: Y(trace.ref[i]) })
      altitude.push({ x, y: Y(trace.h[i]) })
      elevator.push({ x, y: U(trace.u[i]) })
    }
    tFlown = trace.t[n - 1]
  }
  // The rest of the reference: from the rings, or flat at the player's
  // setpoint in Semi-auto.
  const player = snapshot.planes.find((p) => p.id === 'player')
  const setpoint = player?.mode === 'semi-auto' ? player.ref : undefined
  const refFor = (x: number): number => setpoint ?? refAt(course, x)
  if (course.endX > 0) {
    const from = n > 0 ? tFlown + TARGET_STEP_T : 0
    for (let t = from; t < tEnd; t += TARGET_STEP_T) target.push({ x: X(t), y: Y(refFor(PLANT.speed * t)) })
    target.push({ x: X(tEnd), y: Y(refFor(course.endX)) })
  }

  const results = player?.results ?? []
  const clip = (y: number): number => Math.min(plot.bottom, Math.max(plot.top, y))
  const ringBars: RingBar[] = snapshot.rings.map((ring, index) => {
    const result = results.find((r) => r.ring === index)
    const state: RingState = !result ? 'pending' : result.pass ? 'pass' : 'miss'
    return {
      index,
      x: X(ring.x / PLANT.speed),
      top: clip(Y(ring.h + PLANT.ringR)),
      bottom: clip(Y(ring.h - PLANT.ringR)),
      width: RING_BAR_WIDTH,
      state,
    }
  })

  const markers: MarkerShape[] = []
  /** Lowest label row whose baseline stays inside the plot; later labels share it. */
  const lastRow = Math.max(0, Math.floor((plot.bottom - plot.top - RECORDER_FONT.marker) / MARKER_ROW))
  /** Right edge of the last label on each row. */
  const rowEnds: number[] = []
  for (const m of snapshot.markers) {
    if (!Number.isFinite(m.t) || m.label === '') continue
    const x = X(Math.min(Math.max(0, m.t), tEnd))
    const w = labelWidth(m.label, measure)
    // Keep the label on the canvas: right of the line, or left of it near the edge.
    const labelX = x + 6 + w <= W ? x + 6 : Math.max(0, x - 6 - w)
    let row = 0
    while (row < lastRow && row < rowEnds.length && labelX < rowEnds[row] + LABEL_GAP) row++
    rowEnds[row] = labelX + w
    markers.push({
      x,
      y0: plot.top,
      y1: band.bottom,
      label: m.label,
      labelX,
      labelY: plot.top + RECORDER_FONT.marker + row * MARKER_ROW,
      row,
    })
  }

  const ticks = [20, 50, 80, 110].map((h) => ({ h, y: Y(h) }))

  return { width: W, height: H, plot, band, tEnd, target, altitude, elevator, ringBars, markers, legend, ticks }
}
