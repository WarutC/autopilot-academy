// The flight conditions the player sets: their specs, defaults and the merge
// and clamp rules the store and storage share. One source of keys and ranges.

import type { ParamSpec } from '../algorithms/index.ts'
import type { Conditions } from '../sim/types.ts'
import { clampValue } from './params.ts'

export const CONDITION_SPECS: readonly ParamSpec[] = [
  {
    key: 'down',
    label: 'Steady downdraft',
    accessibleName: 'Steady downdraft, meters per second squared',
    unit: 'm/s²',
    min: 0,
    max: 10,
    step: 0.5,
    default: 0,
  },
  {
    key: 'gusts',
    label: 'Gusts',
    accessibleName: 'Gusts, meters per second squared, rms',
    unit: 'm/s², rms',
    min: 0,
    max: 20,
    step: 0.5,
    default: 0,
  },
  {
    key: 'noise',
    label: 'Altimeter noise σ',
    accessibleName: 'Altimeter noise sigma, meters',
    unit: 'm',
    min: 0,
    max: 5,
    step: 0.1,
    default: 0,
  },
  {
    key: 'kalman',
    label: 'Kalman filter',
    accessibleName: 'Kalman filter',
    min: 0,
    max: 1,
    step: 1,
    default: 0,
    toggle: true,
  },
  {
    key: 'kq',
    label: 'Q, process noise',
    accessibleName: 'Q, process noise',
    min: 0.1,
    max: 1000,
    step: 0.1,
    default: 10,
    log: true,
  },
  {
    key: 'kr',
    label: 'R, assumed sensor variance',
    accessibleName: 'R, assumed sensor variance, square meters',
    unit: 'm²',
    min: 0.1,
    max: 100,
    step: 0.1,
    default: 4,
    log: true,
  },
]

/** The conditions the Flight conditions card shows rows for. */
export const CARD_CONDITIONS: readonly (keyof Conditions)[] = ['down', 'gusts']

function specOf(key: string): ParamSpec | undefined {
  return CONDITION_SPECS.find((s) => s.key === key)
}

/** Every condition at its default. */
export function defaultConditions(): Conditions {
  return Object.fromEntries(CONDITION_SPECS.map((s) => [s.key, s.default])) as unknown as Conditions
}

/** `value` clamped and snapped for condition `key`; undefined for an unknown key or a non-finite value. */
export function clampCondition(key: string, value: number): number | undefined {
  const spec = specOf(key)
  if (!spec || typeof value !== 'number' || !Number.isFinite(value)) return undefined
  return clampValue(spec, value)
}

/** The defaults, overridden by each stored key that is a condition key holding a finite number, clamped. */
export function mergeConditions(stored: unknown): Conditions {
  const conditions: Record<string, number> = { ...defaultConditions() }
  if (typeof stored !== 'object' || stored === null || Array.isArray(stored)) return conditions as unknown as Conditions
  const record = stored as Record<string, unknown>
  for (const spec of CONDITION_SPECS) {
    const value = record[spec.key]
    if (typeof value !== 'number') continue
    const clamped = clampCondition(spec.key, value)
    if (clamped !== undefined) conditions[spec.key] = clamped
  }
  return conditions as unknown as Conditions
}
