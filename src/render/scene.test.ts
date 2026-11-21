import { describe, expect, it } from 'vitest'
import { LIGHT } from '../ui/theme.ts'
import { fixtureSnapshot } from './fixture.ts'
import { draw } from './scene.ts'

/** A 2D context stand-in that records every method call. */
function recordingContext(): { ctx: CanvasRenderingContext2D; calls: string[] } {
  const calls: string[] = []
  const gradient = { addColorStop: () => {} }
  const ctx = new Proxy({} as Record<string | symbol, unknown>, {
    get(target, key) {
      if (key in target) return target[key]
      return (..._args: unknown[]) => {
        calls.push(String(key))
        return key === 'createLinearGradient' ? gradient : undefined
      }
    },
    set(target, key, value) {
      target[key] = value
      return true
    },
  })
  return { ctx: ctx as unknown as CanvasRenderingContext2D, calls }
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
})
