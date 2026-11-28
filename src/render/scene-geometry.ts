// Everything the flight scene draws, worked out from a snapshot and the canvas
// size in CSS pixels. Pure: the renderer only strokes and fills what this returns.

import { courseFromRings, refAt } from '../sim/course.ts'
import { PLANT } from '../sim/plant.ts'
import type { Conditions, PlaneSnapshot, Snapshot, Trace } from '../sim/types.ts'

/** Canvas size in CSS pixels, and the device pixels per CSS pixel. */
export interface SceneSize {
  readonly width: number
  readonly height: number
  readonly dpr: number
}

export interface Point {
  readonly x: number
  readonly y: number
}

export type RingState = 'pending' | 'pass' | 'miss'

export interface RingShape {
  /** Index of the ring in the course. */
  readonly index: number
  readonly x: number
  readonly y: number
  readonly rx: number
  readonly ry: number
  /** Width of the colored band, CSS px; the rim is drawn `LINE.rim` wider. */
  readonly width: number
  readonly state: RingState
  /** Near the plane: the front half is drawn again over it. */
  readonly front: boolean
}

export interface Camera {
  /** CSS px per meter along the course. */
  readonly sx: number
  /** CSS px per meter of altitude. */
  readonly ky: number
  /** Course distance at the left edge, m. */
  readonly camX: number
}

export interface Badge {
  readonly x: number
  readonly y: number
  readonly r: number
}

export interface PlaneShape {
  readonly x: number
  readonly y: number
  readonly angle: number
  /** Width of the sprite, CSS px; its height is `length / PLANE_ASPECT`. */
  readonly length: number
}

export interface SceneGeometry {
  readonly width: number
  readonly height: number
  readonly camera: Camera
  /** Top of the ground band, CSS px. */
  readonly groundY: number
  readonly rings: readonly RingShape[]
  readonly target: readonly Point[]
  readonly trail: readonly Point[]
  readonly plane: PlaneShape
  /** The wingman's plane and trail, only when the snapshot has a wingman. */
  readonly wingman?: { readonly plane: PlaneShape; readonly trail: readonly Point[] }
  /**
   * `wingman` is the wingman's score line, only when the snapshot has a wingman;
   * `conditions` lists the flight conditions, only when they are not calm;
   * the renderer packs them into lines that fit the scene.
   */
  readonly hud: { readonly ring: string; readonly altitude: string; readonly wingman?: string; readonly conditions?: readonly string[] }
  readonly score: string
  readonly badge: Badge
}

/** Stroke widths in CSS px; none is below the 3 px floor. */
export const LINE = {
  target: 3,
  trail: 3,
  outline: 3,
  /** Narrowest colored ring band. */
  ringMin: 4,
  /** How much wider the ring rim is than its band. */
  rim: 3,
} as const

/** Text sizes in CSS px; none is below the 18 px floor. */
export const FONT = {
  hud: 22,
  score: 32,
  scoreLabel: 18,
} as const

/** Side of one mascot sprite pixel, CSS px; the plane sprite scales with the rings instead. */
export const SPRITE_PIXEL = 3

/** The plane sprite's width over its height: 26 by 15 sprite pixels. */
export const PLANE_ASPECT = 26 / 15

/**
 * The plane's height as a share of a ring's outer height. The plane scales
 * with the altitude scale, like the rings, so a phone shows the same plane in
 * the same ring as a desktop does, and what looks like a pass is one.
 */
export const PLANE_TO_RING = 0.8

/** Target line dash pattern, CSS px. */
export const TARGET_DASH: readonly number[] = [10, 7]

/** Inset of the HUD and the badge from the scene edges, CSS px. */
export const INSET = 16

const BADGE_RADIUS = 46
/** Course distance between target line samples, m. */
const TARGET_STEP = 2

/** Where the plane sits, as a fraction of the width from the left. */
export const PLANE_AT = 0.3

/** The player plane, or the plane on the start line when there is none. */
function playerOf(snapshot: Snapshot): PlaneSnapshot | undefined {
  return snapshot.planes.find((p) => p.id === 'player')
}

/** The wingman plane, or undefined when the run has none. */
function wingmanOf(snapshot: Snapshot): PlaneSnapshot | undefined {
  return snapshot.planes.find((p) => p.id === 'wingman')
}

/**
 * The course distance the camera follows: the player while it flies, else the
 * wingman while it flies, else the plane further along (the player on a tie).
 * Both planes fly at one speed, so the further one is the last that stopped.
 */
export function focusX(player: PlaneSnapshot | undefined, wingman: PlaneSnapshot | undefined): number {
  const px = player?.x ?? 0
  if (!wingman || player?.status === 'flying') return px
  if (wingman.status === 'flying') return wingman.x
  return wingman.x > px ? wingman.x : px
}

/** Altitude the scene height spans, m. */
const VIEW_ALTITUDE = 110

/** CSS px per meter of altitude for a scene `height` px tall. */
function altitudeScale(height: number): number {
  return (height * 0.92) / VIEW_ALTITUDE
}

export function camera(width: number, height: number, planeX: number): Camera {
  const sx = width / (width < 600 ? 170 : 230)
  return { sx, ky: altitudeScale(height), camX: planeX - (PLANE_AT * width) / sx }
}

/** Screen y of altitude `h`, CSS px. */
export function altitudeY(height: number, h: number): number {
  return height * 0.97 - h * altitudeScale(height)
}

/** A number without a trailing `.0`, such as `2` or `2.5`. */
function short(value: number): string {
  return String(Math.round(value * 10) / 10)
}

