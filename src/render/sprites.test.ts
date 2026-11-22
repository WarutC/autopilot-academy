import { describe, expect, it } from 'vitest'
import { SPRITE_PIXEL } from './scene-geometry.ts'
import {
  PLANE_FRAMES,
  PLANE_PAD,
  PLANE_ROWS,
  PLANE_WIDTH,
  PITCH_SLOPES,
  PLAYER_PALETTE,
  WINGMAN_PALETTE,
  drawPlaneSprite,
  frameFor,
  paintGrid,
  propellerOn,
  shearRows,
  spritePixel,
} from './sprites.ts'

interface Rect {
  readonly fill: string
  readonly args: readonly number[]
}

/** A 2D context stand-in that records method names, `fillRect` calls with their fill, and property sets. */
function spriteContext(): { ctx: CanvasRenderingContext2D; calls: string[]; rects: Rect[] } {
  const calls: string[] = []
  const rects: Rect[] = []
  const ctx = new Proxy({} as Record<string | symbol, unknown>, {
    get(target, key) {
      if (key in target) return target[key]
      return (...args: unknown[]) => {
        calls.push(String(key))
        if (key === 'fillRect') rects.push({ fill: String(target.fillStyle), args: args as number[] })
      }
    },
    set(target, key, value) {
      calls.push(`${String(key)}=${String(value)}`)
      target[key] = value
      return true
    },
  })
  return { ctx: ctx as unknown as CanvasRenderingContext2D, calls, rects }
}

/** Every opaque pixel of `grid` as `x,y` mapped to its key. */
function pixels(grid: readonly string[]): Map<string, string> {
  const out = new Map<string, string>()
  grid.forEach((row, y) => [...row].forEach((key, x) => key !== '.' && out.set(`${x},${y}`, key)))
  return out
}

describe('frameFor', () => {
  it('picks the five frames from steep dive to steep climb', () => {
    expect([-0.5, -0.25, 0, 0.25, 0.5].map(frameFor)).toEqual([0, 1, 2, 3, 4])
  })

  it('is level near zero, at -0 and for NaN, and symmetric in the sign of the angle', () => {
    expect(frameFor(0)).toBe(2)
    expect(frameFor(-0)).toBe(2)
    expect(frameFor(Number.NaN)).toBe(2)
    expect(frameFor(0.1099)).toBe(2)
    expect(frameFor(-0.1099)).toBe(2)
    for (let a = 0; a <= 1.6; a += 0.001) expect(frameFor(-a)).toBe(4 - frameFor(a))
    for (const a of [0.11, 0.33, 0.22, 0.44, Math.PI / 2, Infinity]) expect(frameFor(-a)).toBe(4 - frameFor(a))
    expect(frameFor(Infinity)).toBe(4)
    expect(frameFor(-Infinity)).toBe(0)
  })
})

