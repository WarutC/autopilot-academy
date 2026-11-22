import { describe, expect, it } from 'vitest'
import { defaultParams } from '../index.ts'
import pid from '../pid.ts'
import { FLY_COURSE, SEMI_AUTO_HIGH, SEMI_AUTO_LOW, SEMI_AUTO_PERIOD, flyCourse, semiAutoSetpoint } from './fly-course.ts'

describe('semiAutoSetpoint', () => {
  it('starts high and switches every period', () => {
    expect(FLY_COURSE).toBe(101)
    expect([SEMI_AUTO_HIGH, SEMI_AUTO_LOW, SEMI_AUTO_PERIOD]).toEqual([80, 30, 5])
    expect(semiAutoSetpoint(0)).toBe(80)
    expect(semiAutoSetpoint(4.99)).toBe(80)
    expect(semiAutoSetpoint(5)).toBe(30)
    expect(semiAutoSetpoint(10)).toBe(80)
    expect(semiAutoSetpoint(17)).toBe(30)
  })
})

describe('flyCourse', () => {
  it('passes all 10 rings of course 101 with PID defaults in Autopilot', () => {
    const flight = flyCourse(pid, defaultParams(pid), 'autopilot')
    expect(flight.status).toBe('finished')
    expect(flight.ringsTotal).toBe(10)
    expect(flight.ringsPassed).toBe(10)
    expect(flight.results).toHaveLength(10)
  })

  it('finishes Semi-auto with PID defaults', () => {
    expect(flyCourse(pid, defaultParams(pid), 'semi-auto').status).toBe('finished')
  })

  it('does not write to the params it is given', () => {
    const params = Object.freeze(defaultParams(pid))
    expect(() => flyCourse(pid, params, 'autopilot')).not.toThrow()
    expect(params).toEqual(defaultParams(pid))
  })
})
