// Paints the s-plane for the Pole readout: the right (unstable) half shaded,
// the real and imaginary axes, and an Accent cross for every closed-loop pole.
// It reads only `AlgorithmAnalysis.poles`, so every module that reports poles
// gets the same plot.

import type { AlgorithmAnalysis, Complex } from '../algorithms/index.ts'
import type { Theme } from '../ui/theme.ts'
import type { Point, SceneSize } from './scene-geometry.ts'

/** Line widths, CSS px. */
export const SPLANE_LINE = {
  axis: 3,
  cross: 3,
} as const

/** Font sizes, CSS px. */
export const SPLANE_FONT = {
  axis: 18,
} as const

/** Half the width of a pole cross, CSS px. */
export const CROSS_ARM = 7
/** Opacity of the shaded right half. */
const UNSTABLE_ALPHA = 0.12
/** The smallest extent the plot shows from the origin, 1/s. */
const MIN_EXTENT = 3
/** Room around the outermost pole, as a factor of its distance. */
const MARGIN = 1.25

export interface SplaneGeometry {
  /** Where s = 0 sits: 62 % across, half way down. */
  readonly origin: Point
  /** CSS px per 1/s, the same on both axes. */
  readonly scale: number
  /** Each pole's position, in the order given. */
  readonly crosses: readonly Point[]
}

/**
 * Lays out `poles` on a `size` canvas. The origin sits at 62 % of the width and
 * half the height. The scale fits an extent of max(3, 1.25·max|re|,
 * 1.25·max|im|) into the half height and into the room on the side the poles
 * lie (the 62 % to the left, or the 38 % to the right when any pole is
 * unstable). Non-finite poles are skipped.
 */
export function splaneGeometry(poles: readonly Complex[], size: SceneSize): SplaneGeometry {
  const W = Math.max(0, size.width)
  const H = Math.max(0, size.height)
  const origin = { x: 0.62 * W, y: H / 2 }
  const finite = poles.filter((p) => Number.isFinite(p.re) && Number.isFinite(p.im))
  let extent = MIN_EXTENT
  for (const p of finite) extent = Math.max(extent, MARGIN * Math.abs(p.re), MARGIN * Math.abs(p.im))
  const anyUnstable = finite.some((p) => p.re > 0)
  const room = Math.min(H / 2, anyUnstable ? 0.38 * W : 0.62 * W)
  const scale = room / extent
  const crosses = finite.map((p) => ({ x: origin.x + p.re * scale, y: origin.y - p.im * scale }))
  return { origin, scale, crosses }
}

function line(ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number): void {
  ctx.beginPath()
  ctx.moveTo(x0, y0)
  ctx.lineTo(x1, y1)
  ctx.stroke()
}

/**
 * Paints the s-plane for `analysis.poles` into `ctx`, whose backing store is
 * `size` CSS px at `size.dpr`. Paints nothing at size 0 or without poles.
 * Never writes to `analysis`.
 */
export function draw(ctx: CanvasRenderingContext2D, analysis: AlgorithmAnalysis, theme: Theme, size: SceneSize): void {
  const { width: W, height: H } = size
  const poles = analysis.poles
  if (!(W > 0 && H > 0) || !poles || poles.length === 0) return
  const dpr = size.dpr > 0 ? size.dpr : 1
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  const g = splaneGeometry(poles, size)

  ctx.clearRect(0, 0, W, H)
  ctx.globalAlpha = 1
  ctx.fillStyle = theme.field
  ctx.fillRect(0, 0, W, H)
  ctx.globalAlpha = UNSTABLE_ALPHA
  ctx.fillStyle = theme.accent
  ctx.fillRect(g.origin.x, 0, W - g.origin.x, H)
  ctx.globalAlpha = 1

  ctx.setLineDash([])
  ctx.lineCap = 'round'
  ctx.lineWidth = SPLANE_LINE.axis
  ctx.strokeStyle = theme.muted
  line(ctx, 0, g.origin.y, W, g.origin.y)
  line(ctx, g.origin.x, 0, g.origin.x, H)

  ctx.fillStyle = theme.muted
  ctx.font = `500 ${SPLANE_FONT.axis}px ${theme.fontBody}`
  ctx.textAlign = 'right'
  ctx.textBaseline = 'bottom'
  ctx.fillText('Re', W - 4, g.origin.y - 4)
  ctx.textAlign = 'left'
  ctx.textBaseline = 'top'
  ctx.fillText('Im', g.origin.x + 6, 4)

  ctx.lineWidth = SPLANE_LINE.cross
  ctx.strokeStyle = theme.accent
  for (const c of g.crosses) {
    line(ctx, c.x - CROSS_ARM, c.y - CROSS_ARM, c.x + CROSS_ARM, c.y + CROSS_ARM)
    line(ctx, c.x - CROSS_ARM, c.y + CROSS_ARM, c.x + CROSS_ARM, c.y - CROSS_ARM)
  }
}
