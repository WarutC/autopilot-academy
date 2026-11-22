// The flight recorder plot: the target (dashed), the altitude flown, and a
// labeled vertical marker for every parameter change. `recorderGeometry` is
// pure; `draw` only strokes and fills what it returns.

import { END_PAST_LAST_RING, refAt, ringBounds, type Course } from '../sim/course.ts'
import { PLANT } from '../sim/plant.ts'
import type { Ring, Snapshot } from '../sim/types.ts'
import type { Theme } from '../ui/theme.ts'
import { TARGET_DASH, type Point, type SceneSize } from './scene-geometry.ts'

/** Stroke widths in CSS px. Plot lines hold the 3 px floor; the grid is a hairline. */
export const RECORDER_LINE = {
  target: 3,
  altitude: 3,
  marker: 3,
  axis: 1,
} as const

/** Text sizes in CSS px; none is below the 18 px floor. */
export const RECORDER_FONT = {
  marker: 18,
  axis: 18,
} as const

/** Space around the plot for the axis labels, CSS px. */
export const PAD = { left: 48, right: 12, top: 8, bottom: 8 } as const

/** Height of one marker label row, CSS px. */
export const MARKER_ROW = 24

/** Gap kept between two labels on one row, CSS px. */
const LABEL_GAP = 8

/** Course time between samples of the target ahead of the plane, s. */
const TARGET_STEP_T = 0.1

/** Text width estimate per character at the marker font, CSS px. */
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

export interface RecorderGeometry {
  readonly width: number
  readonly height: number
  /** The plot area, CSS px. */
  readonly plot: { readonly left: number; readonly top: number; readonly right: number; readonly bottom: number }
  /** Course time at the right edge, s. */
  readonly tEnd: number
  readonly target: readonly Point[]
  readonly altitude: readonly Point[]
  readonly markers: readonly MarkerShape[]
  /** Altitude grid values with their y, CSS px. */
  readonly ticks: readonly { readonly h: number; readonly y: number }[]
}

function courseOf(snapshot: Snapshot): Course {
  const rings: readonly Ring[] = snapshot.rings
  const endX = rings.length > 0 ? rings[rings.length - 1].x + END_PAST_LAST_RING : 0
  return { number: snapshot.course, rings, bounds: ringBounds(rings), endX }
}

/** Estimated width of `text` at the marker font, CSS px; `measure` overrides it. */
export function labelWidth(text: string, measure?: (text: string) => number): number {
  const w = measure?.(text)
  return typeof w === 'number' && Number.isFinite(w) && w >= 0 ? w : text.length * CHAR_WIDTH
}

/**
 * Everything the recorder draws, for `snapshot` on a canvas `size` CSS px.
 * x spans t = 0 to the course end; y spans the safe band. Labels that would
 * overlap move down a row.
 */
export function recorderGeometry(
  snapshot: Snapshot,
  size: SceneSize,
  measure?: (text: string) => number,
): RecorderGeometry {
  const W = size.width
  const H = size.height
  const course = courseOf(snapshot)
  const tEnd = course.endX > 0 ? course.endX / PLANT.speed : 1
  const plot = { left: PAD.left, top: PAD.top, right: Math.max(PAD.left, W - PAD.right), bottom: Math.max(PAD.top, H - PAD.bottom) }
  const X = (t: number): number => plot.left + (t / tEnd) * (plot.right - plot.left)
  const Y = (h: number): number =>
    plot.bottom - ((h - PLANT.hFloor) / (PLANT.hCeil - PLANT.hFloor)) * (plot.bottom - plot.top)

  const trace = snapshot.trace.player
  const n = trace?.length ?? 0

  const target: Point[] = []
  const altitude: Point[] = []
  let tFlown = 0
  if (trace && n > 0) {
    for (let i = 0; i < n; i++) {
      target.push({ x: X(trace.t[i]), y: Y(trace.ref[i]) })
      altitude.push({ x: X(trace.t[i]), y: Y(trace.h[i]) })
    }
    tFlown = trace.t[n - 1]
  }
  // The rest of the course reference, from the rings.
  if (course.endX > 0) {
    const from = n > 0 ? tFlown + TARGET_STEP_T : 0
    for (let t = from; t < tEnd; t += TARGET_STEP_T) target.push({ x: X(t), y: Y(refAt(course, PLANT.speed * t)) })
    target.push({ x: X(tEnd), y: Y(refAt(course, course.endX)) })
  }

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
      y1: plot.bottom,
      label: m.label,
      labelX,
      labelY: plot.top + RECORDER_FONT.marker + row * MARKER_ROW,
      row,
    })
  }

  const ticks = [20, 50, 80, 110].map((h) => ({ h, y: Y(h) }))

  return { width: W, height: H, plot, tEnd, target, altitude, markers, ticks }
}

function polyline(ctx: CanvasRenderingContext2D, points: readonly Point[]): void {
  ctx.beginPath()
  points.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)))
  ctx.stroke()
}

/** Paints the recorder for `snapshot` into `ctx`, whose backing store is `size` CSS px at `size.dpr`. Never writes to the snapshot. */
export function draw(ctx: CanvasRenderingContext2D, snapshot: Snapshot, theme: Theme, size: SceneSize): void {
  const { width: W, height: H } = size
  if (!(W > 0 && H > 0)) return
  const dpr = size.dpr > 0 ? size.dpr : 1
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.font = `500 ${RECORDER_FONT.marker}px ${theme.fontBody}`
  const g = recorderGeometry(snapshot, size, (text) => ctx.measureText(text).width)

  ctx.clearRect(0, 0, W, H)
  ctx.fillStyle = theme.panel
  ctx.fillRect(0, 0, W, H)
  ctx.setLineDash([])
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'

  // Altitude grid and labels.
  ctx.lineWidth = RECORDER_LINE.axis
  ctx.strokeStyle = theme.line
  ctx.fillStyle = theme.muted
  ctx.font = `500 ${RECORDER_FONT.axis}px ${theme.fontBody}`
  ctx.textAlign = 'right'
  ctx.textBaseline = 'middle'
  for (const tick of g.ticks) {
    ctx.beginPath()
    ctx.moveTo(g.plot.left, tick.y)
    ctx.lineTo(g.plot.right, tick.y)
    ctx.stroke()
    ctx.fillText(String(tick.h), g.plot.left - 8, Math.max(RECORDER_FONT.axis / 2, tick.y))
  }

  if (g.target.length >= 2) {
    ctx.save()
    ctx.setLineDash(TARGET_DASH as number[])
    ctx.lineCap = 'butt'
    ctx.lineWidth = RECORDER_LINE.target
    ctx.strokeStyle = theme.refline
    polyline(ctx, g.target)
    ctx.restore()
  }

  if (g.altitude.length >= 2) {
    ctx.lineWidth = RECORDER_LINE.altitude
    ctx.strokeStyle = theme.accent
    polyline(ctx, g.altitude)
  }

  ctx.font = `500 ${RECORDER_FONT.marker}px ${theme.fontBody}`
  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'
  for (const m of g.markers) {
    ctx.lineWidth = RECORDER_LINE.marker
    ctx.strokeStyle = theme.ink
    ctx.beginPath()
    ctx.moveTo(m.x, m.y0)
    ctx.lineTo(m.x, m.y1)
    ctx.stroke()
    // A panel-colored halo keeps the label readable over the lines.
    ctx.lineWidth = 4
    ctx.strokeStyle = theme.panel
    ctx.strokeText(m.label, m.labelX, m.labelY)
    ctx.fillStyle = theme.ink
    ctx.fillText(m.label, m.labelX, m.labelY)
  }
}
