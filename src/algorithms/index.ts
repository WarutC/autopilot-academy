// The algorithm contract and the registry. Every other non-test `.ts` file in
// this folder is an algorithm module whose default export is an
// `AlgorithmModule`; the registry finds them, so adding a lesson needs no
// change anywhere else.

import type { FlightMode } from '../sim/scoring.ts'
import type { Controller } from '../sim/types.ts'

/** How an algorithm can fly a plane; the same union the run and the logbook use. */
export type AlgorithmMode = FlightMode

/** One tunable parameter, shown as a slider or, with `toggle`, a switch. */
export interface ParamSpec {
  /** Key in the params record, such as `Kp`. */
  readonly key: string
  /** Visible label. */
  readonly label: string
  /** Name read by screen readers, such as "Kp, proportional gain". */
  readonly accessibleName: string
  readonly unit?: string
  readonly min: number
  readonly max: number
  readonly step: number
  readonly default: number
  /** The slider maps log10 of the value; the value itself is stored as is. */
  readonly log?: boolean
  /** An on/off switch stored as 0 or 1. */
  readonly toggle?: boolean
}

/** Parameter values by key; toggles are 0 or 1. */
export type Params = Readonly<Record<string, number>>

/** Complex number `re + im·j`. */
export interface Complex {
  readonly re: number
  readonly im: number
}

export interface AlgorithmAnalysis {
  /** Closed-loop poles of the linear, unsaturated loop. */
  readonly poles?: readonly Complex[]
  /** Computed gains, by name. */
  readonly gains?: Readonly<Record<string, number>>
  /** How far ahead the controller looks, in seconds. */
  readonly lookahead?: number
}

export interface AlgorithmModule {
  /** Kebab-case id, equal to the file name. */
  readonly id: string
  readonly name: string
  readonly tag: string
  /** Plain-text lesson ending with a "Try:" sentence. */
  readonly lesson: string
  readonly modes: readonly AlgorithmMode[]
  readonly params: readonly ParamSpec[]
  /**
   * Builds a controller that keeps its own state and reads `params` on every
   * call, so changes to the record take effect on the next tick.
   */
  create(params: Params): Controller
  analysis?(params: Params): AlgorithmAnalysis
}

export type RegisteredAlgorithm = AlgorithmModule & { readonly community: boolean }

/** Built-in lessons in teaching order. Any other module follows as Community. */
export const BUILT_IN_ORDER: readonly string[] = [
  'manual',
  'on-off',
  'p',
  'pi',
  'pd',
  'pid',
  'cascade-pid',
  'pole-placement',
  'lqr',
  'fuzzy',
  'mpc',
]

const KEBAB_CASE = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/

function isAlgorithmModule(value: unknown): value is AlgorithmModule {
  if (typeof value !== 'object' || value === null) return false
  const m = value as Partial<Record<keyof AlgorithmModule, unknown>>
  return (
    typeof m.id === 'string' &&
    typeof m.create === 'function' &&
    Array.isArray(m.params) &&
    Array.isArray(m.modes)
  )
}

/**
 * Turns glob results (file path → module namespace) into the ordered list of
 * algorithms. Files are visited in sorted path order, so when two share an id
 * the first path wins. A file without a valid default export, with a
 * non-kebab-case id, or with a duplicate id is skipped with one warning.
 */
export function buildRegistry(
  entries: Record<string, unknown>,
  warn: (message: string) => void = console.warn,
): RegisteredAlgorithm[] {
  const byId = new Map<string, AlgorithmModule>()
  for (const path of Object.keys(entries).sort()) {
    const namespace = entries[path]
    const candidate =
      typeof namespace === 'object' && namespace !== null
        ? (namespace as { default?: unknown }).default
        : undefined
    if (!isAlgorithmModule(candidate)) {
      warn(`Skipping algorithm file ${path}: its default export is not an algorithm module.`)
      continue
    }
    if (!KEBAB_CASE.test(candidate.id)) {
      warn(`Skipping algorithm file ${path}: id "${candidate.id}" is not kebab-case.`)
      continue
    }
    if (byId.has(candidate.id)) {
      warn(`Skipping algorithm file ${path}: id "${candidate.id}" is already registered.`)
      continue
    }
    byId.set(candidate.id, candidate)
  }

  const builtIns = BUILT_IN_ORDER.flatMap((id) => {
    const m = byId.get(id)
    return m ? [{ ...m, community: false }] : []
  })
  const community = [...byId.values()]
    .filter((m) => !BUILT_IN_ORDER.includes(m.id))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((m) => ({ ...m, community: true }))
  return [...builtIns, ...community]
}

export const algorithms: readonly RegisteredAlgorithm[] = buildRegistry(
  import.meta.glob(['./*.ts', '!./index.ts', '!./*.test.ts'], { eager: true }),
)

export function findAlgorithm(id: string): RegisteredAlgorithm | undefined {
  return algorithms.find((m) => m.id === id)
}

/** A fresh params record holding each parameter's default. */
export function defaultParams(module: AlgorithmModule): Record<string, number> {
  const params: Record<string, number> = {}
  for (const spec of module.params) params[spec.key] = spec.default
  return params
}
