// The flight mode switch: a segmented control with one button per mode the
// lesson offers, shown only when there is more than one to choose from.

import type { FlightMode } from '../sim/types.ts'

export interface ModeSwitchHandlers {
  select(mode: FlightMode): void
}

export interface ModeSwitch {
  readonly element: HTMLElement
  /**
   * Shows one button per mode in `modes` order with `selected` pressed; hidden
   * when there are fewer than two. Buttons are rebuilt only when `modes` changes.
   */
  update(modes: readonly FlightMode[], selected: FlightMode): void
}

export const MODE_LABELS: Readonly<Record<FlightMode, string>> = {
  'semi-auto': 'Semi-auto',
  autopilot: 'Autopilot',
  manual: 'Manual',
}

export function createModeSwitch(doc: Document, handlers: ModeSwitchHandlers): ModeSwitch {
  const element = doc.createElement('div')
  element.className = 'seg mode-switch'
  element.setAttribute('role', 'group')
  element.setAttribute('aria-label', 'Flight mode')
  element.hidden = true

  let shown: readonly FlightMode[] = []
  let buttons: Array<{ mode: FlightMode; b: HTMLButtonElement }> = []
  let current: FlightMode | undefined

  function build(modes: readonly FlightMode[]): void {
    shown = modes.slice()
    buttons = shown.map((mode) => {
      const b = doc.createElement('button')
      b.type = 'button'
      b.className = 'seg-btn'
      b.textContent = MODE_LABELS[mode]
      b.addEventListener('click', () => {
        if (mode !== current) handlers.select(mode)
      })
      return { mode, b }
    })
    element.replaceChildren(...buttons.map(({ b }) => b))
  }

  return {
    element,
    update(modes, selected) {
      const same = modes.length === shown.length && modes.every((m, i) => m === shown[i])
      if (!same) build(modes)
      current = selected
      const hidden = modes.length < 2
      if (element.hidden !== hidden) element.hidden = hidden
      for (const { mode, b } of buttons) {
        const pressed = String(mode === selected)
        if (b.getAttribute('aria-pressed') !== pressed) b.setAttribute('aria-pressed', pressed)
      }
    },
  }
}
