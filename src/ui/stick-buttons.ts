// The stick buttons over the scene's right edge: ▲ Climb and ▼ Dive. Each
// one is a pointer source for the stick while it is held.

import type { Stick, StickDirection } from './input.ts'

export interface StickButtons {
  readonly element: HTMLElement
  /** Shows or hides the buttons; hiding releases them. */
  setVisible(visible: boolean): void
}

const BUTTONS: ReadonlyArray<{ direction: StickDirection; glyph: string; label: string }> = [
  { direction: 'climb', glyph: '▲', label: 'Climb' },
  { direction: 'dive', glyph: '▼', label: 'Dive' },
]

export function createStickButtons(doc: Document, stick: Stick): StickButtons {
  const element = doc.createElement('div')
  element.className = 'stick'
  element.setAttribute('role', 'group')
  element.setAttribute('aria-label', 'Stick')

  const releases: Array<() => void> = []

  for (const { direction, glyph, label } of BUTTONS) {
    const source = `pointer:${direction}`
    const b = doc.createElement('button')
    b.type = 'button'
    b.className = `stick-btn stick-${direction}`
    b.setAttribute('aria-label', label)
    b.setAttribute('aria-pressed', 'false')
    b.textContent = glyph

    const hold = (held: boolean) => {
      b.setAttribute('aria-pressed', String(held))
      b.classList.toggle('held', held)
    }
    const keySource = `button-key:${direction}`
    const release = () => {
      stick.release(source)
      stick.release(keySource)
      hold(false)
    }
    releases.push(release)

    b.addEventListener('pointerdown', (event: PointerEvent) => {
      if (event.button !== 0) return
      event.preventDefault()
      // Capture keeps the release on this button even when the finger slides off.
      try {
        b.setPointerCapture(event.pointerId)
      } catch {
        // An already released pointer cannot be captured; the press still counts.
      }
      stick.press(direction, source)
      hold(true)
    })
    b.addEventListener('pointerup', release)
    b.addEventListener('pointercancel', release)
    b.addEventListener('lostpointercapture', release)
    b.addEventListener('contextmenu', (event: Event) => event.preventDefault())
    // Space and Enter hold a focused button like a pointer does.
    b.addEventListener('keydown', (event: KeyboardEvent) => {
      if (event.key !== ' ' && event.key !== 'Enter') return
      event.preventDefault()
      if (event.repeat) return
      stick.press(direction, keySource)
      hold(true)
    })
    b.addEventListener('keyup', (event: KeyboardEvent) => {
      if (event.key !== ' ' && event.key !== 'Enter') return
      stick.release(keySource)
      hold(false)
    })
    b.addEventListener('blur', release)
    element.append(b)
  }

  return {
    element,
    setVisible(visible) {
      if (!visible) for (const release of releases) release()
      element.hidden = !visible
    },
  }
}
