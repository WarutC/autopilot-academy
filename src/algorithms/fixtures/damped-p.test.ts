import { describe, expect, it } from 'vitest'
import readme from '../../../README.md?raw'
import { PLANT } from '../../sim/plant.ts'
import { defaultParams } from '../index.ts'
import { flyCourse } from '../lib/fly-course.ts'
import { polyAt } from '../lib/poly.ts'
import exampleSource from './damped-p.ts?raw'
import dampedP from './damped-p.ts'

describe('damped-p example module', () => {
  it('flies course 101: at least 6 of 10 rings in Autopilot without crashing', () => {
    const flight = flyCourse(dampedP, defaultParams(dampedP), 'autopilot')
    expect(flight.status).not.toBe('crashed')
    expect(flight.ringsPassed).toBeGreaterThanOrEqual(6)
  })

  it('finishes Semi-auto', () => {
    expect(flyCourse(dampedP, defaultParams(dampedP), 'semi-auto').status).toBe('finished')
  })

  it('returns 0 for non-finite results', () => {
    const c = dampedP.create({ Kp: Number.NaN, Kv: 0.05 })
    expect(c.compute({ t: 0, T: 0.02, ref: 60, h: 50, v: 0, input: 0, refAhead: () => 60 })).toBe(0)
  })

  for (const [Kp, Kv] of [[0.1, 0.05], [0.5, 0], [0.02, 0.3], [1, 0.5]] as const) {
    it(`gives the roots of s² + (a + b·Kv)·s + b·Kp for Kp ${Kp}, Kv ${Kv}`, () => {
      const chi = [1, PLANT.a + PLANT.b * Kv, PLANT.b * Kp]
      const poles = dampedP.analysis!({ Kp, Kv }).poles!
      expect(poles).toHaveLength(2)
      for (const s of poles) {
        const r = polyAt(chi, s)
        expect(Math.hypot(r.re, r.im)).toBeLessThan(1e-9)
      }
    })
  }

  it('is the module shown in the README, with import paths for src/algorithms/', () => {
    const block = /## Add an algorithm[\s\S]*?```ts\n([\s\S]*?)```/.exec(readme)
    expect(block).not.toBeNull()
    const asInRegistry = exampleSource
      .replaceAll("'../index.ts'", "'./index.ts'")
      .replaceAll("'../../", "'../")
      .replaceAll("'../lib/", "'./lib/")
    // The file header explains why the fixture exists; the README copy starts at the imports.
    const body = asInRegistry.slice(asInRegistry.search(/^import /m))
    expect(block![1]).toBe(body)
  })
})
