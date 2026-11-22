import { describe, expect, it } from 'vitest'
import { createTrace } from '../sim/trace.ts'
import type { Snapshot, Trace } from '../sim/types.ts'
import { themeTokens } from '../styles/css-test-helpers.ts'
import tokensCss from '../styles/tokens.css?raw'
import { LIGHT, readTheme, type Theme } from '../ui/theme.ts'
import { fixtureSnapshot } from './fixture.ts'
import { RECORDER_FONT, RECORDER_LINE } from './recorder-geometry.ts'
import { READING_ALPHA, RING_BAR_OUTLINE_TOKEN, draw, drawRingBar } from './recorder.ts'
import { SCENE } from './scene.ts'

/** A copy of `trace` whose elevator column swings between -1 and 1. */
function elevatorTrace(trace: Trace): Trace {
  const copy = createTrace(trace.length)
  copy.length = trace.length
  for (let i = 0; i < trace.length; i++) {
    copy.t[i] = trace.t[i]
    copy.ref[i] = trace.ref[i]
    copy.h[i] = trace.h[i]
    copy.hMeas[i] = trace.hMeas[i]
    copy.hEst[i] = trace.hEst[i]
    copy.u[i] = Math.sin(i / 10)
  }
  return copy
}

/** The dark theme as tokens.css defines it. */
const DARK: Theme = readTheme((name) => themeTokens(tokensCss).dark[name.slice(2)])

const withMarkers = (markers: Snapshot['markers'], s: Snapshot = fixtureSnapshot()): Snapshot => ({ ...s, markers })

/** A 2D context stand-in that records method calls, the text of `fillText`, and `lineWidth`, `font`, `strokeStyle` and `fillStyle` sets. */
function recordingContext(): { ctx: CanvasRenderingContext2D; calls: string[] } {
  const calls: string[] = []
  const ctx = new Proxy({} as Record<string | symbol, unknown>, {
    get(target, key) {
      if (key in target) return target[key]
      return (...args: unknown[]) => {
        calls.push(String(key))
        if (key === 'fillText') calls.push(`text=${String(args[0])}`)
        if (key === 'fillRect' || key === 'setLineDash') calls.push(`${String(key)}=${JSON.stringify(args)}`)
        return key === 'measureText' ? { width: String(args[0]).length * 9 } : undefined
      }
    },
    set(target, key, value) {
      if (key === 'lineWidth' || key === 'font' || key === 'strokeStyle' || key === 'fillStyle' || key === 'globalAlpha') calls.push(`${String(key)}=${String(value)}`)
      target[key] = value
      return true
    },
  })
  return { ctx: ctx as unknown as CanvasRenderingContext2D, calls }
}

describe('recorder ring bars', () => {
  /** The fixture with two rings flown: the first passed, the second missed, the rest pending. */
  const snapshot = fixtureSnapshot(2)

  it.each([
    ['light', LIGHT],
    ['dark', DARK],
  ] as const)('fills passed and pending bars 12 px wide and outlines them 3 px in Strong, in the %s theme', (_name, theme) => {
    expect(RING_BAR_OUTLINE_TOKEN).toBe('strong')
    const { ctx, calls } = recordingContext()
    draw(ctx, snapshot, theme, { width: 1000, height: 240, dpr: 1 })
    for (const fill of [SCENE.ringHit, SCENE.ringGold]) {
      const at = calls.indexOf(`fillStyle=${fill}`)
      expect(at).toBeGreaterThan(-1)
      const rect = JSON.parse(calls[at + 2]!.slice('fillRect='.length)) as number[]
      expect(calls[at + 1]).toBe('fillRect')
      expect(rect[2]).toBe(12)
      expect(calls.slice(at + 3, at + 6)).toEqual([`lineWidth=${RECORDER_LINE.ringOutline}`, `strokeStyle=${theme.strong}`, 'strokeRect'])
    }
    expect(RECORDER_LINE.ringOutline).toBe(3)
    // The miss stays a hollow red outline, with no fill and no Strong outline.
    expect(calls).not.toContain(`fillStyle=${SCENE.ringMiss}`)
    const miss = calls.indexOf(`strokeStyle=${SCENE.ringMiss}`)
    expect(calls.slice(miss - 1, miss + 2)).toEqual([`lineWidth=${RECORDER_LINE.ringMiss}`, `strokeStyle=${SCENE.ringMiss}`, 'strokeRect'])
    expect(calls[miss + 2]).not.toBe(`lineWidth=${RECORDER_LINE.ringOutline}`)
  })

  it('insets the outline by half its width so it keeps the bar size', () => {
    const rects: number[][] = []
    const fills: number[][] = []
    const ctx = new Proxy({} as Record<string | symbol, unknown>, {
      get(target, key) {
        if (key in target) return target[key]
        return (...args: number[]) => {
          if (key === 'strokeRect' && target.strokeStyle === LIGHT.strong) rects.push(args)
          if (key === 'fillRect' && (target.fillStyle === SCENE.ringHit || target.fillStyle === SCENE.ringGold)) fills.push(args)
          return key === 'measureText' ? { width: 9 } : undefined
        }
      },
      set(target, key, value) {
        target[key] = value
        return true
      },
    }) as unknown as CanvasRenderingContext2D
    draw(ctx, snapshot, LIGHT, { width: 1000, height: 240, dpr: 1 })
    expect(rects.length).toBe(fills.length)
    expect(rects.length).toBeGreaterThan(0)
    rects.forEach((r, i) => {
      const f = fills[i]!
      expect(r[0]).toBeCloseTo(f[0]! + 1.5, 9)
      expect(r[1]).toBeCloseTo(f[1]! + 1.5, 9)
      expect(r[2]).toBeCloseTo(f[2]! - 3, 9)
      expect(r[3]).toBeCloseTo(f[3]! - 3, 9)
    })
  })
})

