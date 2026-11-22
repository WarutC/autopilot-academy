import { describe, expect, it } from 'vitest'
import type { ParamSpec } from '../algorithms/index.ts'
import pid from '../algorithms/pid.ts'
import {
  changeLabel,
  clampValue,
  formatValue,
  fromSlider,
  parseNumber,
  resetChanges,
  sliderRange,
  stepDecimals,
  toSlider,
} from './params.ts'

const spec = (key: string): ParamSpec => pid.params.find((p) => p.key === key)!
const Kd = spec('Kd')
const Kp = spec('Kp')
const aw = spec('aw')
const Q: ParamSpec = { key: 'Q', label: 'Q', accessibleName: 'Q weight', min: 0.01, max: 100, step: 0.01, default: 1, log: true }
const logFromZero: ParamSpec = { ...Q, min: 0 }

describe('stepDecimals', () => {
  it('counts the decimals of the step', () => {
    expect(stepDecimals(1)).toBe(0)
    expect(stepDecimals(0.01)).toBe(2)
    expect(stepDecimals(0.005)).toBe(3)
    expect(stepDecimals(0)).toBe(0)
    expect(stepDecimals(NaN)).toBe(0)
  })
})

describe('formatValue', () => {
  it('uses the step decimals and trims trailing zeros', () => {
    expect(formatValue(Kd, 0)).toBe('0')
    expect(formatValue(Kd, 0.05)).toBe('0.05')
    expect(formatValue(Kd, 0.055)).toBe('0.055')
    expect(formatValue(Kp, 0.2)).toBe('0.2')
    expect(formatValue(Kp, 1)).toBe('1')
    expect(formatValue(Kd, 0.1 + 0.2)).toBe('0.3')
    expect(formatValue(Kd, -0.0001)).toBe('0')
  })
})

describe('changeLabel', () => {
  it('reads "<key> <old> → <new>"', () => {
    expect(changeLabel(Kd, 0, 0.05)).toBe('Kd 0 → 0.05')
    expect(changeLabel(Kp, 0.5, 0.2)).toBe('Kp 0.5 → 0.2')
  })

  it('reads toggles as on and off', () => {
    expect(changeLabel(aw, 1, 0)).toBe('aw on → off')
  })
})

describe('clampValue', () => {
  it('clamps to the range and rounds to the step decimals', () => {
    expect(clampValue(Kd, -1)).toBe(0)
    expect(clampValue(Kd, 9)).toBe(0.3)
    expect(clampValue(Kd, 0.05)).toBe(0.05)
    expect(clampValue(Kd, 0.1 + 0.2)).toBe(0.3)
    expect(clampValue(Kd, Infinity)).toBe(0.3)
    expect(clampValue(Kd, -Infinity)).toBe(0)
  })

  it('snaps to the nearest multiple of the step, as the slider does', () => {
    expect(clampValue(Kd, 0.053)).toBe(0.055)
    expect(clampValue(Kd, 0.052)).toBe(0.05)
    expect(clampValue(Kp, 0.123)).toBe(0.12)
    expect(clampValue(Q, 0.013)).toBe(0.01)
  })

  it('reads a decimal comma as a decimal point', () => {
    expect(parseNumber('0,05')).toBe(0.05)
    expect(parseNumber(' 1,5 ')).toBe(1.5)
    expect(parseNumber('0.05')).toBe(0.05)
    expect(parseNumber('1,2,3')).toBeNaN()
    expect(parseNumber('1.2,3')).toBeNaN()
  })

  it('gives undefined for NaN', () => {
    expect(clampValue(Kd, NaN)).toBeUndefined()
    expect(clampValue(Kd, parseNumber('abc'))).toBeUndefined()
    expect(clampValue(Kd, parseNumber('  '))).toBeUndefined()
  })

  it('makes toggles 0 or 1', () => {
    expect(clampValue(aw, 0)).toBe(0)
    expect(clampValue(aw, 0.4)).toBe(1)
    expect(clampValue(aw, NaN)).toBeUndefined()
  })
})

describe('slider mapping', () => {
  it('is linear without log', () => {
    expect(sliderRange(Kd)).toEqual({ min: 0, max: 0.3, step: 0.005 })
    expect(toSlider(Kd, 0.05)).toBe(0.05)
    expect(fromSlider(Kd, 0.05)).toBe(0.05)
    expect(fromSlider(Kd, 0.3000001)).toBe(0.3)
  })

  it('maps log10 when log is set and min is above 0', () => {
    expect(sliderRange(Q)).toEqual({ min: -2, max: 2, step: 'any' })
    expect(toSlider(Q, 10)).toBeCloseTo(1, 12)
    expect(fromSlider(Q, 1)).toBe(10)
    expect(fromSlider(Q, toSlider(Q, 0.5))).toBe(0.5)
    expect(fromSlider(Q, 5)).toBe(100)
  })

  it('stays linear for a log spec whose min is 0', () => {
    expect(sliderRange(logFromZero).min).toBe(0)
    expect(toSlider(logFromZero, 3)).toBe(3)
  })
})

describe('resetChanges', () => {
  it('lists only the keys away from their default, with their labels', () => {
    const params = { Kp: 0.5, Ki: 0.03, Kd: 0, aw: 1, dmeas: 1 }
    expect(resetChanges(pid.params, params)).toEqual([
      { key: 'Kp', value: 0.2, label: 'Kp 0.5 → 0.2' },
      { key: 'Kd', value: 0.05, label: 'Kd 0 → 0.05' },
    ])
  })

  it('is empty when nothing changed', () => {
    expect(resetChanges(pid.params, { Kp: 0.2, Ki: 0.03, Kd: 0.05, aw: 1, dmeas: 1 })).toEqual([])
  })
})
