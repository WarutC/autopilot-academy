// Paints the flight scene for one snapshot: the course's scenery as parallax
// layers, then the target, rings, trails, planes, HUD and score badge. Geometry
// comes from `sceneGeometry` and `sceneryFor`; UI colors come from the theme,
// scene colors are fixed.

import type { Snapshot } from '../sim/types.ts'
import type { Theme } from '../ui/theme.ts'
import { FONT, INSET, LINE, PLANE_AT, TARGET_DASH, sceneGeometry, type PlaneShape, type Point, type RingShape, type RingState, type SceneSize } from './scene-geometry.ts'
import {
  CITY,
  CLOUD_PERIOD,
  CLOUD_SIZE_MAX,
  RIDGES,
  SEA_TOP,
  STAR,
  TIMES,
  WAVE,
  WAVE_GAP,
  WAVE_PERIOD,
  layerOffsets,
  periodStarts,
  ridgeHeight,
  sceneryFor,
  terrainColors,
  type Cloud,
  type CityLayer,
  type RidgeLayer,
  type RidgePhases,
  type Scenery,
} from './scenery.ts'

/** Scene colors, the same in both themes because the scene is a picture. */
export const SCENE = {
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

/** What the backdrop needs of the scene: its size, the ground line, and the camera. */
export interface BackdropView {
  readonly width: number
  readonly height: number
  /** Top of the ground band, CSS px. */
  readonly groundY: number
  /** CSS px per meter along the course. */
  readonly sx: number
  /** Course distance at the left edge, m. */
  readonly camX: number
}

/** Cloud blobs: offset and radius in units of the main blob's radius. */
const CLOUD_BLOBS: ReadonlyArray<readonly [dx: number, dy: number, r: number]> = [
  [0, 0, 1],
  [0.9, -0.25, 0.8],
  [-0.9, 0.1, 0.75],
  [1.7, 0.15, 0.6],
  [-1.6, 0.3, 0.5],
  [0.3, 0.35, 0.85],
]
/** How far the blobs reach from the cloud center, in main-blob radii. */
const CLOUD_REACH = 2.3
/** Orb radius, fraction of scene height. */
const ORB_RADIUS = 0.055
/** Side of a star, CSS px. */
const STAR_SIZE = 3
/** Screen px between ridge samples. */
const RIDGE_STEP = 6
/** A wave crest's length, m, and rise, fraction of scene height. */
const WAVE_LENGTH = 6
const WAVE_RISE = 0.014

function drawCloud(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string): void {
  // The outline is twice the line floor, under the fill, so the floor shows outside.
  ctx.lineWidth = LINE.outline * 2
  ctx.strokeStyle = SCENE.outline
  for (const [dx, dy, k] of CLOUD_BLOBS) {
    ctx.beginPath()
    ctx.arc(x + dx * r, y + dy * r, k * r, 0, Math.PI * 2)
    ctx.stroke()
  }
  ctx.fillStyle = color
  for (const [dx, dy, k] of CLOUD_BLOBS) {
    ctx.beginPath()
    ctx.arc(x + dx * r, y + dy * r, k * r, 0, Math.PI * 2)
    ctx.fill()
  }
}

function drawClouds(ctx: CanvasRenderingContext2D, clouds: readonly Cloud[], view: BackdropView, offset: number, color: string): void {
  const { width: W, height: H, sx } = view
  // The outline is drawn `LINE.outline * 2` wide, so it shows `LINE.outline` px past the blobs.
  const reach = (CLOUD_REACH * CLOUD_SIZE_MAX * H + LINE.outline) / sx
  for (const start of periodStarts(offset - reach, offset + W / sx + reach, CLOUD_PERIOD)) {
    for (const cloud of clouds) {
      const r = cloud.size * H
      const x = (start + cloud.x - offset) * sx
      const extent = CLOUD_REACH * r + LINE.outline
      if (x + extent < 0 || x - extent > W) continue
      drawCloud(ctx, x, cloud.y * H, r, color)
    }
  }
}

function drawRidge(
  ctx: CanvasRenderingContext2D,
  layer: RidgeLayer,
  phases: RidgePhases,
  view: BackdropView,
  offset: number,
  fill: string,
  snow: string | undefined,
): void {
  const { width: W, height: H, sx } = view
  const base = layer.base * H
  const amp = layer.amp * H
  const top = layer.flat === undefined ? -Infinity : base - amp * layer.flat
  ctx.beginPath()
  ctx.moveTo(-RIDGE_STEP, H + RIDGE_STEP)
  for (let s = -RIDGE_STEP; s <= W + RIDGE_STEP; s += RIDGE_STEP) {
    ctx.lineTo(s, Math.max(top, base - amp * ridgeHeight(s / sx + offset, phases)))
  }
  ctx.lineTo(W + RIDGE_STEP, H + RIDGE_STEP)
  ctx.closePath()
  ctx.fillStyle = fill
  ctx.fill()
  if (snow !== undefined && layer.snowAt !== undefined) {
    ctx.save()
    ctx.clip()
    ctx.fillStyle = snow
    ctx.fillRect(0, 0, W, base - amp * layer.snowAt)
    ctx.restore()
  }
  ctx.lineWidth = LINE.outline
  ctx.strokeStyle = SCENE.outline
  ctx.stroke()
}

function drawSea(ctx: CanvasRenderingContext2D, waves: Scenery['waves'], view: BackdropView, offset: number, color: string): void {
  const { width: W, height: H, groundY, sx } = view
  const top = SEA_TOP * H
  if (!(groundY > top)) return
  ctx.fillStyle = color
  ctx.fillRect(0, top, W, groundY - top)
  ctx.lineWidth = LINE.outline
  ctx.strokeStyle = SCENE.outline
  ctx.beginPath()
  ctx.moveTo(0, top)
  ctx.lineTo(W, top)
  ctx.stroke()

  ctx.strokeStyle = WAVE
  const rise = WAVE_RISE * H
  const left = offset - WAVE_GAP * 2
  const right = offset + W / sx
  waves.forEach((row, r) => {
    const y = top + (groundY - top) * (0.25 + r * 0.25)
    for (const start of periodStarts(left, right, WAVE_PERIOD)) {
      row.forEach((jitter, i) => {
        const x = (start + i * WAVE_GAP + jitter - offset) * sx
        const w = WAVE_LENGTH * sx
        if (x + w < 0 || x > W) return
        ctx.beginPath()
        ctx.moveTo(x, y)
        ctx.quadraticCurveTo(x + w / 2, y - rise, x + w, y)
        ctx.stroke()
      })
    }
  })
}

function drawCity(ctx: CanvasRenderingContext2D, layer: CityLayer, base: number, view: BackdropView, offset: number, fill: string, window: string): void {
  const { width: W, height: H, sx } = view
  const widest = Math.max(...layer.buildings.map((b) => b.width))
  ctx.lineWidth = LINE.outline
  ctx.strokeStyle = SCENE.outline
  for (const start of periodStarts(offset - widest, offset + W / sx, layer.period)) {
    for (const b of layer.buildings) {
      const x = (start + b.x - offset) * sx
      const w = b.width * sx
      if (x + w < 0 || x > W) continue
      const h = b.height * H
      const y = base - h
      ctx.fillStyle = fill
      ctx.fillRect(x, y, w, H - y)
      ctx.strokeRect(x, y, w, H - y)
      // Windows: a cols × rows grid in the building, each window half its cell.
      const cellW = w / b.cols
      const cellH = (h * 0.9) / b.rows
      ctx.fillStyle = window
      for (let r = 0; r < b.rows; r++) {
        for (let c = 0; c < b.cols; c++) {
          if (!b.lit[r * b.cols + c]) continue
          ctx.fillRect(x + (c + 0.3) * cellW, y + h * 0.06 + (r + 0.2) * cellH, cellW * 0.4, cellH * 0.55)
        }
      }
    }
  }
}

/**
 * Paints the scenery behind the scene: sky, stars at night, the sun or moon,
 * clouds, far and near terrain (or the sea), and the ground. Each layer moves
 * with the camera by its parallax factor; under `reducedMotion` none moves.
 */
export function drawBackdrop(ctx: CanvasRenderingContext2D, scenery: Scenery, view: BackdropView, reducedMotion: boolean): void {
  const { width: W, height: H, groundY } = view
  if (!(W > 0 && H > 0 && view.sx > 0)) return
  const style = TIMES[scenery.time]
  const colors = terrainColors(scenery)
  // Parallax turns about the plane, so the scenery under the plane is the same
  // on every screen width; each helper takes its layer's left-edge offset.
  const anchor = (PLANE_AT * W) / view.sx
  const moved = layerOffsets(view.camX + anchor, reducedMotion)
  const offsets = { clouds: moved.clouds - anchor, far: moved.far - anchor, near: moved.near - anchor }

  ctx.save()
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'

  const sky = ctx.createLinearGradient(0, 0, 0, H)
  for (const [offset, color] of style.sky) sky.addColorStop(offset, color)
  ctx.fillStyle = sky
  ctx.fillRect(0, 0, W, H)

  if (style.stars) {
    ctx.fillStyle = STAR
    for (const star of scenery.stars) ctx.fillRect(Math.round(star.x * W), Math.round(star.y * 0.6 * H), STAR_SIZE, STAR_SIZE)
  }

  ctx.beginPath()
  ctx.arc(W * style.orbX, H * style.orbY, H * ORB_RADIUS, 0, Math.PI * 2)
  ctx.fillStyle = style.orb
  ctx.fill()
  ctx.lineWidth = LINE.outline
  ctx.strokeStyle = SCENE.outline
  ctx.stroke()

  drawClouds(ctx, scenery.clouds, view, offsets.clouds, style.cloud)

  const ridges = RIDGES[scenery.terrain]
  if (ridges.far) drawRidge(ctx, ridges.far, scenery.ridges.far, view, offsets.far, colors.far, colors.snow)
  if (scenery.terrain === 'coast') drawSea(ctx, scenery.waves, view, offsets.near, colors.near)
  else if (ridges.near) drawRidge(ctx, ridges.near, scenery.ridges.near, view, offsets.near, colors.near, undefined)
  if (scenery.terrain === 'city') {
    drawCity(ctx, scenery.city.far, CITY.far.base * H, view, offsets.far, colors.far, style.window)
    drawCity(ctx, scenery.city.near, groundY, view, offsets.near, colors.near, style.window)
  }

  ctx.fillStyle = colors.ground
  ctx.fillRect(0, groundY, W, H - groundY)
  ctx.beginPath()
  ctx.moveTo(0, groundY)
  ctx.lineTo(W, groundY)
  ctx.lineWidth = LINE.outline
  ctx.strokeStyle = SCENE.outline
  ctx.stroke()

  ctx.restore()
}

/** The last course's scenery, so a frame does not rebuild it. */
let memo: Scenery | undefined

function sceneryOf(course: number): Scenery {
  if (memo === undefined || memo.course !== course) memo = sceneryFor(course)
  return memo
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

  drawBackdrop(ctx, sceneryOf(snapshot.course), { width: W, height: H, groundY: g.groundY, sx: g.camera.sx, camX: g.camera.camX }, theme.reducedMotion)

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
