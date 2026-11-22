import { describe, expect, it } from 'vitest'
import { CALM } from '../sim/run.ts'
import { CARD_CONDITIONS, CONDITION_SPECS, KALMAN_CONDITIONS, clampCondition, defaultConditions, mergeConditions } from './conditions.ts'

describe('condition specs', () => {
  it('declares all six conditions, three slider rows and the Kalman tuning on the card', () => {
    expect(CONDITION_SPECS.map((s) => s.key)).toEqual(['down', 'gusts', 'noise', 'kalman', 'kq', 'kr'])
    expect(CARD_CONDITIONS).toEqual(['down', 'gusts', 'noise'])
    expect(KALMAN_CONDITIONS).toEqual(['kq', 'kr'])
    const by = Object.fromEntries(CONDITION_SPECS.map((s) => [s.key, s]))
    expect(by.down).toMatchObject({ min: 0, max: 10, step: 0.5, unit: 'm/s²', label: 'Steady downdraft' })
    expect(by.gusts).toMatchObject({ min: 0, max: 20, step: 0.5, unit: 'm/s², rms', label: 'Gusts' })
    expect(by.noise).toMatchObject({ min: 0, max: 5, step: 0.1, unit: 'm', label: 'Altimeter noise σ' })
    expect(by.kalman).toMatchObject({ toggle: true, label: 'Kalman filter on the altimeter' })
    expect(by.kq).toMatchObject({ log: true, min: 0.1, max: 1000, step: 0.01, default: 10 })
    expect(by.kr).toMatchObject({ log: true, min: 0.1, max: 100, step: 0.01, default: 4, unit: 'm²' })
  })

  it('defaults to the calm conditions a run flies without any', () => {
    expect(defaultConditions()).toEqual(CALM)
  })
})

describe('clampCondition', () => {
  it('clamps and snaps to the step', () => {
    expect(clampCondition('gusts', 99)).toBe(20)
    expect(clampCondition('down', 0.3)).toBe(0.5)
    expect(clampCondition('down', -2)).toBe(0)
    expect(clampCondition('kalman', 0.4)).toBe(1)
    expect(clampCondition('kq', 10)).toBe(10)
    expect(clampCondition('kr', 4)).toBe(4)
    expect(clampCondition('kq', 0.123)).toBe(0.12)
  })

  it('ignores an unknown key or a non-finite value', () => {
    expect(clampCondition('nope', 1)).toBeUndefined()
    expect(clampCondition('gusts', NaN)).toBeUndefined()
    expect(clampCondition('gusts', Infinity)).toBeUndefined()
  })
})

describe('mergeConditions', () => {
  it('keeps valid stored values and drops the rest', () => {
    expect(mergeConditions({ gusts: 'x', down: 50, zzz: 1, noise: 1.23 })).toEqual({
      ...defaultConditions(),
      down: 10,
      noise: 1.2,
    })
  })

  it('gives the defaults for anything but an object', () => {
    for (const stored of [undefined, null, 5, 'x', [1]]) expect(mergeConditions(stored)).toEqual(defaultConditions())
  })
})
