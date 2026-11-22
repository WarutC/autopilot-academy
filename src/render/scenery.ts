// The scenery behind the flight scene, worked out from the course number alone:
// time of day, terrain, and where every cloud, ridge, building, wave and star
// sits. Pure: every random draw comes from the course's scenery stream, every x
// is in course meters on its parallax layer, and every y or size is a fraction
// of the scene height, so any screen shows the same picture for one course.

import { stream } from '../sim/rng.ts'

export type TimeOfDay = 'morning' | 'afternoon' | 'sunset' | 'night'
export type Terrain = 'mountains' | 'coast' | 'desert' | 'city'

/** In stream draw order: the first draw picks the time, the second the terrain. */
export const TIMES_OF_DAY: readonly TimeOfDay[] = ['morning', 'afternoon', 'sunset', 'night']
export const TERRAINS: readonly Terrain[] = ['mountains', 'coast', 'desert', 'city']

export interface Cloud {
  /** Center on the cloud layer within one `CLOUD_PERIOD`, m. */
  readonly x: number
  /** Center, fraction of scene height. */
  readonly y: number
  /** Radius of the main blob, fraction of scene height. */
  readonly size: number
}

/** Phases of the three sine terms of a ridge line, radians. */
export type RidgePhases = readonly [number, number, number]

export interface Building {
  /** Left edge on its layer within one period, m. */
  readonly x: number
  /** Width, m. */
  readonly width: number
  /** Height above the layer base, fraction of scene height. */
  readonly height: number
  /** Window grid. */
  readonly cols: number
  readonly rows: number
  /** Whether each window is lit, row by row (`row * cols + col`). */
  readonly lit: readonly boolean[]
}

export interface CityLayer {
  /** The layer repeats every this many meters. */
  readonly period: number
  readonly buildings: readonly Building[]
}

export interface Star {
  /** Fraction of scene width. */
  readonly x: number
  /** Fraction of 0.6 × scene height. */
  readonly y: number
}

export interface Scenery {
  readonly course: number
  readonly time: TimeOfDay
  readonly terrain: Terrain
  /** One `CLOUD_PERIOD` of clouds. */
  readonly clouds: readonly Cloud[]
  readonly ridges: { readonly far: RidgePhases; readonly near: RidgePhases }
  readonly city: { readonly far: CityLayer; readonly near: CityLayer }
  /** Per wave row, the offset of each wave in its `WAVE_GAP` slot, m; a row repeats every `WAVE_PERIOD`. */
  readonly waves: readonly (readonly number[])[]
  readonly stars: readonly Star[]
}

export interface SkyStyle {
  /** Gradient stops from the top of the scene to the bottom. */
  readonly sky: ReadonlyArray<readonly [offset: number, color: string]>
  readonly orb: string
  /** Orb center, fractions of scene width and height. */
  readonly orbX: number
  readonly orbY: number
  readonly cloud: string
  readonly stars: boolean
  /** Window color in the city. */
  readonly window: string
}

export const TIMES: Readonly<Record<TimeOfDay, SkyStyle>> = {
  morning: {
    sky: [[0, '#4F9FD9'], [0.5, '#A6D6F0'], [0.75, '#FBE7C4'], [0.92, '#F6CFA0']],
    orb: '#FFF4CC',
    orbX: 0.16,
    orbY: 0.34,
    cloud: '#FFFFFF',
    stars: false,
    window: 'rgba(255, 255, 255, 0.6)',
  },
  afternoon: {
    sky: [[0, '#2B7FC4'], [0.55, '#7EC3EC'], [0.85, '#CBEAF7']],
    orb: '#FFF8DC',
    orbX: 0.78,
    orbY: 0.13,
    cloud: '#FFFFFF',
    stars: false,
    window: 'rgba(255, 255, 255, 0.6)',
  },
  sunset: {
    sky: [[0, '#2B7FC4'], [0.5, '#7EC3EC'], [0.74, '#F7E38E'], [0.9, '#F2A65A']],
    orb: '#FFE2A6',
    orbX: 0.82,
    orbY: 0.52,
    cloud: '#FFF4E8',
    stars: false,
    window: 'rgba(255, 255, 255, 0.6)',
  },
  night: {
    sky: [[0, '#0A1430'], [0.6, '#1E3366'], [0.9, '#3B4F86']],
    orb: '#F1F3FF',
    orbX: 0.75,
    orbY: 0.16,
    cloud: '#AEB9D6',
    stars: true,
    window: '#FFD86B',
  },
}

