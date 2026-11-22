import { describe, expect, it } from 'vitest'
import { defaultParams } from './index.ts'
import onOff from './on-off.ts'
import { controlContext as ctx, fliesCourse101 } from './lib/testing.ts'

describe('on-off module', () => {
  it('declares its id, modes and the output level and hysteresis parameters', () => {
    expect(onOff.id).toBe('on-off')
    expect(onOff.name).toBe('On-Off')
    expect(onOff.tag).toBe('Bang-bang')
    expect(onOff.modes).toEqual(['semi-auto', 'autopilot'])
    expect(onOff.params).toHaveLength(2)
    expect(onOff.params[0]).toMatchObject({
      key: 'U',
      label: 'Output level',
      accessibleName: 'Output level',
      min: 0.1,
      max: 1,
      step: 0.05,
      default: 0.4,
    })
    expect(onOff.params[1]).toMatchObject({
      key: 'hyst',
      label: 'Hysteresis (m either side)',
      accessibleName: 'Hysteresis, meters either side of the target',
      min: 0,
      max: 10,
      step: 0.5,
      default: 0.5,
    })
  })

  it('ends its lesson with a Try: sentence about the hysteresis band, with no HTML', () => {
    expect(onOff.lesson).toMatch(/Try: [^.]*\.$/)
    const tryText = onOff.lesson.slice(onOff.lesson.indexOf('Try:'))
    expect(tryText).toContain('hysteresis band')
    expect(tryText).toContain('accuracy')
    expect(onOff.lesson).toContain('square wave')
    expect(onOff.lesson).not.toMatch(/</)
  })

  it('has no analysis, so the Pole readout stays hidden', () => {
    expect(onOff.analysis).toBeUndefined()
  })
})

describe('on-off controller', () => {
  it('starts at 0 while the error is inside the band', () => {
    const c = onOff.create(defaultParams(onOff))
    expect(c.compute(ctx({ ref: 50, h: 50 }))).toBe(0)
    expect(c.compute(ctx({ ref: 50.4, h: 50 }))).toBe(0)
    expect(c.compute(ctx({ ref: 50, h: 50.5 }))).toBe(0)
  })

  it('switches to +U above the band and −U below it', () => {
    const c = onOff.create(defaultParams(onOff))
    expect(c.compute(ctx({ ref: 51, h: 50 }))).toBe(0.4)
    expect(c.compute(ctx({ ref: 50, h: 51 }))).toBe(-0.4)
    expect(c.compute(ctx({ ref: 60, h: 50 }))).toBe(0.4)
  })

  it('holds its last output inside the band', () => {
    const c = onOff.create({ U: 0.6, hyst: 2 })
    expect(c.compute(ctx({ ref: 53, h: 50 }))).toBe(0.6)
    expect(c.compute(ctx({ ref: 50, h: 50 }))).toBe(0.6)
    expect(c.compute(ctx({ ref: 50, h: 51.9 }))).toBe(0.6)
    expect(c.compute(ctx({ ref: 50, h: 52.1 }))).toBe(-0.6)
    expect(c.compute(ctx({ ref: 51.5, h: 50 }))).toBe(-0.6)
    expect(c.compute(ctx({ ref: 50, h: 50 }))).toBe(-0.6)
  })

  it('only ever outputs 0 or ±U and changes only when the error leaves the band', () => {
    const U = 0.45
    const hyst = 1.5
    const c = onOff.create({ U, hyst })
    // Deterministic pseudo-random errors in [−5, 5].
    let seed = 12345
    const next = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648
      return seed / 2147483648
    }
    let prev = 0
    let changes = 0
    for (let i = 0; i < 5000; i++) {
      const e = next() * 10 - 5
      const u = c.compute(ctx({ ref: 50 + e, h: 50 }))
      expect([0, U, -U]).toContain(u)
      if (u !== prev) {
        expect(Math.abs(e)).toBeGreaterThan(hyst)
        changes++
      }
      prev = u
    }
    expect(changes).toBeGreaterThan(10)
  })

  it('reads its parameters live on every call', () => {
    const params: Record<string, number> = { U: 0.4, hyst: 0.5 }
    const c = onOff.create(params)
    expect(c.compute(ctx({ ref: 52, h: 50 }))).toBe(0.4)
    params.U = 0.8
    expect(c.compute(ctx({ ref: 52, h: 50 }))).toBe(0.8)
    params.hyst = 5
    expect(c.compute(ctx({ ref: 50, h: 53 }))).toBe(0.8)
    expect(c.compute(ctx({ ref: 50, h: 56 }))).toBe(-0.8)
  })

  it('keeps its output for non-finite inputs and returns 0 for a non-finite level', () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(onOff.create({ U: 0.4, hyst: 0.5 }).compute(ctx({ h: bad }))).toBe(0)
      expect(onOff.create({ U: 0.4, hyst: 0.5 }).compute(ctx({ ref: bad }))).toBe(0)
      expect(onOff.create({ U: bad, hyst: 0.5 }).compute(ctx({ ref: 55 }))).toBe(0)
      expect(onOff.create({ U: 0.4, hyst: Number.NaN }).compute(ctx({ ref: 55 }))).toBe(0)

      const c = onOff.create({ U: 0.4, hyst: 0.5 })
      expect(c.compute(ctx({ ref: 55 }))).toBe(0.4)
      expect(c.compute(ctx({ h: bad }))).toBe(0.4)
      expect(c.compute(ctx({ ref: bad }))).toBe(0.4)
    }
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY]) {
      const p2: Record<string, number> = { U: 0.4, hyst: 0.5 }
      const c2 = onOff.create(p2)
      expect(c2.compute(ctx({ ref: 55 }))).toBe(0.4)
      p2.hyst = bad
      expect(c2.compute(ctx({ ref: 45 }))).toBe(0.4)
      expect(c2.compute(ctx({ ref: 55 }))).toBe(0.4)
    }
    const params: Record<string, number> = { U: 0.4, hyst: 0.5 }
    const c = onOff.create(params)
    expect(c.compute(ctx({ ref: 45 }))).toBe(-0.4)
    params.U = Number.NaN
    expect(c.compute(ctx({ ref: 45 }))).toBe(0)
    params.U = 0.4
    expect(c.compute(ctx({ ref: 50 }))).toBe(-0.4)
  })
})

describe('on-off flies course 101', () => {
  fliesCourse101(onOff)
})
