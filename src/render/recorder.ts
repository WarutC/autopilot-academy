// Paints the flight recorder: a legend, the target (dashed), the altitude
// flown (and the wingman's, under it), ring bars colored by result, the elevator command in a lower band,
// and a labeled vertical marker for every parameter change. Geometry comes
// from `recorderGeometry`; this only strokes and fills what it returns.

import type { Snapshot } from '../sim/types.ts'
import type { Theme } from '../ui/theme.ts'
import { RECORDER_FONT, RECORDER_LINE, recorderGeometry, type LegendKey, type RingBar } from './recorder-geometry.ts'
import { SCENE } from './scene.ts'
import { TARGET_DASH, type Point, type RingState, type SceneSize } from './scene-geometry.ts'

const RING_BAR_COLOR: Record<RingState, string> = {
  pending: SCENE.ringGold,
  pass: SCENE.ringHit,
  miss: SCENE.ringMiss,
}

function polyline(ctx: CanvasRenderingContext2D, points: readonly Point[]): void {
  ctx.beginPath()
  points.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)))
  ctx.stroke()
}

function hline(ctx: CanvasRenderingContext2D, x0: number, x1: number, y: number): void {
  ctx.beginPath()
  ctx.moveTo(x0, y)
  ctx.lineTo(x1, y)
  ctx.stroke()
}

/** A passed or pending ring is a filled bar; a missed ring is a hollow outline. */
function drawRingBar(ctx: CanvasRenderingContext2D, bar: RingBar): void {
  const color = RING_BAR_COLOR[bar.state]
  const left = bar.x - bar.width / 2
  const height = bar.bottom - bar.top
  if (bar.state === 'miss') {
    // Inset by half the stroke so the outline keeps the bar's outer size.
    const inset = RECORDER_LINE.ringMiss / 2
    ctx.lineWidth = RECORDER_LINE.ringMiss
    ctx.strokeStyle = color
    ctx.strokeRect(left + inset, bar.top + inset, Math.max(0, bar.width - 2 * inset), Math.max(0, height - 2 * inset))
  } else {
    ctx.fillStyle = color
    ctx.fillRect(left, bar.top, bar.width, height)
  }
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

  // Altitude grid, the elevator band grid, and their labels.
  ctx.lineWidth = RECORDER_LINE.axis
  ctx.strokeStyle = theme.line
  ctx.fillStyle = theme.muted
  ctx.font = `500 ${RECORDER_FONT.axis}px ${theme.fontBody}`
  ctx.textAlign = 'right'
  ctx.textBaseline = 'middle'
  for (const tick of g.ticks) {
    hline(ctx, g.plot.left, g.plot.right, tick.y)
    ctx.fillText(String(tick.h), g.plot.left - 8, Math.max(RECORDER_FONT.axis / 2, tick.y))
  }
  for (const y of [g.band.top, g.band.mid, g.band.bottom]) hline(ctx, g.plot.left, g.plot.right, y)
  ctx.fillText('u', g.plot.left - 8, g.band.mid)

  for (const bar of g.ringBars) drawRingBar(ctx, bar)

  if (g.target.length >= 2) {
    ctx.save()
    ctx.setLineDash(TARGET_DASH as number[])
    ctx.lineCap = 'butt'
    ctx.lineWidth = RECORDER_LINE.target
    ctx.strokeStyle = theme.refline
    polyline(ctx, g.target)
    ctx.restore()
  }

  // The wingman's line goes under the player's altitude line.
  if (g.wingman.length >= 2) {
    ctx.lineWidth = RECORDER_LINE.altitude
    ctx.strokeStyle = theme.ghost
    polyline(ctx, g.wingman)
  }

  if (g.altitude.length >= 2) {
    ctx.lineWidth = RECORDER_LINE.altitude
    ctx.strokeStyle = theme.accent
    polyline(ctx, g.altitude)
  }

  if (g.elevator.length >= 2) {
    ctx.lineWidth = RECORDER_LINE.elevator
    ctx.strokeStyle = theme.muted
    polyline(ctx, g.elevator)
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

  // Legend: a swatch line in each line's own color and style, then its label.
  const swatchColor: Record<LegendKey, string> = {
    target: theme.refline,
    altitude: theme.accent,
    wingman: theme.ghost,
    elevator: theme.muted,
  }
  ctx.font = `500 ${RECORDER_FONT.legend}px ${theme.fontBody}`
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  for (const entry of g.legend) {
    ctx.save()
    if (entry.dashed) {
      ctx.setLineDash(TARGET_DASH as number[])
      ctx.lineCap = 'butt'
    }
    ctx.lineWidth = RECORDER_LINE.swatch
    ctx.strokeStyle = swatchColor[entry.key]
    hline(ctx, entry.swatchX0, entry.swatchX1, entry.y)
    ctx.restore()
    ctx.fillStyle = theme.ink
    ctx.fillText(entry.label, entry.x, entry.y)
  }
}
