// The player's settings and the flight phase. The store is the only writer of
// settings: it loads them once, validates every change and writes each one
// through to storage. The phase lives here too but is never saved.

import type { AlgorithmModule, Params } from '../algorithms/index.ts'
import type { FlightMode } from '../sim/types.ts'
import { clampValue } from './params.ts'
import { loadSettings, saveSettings, validCourse, type Settings, type StorageGetter } from './persistence.ts'

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
}

/** A lesson's mode until the player picks another: Autopilot when it has one, else its first mode. */
export function defaultMode(module: AlgorithmModule): FlightMode {
  return module.modes.includes('autopilot') ? 'autopilot' : module.modes[0]!
}

export function createStore(modules: readonly AlgorithmModule[], getStorage: StorageGetter): Store {
  const phase = createPhase()
  let settings: Settings = loadSettings(getStorage, modules)
  const find = (id: string) => modules.find((m) => m.id === id)

  function update(next: Partial<Settings>): void {
    settings = { ...settings, ...next }
    saveSettings(getStorage, settings)
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
      if (!validCourse(course)) return
      update({ course })
    },
  }
}
