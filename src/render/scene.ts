// Paints the flight scene for one snapshot. Geometry comes from
// `sceneGeometry`; UI colors come from the theme, scene colors are fixed.

import type { Snapshot } from '../sim/types.ts'
import type { Theme } from '../ui/theme.ts'
import { FONT, INSET, LINE, TARGET_DASH, sceneGeometry, type PlaneShape, type Point, type RingShape, type RingState, type SceneSize } from './scene-geometry.ts'

/** Scene colors, the same in both themes because the scene is a picture. */
export const SCENE = {
  sky: [
    [0, '#2B7FC4'],
    [0.55, '#7EC3EC'],
    [0.85, '#CBEAF7'],
  ] as ReadonlyArray<readonly [offset: number, color: string]>,
  ground: '#58B43C',
  outline: '#1A2A3A',
  target: '#FFFFFF',
  ringGold: '#F2B705',
  ringHit: '#2FBF5F',
  ringMiss: '#E0353C',
  ringRim: '#4A3500',
  planeRed: '#D7262E',
  planeRedShade: '#9E141B',
  hudText: '#FFFFFF',
  hudShadow: 'rgba(0, 0, 0, 0.75)',
  badge: 'rgba(255, 255, 255, 0.55)',
  /** Text on the badge; fixed because the badge background is. */
  badgeInk: '#13294B',
} as const

const RING_COLOR: Record<RingState, string> = {
  pending: SCENE.ringGold,
  pass: SCENE.ringHit,
  miss: SCENE.ringMiss,
}

function drawRing(ctx: CanvasRenderingContext2D, ring: RingShape, half: boolean): void {
  ctx.beginPath()
  if (half) ctx.ellipse(ring.x, ring.y, ring.rx, ring.ry, 0, Math.PI / 2, Math.PI * 1.5)
  else ctx.ellipse(ring.x, ring.y, ring.rx, ring.ry, 0, 0, Math.PI * 2)
  ctx.lineWidth = ring.width + LINE.rim
  ctx.strokeStyle = SCENE.ringRim
  ctx.stroke()
  ctx.lineWidth = ring.width
  ctx.strokeStyle = RING_COLOR[ring.state]
  ctx.stroke()
}

/** A plain plane, nose to +x, drawn in a 100-unit box scaled to `length`, with `fill` for the body and `shade` for the wing. */
function drawPlane(
  ctx: CanvasRenderingContext2D,
  plane: PlaneShape,
  fill: string,
  shade: string,
): void {
  const { x, y, angle, length } = plane
  const s = length / 100
  ctx.save()
  ctx.translate(x, y)
  ctx.rotate(-angle)
  ctx.scale(s, s)
  ctx.lineJoin = 'round'
  ctx.lineWidth = LINE.outline / s
  ctx.strokeStyle = SCENE.outline

  // Tail fin.
  ctx.fillStyle = fill
  ctx.beginPath()
  ctx.moveTo(-32, -4)
  ctx.lineTo(-50, -25)
  ctx.lineTo(-40, -26)
  ctx.lineTo(-24, -6)
  ctx.closePath()
  ctx.fill()
  ctx.stroke()

  // Body.
  ctx.beginPath()
  ctx.moveTo(40, -8)
  ctx.quadraticCurveTo(10, -14, -20, -6)
  ctx.lineTo(-46, -3)
  ctx.lineTo(-46, 3)
  ctx.lineTo(-20, 8)
  ctx.quadraticCurveTo(10, 12, 40, 8)
  ctx.closePath()
  ctx.fill()
  ctx.stroke()

  // Wing.
  ctx.fillStyle = shade
  ctx.beginPath()
  ctx.roundRect(-10, -2, 34, 8, 3)
  ctx.fill()
  ctx.stroke()

  ctx.restore()
}

function drawTrail(ctx: CanvasRenderingContext2D, trail: readonly Point[], color: string): void {
  if (trail.length < 2) return
  ctx.lineWidth = LINE.trail
  ctx.strokeStyle = color
  ctx.beginPath()
  trail.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)))
  ctx.stroke()
}

function drawHud(ctx: CanvasRenderingContext2D, lines: readonly string[], theme: Theme): void {
  ctx.save()
  ctx.font = `700 ${FONT.hud}px ${theme.fontCondensed}`
  ctx.textAlign = 'left'
  ctx.textBaseline = 'top'
  ctx.fillStyle = SCENE.hudText
  ctx.shadowColor = SCENE.hudShadow
  ctx.shadowBlur = 4
  ctx.shadowOffsetX = 1
  ctx.shadowOffsetY = 2
  lines.forEach((line, i) => ctx.fillText(line, INSET, INSET + i * FONT.hud * 1.25))
  ctx.restore()
}

/** Paints `snapshot` into `ctx`, whose backing store is `size` CSS px at `size.dpr`. Never writes to the snapshot. */
export function draw(ctx: CanvasRenderingContext2D, snapshot: Snapshot, theme: Theme, size: SceneSize): void {
  const { width: W, height: H } = size
  if (!(W > 0 && H > 0)) return
  const dpr = size.dpr > 0 ? size.dpr : 1
  const g = sceneGeometry(snapshot, size)

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.setLineDash([])
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'

  const sky = ctx.createLinearGradient(0, 0, 0, H)
  for (const [offset, color] of SCENE.sky) sky.addColorStop(offset, color)
  ctx.fillStyle = sky
  ctx.fillRect(0, 0, W, H)

  ctx.fillStyle = SCENE.ground
  ctx.fillRect(0, g.groundY, W, H - g.groundY)
  ctx.beginPath()
  ctx.moveTo(0, g.groundY)
  ctx.lineTo(W, g.groundY)
  ctx.lineWidth = LINE.outline
  ctx.strokeStyle = SCENE.outline
  ctx.stroke()

  if (g.target.length >= 2) {
    ctx.save()
    ctx.setLineDash(TARGET_DASH as number[])
    ctx.lineCap = 'butt'
    ctx.lineWidth = LINE.target
    ctx.strokeStyle = SCENE.target
    ctx.beginPath()
    g.target.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)))
    ctx.stroke()
    ctx.restore()
  }

  for (const ring of g.rings) drawRing(ctx, ring, false)

  // The wingman's trail and plane go first, so the player's draw over them.
  if (g.wingman) drawTrail(ctx, g.wingman.trail, theme.ghost)
  drawTrail(ctx, g.trail, theme.accent)

  if (g.wingman) drawPlane(ctx, g.wingman.plane, theme.ghost, theme.ghost)
  drawPlane(ctx, g.plane, SCENE.planeRed, SCENE.planeRedShade)

  for (const ring of g.rings) if (ring.front) drawRing(ctx, ring, true)

  drawHud(ctx, g.hud.wingman === undefined ? [g.hud.ring, g.hud.altitude] : [g.hud.ring, g.hud.altitude, g.hud.wingman], theme)

  const { badge } = g
  if (badge.r > 0) {
    ctx.beginPath()
    ctx.arc(badge.x, badge.y, badge.r, 0, Math.PI * 2)
    ctx.fillStyle = SCENE.badge
    ctx.fill()
    ctx.fillStyle = SCENE.badgeInk
    ctx.textAlign = 'center'
    ctx.textBaseline = 'alphabetic'
    ctx.font = `700 ${FONT.score}px ${theme.fontCondensed}`
    ctx.fillText(g.score, badge.x, badge.y + FONT.score * 0.3)
    ctx.font = `500 ${FONT.scoreLabel}px ${theme.fontBody}`
    ctx.fillText('points', badge.x, badge.y + FONT.score * 0.3 + FONT.scoreLabel + 2)
  }
}
