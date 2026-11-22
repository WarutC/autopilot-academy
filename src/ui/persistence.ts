// The browser's memory of the player's settings: one versioned JSON object in
// localStorage. This is the only module that touches storage, and it never
// throws: blocked, full or corrupt storage just means defaults.

import { defaultParams, type AlgorithmModule } from '../algorithms/index.ts'
import type { Conditions, FlightMode } from '../sim/types.ts'
import { defaultConditions, mergeConditions } from './conditions.ts'
import { clampValue } from './params.ts'

export const STORAGE_KEY = 'autopilot-academy.v1'
export const SETTINGS_VERSION = 1
/** The course flown until the player picks another. */
export const DEFAULT_COURSE = 101
/** The lesson selected on a first visit, when it is registered. */
export const DEFAULT_LESSON = 'pid'
/** The highest course number. */
export const MAX_COURSE = 99999

export interface Settings {
  readonly lesson: string
  /** The mode the player picked per lesson; a lesson missing here flies its default mode. */
  readonly modes: Readonly<Record<string, FlightMode>>
  /** Every registered lesson's params, complete. */
  readonly params: Readonly<Record<string, Readonly<Record<string, number>>>>
  readonly course: number
  /** The flight conditions, complete. */
  readonly conditions: Conditions
  /** The lesson flown as the wingman, always one offering Autopilot; null for none. */
  readonly wingman: string | null
}

/** Returns the storage, or undefined; obtaining it can itself throw when site data is blocked. */
export type StorageGetter = () => Storage | undefined

/** The browser's localStorage; loadSettings and saveSettings call it inside try/catch, since reading it throws when site data is blocked. */
export const browserStorage: StorageGetter = () => window.localStorage

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** The default lesson when registered, else the first registered one. */
export function firstLesson(modules: readonly AlgorithmModule[]): string {
  return modules.some((m) => m.id === DEFAULT_LESSON) ? DEFAULT_LESSON : (modules[0]?.id ?? DEFAULT_LESSON)
}

/** True when `id` is a registered lesson whose modes include Autopilot, so it can fly as the wingman. */
export function validWingman(id: unknown, modules: readonly AlgorithmModule[]): id is string {
  return typeof id === 'string' && modules.some((m) => m.id === id && m.modes.includes('autopilot'))
}

/** A course number is an integer from 1 to MAX_COURSE. */
export function validCourse(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= MAX_COURSE
}

export function defaultSettings(modules: readonly AlgorithmModule[]): Settings {
  return {
    lesson: firstLesson(modules),
    modes: {},
    params: Object.fromEntries(modules.map((m) => [m.id, defaultParams(m)])),
    course: DEFAULT_COURSE,
    conditions: defaultConditions(),
    wingman: null,
  }
}

/** The module's defaults, overridden by each stored key that is a spec key holding a finite number, clamped. */
export function mergeParams(module: AlgorithmModule, stored: unknown): Record<string, number> {
  const params = defaultParams(module)
  if (!isRecord(stored)) return params
  for (const spec of module.params) {
    const value = stored[spec.key]
    if (typeof value !== 'number' || !Number.isFinite(value)) continue
    const clamped = clampValue(spec, value)
    if (clamped !== undefined) params[spec.key] = clamped
  }
  return params
}

/** Settings from the stored text; anything missing, unknown or invalid falls back to its default. */
export function parseSettings(text: string | null, modules: readonly AlgorithmModule[]): Settings {
  const defaults = defaultSettings(modules)
  if (text === null) return defaults
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    return defaults
  }
  if (!isRecord(data) || data.version !== SETTINGS_VERSION) return defaults

  const lesson =
    typeof data.lesson === 'string' && modules.some((m) => m.id === data.lesson) ? data.lesson : defaults.lesson

  const modes: Record<string, FlightMode> = {}
  if (isRecord(data.modes)) {
    for (const m of modules) {
      const mode = data.modes[m.id]
      if (typeof mode === 'string' && (m.modes as readonly string[]).includes(mode)) modes[m.id] = mode as FlightMode
    }
  }

  const storedParams = isRecord(data.params) ? data.params : {}
  const params = Object.fromEntries(modules.map((m) => [m.id, mergeParams(m, storedParams[m.id])]))

  const course = validCourse(data.course) ? data.course : DEFAULT_COURSE

  const conditions = mergeConditions(data.conditions)

  const wingman = validWingman(data.wingman, modules) ? data.wingman : null

  return { lesson, modes, params, course, conditions, wingman }
}

/** The stored settings, or defaults when storage is missing, blocked or holds something unusable. */
export function loadSettings(getStorage: StorageGetter, modules: readonly AlgorithmModule[]): Settings {
  let text: string | null = null
  try {
    text = getStorage()?.getItem(STORAGE_KEY) ?? null
  } catch {
    text = null
  }
  return parseSettings(text, modules)
}

/** Writes the settings; false when storage is missing, blocked or full. */
export function saveSettings(getStorage: StorageGetter, settings: Settings): boolean {
  try {
    const storage = getStorage()
    if (!storage) return false
    storage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        version: SETTINGS_VERSION,
        lesson: settings.lesson,
        modes: settings.modes,
        params: settings.params,
        course: settings.course,
        conditions: settings.conditions,
        wingman: settings.wingman,
      }),
    )
    return true
  } catch {
    return false
  }
}