describe('ring bars shorter than their outline', () => {
  /** Every fill and stroke rect painted for `bar`, as its extent. */
  const paint = (bar: Parameters<typeof drawRingBar>[1]) => {
    const rects: Array<{ kind: string; color: string; left: number; top: number; right: number; bottom: number }> = []
    const ctx = new Proxy({} as Record<string | symbol, unknown>, {
      get(target, key) {
        if (key in target) return target[key]
        return (x: number, y: number, w: number, h: number) => {
          if (key === 'fillRect') rects.push({ kind: 'fill', color: String(target.fillStyle), left: x, top: y, right: x + w, bottom: y + h })
          if (key === 'strokeRect') {
            const half = Number(target.lineWidth) / 2
            rects.push({ kind: 'stroke', color: String(target.strokeStyle), left: x - half, top: y - half, right: x + w + half, bottom: y + h + half })
          }
        }
      },
      set(target, key, value) {
        target[key] = value
        return true
      },
    }) as unknown as CanvasRenderingContext2D
    drawRingBar(ctx, bar, LIGHT)
    return rects
  }

  it.each([
    ['clipped at the plot edge', 1],
    ['2 px tall', 2],
  ])('paints nothing outside a bar %s', (_name, height) => {
    for (const state of ['pass', 'pending', 'miss'] as const) {
      const bar = { index: 0, x: 100, top: 50, bottom: 50 + height, width: 12, state }
      const rects = paint(bar)
      expect(rects.length).toBeGreaterThan(0)
      for (const r of rects) {
        expect(r.left).toBeGreaterThanOrEqual(94)
        expect(r.right).toBeLessThanOrEqual(106)
        expect(r.top).toBeGreaterThanOrEqual(50)
        expect(r.bottom).toBeLessThanOrEqual(50 + height)
      }
      expect(rects.map((r) => r.color)).toContain(state === 'miss' ? SCENE.ringMiss : state === 'pass' ? SCENE.ringHit : SCENE.ringGold)
    }
  })

  it('keeps the outline on a bar tall enough to hold it', () => {
    const rects = paint({ index: 0, x: 100, top: 50, bottom: 80, width: 12, state: 'pass' })
    expect(rects.filter((r) => r.kind === 'stroke').map((r) => r.color)).toEqual([LIGHT.strong])
  })
})