describe('PLANE_FRAMES', () => {
  it('holds five frames of 27 rows by 26 columns', () => {
    expect(PLANE_ROWS).toHaveLength(15)
    for (const row of PLANE_ROWS) expect(row).toHaveLength(PLANE_WIDTH)
    expect(PLANE_FRAMES).toHaveLength(5)
    for (const frame of PLANE_FRAMES) {
      expect(frame).toHaveLength(PLANE_ROWS.length + PLANE_PAD * 2)
      for (const row of frame) expect(row).toHaveLength(PLANE_WIDTH)
    }
  })

  it('keeps the level frame as the plane grid between the pads', () => {
    expect(PLANE_FRAMES[2]!.slice(PLANE_PAD, PLANE_PAD + PLANE_ROWS.length)).toEqual(PLANE_ROWS)
    const pad = '.'.repeat(PLANE_WIDTH)
    expect(PLANE_FRAMES[2]!.slice(0, PLANE_PAD).every((r) => r === pad)).toBe(true)
    expect(PLANE_FRAMES[2]!.slice(-PLANE_PAD).every((r) => r === pad)).toBe(true)
  })

  it('mirrors the dive shear of the climb shear', () => {
    for (let x = 0; x < PLANE_WIDTH; x++) {
      expect(shearRows(x, -0.4) + shearRows(x, 0.4)).toBe(0)
      expect(shearRows(x, -0.2) + shearRows(x, 0.2)).toBe(0)
    }
    // Climbing lifts the nose: the rightmost column moves up.
    expect(shearRows(PLANE_WIDTH - 1, 0.4)).toBeLessThan(0)
  })

  it('outlines every opaque pixel except the propeller blades', () => {
    const at = (x: number, y: number) => PLANE_ROWS[y]?.[x] ?? '.'
    PLANE_ROWS.forEach((row, y) => {
      for (let x = 0; x < row.length; x++) {
        const key = row[x]!
        if (key === '.' || key === 'K' || key === 'G') continue
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
          expect(at(x + dx, y + dy), `${key} at ${x},${y}`).not.toBe('.')
        }
      }
    })
  })

  it('pads enough rows for the steepest shear of any column', () => {
    let most = 0
    for (const slope of PITCH_SLOPES) for (let x = 0; x < PLANE_WIDTH; x++) most = Math.max(most, Math.abs(shearRows(x, slope)))
    expect(PLANE_PAD).toBeGreaterThanOrEqual(most)
  })

  it('moves whole columns, so every frame holds the plane pixels with none lost', () => {
    const level = pixels(PLANE_ROWS)
    const slopes = [-0.4, -0.2, 0, 0.2, 0.4]
    PLANE_FRAMES.forEach((frame, i) => {
      const got = pixels(frame)
      expect(got.size).toBe(level.size)
      for (const [at, key] of level) {
        const [x, y] = at.split(',').map(Number) as [number, number]
        expect(got.get(`${x},${y + PLANE_PAD + shearRows(x, slopes[i]!)}`)).toBe(key)
      }
    })
  })
})

describe('propellerOn and spritePixel', () => {
  it('alternates the blade 24 times a second and holds it under reduced motion', () => {
    expect(propellerOn(0, false)).toBe(true)
    expect(propellerOn(1 / 24, false)).toBe(false)
    expect(propellerOn(2 / 24, false)).toBe(true)
    expect(propellerOn(1 / 24, true)).toBe(true)
  })

  it('never goes below the sprite pixel floor', () => {
    expect(spritePixel(46)).toBe(SPRITE_PIXEL)
    expect(spritePixel(0.13 * 831)).toBe(4)
    expect(spritePixel(Number.NaN)).toBe(SPRITE_PIXEL)
  })
})

describe('paintGrid', () => {
  it('merges each run of one key into one whole-pixel fillRect with smoothing off', () => {
    const { ctx, calls, rects } = spriteContext()
    paintGrid(ctx, ['KKR.R', '..GG.'], PLAYER_PALETTE, 10, 20, 3, new Set(['G']))
    expect(calls[0]).toBe('imageSmoothingEnabled=false')
    expect(rects).toEqual([
      { fill: PLAYER_PALETTE.K, args: [10, 20, 6, 3] },
      { fill: PLAYER_PALETTE.R, args: [16, 20, 3, 3] },
      { fill: PLAYER_PALETTE.R, args: [22, 20, 3, 3] },
    ])
  })
})

describe('paintGrid at a fractional pixel ratio', () => {
  it.each([1.25, 1.5])('lands every edge on a device pixel at dpr %s, with adjacent runs abutting', (dpr) => {
    const { ctx, rects } = spriteContext()
    const grid = PLANE_FRAMES[3]!
    paintGrid(ctx, grid, PLAYER_PALETTE, 101, 57, 3, undefined, dpr)
    expect(rects.length).toBeGreaterThan(0)
    const onDevice = (v: number) => expect(Math.abs(v * dpr - Math.round(v * dpr))).toBeLessThan(1e-9)
    for (const { args } of rects) {
      const [x, y, w, h] = args as [number, number, number, number]
      for (const edge of [x, y, x + w, y + h]) onDevice(edge)
      // Each run keeps the nominal 3 px sprite pixel to within one device pixel.
      expect(Math.abs(h - 3)).toBeLessThanOrEqual(1 / dpr + 1e-9)
    }
    // Runs in one row share edges, and each row starts where the row above ends.
    const rows = new Map<number, number[][]>()
    for (const { args } of rects) rows.set(args[1]!, [...(rows.get(args[1]!) ?? []), [...args]])
    const tops = [...rows.keys()].sort((a, b) => a - b)
    for (const top of tops) {
      const runs = rows.get(top)!.sort((a, b) => a[0]! - b[0]!)
      for (let i = 1; i < runs.length; i++) {
        const prev = runs[i - 1]!
        expect(runs[i]![0]!).toBeGreaterThanOrEqual(prev[0]! + prev[2]! - 1e-9)
      }
      for (const r of runs) expect(r[3]).toBe(runs[0]![3])
    }
    for (let i = 1; i < tops.length; i++) {
      const above = rows.get(tops[i - 1]!)![0]!
      if (tops[i]! - tops[i - 1]! < 4) expect(tops[i]!).toBeCloseTo(above[1]! + above[3]!, 9)
    }
  })

  it('abuts two adjacent runs exactly where both meet', () => {
    const { ctx, rects } = spriteContext()
    paintGrid(ctx, ['KR', 'RK'], PLAYER_PALETTE, 7, 7, 3, undefined, 1.5)
    const [a, b, c] = rects.map((r) => r.args) as [number[], number[], number[]]
    expect(a[0]! + a[2]!).toBe(b[0])
    expect(a[1]! + a[3]!).toBe(c[1])
  })
})