/** Star color. */
export const STAR = 'rgba(255, 255, 255, 0.85)'
/** Wave crest color on the sea. */
export const WAVE = 'rgba(255, 255, 255, 0.75)'

/** How much night darkens the land: each channel moves this share toward `NIGHT_TINT`. */
export const NIGHT_SHADE = 0.42
export const NIGHT_TINT: readonly [number, number, number] = [10, 20, 48]

export interface TerrainColors {
  /** Far ridge, or far buildings. */
  readonly far: string
  /** Near ridge, sea, or near buildings. */
  readonly near: string
  /** Snow on the far ridge, mountains only. */
  readonly snow?: string
  readonly ground: string
}

/** Land colors by day. */
export const TERRAIN_DAY: Readonly<Record<Terrain, TerrainColors>> = {
  mountains: { far: '#2E8B4E', near: '#69C447', snow: '#FFFFFF', ground: '#58B43C' },
  coast: { far: '#3E9A5A', near: '#2F86C4', ground: '#EBCF8E' },
  desert: { far: '#C9773F', near: '#E8B567', ground: '#E3B160' },
  city: { far: '#8FA3C0', near: '#56688A', ground: '#5E6E80' },
}

/** The day colors mixed `NIGHT_SHADE` toward `NIGHT_TINT`. */
export const TERRAIN_NIGHT: Readonly<Record<Terrain, TerrainColors>> = {
  mountains: { far: '#1F5941', near: '#417A3D', snow: '#989CA8', ground: '#377137' },
  coast: { far: '#286248', near: '#1F5686', ground: '#8D8067' },
  desert: { far: '#794D39', near: '#8B7150', ground: '#886F4C' },
  city: { far: '#576784', near: '#364564', ground: '#3B485E' },
}

export function terrainColors(scenery: Pick<Scenery, 'time' | 'terrain'>): TerrainColors {
  return (scenery.time === 'night' ? TERRAIN_NIGHT : TERRAIN_DAY)[scenery.terrain]
}

/** A ridge layer: base line and height of the ridge above it, fractions of scene height. */
export interface RidgeLayer {
  readonly base: number
  readonly amp: number
  /** Flattens the ridge above this share of `amp` into mesas. */
  readonly flat?: number
  /** Snow covers the ridge above this share of `amp`. */
  readonly snowAt?: number
}

/** The ridges each terrain shows; the coast's near layer is the sea and the city has buildings instead. */
export const RIDGES: Readonly<Record<Terrain, { readonly far?: RidgeLayer; readonly near?: RidgeLayer }>> = {
  mountains: { far: { base: 0.82, amp: 0.22, snowAt: 0.74 }, near: { base: 0.95, amp: 0.09 } },
  coast: { far: { base: 0.8, amp: 0.12 } },
  desert: { far: { base: 0.84, amp: 0.24, flat: 0.62 }, near: { base: 0.95, amp: 0.07 } },
  city: {},
}

/** Top of the sea on the coast, fraction of scene height; it reaches down to the ground. */
export const SEA_TOP = 0.8

/** City layers: base line (`ground` for the ground line) and tallest building, fractions of scene height. */
export const CITY = {
  far: { base: 0.9, maxHeight: 0.22, slot: 16 },
  near: { base: 'ground', maxHeight: 0.32, slot: 23 },
} as const

/** Buildings per city layer period. */
export const CITY_SLOTS = 24

/** Clouds repeat every this many meters on their layer, `CLOUDS_PER_PERIOD` at a time. */
export const CLOUD_PERIOD = 1600
/** Radius of a cloud's main blob ranges from `CLOUD_SIZE_MIN` to `CLOUD_SIZE_MAX`, fractions of scene height. */
export const CLOUD_SIZE_MIN = 0.045
export const CLOUD_SIZE_MAX = 0.075
export const CLOUDS_PER_PERIOD = 8

/** Wave rows on the sea, the spacing of waves in a row, and the length after which a row repeats, m. */
export const WAVE_ROWS = 3
export const WAVE_GAP = 25
export const WAVES_PER_ROW = 16
export const WAVE_PERIOD = WAVE_GAP * WAVES_PER_ROW
/** Most a wave moves inside its slot, m. */
const WAVE_JITTER = 11

