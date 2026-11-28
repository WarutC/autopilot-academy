// 8-bit pixel sprites: grids of palette keys painted as whole CSS-px squares.
// The plane has five pitch frames made by shearing its pixel columns, so it is
// never rotated or smoothly scaled. Pure data and `fillRect` calls only: no
// offscreen canvas, so the painter runs against any recording context.

import type { PlaneShape } from './scene-geometry.ts'

/** Equal-length rows of palette keys; `.` is transparent. */
export type SpriteGrid = readonly string[]

/** Colors by palette key. */
export type Palette = Readonly<Record<string, string>>

/** Transparent pixel. */
const CLEAR = '.'

/** Width of every plane frame, in sprite pixels. */
export const PLANE_WIDTH = 26
/** Transparent rows above and below the plane, so the shear stays in the frame. */
export const PLANE_PAD = 6
/** The column the shear turns about. */
const SHEAR_COLUMN = 13

/**
 * The level plane, nose to the right. Keys: K outline, R body, D shade,
 * W stripe, B canopy, P pilot, Y hub, G propeller blade.
 */
export const PLANE_ROWS: SpriteGrid = [
  '......KKKKKKKKKKKK',
  '......KRRRRRRRRRRK',
  '......KKKKKKKKKKKK',
  'KK.......K..KK..K',
  'KRK......K.KPPKKK.....K',
  'KRRK.....K.KPPKBK.....KG',
  'KRRRKKKKKKKKKKKKKKKKKKKYK',
  'KRRRRRRRRRRRRRRRRRRRRRKYYK',
  'KDDWWWWWWWWWWWWWWWWWWRKYK',
  'KKKKRRRRRRRRRRRRRRRRRRKG',
  '...KKDDDDDDDDDDDDDKKKK..G',
  '.....KKKKKKKKKKKKK',
  '..........K...K',
  '.........KKK.KKK',
  '..........K...K',
].map((row) => row.padEnd(PLANE_WIDTH, CLEAR))

/** Colors both planes share: outline, stripe, canopy, pilot, hub and blade. */
const PLANE_COMMON: Palette = {
  K: '#1A2A3A',
  W: '#FFFFFF',
  B: '#8FD3FF',
  P: '#5A3A28',
  Y: '#F5B700',
  G: '#6B6B6B',
}

/** The player's plane: red body, darker red shade. */
export const PLAYER_PALETTE: Palette = { ...PLANE_COMMON, R: '#D7262E', D: '#9E141B' }

/** The wingman's plane: blue body, darker blue shade. */
export const WINGMAN_PALETTE: Palette = { ...PLANE_COMMON, R: '#3D74FF', D: '#2049B8' }

/** Propeller blade key, painted only on alternate propeller states. */
const BLADE = 'G'

/** Shear slope of each frame: steep dive, dive, level, climb, steep climb. */
export const PITCH_SLOPES: readonly number[] = [-0.4, -0.2, 0, 0.2, 0.4]

/** Index of the level frame. */
const LEVEL = 2
/** Screen radians per frame step. */
const FRAME_STEP = 0.22
/** Propeller states per second. */
const PROPELLER_RATE = 24

/** Rows a pixel in `column` moves at `slope`; climbing lifts the nose. Symmetric in the sign of the slope. */
export function shearRows(column: number, slope: number): number {
  const d = (column - SHEAR_COLUMN) * slope
  return d === 0 ? 0 : -Math.sign(d) * Math.round(Math.abs(d))
}

/** `grid` with each column moved by its shear at `slope`, padded `PLANE_PAD` rows top and bottom. */
function shear(grid: SpriteGrid, slope: number): SpriteGrid {
  const width = grid[0]?.length ?? 0
  const rows: string[][] = Array.from({ length: grid.length + PLANE_PAD * 2 }, () => Array<string>(width).fill(CLEAR))
  grid.forEach((row, y) => {
    for (let x = 0; x < width; x++) {
      const key = row[x]!
      if (key === CLEAR) continue
      rows[y + PLANE_PAD + shearRows(x, slope)]![x] = key
    }
  })
  return rows.map((r) => r.join(''))
}

/** The plane's five pitch frames, index 0..4 = steep dive .. steep climb. */
export const PLANE_FRAMES: readonly SpriteGrid[] = PITCH_SLOPES.map((slope) => shear(PLANE_ROWS, slope))

