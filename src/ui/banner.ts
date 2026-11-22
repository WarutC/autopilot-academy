// The banner over the scene: Ready for takeoff, New course loaded, Paused,
// Crashed or Mission complete. A persistent live region announces it; the
// visible box inside it is added or removed, and never takes input.

import { ringsPassed, type PlaneResult } from '../sim/scoring.ts'
import type { Phase } from './flight.ts'

export interface BannerContent {
  readonly title: string
  readonly body: string
  /** A second line under the body, such as "Retuned". */
  readonly note?: string
}

/**
 * What the banner says for a phase and the player's result; undefined hides it.
 * `loadedCourse` is a course the player just loaded, announced while the flight is ready.
 * `wingman` is the wingman's name and result, reported after Mission complete.
 */
export function bannerContent(
  phase: Phase,
  result: PlaneResult | undefined,
  loadedCourse?: number,
  wingman?: { readonly name: string; readonly result: PlaneResult },
): BannerContent | undefined {
  if (phase === 'ready' && loadedCourse !== undefined) {
    return {
      title: 'New course loaded',
      body: `Course ${loadedCourse}. Share the number so classmates fly the same rings.`,
    }
  }
  if (phase === 'ready') return { title: 'Ready for takeoff', body: 'Pick an autopilot, then press Fly.' }
  if (phase === 'paused') return { title: 'Paused', body: 'Retune freely. Changes apply the moment you resume.' }
  if (phase !== 'ended' || !result) return undefined
  const note = result.retuned ? { note: 'Retuned' } : {}
  if (result.status === 'crashed') {
    return { title: 'Crashed', body: 'The aircraft left the safe altitude band. Retune and fly again.', ...note }
  }
  if (result.status === 'finished') {
    const passed = ringsPassed(result.results)
    return {
      title: 'Mission complete',
      body: `${result.points.toFixed(1)} points, ${passed} of ${result.ringsTotal} rings.${wingmanText(wingman)}`,
      ...note,
    }
  }
  return undefined
}

/** The wingman's score after the player's, with a leading space; empty without a wingman. */
function wingmanText(wingman: { readonly name: string; readonly result: PlaneResult } | undefined): string {
  if (!wingman) return ''
  const points = wingman.result.points.toFixed(1)
  return wingman.result.status === 'crashed'
    ? ` Wingman ${wingman.name} crashed with ${points} points.`
    : ` Wingman ${wingman.name}: ${points} points.`
}

export interface Banner {
  /** The live region; it stays in the DOM and covers the scene without taking input. */
  readonly element: HTMLElement
  /** Shows `content`, or removes the box when undefined; unchanged content is not rewritten. */
  update(content: BannerContent | undefined): void
}

export function createBanner(doc: Document): Banner {
  const element = doc.createElement('div')
  element.className = 'banner-region'
  element.setAttribute('role', 'status')
  element.setAttribute('aria-live', 'polite')
  element.setAttribute('aria-atomic', 'true')
  let shown: BannerContent | undefined

  return {
    element,
    update(content) {
      if (content?.title === shown?.title && content?.body === shown?.body && content?.note === shown?.note) return
      shown = content
      if (!content) {
        element.replaceChildren()
        return
      }
      const box = doc.createElement('div')
      box.className = 'banner'
      const title = doc.createElement('h2')
      title.className = 'banner-title'
      title.textContent = content.title
      const body = doc.createElement('p')
      body.className = 'banner-body'
      body.textContent = content.body
      box.append(title, body)
      if (content.note) {
        const note = doc.createElement('p')
        note.className = 'banner-note'
        note.textContent = content.note
        box.append(note)
      }
      element.replaceChildren(box)
    },
  }
}
