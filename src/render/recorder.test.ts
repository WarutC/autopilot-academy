import { describe, expect, it } from 'vitest'
import { createTrace } from '../sim/trace.ts'
import type { Snapshot, Trace } from '../sim/types.ts'
import { LIGHT } from '../ui/theme.ts'
import { fixtureSnapshot } from './fixture.ts'
import { RECORDER_FONT, RECORDER_LINE } from './recorder-geometry.ts'
import { draw } from './recorder.ts'
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
        return key === 'measureText' ? { width: String(args[0]).length * 9 } : undefined
      }
    },
    set(target, key, value) {
      if (key === 'lineWidth' || key === 'font' || key === 'strokeStyle' || key === 'fillStyle') calls.push(`${String(key)}=${String(value)}`)
      target[key] = value
      return true
    },
  })
  return { ctx: ctx as unknown as CanvasRenderingContext2D, calls }
}

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
})
