import { describe, expect, it } from 'vitest'
import { LIGHT } from '../ui/theme.ts'
import { fixtureSnapshot } from './fixture.ts'
import { SCENE, draw } from './scene.ts'

/**
 * A 2D context stand-in that records every method call and every `strokeStyle`,
 * `font` and `lineWidth` set. It also tracks `scale` through `save` and
 * `restore`, and records each `lineWidth` as drawn on screen in CSS px.
 */
function recordingContext(): { ctx: CanvasRenderingContext2D; calls: string[]; widths: number[] } {
  const calls: string[] = []
  const widths: number[] = []
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
  return { ctx: ctx as unknown as CanvasRenderingContext2D, calls, widths }
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
})
