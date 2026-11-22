import { describe, expect, it } from 'vitest'
import { LIGHT } from '../ui/theme.ts'
import { fixtureSnapshot } from './fixture.ts'
import { contrast } from '../styles/css-test-helpers.ts'
import { SCENE, WINGMAN_TRAIL, drawBackdrop, draw } from './scene.ts'
import { TIMES, sceneryFor } from './scenery.ts'
import { PLANE_AT, SPRITE_PIXEL, TARGET_DASH } from './scene-geometry.ts'
import { PLAYER_PALETTE, WINGMAN_PALETTE } from './sprites.ts'
import type { Snapshot } from '../sim/types.ts'

const SAMPLE_COURSES = [101, 7, 8, 14] as const

/** The fixture flown on course `course`; the rings stay course 101's, which only the backdrop ignores. */
const onCourse = (course: number): Snapshot => ({ ...fixtureSnapshot(), course })

/**
 * A 2D context stand-in that records every method call and every `strokeStyle`,
 * `fillStyle`, `font`, `lineWidth`, `globalAlpha` and `imageSmoothingEnabled`
 * set. It also tracks `scale` through `save` and `restore`, records each
 * `lineWidth` as drawn on screen in CSS px, the pattern of every `setLineDash`,
 * and the arguments of every `fillRect` with its index in `calls`.
 */
function recordingContext(): {
  ctx: CanvasRenderingContext2D
  calls: string[]
  widths: number[]
  dashes: number[][]
  rects: Array<{ at: number; args: number[] }>
} {
  const calls: string[] = []
  const widths: number[] = []
  const dashes: number[][] = []
  const rects: Array<{ at: number; args: number[] }> = []
  const gradient = { addColorStop: () => {} }
  let scale = 1
  const saved: number[] = []
  const ctx = new Proxy({} as Record<string | symbol, unknown>, {
    get(target, key) {
      if (key in target) return target[key]
      return (...args: unknown[]) => {
        calls.push(String(key))
        if (key === 'save') saved.push(scale)
        else if (key === 'restore') scale = saved.pop() ?? 1
        else if (key === 'scale') scale *= Number(args[0])
        else if (key === 'setLineDash') dashes.push([...(args[0] as number[])])
        else if (key === 'fillRect') rects.push({ at: calls.length - 1, args: args as number[] })
        return key === 'createLinearGradient' ? gradient : undefined
      }
    },
    set(target, key, value) {
      if (['strokeStyle', 'fillStyle', 'font', 'lineWidth', 'globalAlpha', 'imageSmoothingEnabled'].includes(String(key))) calls.push(`${String(key)}=${String(value)}`)
      if (key === 'lineWidth') widths.push(Number(value) * scale)
      target[key] = value
      return true
    },
  })
  return { ctx: ctx as unknown as CanvasRenderingContext2D, calls, widths, dashes, rects }
}

/** The fixture with a wingman 6 m above the player, flying the same trace. */
function withWingman(): Snapshot {
  const base = fixtureSnapshot()
  const player = base.planes[0]!
  return { ...base, planes: [player, { ...player, id: 'wingman' as const, h: player.h + 6, points: 7.25 }], trace: { player: base.trace.player!, wingman: base.trace.player! } }
}

/**
 * The fill rects painted by sprites: from the first `imageSmoothingEnabled=false`
 * to the `restore` that ends the last (player) sprite.
 */
function spriteRects(calls: readonly string[], rects: ReadonlyArray<{ at: number; args: number[] }>): number[][] {
  const from = calls.indexOf('imageSmoothingEnabled=false')
  if (from < 0) return []
  const to = calls.indexOf('restore', calls.lastIndexOf('imageSmoothingEnabled=false'))
  return rects.filter((r) => r.at > from && r.at < to).map((r) => r.args)
}

