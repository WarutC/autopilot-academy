// A visually hidden live region that repeats the score for screen readers.

import { scoreLabel } from '../render/scene-geometry.ts'
import type { Snapshot } from '../sim/types.ts'

export interface ScoreMirror {
  readonly element: HTMLElement
  /** Writes the snapshot's score, such as `12.3 points`; unchanged text is not rewritten. */
  update(snapshot: Snapshot): void
}

export function createScoreMirror(doc: Document): ScoreMirror {
  const element = doc.createElement('p')
  element.className = 'visually-hidden'
  element.setAttribute('aria-live', 'polite')
  return {
    element,
    update(snapshot) {
      const text = scoreLabel(snapshot)
      if (element.textContent !== text) element.textContent = text
    },
  }
}