describe('recorder draw', () => {
  it('paints nothing at size 0', () => {
    const { ctx, calls } = recordingContext()
    draw(ctx, fixtureSnapshot(), LIGHT, { width: 0, height: 300, dpr: 2 })
    expect(calls).toEqual([])
  })

  it('paints the lines, bars, legend and markers at the floors without writing to the snapshot', () => {
    const fixture = fixtureSnapshot()
    const trace = elevatorTrace(fixture.trace.player!)
    const s = withMarkers([{ t: 3.2, label: 'Kd 0 → 0.05' }], { ...fixture, trace: { player: trace } })
    const before = {
      h: trace.h.slice(),
      ref: trace.ref.slice(),
      t: trace.t.slice(),
      u: trace.u.slice(),
      length: trace.length,
      markers: s.markers.slice(),
      results: s.planes[0]!.results.slice(),
    }
    const { ctx, calls } = recordingContext()
    draw(ctx, s, LIGHT, { width: 1000, height: 240, dpr: 2 })
    expect(calls).toContain('fillText')
    expect(calls).toContain(`strokeStyle=${LIGHT.refline}`)
    expect(calls).toContain(`strokeStyle=${LIGHT.accent}`)
    expect(calls).toContain(`lineWidth=${RECORDER_LINE.marker}`)
    // The elevator: muted at 3 px.
    expect(RECORDER_LINE.elevator).toBe(3)
    expect(calls.join('\n')).toContain(`lineWidth=${RECORDER_LINE.elevator}\nstrokeStyle=${LIGHT.muted}`)
    // Ring bars: passed and pending filled, missed stroked hollow.
    expect(calls).toContain(`fillStyle=${SCENE.ringHit}`)
    expect(calls).toContain(`fillStyle=${SCENE.ringGold}`)
    expect(calls).not.toContain(`fillStyle=${SCENE.ringMiss}`)
    expect(calls.join('\n')).toContain(`lineWidth=${RECORDER_LINE.ringMiss}\nstrokeStyle=${SCENE.ringMiss}\nstrokeRect`)
    // Legend labels and the band label.
    for (const label of ['Target', 'Altitude', 'Elevator', 'u']) expect(calls).toContain(`text=${label}`)
    const fonts = calls.filter((c) => c.startsWith('font=')).map((c) => Number(/(\d+)px/.exec(c)![1]))
    expect(Math.min(...fonts)).toBeGreaterThanOrEqual(18)
    for (const f of Object.values(RECORDER_FONT)) expect(f).toBeGreaterThanOrEqual(18)
    const widths = calls.filter((c) => c.startsWith('lineWidth=')).map((c) => Number(c.slice('lineWidth='.length)))
    // Only the grid hairlines go below 3 px.
    for (const w of widths) expect(w === RECORDER_LINE.axis || w >= 3).toBe(true)
    for (const [key, w] of Object.entries(RECORDER_LINE)) if (key !== 'axis') expect(w).toBeGreaterThanOrEqual(3)
    expect(trace.h).toEqual(before.h)
    expect(trace.ref).toEqual(before.ref)
    expect(trace.t).toEqual(before.t)
    expect(trace.u).toEqual(before.u)
    expect(trace.length).toBe(before.length)
    expect(s.markers).toEqual(before.markers)
    expect(s.planes[0]!.results).toEqual(before.results)
  })

  it('labels only the target before Fly', () => {
    const s = fixtureSnapshot()
    const empty: Snapshot = { ...s, planes: s.planes.map((p) => ({ ...p, results: [] })), trace: {} }
    const { ctx, calls } = recordingContext()
    draw(ctx, empty, LIGHT, { width: 1000, height: 240, dpr: 1 })
    expect(calls).toContain('text=Target')
    expect(calls).not.toContain('text=Altitude')
    expect(calls).not.toContain('text=Elevator')
    expect(calls).not.toContain(`fillStyle=${SCENE.ringHit}`)
  })

  it('strokes the wingman line in the ghost color under the altitude line, with a Wingman legend entry', () => {
    const base = fixtureSnapshot()
    const player = base.planes[0]!
    const s = { ...base, planes: [player, { ...player, id: 'wingman' as const }], trace: { player: base.trace.player!, wingman: base.trace.player! } }
    const { ctx, calls } = recordingContext()
    draw(ctx, s, LIGHT, { width: 1000, height: 240, dpr: 1 })
    const ghost = calls.indexOf(`strokeStyle=${LIGHT.ghost}`)
    expect(ghost).toBeGreaterThan(-1)
    expect(ghost).toBeLessThan(calls.indexOf(`strokeStyle=${LIGHT.accent}`))
    expect(calls[ghost - 1]).toBe(`lineWidth=${RECORDER_LINE.altitude}`)
    expect(calls).toContain('text=Wingman')
  })

  it('has no ghost line or Wingman entry without a wingman', () => {
    const { ctx, calls } = recordingContext()
    draw(ctx, fixtureSnapshot(), LIGHT, { width: 1000, height: 240, dpr: 1 })
    expect(calls).not.toContain(`strokeStyle=${LIGHT.ghost}`)
    expect(calls).not.toContain('text=Wingman')
  })

  /** The fixture with noise 2 and the filter on: readings 1 m high, the estimate 0.5 m low from row 10. */
  function sensorSnapshot(kalman: number): Snapshot {
    const base = fixtureSnapshot()
    const tr = base.trace.player!
    const copy = createTrace(tr.length)
    copy.length = tr.length
    for (let i = 0; i < tr.length; i++) {
      copy.t[i] = tr.t[i]
      copy.ref[i] = tr.ref[i]
      copy.h[i] = tr.h[i]
      copy.hMeas[i] = tr.h[i] + 1
      copy.hEst[i] = i >= 10 && kalman ? tr.h[i] - 0.5 : copy.hMeas[i]
      copy.u[i] = tr.u[i]
      copy.noise[i] = 2
      copy.kalman[i] = i >= 10 && kalman ? 1 : 0
    }
    return { ...base, trace: { player: copy }, conditions: { ...base.conditions, noise: 2, kalman } }
  }

  it('paints readings as gray dots under the lines and the estimate in Amber above the altitude', () => {
    for (const theme of [LIGHT, DARK]) {
      const { ctx, calls } = recordingContext()
      draw(ctx, sensorSnapshot(1), theme, { width: 1000, height: 240, dpr: 1 })
      const alpha = calls.indexOf(`globalAlpha=${READING_ALPHA}`)
      expect(alpha).toBeGreaterThan(-1)
      expect(calls[alpha + 1]).toBe(`fillStyle=${theme.muted}`)
      const dots = calls.filter((c) => c.startsWith('fillRect=[') && JSON.parse(c.slice('fillRect='.length))[2] === 4)
      expect(dots.length).toBe(Math.ceil(sensorSnapshot(1).trace.player!.length / 3))
      for (const d of dots) expect(JSON.parse(d.slice('fillRect='.length))[3]).toBe(4)
      const accent = calls.indexOf(`strokeStyle=${theme.accent}`)
      const amber = calls.indexOf(`strokeStyle=${theme.amber}`)
      expect(alpha).toBeLessThan(accent)
      expect(accent).toBeLessThan(amber)
      expect(calls[amber - 1]).toBe(`lineWidth=${RECORDER_LINE.estimate}`)
      expect(amber).toBeLessThan(calls.indexOf(`strokeStyle=${theme.muted}`, amber))
      const legend = calls.filter((c) => c.startsWith('text=')).slice(-5)
      expect(legend).toEqual(['text=Target', 'text=Altitude', 'text=Altimeter', 'text=Kalman estimate', 'text=Elevator'])
      // The altimeter swatch is dotted, in the reading gray.
      expect(calls.join('\n')).toContain(`setLineDash=[[3,5]]\nlineWidth=3\nstrokeStyle=${theme.muted}`)
    }
  })

  it('has no dots, estimate or entries without noise or the filter', () => {
    const { ctx, calls } = recordingContext()
    draw(ctx, fixtureSnapshot(), LIGHT, { width: 1000, height: 240, dpr: 1 })
    expect(calls).not.toContain(`globalAlpha=${READING_ALPHA}`)
    expect(calls).not.toContain(`strokeStyle=${LIGHT.amber}`)
    expect(calls).not.toContain('text=Altimeter')
    expect(calls).not.toContain('text=Kalman estimate')
  })

  it('never writes into the snapshot', () => {
    const s = sensorSnapshot(1)
    const t = s.trace.player!
    const cols = () => [t.t, t.h, t.hMeas, t.hEst, t.u, t.noise, t.kalman].map((c) => Array.from(c))
    const before = JSON.stringify([s.conditions, s.planes, s.markers, cols()])
    const { ctx } = recordingContext()
    draw(ctx, s, LIGHT, { width: 1000, height: 240, dpr: 1 })
    expect(JSON.stringify([s.conditions, s.planes, s.markers, cols()])).toBe(before)
  })
})