export const STAR_COUNT = 60

/** How far each layer moves per meter the camera moves. */
export const PARALLAX = {
  sky: 0,
  stars: 0,
  orb: 0,
  clouds: 0.35,
  far: 0.15,
  near: 0.45,
  ground: 1,
} as const

export type Layer = keyof typeof PARALLAX
export type LayerOffsets = Readonly<Record<Layer, number>>

/** Each layer's offset in meters for the camera at `camX`; all zero under reduced motion. */
export function layerOffsets(camX: number, reducedMotion: boolean): LayerOffsets {
  const out = {} as Record<Layer, number>
  for (const layer of Object.keys(PARALLAX) as Layer[]) out[layer] = reducedMotion ? 0 : PARALLAX[layer] * camX
  return out
}

/** Ridge frequencies per meter. */
const RIDGE_FREQ: readonly [number, number, number] = [0.03, 0.075, 0.175]

/** The ridge line at layer distance `u` m, about 0 to 1 of its layer's `amp`. */
export function ridgeHeight(u: number, phases: RidgePhases): number {
  return (
    0.5 +
    0.25 * Math.sin(u * RIDGE_FREQ[0] + phases[0]) +
    0.15 * Math.sin(u * RIDGE_FREQ[1] + phases[1]) +
    0.1 * Math.sin(u * RIDGE_FREQ[2] + phases[2])
  )
}

/**
 * The starts of every period of length `period` with a feature that can reach
 * the span `left` to `right` (m on its layer), for features placed in
 * `[0, period)` of their period. Widen `left` by how far a feature reaches
 * left of its x.
 */
export function periodStarts(left: number, right: number, period: number): number[] {
  const out: number[] = []
  if (!(period > 0) || !(right >= left)) return out
  for (let k = Math.floor(left / period) - 1; k * period <= right; k++) out.push(k * period)
  return out
}

function cityLayer(rng: () => number, slot: number, maxHeight: number): CityLayer {
  const buildings: Building[] = []
  for (let i = 0; i < CITY_SLOTS; i++) {
    const width = slot * (0.72 + 0.24 * rng())
    const height = maxHeight * (0.35 + 0.65 * rng())
    const cols = 2 + Math.floor(rng() * 3)
    const rows = 3 + Math.floor(rng() * 6)
    const lit: boolean[] = []
    for (let c = 0; c < cols * rows; c++) lit.push(rng() > 0.5)
    buildings.push({ x: i * slot, width, height, cols, rows, lit })
  }
  return { period: CITY_SLOTS * slot, buildings }
}

const phases = (rng: () => number): RidgePhases => [rng() * 2 * Math.PI, rng() * 2 * Math.PI, rng() * 2 * Math.PI]

/** The scenery of course `course`, the same on every call and every screen. */
export function sceneryFor(course: number): Scenery {
  const rng = stream(course, 'scenery')
  const time = TIMES_OF_DAY[Math.floor(rng() * 4)]!
  const terrain = TERRAINS[Math.floor(rng() * 4)]!

  const slot = CLOUD_PERIOD / CLOUDS_PER_PERIOD
  const clouds: Cloud[] = []
  for (let i = 0; i < CLOUDS_PER_PERIOD; i++) {
    clouds.push({ x: i * slot + rng() * slot * 0.5, y: 0.1 + 0.28 * rng(), size: CLOUD_SIZE_MIN + (CLOUD_SIZE_MAX - CLOUD_SIZE_MIN) * rng() })
  }

  const ridges = { far: phases(rng), near: phases(rng) }
  const city = {
    far: cityLayer(rng, CITY.far.slot, CITY.far.maxHeight),
    near: cityLayer(rng, CITY.near.slot, CITY.near.maxHeight),
  }

  const waves: number[][] = []
  for (let row = 0; row < WAVE_ROWS; row++) {
    const jitters: number[] = []
    for (let i = 0; i < WAVES_PER_ROW; i++) jitters.push(rng() * WAVE_JITTER)
    waves.push(jitters)
  }

  const stars: Star[] = []
  for (let i = 0; i < STAR_COUNT; i++) stars.push({ x: rng(), y: rng() })

  return { course, time, terrain, clouds, ridges, city, waves, stars }
}
