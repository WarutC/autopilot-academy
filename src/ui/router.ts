// The address: `#/lesson/<id>?course=<n>`, so one link flies the same lesson
// on the same rings. Parsing and building are pure; the router only reads the
// hash, rewrites it with replaceState and listens for hashchange.

import type { AlgorithmModule } from '../algorithms/index.ts'
import { MAX_COURSE, validCourse } from './persistence.ts'

export interface Route {
  /** The lesson to select; undefined unless the route names a registered one. */
  readonly lesson?: string
  /** The course to load; undefined unless the route names a valid one. */
  readonly course?: number
}

/** Reads `#/lesson/<id>?course=<n>`; an unknown lesson or an invalid course is left out, so the stored one stays. */
export function parseRoute(hash: string, modules: readonly AlgorithmModule[]): Route {
  const text = hash.startsWith('#') ? hash.slice(1) : hash
  const q = text.indexOf('?')
  const path = q < 0 ? text : text.slice(0, q)
  const query = q < 0 ? '' : text.slice(q + 1)
  const match = /^\/lesson(?:\/(.*))?$/.exec(path)
  if (!match) return {}

  let id = ''
  try {
    id = decodeURIComponent(match[1] ?? '')
  } catch {
    id = ''
  }
  const lesson = modules.some((m) => m.id === id) ? id : undefined

  const raw = new URLSearchParams(query).get('course')
  const course = raw !== null && /^\d+$/.test(raw) ? Number(raw) : undefined
  return {
    ...(lesson !== undefined && { lesson }),
    ...(validCourse(course) && { course }),
  }
}

/** The canonical hash for a lesson and course. */
export function lessonHash(lesson: string, course: number): string {
  return `#/lesson/${encodeURIComponent(lesson)}?course=${course}`
}

const DRAW_TRIES = 5

/** A random course from 1 to MAX_COURSE that differs from `current`. */
export function drawCourse(random: () => number, current: number): number {
  for (let i = 0; i < DRAW_TRIES; i++) {
    const course = 1 + Math.floor(random() * MAX_COURSE)
    if (course !== current && validCourse(course)) return course
  }
  // A stuck or broken source still yields a different course.
  return (current % MAX_COURSE) + 1
}

/** The parts of `window` the router uses. */
export interface RouterWindow {
  readonly location: { readonly hash: string; readonly pathname: string; readonly search: string }
  readonly history: { readonly state: unknown; replaceState(data: unknown, unused: string, url: string): void }
  addEventListener(type: 'hashchange', listener: () => void): void
}

export interface Router {
  /** The current hash. */
  read(): string
  /** Replaces the hash with the lesson route, keeping the path and query; an equal hash is left alone. */
  write(lesson: string, course: number): void
  /** Calls `listener` with the new hash whenever the user changes it. */
  onChange(listener: (hash: string) => void): void
}

/** What an edited address acts on. */
export interface AddressTarget {
  /** True while a run is flying or paused. */
  flying(): boolean
  selectLesson(id: string): void
  loadCourse(course: number): void
  /** The lesson and course on screen, written back to the address. */
  current(): { readonly lesson: string; readonly course: number }
}

/**
 * An edited address selects its lesson and course outside a flight; during
 * one it is put back. Either way the address ends on the current route.
 */
export function followAddress(router: Router, modules: readonly AlgorithmModule[], target: AddressTarget): void {
  router.onChange((hash) => {
    if (!target.flying()) {
      const next = parseRoute(hash, modules)
      if (next.lesson !== undefined) target.selectLesson(next.lesson)
      if (next.course !== undefined) target.loadCourse(next.course)
    }
    const { lesson, course } = target.current()
    router.write(lesson, course)
  })
}

export function createRouter(win: RouterWindow): Router {
  return {
    read() {
      return win.location.hash
    },
    write(lesson, course) {
      const hash = lessonHash(lesson, course)
      const { location } = win
      if (location.hash === hash) return
      win.history.replaceState(win.history.state, '', `${location.pathname}${location.search}${hash}`)
    },
    onChange(listener) {
      win.addEventListener('hashchange', () => listener(win.location.hash))
    },
  }
}