/** The frame for a screen pitch `angle` in radians, climb positive; level for NaN. */
export function frameFor(angle: number): number {
  if (Number.isNaN(angle)) return LEVEL
  const steps = Math.min(2, Math.floor(Math.abs(angle) / FRAME_STEP + 0.5))
  return LEVEL + Math.sign(angle) * steps
}

/** Whether the propeller blade shows at time `t`, s; always under reduced motion. */
export function propellerOn(t: number, reducedMotion: boolean): boolean {
  if (reducedMotion || !Number.isFinite(t)) return true
  return Math.floor(t * PROPELLER_RATE) % 2 === 0
}

/** Smallest side of one plane sprite pixel, CSS px: on a phone the plane shrinks with the rings. */
export const PLANE_PIXEL_MIN = 1.5

/**
 * CSS px per sprite pixel for a plane `length` px long at `dpr`: a whole
 * number of device pixels, so every sprite pixel is the same size, and never
 * below `PLANE_PIXEL_MIN`.
 */
export function spritePixel(length: number, dpr = 1): number {
  const ratio = dpr > 0 && Number.isFinite(dpr) ? dpr : 1
  const floor = Math.ceil(PLANE_PIXEL_MIN * ratio)
  const device = Number.isFinite(length) ? Math.round((length / PLANE_WIDTH) * ratio) : floor
  return Math.max(floor, device) / ratio
}

/** One horizontal run of one opaque key in a grid row, columns `x` to `end` (exclusive). */
export interface GridRun {
  readonly x: number
  readonly end: number
  readonly y: number
  readonly key: string
  readonly color: string
}

/** Every run of one opaque key in `grid` that `palette` colors, row by row, left to right. */
export function gridRuns(grid: SpriteGrid, palette: Palette): GridRun[] {
  const out: GridRun[] = []
  grid.forEach((row, y) => {
    let x = 0
    while (x < row.length) {
      const key = row[x]!
      let end = x + 1
      while (end < row.length && row[end] === key) end++
      const color = palette[key]
      if (key !== CLEAR && color !== undefined) out.push({ x, end, y, key, color })
      x = end
    }
  })
  return out
}

/**
 * Paints `grid` with its top-left at (`left`, `top`), each sprite pixel a
 * `px`-square, skipping keys in `skip`. Each horizontal run of one key is one
 * `fillRect` whose edges are snapped to device pixels at `dpr`, so a
 * fractional pixel ratio never blurs an edge and adjacent runs share theirs.
 */
export function paintGrid(
  ctx: CanvasRenderingContext2D,
  grid: SpriteGrid,
  palette: Palette,
  left: number,
  top: number,
  px: number,
  skip: ReadonlySet<string> = new Set(),
  dpr = 1,
): void {
  const ratio = dpr > 0 && Number.isFinite(dpr) ? dpr : 1
  const snap = (v: number): number => Math.round(v * ratio) / ratio
  ctx.imageSmoothingEnabled = false
  for (const run of gridRuns(grid, palette)) {
    if (skip.has(run.key)) continue
    const x0 = snap(left + run.x * px)
    const y0 = snap(top + run.y * px)
    ctx.fillStyle = run.color
    ctx.fillRect(x0, y0, snap(left + run.end * px) - x0, snap(top + (run.y + 1) * px) - y0)
  }
}

const NO_BLADE: ReadonlySet<string> = new Set([BLADE])

/** Paints `plane` as its pitch frame in `palette`, centered as the plane shape says, crisp at `dpr`. */
export function drawPlaneSprite(
  ctx: CanvasRenderingContext2D,
  plane: PlaneShape,
  palette: Palette,
  t: number,
  reducedMotion: boolean,
  dpr = 1,
): void {
  if (!(Number.isFinite(plane.x) && Number.isFinite(plane.y))) return
  const px = spritePixel(plane.length, dpr)
  const frame = PLANE_FRAMES[frameFor(plane.angle)]!
  const left = Math.round(plane.x - 0.55 * PLANE_WIDTH * px)
  const top = Math.round(plane.y - (frame.length / 2) * px)
  // Scoped, so the smoothing setting does not leak onto the rest of the scene.
  ctx.save()
  paintGrid(ctx, frame, palette, left, top, px, propellerOn(t, reducedMotion) ? undefined : NO_BLADE, dpr)
  ctx.restore()
}