describe('drawPlaneSprite', () => {
  const plane = { x: 444.37, y: 301.62, angle: 0.3, length: 108.03 }

  it('paints integer rects in the palette with no rotate, scale or image', () => {
    const { ctx, calls, rects } = spriteContext()
    drawPlaneSprite(ctx, plane, WINGMAN_PALETTE, 0, false)
    expect(rects.length).toBeGreaterThan(0)
    for (const r of rects) {
      for (const v of r.args) expect(Number.isInteger(v)).toBe(true)
      expect(r.args[3]).toBe(spritePixel(plane.length))
      expect(r.args[2]! % spritePixel(plane.length)).toBe(0)
    }
    for (const banned of ['rotate', 'scale', 'drawImage', 'setTransform', 'translate']) expect(calls).not.toContain(banned)
    expect(rects.some((r) => r.fill === WINGMAN_PALETTE.R)).toBe(true)
    expect(rects.some((r) => r.fill === PLAYER_PALETTE.R)).toBe(false)
  })

  it('anchors the frame 55% along its width and centered on the plane point', () => {
    const { ctx, rects } = spriteContext()
    drawPlaneSprite(ctx, { ...plane, angle: 0 }, PLAYER_PALETTE, 0, false)
    const px = spritePixel(plane.length)
    const left = Math.round(plane.x - 0.55 * PLANE_WIDTH * px)
    const top = Math.round(plane.y - 13.5 * px)
    expect(Math.min(...rects.map((r) => r.args[0]!))).toBe(left)
    expect(Math.min(...rects.map((r) => r.args[1]!))).toBe(top + PLANE_PAD * px)
  })

  it.each([
    [0.3, 3],
    [-0.3, 1],
  ])('paints the frame for angle %s', (angle, index) => {
    const painted = (frame: readonly string[]) => {
      const { ctx, rects } = spriteContext()
      paintGrid(ctx, frame, PLAYER_PALETTE, 0, 0, 1)
      return rects.map((r) => `${r.fill}:${r.args.join(',')}`)
    }
    const { ctx, rects } = spriteContext()
    const px = spritePixel(plane.length)
    const left = Math.round(plane.x - 0.55 * PLANE_WIDTH * px)
    const top = Math.round(plane.y - (PLANE_FRAMES[index]!.length / 2) * px)
    drawPlaneSprite(ctx, { ...plane, angle }, PLAYER_PALETTE, 0, false)
    const got = rects.map((r) => {
      const [x, y, w, h] = r.args as [number, number, number, number]
      return `${r.fill}:${(x - left) / px},${(y - top) / px},${w / px},${h / px}`
    })
    expect(got).toEqual(painted(PLANE_FRAMES[index]!))
    expect(got).not.toEqual(painted(PLANE_FRAMES[2]!))
  })

  it('flickers the propeller, but not under reduced motion', () => {
    const at = (t: number, reduced: boolean) => {
      const { ctx, calls, rects } = spriteContext()
      drawPlaneSprite(ctx, plane, PLAYER_PALETTE, t, reduced)
      return { calls, blades: rects.filter((r) => r.fill === PLAYER_PALETTE.G).length }
    }
    expect(at(0, false).blades).toBeGreaterThan(0)
    expect(at(1 / 24, false).blades).toBe(0)
    expect(at(1 / 24, true).calls).toEqual(at(0, true).calls)
  })
})
