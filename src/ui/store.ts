// The player's settings and the flight phase. The store is the only writer of
// settings: it loads them once, validates every change and writes each one
// through to storage. Best scores are settings too. The phase and the
// session's logbook live here as well but are never saved.

import type { AlgorithmModule, Params } from '../algorithms/index.ts'
import type { LogEntry } from '../sim/scoring.ts'
import type { Conditions, FlightMode } from '../sim/types.ts'
import { clampCondition } from './conditions.ts'
import { clampValue } from './params.ts'
import { loadSettings, saveSettings, validCourse, validWingman, type Settings, type StorageGetter } from './persistence.ts'

export type Phase = 'ready' | 'running' | 'paused' | 'ended'

/** Something that holds the flight phase. */
export interface PhaseOwner {
  readonly phase: Phase
  setPhase(phase: Phase): void
}

/** An in-memory phase owner, starting ready. */
export function createPhase(): PhaseOwner {
  let phase: Phase = 'ready'
  return {
    get phase() {
      return phase
    },
    setPhase(p) {
      phase = p
    },
  }
}

export interface Store extends PhaseOwner {
  /** The selected lesson's id. */
  readonly lesson: string
  setLesson(id: string): void
  /** The lesson's flight mode: the player's pick, else Autopilot when offered, else its first mode. */
  mode(id: string): FlightMode
  setMode(id: string, mode: FlightMode): void
  /** The lesson's params; a record handed out is never changed later. */
  params(id: string): Params
  setParam(id: string, key: string, value: number): void
  readonly course: number
  setCourse(course: number): void
  /** The flight conditions; a record handed out is never changed later. */
  readonly conditions: Conditions
  /** Sets condition `key`, clamped and snapped; an unknown key or a non-finite value is ignored. */
  setCondition(key: string, value: number): void
  /** The lesson flown as the wingman, or null for none. */
  readonly wingman: string | null
  /** Sets the wingman; an id that is not a registered lesson offering Autopilot is ignored. */
  setWingman(id: string | null): void
  /** This session's logbook rows, newest first; never saved, empty on every load. */
  readonly logbook: readonly LogEntry[]
  /** Replaces the logbook rows with a copy of `rows`. */
  setLogbook(rows: readonly LogEntry[]): void
  /** The best score per lesson; a record handed out is never changed later. */
  readonly best: Readonly<Record<string, number>>
  /** Sets the lesson's best score; an unregistered lesson or a non-finite value is ignored. */
  setBest(id: string, points: number): void
}

/** A lesson's mode until the player picks another: Autopilot when it has one, else its first mode. */
export function defaultMode(module: AlgorithmModule): FlightMode {
  return module.modes.includes('autopilot') ? 'autopilot' : module.modes[0]!
}

export interface StoreOptions {
  /** Called after each change of the lesson or the course, never for a no-op. */
  onRouteChange?(lesson: string, course: number): void
}

export function createStore(
  modules: readonly AlgorithmModule[],
  getStorage: StorageGetter,
  options: StoreOptions = {},
): Store {
  const phase = createPhase()
  let settings: Settings = loadSettings(getStorage, modules)
  const find = (id: string) => modules.find((m) => m.id === id)
  let logbook: readonly LogEntry[] = []

  function update(next: Partial<Settings>): void {
    settings = { ...settings, ...next }
    saveSettings(getStorage, settings)
  }

  function routeChanged(): void {
    options.onRouteChange?.(settings.lesson, settings.course)
  }

  return {
    get phase() {
      return phase.phase
    },
    setPhase(p) {
      phase.setPhase(p)
    },
    get lesson() {
      return settings.lesson
    },
    setLesson(id) {
      if (!find(id) || id === settings.lesson) return
      update({ lesson: id })
      routeChanged()
    },
    mode(id) {
      const module = find(id)
      const stored = settings.modes[id]
      if (!module) return stored ?? 'autopilot'
      return stored && module.modes.includes(stored) ? stored : defaultMode(module)
    },
    setMode(id, mode) {
      const module = find(id)
      if (!module || !module.modes.includes(mode)) return
      update({ modes: { ...settings.modes, [id]: mode } })
    },
    params(id) {
      return settings.params[id] ?? {}
    },
    setParam(id, key, value) {
      const spec = find(id)?.params.find((s) => s.key === key)
      if (!spec || typeof value !== 'number' || !Number.isFinite(value)) return
      const clamped = clampValue(spec, value)
      if (clamped === undefined) return
      // A new record, so a params record already handed out (to a run or a caller) never changes.
      update({ params: { ...settings.params, [id]: { ...settings.params[id], [key]: clamped } } })
    },
    get course() {
      return settings.course
    },
    setCourse(course) {
      if (!validCourse(course) || course === settings.course) return
      update({ course })
      routeChanged()
    },
    get conditions() {
      return settings.conditions
    },
    setCondition(key, value) {
      const clamped = clampCondition(key, value)
      if (clamped === undefined || settings.conditions[key as keyof Conditions] === clamped) return
      update({ conditions: { ...settings.conditions, [key]: clamped } })
    },
    get wingman() {
      return settings.wingman
    },
    setWingman(id) {
      if (id !== null && !validWingman(id, modules)) return
      if (id === settings.wingman) return
      update({ wingman: id })
    },
    get logbook() {
      return logbook
    },
    setLogbook(rows) {
      logbook = rows.slice()
    },
    get best() {
      return settings.best
    },
    setBest(id, points) {
      if (!find(id) || typeof points !== 'number' || !Number.isFinite(points)) return
      if (settings.best[id] === points) return
      update({ best: { ...settings.best, [id]: points } })
    },
  }
}
