import { describe, expect, it } from 'vitest'
import type { ControlContext, StickInput } from '../sim/types.ts'
import manual from './manual.ts'

const ctx = (input: StickInput): ControlContext =>
  Object.freeze({ t: 0, T: 0.02, ref: 60, h: 50, v: 0, input, refAhead: () => 60 })

describe('manual', () => {
  it('returns the stick as the elevator command', () => {
    const controller = manual.create({})
    for (const input of [-1, 0, 1] as const) expect(controller.compute(ctx(input))).toBe(input)
  })

  it('flies in Manual mode only, with no parameters', () => {
    expect(manual.modes).toEqual(['manual'])
    expect(manual.params).toEqual([])
  })
})