/**
 * The flight conditions as short HUD parts, such as `Gusts 10 m/s²`, or
 * undefined in calm air with a perfect altimeter. The Kalman filter shows
 * only with noise, since it changes nothing without it.
 */
export function conditionsParts(conditions: Readonly<Conditions> | undefined): readonly string[] | undefined {
  if (!conditions) return undefined
  const parts: string[] = []
  if (conditions.gusts > 0) parts.push(`Gusts ${short(conditions.gusts)} m/s²`)
  if (conditions.down > 0) parts.push(`Downdraft ${short(conditions.down)} m/s²`)
  if (conditions.noise > 0) parts.push(`Noise ${short(conditions.noise)} m${conditions.kalman ? ' + Kalman' : ''}`)
  return parts.length > 0 ? parts : undefined
}

export function scoreText(snapshot: Snapshot): string {
  return (playerOf(snapshot)?.points ?? 0).toFixed(1)
}

/** The score as read by screen readers, such as `12.3 points`. */
export function scoreLabel(snapshot: Snapshot): string {
  return `${scoreText(snapshot)} points`
}

export function sceneGeometry(snapshot: Snapshot, size: SceneSize): SceneGeometry {
  const W = size.width
  const H = size.height
  const player = playerOf(snapshot)
  const px = player?.x ?? 0
  const ph = player?.h ?? PLANT.hStart
  const pv = player?.v ?? 0
  const results = player?.results ?? []

  const wingman = wingmanOf(snapshot)

  const cam = camera(W, H, focusX(player, wingman))
  const { sx, ky, camX } = cam
  const X = (x: number): number => (x - camX) * sx
  const Y = (h: number): number => altitudeY(H, h)
  const course = courseFromRings(snapshot.course, snapshot.rings)

  const planeX = X(px)
  const ry = PLANT.ringR * ky
  const length = 2 * ry * PLANE_TO_RING * PLANE_ASPECT
  const planeShape = (x: number, h: number, v: number): PlaneShape => ({
    x: X(x),
    y: Y(h),
    angle: Math.atan2(v * ky, PLANT.speed * sx),
    length,
  })
  const wingmanX = wingman ? X(wingman.x) : undefined

  const rx = ry * 0.32
  const ringWidth = Math.max(LINE.ringMin, ry * 0.2)
  // Cull a ring only once it is fully off screen, however tall the scene.
  const cull = Math.max(40, rx + (ringWidth + LINE.rim) / 2)
  const rings: RingShape[] = []
  snapshot.rings.forEach((ring, index) => {
    const x = X(ring.x)
    if (x < -cull || x > W + cull) return
    const result = results.find((r) => r.ring === index)
    const state: RingState = !result ? 'pending' : result.pass ? 'pass' : 'miss'
    rings.push({ index, x, y: Y(ring.h), rx, ry, width: ringWidth, state, front: Math.abs(x - planeX) <= length || (wingmanX !== undefined && Math.abs(x - wingmanX) <= length) })
  })

  const target: Point[] = []
  const x0 = Math.max(0, camX)
  const x1 = Math.min(course.endX, camX + W / sx)
  // In Semi-auto the target is the player's setpoint, flat across the view.
  const setpoint = player?.mode === 'semi-auto' ? player.ref : undefined
  const targetAt = (x: number): number => setpoint ?? refAt(course, x)
  if (x1 > x0) {
    for (let x = x0; x < x1; x += TARGET_STEP) target.push({ x: X(x), y: Y(targetAt(x)) })
    target.push({ x: X(x1), y: Y(targetAt(x1)) })
  }

  /** A plane's trail: its trace rows from just left of the view, then the plane itself; empty below 2 points. */
  const trailOf = (trace: Trace | undefined, end: Point): Point[] => {
    const trail: Point[] = []
    if (trace && trace.length > 0) {
      const from = camX - 5
      let first = trace.length
      while (first > 0 && PLANT.speed * trace.t[first - 1] >= from) first--
      for (let i = first; i < trace.length; i++) trail.push({ x: X(PLANT.speed * trace.t[i]), y: Y(trace.h[i]) })
      trail.push(end)
    }
    return trail.length >= 2 ? trail : []
  }
  const trail = trailOf(snapshot.trace.player, { x: planeX, y: Y(ph) })

  const nRings = snapshot.rings.length || PLANT.nRings
  const ref = player?.ref ?? refAt(course, px)
  const r = Math.min(BADGE_RADIUS, Math.max(0, Math.min(W, H) / 2 - INSET))

  const wingmanShape = wingman ? planeShape(wingman.x, wingman.h, wingman.v) : undefined
  const conditions = conditionsParts(snapshot.conditions)

  return {
    width: W,
    height: H,
    camera: cam,
    groundY: Y(1.5),
    rings,
    target,
    trail,
    plane: planeShape(px, ph, pv),
    ...(wingman && wingmanShape
      ? { wingman: { plane: wingmanShape, trail: trailOf(snapshot.trace.wingman, { x: wingmanShape.x, y: wingmanShape.y }) } }
      : {}),
    hud: {
      ring: `Ring ${Math.min(results.length + 1, nRings)} / ${nRings}`,
      altitude: `Altitude ${ph.toFixed(0)} m, target ${ref.toFixed(0)} m`,
      ...(wingman ? { wingman: `Wingman ${wingman.points.toFixed(1)}` } : {}),
      ...(conditions ? { conditions } : {}),
    },
    score: scoreText(snapshot),
    badge: { x: W - INSET - r, y: H - INSET - r, r },
  }
}
