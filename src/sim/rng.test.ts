import { describe, expect, it } from 'vitest'
import { fnv1a, gauss, mulberry32, stream, type StreamName } from './rng.ts'

// The prototype's generator, inlined as the reference.
function prototypeMulberry32(a: number): () => number {
  return function () {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const draws = (rng: () => number, n: number) => Array.from({ length: n }, () => rng())

describe('mulberry32', () => {
  it('matches the prototype bit for bit', () => {
    for (const seed of [0, 1, 101, 2654435761, 0xffffffff, -7]) {
      expect(draws(mulberry32(seed), 1000)).toEqual(draws(prototypeMulberry32(seed), 1000))
    }
  })

  it('stays in [0, 1)', () => {
    for (const x of draws(mulberry32(42), 10000)) {
      expect(x).toBeGreaterThanOrEqual(0)
      expect(x).toBeLessThan(1)
    }
  })
})

describe('fnv1a', () => {
  it('matches the published FNV-1a test vectors', () => {
    expect(fnv1a('')).toBe(0x811c9dc5)
    expect(fnv1a('a')).toBe(0xe40c292c)
    expect(fnv1a('foobar')).toBe(0xbf9cf968)
  })
})

describe('stream', () => {
  const names: StreamName[] = ['rings', 'gusts', 'scenery', 'sensor:player', 'sensor:wingman']

  it('repeats for the same course and name', () => {
    expect(draws(stream(101, 'rings'), 100)).toEqual(draws(stream(101, 'rings'), 100))
  })

  it('differs between stream names', () => {
    const sequences = names.map((name) => draws(stream(101, name), 100))
    for (let i = 0; i < sequences.length; i++) {
      for (let j = i + 1; j < sequences.length; j++) {
        sequences[i].forEach((x, k) => expect(x).not.toBe(sequences[j][k]))
      }
    }
  })

  it('differs between courses', () => {
    expect(draws(stream(101, 'gusts'), 100)).not.toEqual(draws(stream(102, 'gusts'), 100))
  })
})

describe('gauss', () => {
  it('matches the prototype formula', () => {
    const a = mulberry32(7)
    const b = prototypeMulberry32(7)
    for (let i = 0; i < 100; i++) {
      let u = b()
      while (u <= 1e-12) u = b()
      const v = b()
      expect(gauss(a)).toBe(Math.sqrt(-2 * Math.log(u)) * Math.cos(6.283185307179586 * v))
    }
  })

  it('has roughly zero mean and unit variance', () => {
    const rng = stream(101, 'gusts')
    const n = 20000
    const xs = Array.from({ length: n }, () => gauss(rng))
    const mean = xs.reduce((s, x) => s + x, 0) / n
    const variance = xs.reduce((s, x) => s + (x - mean) ** 2, 0) / n
    expect(Math.abs(mean)).toBeLessThan(0.05)
    expect(Math.abs(variance - 1)).toBeLessThan(0.05)
  })
})
