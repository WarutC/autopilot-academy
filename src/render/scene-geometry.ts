// Everything the flight scene draws, worked out from a snapshot and the canvas
// size in CSS pixels. Pure: the renderer only strokes and fills what this returns.

import { END_PAST_LAST_RING, refAt, ringBounds, type Course } from '../sim/course.ts'
import { PLANT } from '../sim/plant.ts'
import type { PlaneSnapshot, Ring, Snapshot } from '../sim/types.ts'

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

export interface SceneGeometry {
  readonly width: number
  readonly height: number
  readonly camera: Camera
  /** Top of the ground band, CSS px. */
  readonly groundY: number
  readonly rings: readonly RingShape[]
  readonly target: readonly Point[]
  readonly trail: readonly Point[]
  readonly plane: { readonly x: number; readonly y: number; readonly angle: number; readonly length: number }
  readonly hud: { readonly ring: string; readonly altitude: string }
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

function courseOf(snapshot: Snapshot): Course {
  const rings: readonly Ring[] = snapshot.rings
  const endX = rings.length > 0 ? rings[rings.length - 1].x + END_PAST_LAST_RING : 0
  return { number: snapshot.course, rings, bounds: ringBounds(rings), endX }
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

  const cam = camera(W, H, px)
  const { sx, ky, camX } = cam
  const X = (x: number): number => (x - camX) * sx
  const Y = (h: number): number => altitudeY(H, h)
  const course = courseOf(snapshot)

  const planeX = X(px)
  const length = Math.max(46, H * 0.13)

  const ry = PLANT.ringR * ky
  const rx = ry * 0.32
  const ringWidth = Math.max(LINE.ringMin, ry * 0.2)
  const rings: RingShape[] = []
  snapshot.rings.forEach((ring, index) => {
    const x = X(ring.x)
    if (x < -40 || x > W + 40) return
    const result = results.find((r) => r.ring === index)
    const state: RingState = !result ? 'pending' : result.pass ? 'pass' : 'miss'
    rings.push({ index, x, y: Y(ring.h), rx, ry, width: ringWidth, state, front: Math.abs(x - planeX) <= length })
  })

  const target: Point[] = []
  const x0 = Math.max(0, camX)
  const x1 = Math.min(course.endX, camX + W / sx)
  if (x1 > x0) {
    for (let x = x0; x < x1; x += TARGET_STEP) target.push({ x: X(x), y: Y(refAt(course, x)) })
    target.push({ x: X(x1), y: Y(refAt(course, x1)) })
  }

  const trail: Point[] = []
  const trace = snapshot.trace.player
  if (trace && trace.length > 0) {
    const from = camX - 5
    let first = trace.length
    while (first > 0 && PLANT.speed * trace.t[first - 1] >= from) first--
    for (let i = first; i < trace.length; i++) trail.push({ x: X(PLANT.speed * trace.t[i]), y: Y(trace.h[i]) })
    trail.push({ x: planeX, y: Y(ph) })
  }

  const nRings = snapshot.rings.length || PLANT.nRings
  const ref = player?.ref ?? refAt(course, px)
  const r = Math.min(BADGE_RADIUS, Math.max(0, Math.min(W, H) / 2 - INSET))

  return {
    width: W,
    height: H,
    camera: cam,
    groundY: Y(1.5),
    rings,
    target,
    trail: trail.length >= 2 ? trail : [],
    plane: { x: planeX, y: Y(ph), angle: Math.atan2(pv * ky, PLANT.speed * sx), length },
    hud: {
      ring: `Ring ${Math.min(results.length + 1, nRings)} / ${nRings}`,
      altitude: `Altitude ${ph.toFixed(0)} m, target ${ref.toFixed(0)} m`,
    },
    score: scoreText(snapshot),
    badge: { x: W - INSET - r, y: H - INSET - r, r },
  }
}
