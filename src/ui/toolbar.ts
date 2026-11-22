// The flight toolbar: Fly (Restart, Fly again), Pause (Resume) and the
// simulation speed segmented control, built from native buttons.

import { SPEEDS, flyLabel, pauseEnabled, pauseLabel, type Phase, type Speed } from './flight.ts'

export interface ToolbarHandlers {
  fly(): void
  togglePause(): void
  setSpeed(speed: Speed): void
}

export interface Toolbar {
  readonly element: HTMLElement
  /** Reflects the phase and speed into labels, `disabled` and `aria-pressed`; unchanged values are not rewritten. */
  update(phase: Phase, speed: Speed): void
}

function button(doc: Document, className: string): HTMLButtonElement {
  const b = doc.createElement('button')
  b.type = 'button'
  b.className = className
  return b
}

function setText(el: HTMLElement, text: string): void {
  if (el.textContent !== text) el.textContent = text
}

export function createToolbar(doc: Document, handlers: ToolbarHandlers): Toolbar {
  const element = doc.createElement('div')
  element.className = 'toolbar'

  const fly = button(doc, 'btn btn-primary')
  fly.addEventListener('click', () => handlers.fly())

  const pause = button(doc, 'btn')
  pause.addEventListener('click', () => handlers.togglePause())

  const seg = doc.createElement('div')
  seg.className = 'seg'
  seg.setAttribute('role', 'group')
  seg.setAttribute('aria-label', 'Simulation speed')
  const speedButtons = SPEEDS.map((speed) => {
    const b = button(doc, 'seg-btn')
    b.textContent = `×${speed}`
    b.addEventListener('click', () => handlers.setSpeed(speed))
    seg.append(b)
    return { speed, b }
  })

  element.append(fly, pause, seg)

  return {
    element,
    update(phase, speed) {
      setText(fly, flyLabel(phase))
      setText(pause, pauseLabel(phase))
      const disabled = !pauseEnabled(phase)
      if (pause.disabled !== disabled) {
        // A disabled button loses focus to the page, so hand it to Fly first.
        if (disabled && doc.activeElement === pause) fly.focus()
        pause.disabled = disabled
      }
      for (const { speed: s, b } of speedButtons) {
        const pressed = String(s === speed)
        if (b.getAttribute('aria-pressed') !== pressed) b.setAttribute('aria-pressed', pressed)
      }
    },
  }
}
