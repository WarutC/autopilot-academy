// The setpoint slider over the scene's right edge in Semi-auto: a vertical
// range input whose thumb is a small plane. Dragging it or nudging it with the
// arrow keys sets the target altitude.

export interface SetpointRange {
  readonly min: number
  readonly max: number
  readonly step: number
  readonly value: number
}

export interface SetpointSlider {
  readonly element: HTMLElement
  /** The current setpoint, in meters. */
  readonly value: number
  /** Moves one step up (1) or down (-1), clamped; calls `onChange` only when the value changes. */
  nudge(direction: 1 | -1): void
  setVisible(visible: boolean): void
}

/** `value` moved one `step` in `direction`, clamped to `[min, max]`. */
export function nudgeValue(value: number, direction: 1 | -1, step: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value + direction * step))
}

const valueText = (value: number): string => `${value} m`

export function createSetpointSlider(
  doc: Document,
  range: SetpointRange,
  onChange: (value: number) => void,
): SetpointSlider {
  const { min, max, step } = range
  let value = Math.min(max, Math.max(min, range.value))

  const element = doc.createElement('div')
  element.className = 'setpoint'

  const input = doc.createElement('input')
  input.type = 'range'
  input.className = 'setpoint-input'
  input.min = String(min)
  input.max = String(max)
  input.step = String(step)
  input.value = String(value)
  input.setAttribute('aria-label', 'Target altitude')
  input.setAttribute('aria-orientation', 'vertical')
  input.setAttribute('aria-valuetext', valueText(value))
  element.append(input)

  function set(next: number): void {
    value = next
    input.setAttribute('aria-valuetext', valueText(value))
    onChange(value)
  }

  input.addEventListener('input', () => {
    const next = Number(input.value)
    if (Number.isFinite(next) && next !== value) set(next)
  })

  return {
    element,
    get value() {
      return value
    },
    nudge(direction) {
      const next = nudgeValue(value, direction, step, min, max)
      if (next === value) return
      input.value = String(next)
      set(next)
    },
    setVisible(visible) {
      element.hidden = !visible
    },
  }
}