describe('draw', () => {
  it('paints nothing at size 0', () => {
    for (const size of [
      { width: 0, height: 0, dpr: 1 },
      { width: 1280, height: 0, dpr: 2 },
      { width: 0, height: 720, dpr: 2 },
    ]) {
      const { ctx, calls } = recordingContext()
      draw(ctx, fixtureSnapshot(), LIGHT, size)
      expect(calls).toEqual([])
    }
  })

  it('paints a snapshot without writing to it', () => {
    const s = fixtureSnapshot()
    const trace = s.trace.player!
    const before = { h: trace.h.slice(), t: trace.t.slice(), length: trace.length, results: s.planes[0].results.slice() }
    const { ctx, calls } = recordingContext()
    draw(ctx, s, LIGHT, { width: 1280, height: 720, dpr: 2 })
    expect(calls).toContain('fillText')
    expect(calls).toContain('ellipse')
    expect(trace.h).toEqual(before.h)
    expect(trace.t).toEqual(before.t)
    expect(trace.length).toBe(before.length)
    expect(s.planes[0].results).toEqual(before.results)
  })

  it('strokes passed rings green and missed rings red', () => {
    const strokes = (flown?: number) => {
      const { ctx, calls } = recordingContext()
      draw(ctx, fixtureSnapshot(flown), LIGHT, { width: 1280, height: 720, dpr: 1 })
      return calls
    }
    // The fixture shows the last ring flown: passed by default, missed after two rings.
    const passed = strokes()
    expect(passed).toContain(`strokeStyle=${SCENE.ringHit}`)
    expect(passed).not.toContain(`strokeStyle=${SCENE.ringMiss}`)
    const missed = strokes(2)
    expect(missed).toContain(`strokeStyle=${SCENE.ringMiss}`)
    expect(missed).not.toContain(`strokeStyle=${SCENE.ringHit}`)
  })

  // The scene as the wide layout sizes it: the left column at 16:9, inside its 2 px border.
  it.each([
    ['1920×1080', { width: 1480, height: 831, dpr: 1 }],
    ['1024×768', { width: 584, height: 327, dpr: 1 }],
  ])('holds the 18 px text and 3 px line floors at %s', (_viewport, size) => {
    const { ctx, calls, widths } = recordingContext()
    draw(ctx, fixtureSnapshot(), LIGHT, size)
    const fonts = calls.filter((c) => c.startsWith('font=')).map((c) => Number(/(\d+(?:\.\d+)?)px/.exec(c)![1]))
    expect(fonts.length).toBeGreaterThan(0)
    expect(Math.min(...fonts)).toBeGreaterThanOrEqual(18)
    // Widths are as drawn on screen, so the plane's scaled outline counts at its real width.
    expect(widths.length).toBeGreaterThan(0)
    for (const w of widths) expect(w).toBeGreaterThanOrEqual(3 - 1e-9)
  })

  it('draws the wingman trail in the sprite blue and its translucent blue plane before the player, and a third HUD line', () => {
    const base = fixtureSnapshot()
    const { ctx, calls } = recordingContext()
    draw(ctx, withWingman(), LIGHT, { width: 1280, height: 720, dpr: 1 })
    expect(WINGMAN_TRAIL).toBe(WINGMAN_PALETTE.R)
    expect(calls).not.toContain(`strokeStyle=${LIGHT.ghost}`)
    const ghost = calls.indexOf(`strokeStyle=${WINGMAN_TRAIL}`)
    const accent = calls.indexOf(`strokeStyle=${LIGHT.accent}`)
    expect(ghost).toBeGreaterThan(-1)
    expect(ghost).toBeLessThan(accent)
    // The wingman sprite is painted at 60% inside save/restore, before any player red.
    const alpha = calls.indexOf('globalAlpha=0.6')
    const blue = calls.indexOf(`fillStyle=${WINGMAN_PALETTE.R}`)
    const red = calls.indexOf(`fillStyle=${PLAYER_PALETTE.R}`)
    expect(alpha).toBeGreaterThan(-1)
    expect(blue).toBeGreaterThan(alpha)
    expect(red).toBeGreaterThan(blue)
    expect(calls.lastIndexOf('save', alpha)).toBeGreaterThan(-1)
    // The restore that matches the save before the alpha set.
    let depth = 1
    let restore = alpha
    while (depth > 0 && ++restore < calls.length) {
      if (calls[restore] === 'save') depth++
      else if (calls[restore] === 'restore') depth--
    }
    expect(restore).toBeGreaterThan(blue)
    expect(restore).toBeLessThan(red)
    expect(calls.slice(alpha, restore)).not.toContain(`fillStyle=${PLAYER_PALETTE.R}`)
    expect(calls.filter((c) => c.startsWith('globalAlpha='))).toEqual(['globalAlpha=0.6'])
    expect(calls.filter((c) => c === 'fillText').length).toBe(
      (() => {
        const alone = recordingContext()
        draw(alone.ctx, base, LIGHT, { width: 1280, height: 720, dpr: 1 })
        return alone.calls.filter((c) => c === 'fillText').length + 1
      })(),
    )
  })

  it('draws one red plane and no blue trail or sprite without a wingman', () => {
    const { ctx, calls } = recordingContext()
    draw(ctx, fixtureSnapshot(), LIGHT, { width: 1280, height: 720, dpr: 1 })
    expect(calls).not.toContain(`strokeStyle=${WINGMAN_TRAIL}`)
    expect(calls).not.toContain(`fillStyle=${WINGMAN_PALETTE.R}`)
    expect(calls.filter((c) => c.startsWith('globalAlpha='))).toEqual([])
    expect(calls).toContain(`fillStyle=${PLAYER_PALETTE.R}`)
    expect(calls.filter((c) => c === 'imageSmoothingEnabled=false')).toHaveLength(1)
  })

  it('outlines both plane sprites in the scene outline color', () => {
    expect(PLAYER_PALETTE.K).toBe(SCENE.outline)
    expect(WINGMAN_PALETTE.K).toBe(SCENE.outline)
  })

  it('scopes the sprite smoothing setting inside save and restore', () => {
    const { ctx, calls } = recordingContext()
    draw(ctx, withWingman(), LIGHT, { width: 1280, height: 720, dpr: 1 })
    let depth = 0
    for (const c of calls) {
      if (c === 'save') depth++
      else if (c === 'restore') depth--
      else if (c === 'imageSmoothingEnabled=false') expect(depth).toBeGreaterThan(0)
    }
  })

  describe.each([
    ['1920×1080', 1480, 831],
    ['1024×768', 584, 327],
  ])('paints the planes as whole pixels at %s', (_viewport, width, height) => {
    it.each([1, 3])('at dpr %i', (dpr) => {
      const { ctx, calls, rects } = recordingContext()
      draw(ctx, withWingman(), LIGHT, { width, height, dpr })
      const sprite = spriteRects(calls, rects)
      expect(sprite.length).toBeGreaterThan(0)
      const px = sprite[0]![3]!
      expect(px).toBeGreaterThanOrEqual(SPRITE_PIXEL)
      for (const args of sprite) {
        for (const v of args) expect(Number.isInteger(v)).toBe(true)
        expect(args[3]).toBe(px)
        expect(args[2]! % px).toBe(0)
      }
      expect(calls).not.toContain('rotate')
      expect(calls).not.toContain('drawImage')
      expect(calls.filter((c) => c === 'setTransform')).toHaveLength(1)
    })
  })

  it('flickers the propeller, and holds it still under reduced motion', () => {
    const at = (t: number, reducedMotion: boolean) => {
      const { ctx, calls } = recordingContext()
      draw(ctx, { ...withWingman(), t }, { ...LIGHT, reducedMotion }, { width: 1280, height: 720, dpr: 1 })
      return calls
    }
    expect(at(0, false)).toContain(`fillStyle=${PLAYER_PALETTE.G}`)
    expect(at(1 / 24, false)).not.toContain(`fillStyle=${PLAYER_PALETTE.G}`)
    expect(at(1 / 24, false)).not.toEqual(at(0, false))
    expect(at(1 / 24, true)).toEqual(at(0, true))
  })

  describe.each([
    ['1920×1080', { width: 1480, height: 831, dpr: 1 }],
    ['1024×768', { width: 584, height: 327, dpr: 1 }],
  ])('over every sample course at %s', (_viewport, size) => {
    it.each(SAMPLE_COURSES)('course %i holds the 3 px line floor and dashes only the target', (course) => {
      const { ctx, widths, dashes } = recordingContext()
      draw(ctx, onCourse(course), LIGHT, size)
      expect(widths.length).toBeGreaterThan(0)
      for (const w of widths) expect(w).toBeGreaterThanOrEqual(3 - 1e-9)
      const dashed = dashes.filter((d) => d.length > 0)
      expect(dashed).toEqual([[...TARGET_DASH]])
    })
  })
})

