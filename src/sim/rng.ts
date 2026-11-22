// Seeded randomness. `stream(course, name)` is the only seed derivation.

export type Rng = () => number

export type StreamName = 'rings' | 'gusts' | 'scenery' | 'sensor:player' | 'sensor:wingman'

/** mulberry32: uniform numbers in [0, 1) from a 32-bit seed. */
export function mulberry32(seed: number): Rng {
  let a = seed | 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** 32-bit FNV-1a hash of a string's UTF-16 code units. */
export function fnv1a(text: string): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

/** The random stream named `name` for course number `course`. */
export function stream(course: number, name: StreamName): Rng {
  const seed = (Math.imul(course >>> 0, 0x9e3779b1) ^ fnv1a(name)) >>> 0
  return mulberry32(seed)
}

/** A standard normal sample (Box-Muller). */
export function gauss(rng: Rng): number {
  let u = rng()
  while (u <= 1e-12) u = rng()
  const v = rng()
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
}
