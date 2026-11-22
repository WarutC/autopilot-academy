import { describe, expect, it } from 'vitest'
import { PLANT, inBand, initialPlant, stepPlant, type PlantState } from './plant.ts'

// The prototype's Sim.step update lines, inlined as the reference, with the
// climb-rate damping tuned from the prototype's 1.0 to 0.5.
function prototypeStep(s: { h: number; v: number; x: number; t: number }, u: number, d: number) {
  const { dt, a, b, speed } = { dt: 0.005, a: 0.5, b: 20, speed: 20 }
  s.v += (-a * s.v + b * u + d) * dt
  s.h += s.v * dt
  s.x += speed * dt
  s.t += dt
}
const prototypeInBand = (h: number) => !(h < 6 || h > 110)

describe('PLANT', () => {
  // Pinned because the course, the PID defaults and the scoring are tuned against these values.
  it('pins the tuned constants (a = 0.5)', () => {
    expect(PLANT).toEqual({
      a: 0.5, b: 20, speed: 20, ringGap: 160, ringR: 7, nRings: 10,
      hFloor: 6, hCeil: 110, hStart: 50, dt: 0.005, Tc: 0.02,
    })
  })
})

describe('stepPlant', () => {
  it('starts level at hStart', () => {
    expect(initialPlant()).toEqual({ h: 50, v: 0, x: 0, t: 0 })
  })

  for (const u of [1, -1, 0.3]) {
    it(`follows the prototype for a fixed command u = ${u}`, () => {
      let state: PlantState = initialPlant()
      const ref = { h: 50, v: 0, x: 0, t: 0 }
      for (let i = 0; i < 4000; i++) {
        state = stepPlant(state, u, 0)
        prototypeStep(ref, u, 0)
        expect(Math.abs(state.h - ref.h)).toBeLessThanOrEqual(1e-9)
        expect(Math.abs(state.v - ref.v)).toBeLessThanOrEqual(1e-9)
        expect(Math.abs(state.x - ref.x)).toBeLessThanOrEqual(1e-9)
        expect(Math.abs(state.t - ref.t)).toBeLessThanOrEqual(1e-9)
      }
    })
  }

  it('adds the disturbance as an acceleration', () => {
    let state: PlantState = initialPlant()
    const ref = { h: 50, v: 0, x: 0, t: 0 }
    for (let i = 0; i < 1000; i++) {
      state = stepPlant(state, 0.2, -3)
      prototypeStep(ref, 0.2, -3)
    }
    expect(Math.abs(state.h - ref.h)).toBeLessThanOrEqual(1e-9)
  })

  it('returns a new state and leaves the input unchanged', () => {
    const before = initialPlant()
    const after = stepPlant(before, 1, 0)
    expect(after).not.toBe(before)
    expect(before).toEqual({ h: 50, v: 0, x: 0, t: 0 })
  })

  it('clamps the command and treats NaN as 0, never throwing', () => {
    const s = initialPlant()
    expect(stepPlant(s, 5, 0)).toEqual(stepPlant(s, 1, 0))
    expect(stepPlant(s, -Infinity, 0)).toEqual(stepPlant(s, -1, 0))
    expect(stepPlant(s, NaN, 0)).toEqual(stepPlant(s, 0, 0))
    expect(stepPlant(s, 0, NaN)).toEqual(stepPlant(s, 0, 0))
  })
})

describe('inBand', () => {
  it('holds between the floor and the ceiling, inclusive', () => {
    expect(inBand(6)).toBe(true)
    expect(inBand(110)).toBe(true)
    expect(inBand(5.999)).toBe(false)
    expect(inBand(110.001)).toBe(false)
  })

  for (const u of [1, -1]) {
    it(`leaves the band at the prototype's step for u = ${u}`, () => {
      const firstOut = (step: () => boolean) => {
        for (let i = 0; i < 100000; i++) if (!step()) return i
        return -1
      }
      let state: PlantState = initialPlant()
      const ours = firstOut(() => {
        state = stepPlant(state, u, 0)
        return inBand(state.h)
      })
      const ref = { h: 50, v: 0, x: 0, t: 0 }
      const theirs = firstOut(() => {
        prototypeStep(ref, u, 0)
        return prototypeInBand(ref.h)
      })
      expect(ours).toBeGreaterThan(0)
      expect(ours).toBe(theirs)
    })
  }
})