/** A 2D context stand-in that records every method call with its arguments, numbers to 3 decimals. */
function argumentContext(): { ctx: CanvasRenderingContext2D; calls: string[]; arcs: number[][] } {
  const calls: string[] = []
  const arcs: number[][] = []
  const ctx = new Proxy({} as Record<string | symbol, unknown>, {
    get(target, key) {
      if (key in target) return target[key]
      return (...a: unknown[]) => {
        calls.push(`${String(key)}(${a.map((v) => (typeof v === 'number' ? v.toFixed(3) : String(v))).join(',')})`)
        if (key === 'arc') arcs.push(a as number[])
        return key === 'createLinearGradient' ? { addColorStop: () => {} } : undefined
      }
    },
    set(target, key, value) {
      target[key] = value
      return true
    },
  })
  return { ctx: ctx as unknown as CanvasRenderingContext2D, calls, arcs }
}

describe('drawBackdrop', () => {
  const view = (camX: number) => ({ width: 1480, height: 831, groundY: 800, sx: 1480 / 230, camX })
  const at = (course: number, camX: number, reduced: boolean) => {
    const rec = argumentContext()
    drawBackdrop(rec.ctx, sceneryFor(course), view(camX), reduced)
    return rec.calls
  }

  it.each(SAMPLE_COURSES)('still scrolls, without depth, under reduced motion on course %i', (course) => {
    expect(at(course, 900, true)).not.toEqual(at(course, 0, true))
    expect(at(course, 900, true)).not.toEqual(at(course, 900, false))
  })

  it('moves every layer by the same distance under reduced motion, and by different distances without', () => {
    /** Main-blob cloud centers and city building lefts, CSS px, on night-city course 7. */
    const layers = (camX: number, reduced: boolean) => {
      const rec = argumentContext()
      drawBackdrop(rec.ctx, sceneryFor(7), view(camX), reduced)
      const clouds = rec.arcs.slice(1).filter((_, i) => i % 12 === 0).map((a) => a[0]!)
      const buildings = rec.calls.filter((c) => c.startsWith('strokeRect(')).map((c) => Number(c.slice('strokeRect('.length).split(',')[0]))
      return { clouds, buildings }
    }
    // Moving the camera less than one cloud or building spacing keeps the same features in view.
    const shift = (reduced: boolean) => {
      const a = layers(100, reduced)
      const b = layers(101, reduced)
      return [a.clouds[0]! - b.clouds[0]!, a.buildings[0]! - b.buildings[0]!]
    }
    const [cloudR, cityR] = shift(true)
    expect(cloudR).toBeGreaterThan(0)
    expect(cloudR).toBeCloseTo(cityR!, 2)
    const [cloud, city] = shift(false)
    expect(Math.abs(cloud! - city!)).toBeGreaterThan(0.5)
  })

  it.each(SAMPLE_COURSES)('scrolls with the camera on course %i', (course) => {
    expect(at(course, 900, false)).not.toEqual(at(course, 0, false))
  })

  it('shows the same clouds at the same course distance from the plane on a phone and a projector', () => {
    const planeX = 900
    /** Main-blob centers as meters ahead of the plane, for a view `width` px wide as `camera()` scales it. */
    const cloudsAhead = (width: number, height: number) => {
      const sx = width / (width < 600 ? 170 : 230)
      const camX = planeX - (PLANE_AT * width) / sx
      const rec = argumentContext()
      drawBackdrop(rec.ctx, sceneryFor(14), { width, height, groundY: height * 0.95, sx, camX }, false)
      // After the orb, each cloud strokes then fills its six blobs; the first is the main blob.
      const clouds = rec.arcs.slice(1)
      expect(clouds.length % 12).toBe(0)
      const out: number[] = []
      for (let i = 0; i < clouds.length; i += 12) out.push((clouds[i]![0]! - PLANE_AT * width) / sx)
      return out
    }
    const phone = cloudsAhead(584, 327)
    const wide = cloudsAhead(1480, 831)
    expect(phone.length).toBeGreaterThan(0)
    for (const d of phone) expect(Math.min(...wide.map((w) => Math.abs(w - d)))).toBeLessThan(1e-6)
  })

  it('rebuilds the scenery when the course changes, so course 7 after course 14 paints the night stars', () => {
    const stars = (course: number) => {
      const { ctx, calls } = recordingContext()
      draw(ctx, onCourse(course), LIGHT, { width: 1280, height: 720, dpr: 1 })
      return calls.includes('fillStyle=rgba(255, 255, 255, 0.85)')
    }
    expect(stars(14)).toBe(false)
    expect(stars(7)).toBe(true)
    expect(stars(14)).toBe(false)
  })

  it('moves the backdrop when the plane moves, as one layer under reduced motion', () => {
    const backdrop = (dx: number, reducedMotion: boolean) => {
      const s = fixtureSnapshot()
      const moved = { ...s, planes: [{ ...s.planes[0], x: s.planes[0].x + dx }] as Snapshot['planes'] }
      const rec = argumentContext()
      draw(rec.ctx, { ...moved, course: 7 }, { ...LIGHT, reducedMotion }, { width: 1280, height: 720, dpr: 1 })
      // The backdrop ends at the ground line, the first full-width stroke after the city.
      return rec.calls.filter((c) => c.startsWith('arc(') || c.startsWith('strokeRect('))
    }
    for (const reduced of [false, true]) expect(backdrop(1, reduced)).not.toEqual(backdrop(0, reduced))
    expect(backdrop(1, true)).not.toEqual(backdrop(1, false))
  })

  it('paints the night sky with stars and the day sky without', () => {
    const fills = (course: number) => {
      const rec = recordingContext()
      drawBackdrop(rec.ctx, sceneryFor(course), view(0), false)
      return rec.calls.filter((c) => c === 'fillRect').length
    }
    // Course 14 is morning over mountains: sky, snow and ground are its only rects.
    expect(fills(14)).toBe(3)
    // Course 7 is a night city: sixty stars, buildings and their windows.
    expect(fills(7)).toBeGreaterThan(60)
  })
})

