import { describe, expect, it } from 'vitest'
import type { AlgorithmAnalysis } from '../algorithms/index.ts'
import { LIGHT } from '../ui/theme.ts'
import { CROSS_ARM, SPLANE_FONT, SPLANE_LINE, draw, splaneGeometry } from './splane.ts'

/** A 2D context stand-in that records method calls, `fillText` text, and style sets. */
function recordingContext(): { ctx: CanvasRenderingContext2D; calls: string[] } {
  const calls: string[] = []
  const ctx = new Proxy({} as Record<string | symbol, unknown>, {
    get(target, key) {
      if (key in target) return target[key]
      return (...args: unknown[]) => {
        calls.push(String(key))
        if (key === 'fillText') calls.push(`text=${String(args[0])}`)
        if (key === 'moveTo' || key === 'lineTo') calls.push(`${String(key)}=${String(args[0])},${String(args[1])}`)
        return undefined
      }
    },
    set(target, key, value) {
      if (['lineWidth', 'font', 'strokeStyle', 'fillStyle', 'globalAlpha'].includes(String(key))) {
        calls.push(`${String(key)}=${String(value)}`)
      }
      target[key] = value
      return true
    },
  })
  return { ctx: ctx as unknown as CanvasRenderingContext2D, calls }
}

const SIZE = { width: 160, height: 160, dpr: 2 }

describe('splaneGeometry', () => {
  it('puts the origin at 62 % width and half height', () => {
    const g = splaneGeometry([{ re: -1, im: 0 }], { width: 200, height: 100, dpr: 1 })
    expect(g.origin).toEqual({ x: 124, y: 50 })
  })

  it('fits an extent of at least 3 into the half height', () => {
    const g = splaneGeometry([{ re: -0.25, im: 1.39 }], SIZE)
    expect(g.scale).toBeCloseTo(80 / 3, 9)
    expect(g.crosses[0]!.x).toBeCloseTo(0.62 * 160 - 0.25 * (80 / 3), 9)
    expect(g.crosses[0]!.y).toBeCloseTo(80 - 1.39 * (80 / 3), 9)
  })

  it('grows the extent to 1.25 times the farthest pole part', () => {
    const g = splaneGeometry([{ re: -1, im: 8 }, { re: -1, im: -8 }], SIZE)
    expect(g.scale).toBeCloseTo(80 / 10, 9)
    const wide = splaneGeometry([{ re: -6, im: 0 }], { width: 400, height: 400, dpr: 1 })
    expect(wide.scale).toBeCloseTo(200 / 7.5, 9)
  })

  it('keeps every cross inside the canvas, unstable poles included', () => {
    for (const poles of [
      [{ re: -10, im: 0 }],
      [{ re: 4, im: 4 }, { re: 4, im: -4 }],
      [{ re: -0.1, im: 20 }, { re: -0.1, im: -20 }],
    ]) {
      const g = splaneGeometry(poles, SIZE)
      for (const c of g.crosses) {
        expect(c.x).toBeGreaterThanOrEqual(0)
        expect(c.x).toBeLessThanOrEqual(SIZE.width)
        expect(c.y).toBeGreaterThanOrEqual(0)
        expect(c.y).toBeLessThanOrEqual(SIZE.height)
      }
    }
  })

  it('skips non-finite poles', () => {
    const g = splaneGeometry([{ re: Number.NaN, im: 0 }, { re: -1, im: 0 }], SIZE)
    expect(g.crosses).toHaveLength(1)
    expect(Number.isFinite(g.scale)).toBe(true)
  })
})

describe('splane draw', () => {
  it('paints nothing at size 0 or without poles', () => {
    for (const [analysis, size] of [
      [{ poles: [{ re: -1, im: 0 }] }, { width: 0, height: 160, dpr: 1 }],
      [{ poles: [{ re: -1, im: 0 }] }, { width: 160, height: 0, dpr: 1 }],
      [{ poles: [] }, SIZE],
      [{ lookahead: 2 }, SIZE],
    ] as const) {
      const { ctx, calls } = recordingContext()
      draw(ctx, analysis as AlgorithmAnalysis, LIGHT, size)
      expect(calls).toEqual([])
    }
  })

  it('paints the field, the shaded right half, axes, labels and one cross per pole at the floors', () => {
    const poles = Object.freeze([Object.freeze({ re: -0.25, im: -1.39 }), Object.freeze({ re: -0.25, im: 1.39 })])
    const analysis: AlgorithmAnalysis = Object.freeze({ poles, gains: Object.freeze({ k1: 0.2 }) })
    const { ctx, calls } = recordingContext()
    draw(ctx, analysis, LIGHT, SIZE)
    const text = calls.join('\n')
    expect(calls[0]).toBe('setTransform')
    expect(text).toContain(`fillStyle=${LIGHT.field}\nfillRect`)
    expect(text).toMatch(new RegExp(`globalAlpha=0\\.\\d+\\nfillStyle=${LIGHT.accent}\\nfillRect`))
    expect(text).toContain(`lineWidth=${SPLANE_LINE.axis}\nstrokeStyle=${LIGHT.muted}`)
    expect(text).toContain(`lineWidth=${SPLANE_LINE.cross}\nstrokeStyle=${LIGHT.accent}`)
    expect(calls).toContain('text=Re')
    expect(calls).toContain('text=Im')
    // Two axes, then two strokes per cross.
    expect(calls.filter((c) => c === 'stroke')).toHaveLength(2 + 2 * poles.length)
    const g = splaneGeometry(poles, SIZE)
    const c = g.crosses[1]!
    expect(calls).toContain(`moveTo=${c.x - CROSS_ARM},${c.y - CROSS_ARM}`)
    // The last alpha set leaves the context opaque.
    expect(calls.filter((x) => x.startsWith('globalAlpha=')).at(-1)).toBe('globalAlpha=1')
    const fonts = calls.filter((x) => x.startsWith('font=')).map((x) => Number(/(\d+)px/.exec(x)![1]))
    expect(fonts.length).toBeGreaterThan(0)
    expect(Math.min(...fonts)).toBeGreaterThanOrEqual(18)
    expect(SPLANE_FONT.axis).toBeGreaterThanOrEqual(18)
    const widths = calls.filter((x) => x.startsWith('lineWidth=')).map((x) => Number(x.slice('lineWidth='.length)))
    for (const w of widths) expect(w).toBeGreaterThanOrEqual(3)
    // Frozen inputs would have thrown on a write; check the values too.
    expect(analysis.poles).toEqual([{ re: -0.25, im: -1.39 }, { re: -0.25, im: 1.39 }])
    expect(analysis.gains).toEqual({ k1: 0.2 })
  })

  it('uses the dark theme tokens it is given', () => {
    const dark = { ...LIGHT, field: '#1A2C48', accent: '#FF5960', muted: '#9AAEC6' }
    const { ctx, calls } = recordingContext()
    draw(ctx, { poles: [{ re: -1, im: 0 }] }, dark, SIZE)
    expect(calls).toContain('fillStyle=#1A2C48')
    expect(calls).toContain('strokeStyle=#FF5960')
    expect(calls).toContain('strokeStyle=#9AAEC6')
  })
})
