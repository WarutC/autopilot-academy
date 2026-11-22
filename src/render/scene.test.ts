import { describe, expect, it } from 'vitest'
import { LIGHT } from '../ui/theme.ts'
import { fixtureSnapshot } from './fixture.ts'
import { SCENE, drawBackdrop, draw } from './scene.ts'
import { sceneryFor } from './scenery.ts'
import { PLANE_AT, TARGET_DASH } from './scene-geometry.ts'
import type { Snapshot } from '../sim/types.ts'

const SAMPLE_COURSES = [101, 7, 8, 14] as const

/** The fixture flown on course `course`; the rings stay course 101's, which only the backdrop ignores. */
const onCourse = (course: number): Snapshot => ({ ...fixtureSnapshot(), course })

/**
 * A 2D context stand-in that records every method call and every `strokeStyle`,
 * `font` and `lineWidth` set. It also tracks `scale` through `save` and
 * `restore`, records each `lineWidth` as drawn on screen in CSS px, and
 * records the pattern of every `setLineDash`.
 */
function recordingContext(): { ctx: CanvasRenderingContext2D; calls: string[]; widths: number[]; dashes: number[][] } {
  const calls: string[] = []
  const widths: number[] = []
  const dashes: number[][] = []
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
        return key === 'createLinearGradient' ? gradient : undefined
      }
    },
    set(target, key, value) {
      if (key === 'strokeStyle' || key === 'fillStyle' || key === 'font' || key === 'lineWidth') calls.push(`${String(key)}=${String(value)}`)
      if (key === 'lineWidth') widths.push(Number(value) * scale)
      target[key] = value
      return true
    },
  })
  return { ctx: ctx as unknown as CanvasRenderingContext2D, calls, widths, dashes }
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

  it('draws the wingman plane and trail in the ghost color before the player, and a third HUD line', () => {
    const base = fixtureSnapshot()
    const player = base.planes[0]!
    const s = { ...base, planes: [player, { ...player, id: 'wingman' as const, h: player.h + 6, points: 7.25 }], trace: { player: base.trace.player!, wingman: base.trace.player! } }
    const { ctx, calls } = recordingContext()
    draw(ctx, s, LIGHT, { width: 1280, height: 720, dpr: 1 })
    const ghost = calls.indexOf(`strokeStyle=${LIGHT.ghost}`)
    const accent = calls.indexOf(`strokeStyle=${LIGHT.accent}`)
    expect(ghost).toBeGreaterThan(-1)
    expect(ghost).toBeLessThan(accent)
    // The wingman plane is filled before the player's.
    const ghostFill = calls.indexOf(`fillStyle=${LIGHT.ghost}`)
    expect(ghostFill).toBeGreaterThan(-1)
    expect(ghostFill).toBeLessThan(calls.indexOf(`fillStyle=${SCENE.planeRed}`))
    // Two planes: one roundRect (the wing) per plane.
    expect(calls.filter((c) => c === 'roundRect')).toHaveLength(2)
    expect(calls.filter((c) => c === 'fillText').length).toBe(
      (() => {
        const alone = recordingContext()
        draw(alone.ctx, base, LIGHT, { width: 1280, height: 720, dpr: 1 })
        return alone.calls.filter((c) => c === 'fillText').length + 1
      })(),
    )
  })

  it('draws one plane and no ghost color without a wingman', () => {
    const { ctx, calls } = recordingContext()
    draw(ctx, fixtureSnapshot(), LIGHT, { width: 1280, height: 720, dpr: 1 })
    expect(calls).not.toContain(`strokeStyle=${LIGHT.ghost}`)
    expect(calls.filter((c) => c === 'roundRect')).toHaveLength(1)
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

  it.each(SAMPLE_COURSES)('holds still under reduced motion on course %i', (course) => {
    expect(at(course, 900, true)).toEqual(at(course, 0, true))
    expect(at(course, 900, true)).not.toEqual(at(course, 900, false))
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
