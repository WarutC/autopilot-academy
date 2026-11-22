import { describe, expect, it } from 'vitest'
import { makeCourse, refAt, ringBounds } from './course.ts'
import { PLANT } from './plant.ts'

describe('makeCourse', () => {
  it('gives the same rings for the same course', () => {
    expect(makeCourse(101)).toEqual(makeCourse(101))
  })

  it('gives different rings for different courses', () => {
    expect(makeCourse(101).rings).not.toEqual(makeCourse(102).rings)
  })

  it('keeps course 101 the same across versions', () => {
    // A change here changes every shared course number.
    expect(makeCourse(101).rings.map((r) => r.h)).toEqual([
      66.65258437674493, 23.89941192837432, 66.32025621831417, 54.19208866264671, 80.37898861570284,
      62.72705052699894, 22.825694946106523, 44.619856676552445, 57.482498216442764, 34.03771034022793,
    ])
  })

  it('records the course number', () => {
    expect(makeCourse(4242).number).toBe(4242)
  })

  it('spaces ten rings 160 m apart with reachable height steps', () => {
    for (let n = 1; n <= 500; n++) {
      const { rings, endX } = makeCourse(n)
      expect(rings).toHaveLength(10)
      let prev: number = PLANT.hStart
      rings.forEach((ring, i) => {
        expect(ring.x).toBe(200 + i * 160)
        expect(ring.h).toBeGreaterThanOrEqual(22)
        expect(ring.h).toBeLessThanOrEqual(88)
        const step = Math.abs(ring.h - prev)
        expect(step).toBeGreaterThanOrEqual(10)
        expect(step).toBeLessThanOrEqual(45)
        prev = ring.h
      })
      expect(endX).toBe(rings[9].x + 100)
    }
  })
})

describe('refAt', () => {
  const course = makeCourse(101)

  it('is hStart before the first boundary', () => {
    expect(course.bounds[0]).toBe(120)
    expect(refAt(course, 0)).toBe(PLANT.hStart)
    expect(refAt(course, 119.999)).toBe(PLANT.hStart)
  })

  it("switches to each ring's height at the midpoint before it", () => {
    course.rings.forEach((ring, i) => {
      const boundary = i === 0 ? ring.x - 80 : (course.rings[i - 1].x + ring.x) / 2
      expect(course.bounds[i]).toBe(boundary)
      expect(refAt(course, boundary)).toBe(ring.h)
      expect(refAt(course, ring.x)).toBe(ring.h)
      if (i > 0) expect(refAt(course, boundary - 0.001)).toBe(course.rings[i - 1].h)
    })
    expect(refAt(course, course.endX + 1000)).toBe(course.rings[9].h)
  })
})

describe('ringBounds', () => {
  it('equals the bounds makeCourse returns', () => {
    for (const n of [1, 101, 4242]) {
      const course = makeCourse(n)
      expect(ringBounds(course.rings)).toEqual(course.bounds)
    }
  })

  it('is empty for no rings', () => {
    expect(ringBounds([])).toEqual([])
  })
})