describe('scene contrast', () => {
  /** The colors of a sky gradient from `from` (a fraction of the scene height) down. */
  const bands = (time: keyof typeof TIMES, from = 0) => TIMES[time].sky.filter(([at]) => at >= from).map(([, color]) => color)

  it.each(['morning', 'sunset'] as const)('keeps the target dash and the gold rings at 3:1 on the %s horizon', (time) => {
    // The horizon: the lower half of the sky, where the pale bands are.
    for (const band of bands(time, 0.5)) {
      // The white dash shows on its dark casing; the gold band on its rim.
      expect(Math.max(contrast(SCENE.target, band), contrast(SCENE.targetCasing, band))).toBeGreaterThanOrEqual(3)
      expect(contrast(SCENE.target, SCENE.targetCasing)).toBeGreaterThanOrEqual(3)
      expect(Math.max(contrast(SCENE.ringGold, band), contrast(SCENE.ringRim, band))).toBeGreaterThanOrEqual(3)
      expect(contrast(SCENE.ringGold, SCENE.ringRim)).toBeGreaterThanOrEqual(3)
    }
  })

  it('keeps the scenery outline at 3:1 on the night sky', () => {
    for (const band of bands('night')) expect(contrast(SCENE.outlineNight, band)).toBeGreaterThanOrEqual(3)
    const { ctx, calls } = recordingContext()
    drawBackdrop(ctx, sceneryFor(7), { width: 1480, height: 831, groundY: 800, sx: 1480 / 230, camX: 0 }, false)
    expect(calls).toContain(`strokeStyle=${SCENE.outlineNight}`)
    expect(calls).not.toContain(`strokeStyle=${SCENE.outline}`)
  })
})
