// The Flight conditions card: slider and number rows for the downdraft, gusts
// and altimeter noise, a toggle for the Kalman filter on the altimeter, and a
// box with the filter's Q and R rows, shown while the filter is on. Built from
// the condition specs. It stays enabled in every phase; the page decides what
// a change does to the run.

import type { ParamSpec } from '../algorithms/index.ts'
import type { Conditions } from '../sim/types.ts'
import { CARD_CONDITIONS, CONDITION_SPECS, KALMAN_CONDITIONS } from './conditions.ts'
import { clampValue, formatValue, fromSlider, parseNumber, sliderRange, toSlider } from './params.ts'

export interface ConditionsCardHandlers {
  /** A condition took a new value; fires on every slider move and number commit. */
  change(key: string, value: number): void
}

export interface ConditionsCard {
  readonly element: HTMLElement
}

export function createConditionsCard(
  doc: Document,
  conditions: Readonly<Conditions>,
  handlers: ConditionsCardHandlers,
): ConditionsCard {
  const element = doc.createElement('section')
  element.className = 'card conditions-card'
  element.setAttribute('aria-labelledby', 'conditions-card-title')

  const header = doc.createElement('h2')
  header.className = 'card-header'
  header.id = 'conditions-card-title'
  header.textContent = 'Flight conditions'

  const body = doc.createElement('div')
  body.className = 'card-body'

  const list = doc.createElement('div')
  list.className = 'param-list'

  const values: Record<string, number> = { ...conditions }

  /** Records `v` for `spec` and tells the handler; false when nothing changed. */
  function apply(spec: ParamSpec, v: number): boolean {
    if (values[spec.key] === v) return false
    values[spec.key] = v
    handlers.change(spec.key, v)
    return true
  }

  function sliderRow(spec: ParamSpec): HTMLElement {
    const id = `condition-${spec.key}`
    const row = doc.createElement('div')
    row.className = 'param-row'
    const head = doc.createElement('div')
    head.className = 'param-head'
    const label = doc.createElement('label')
    label.htmlFor = id
    label.className = 'param-label'
    label.textContent = spec.unit ? `${spec.label} (${spec.unit})` : spec.label

    const field = doc.createElement('input')
    field.type = 'text'
    field.inputMode = 'decimal'
    field.id = id
    field.className = 'param-number'
    field.setAttribute('aria-label', spec.accessibleName)
    field.autocomplete = 'off'

    const slider = doc.createElement('input')
    slider.type = 'range'
    slider.className = 'param-slider'
    slider.setAttribute('aria-label', `${spec.accessibleName}, slider`)
    const range = sliderRange(spec)
    slider.min = String(range.min)
    slider.max = String(range.max)
    slider.step = String(range.step)

    const showField = (v: number) => {
      const text = formatValue(spec, v)
      if (field.value !== text) field.value = text
    }
    const showSlider = (v: number) => {
      const pos = String(toSlider(spec, v))
      if (slider.value !== pos) slider.value = pos
      slider.setAttribute('aria-valuetext', formatValue(spec, v))
    }

    slider.addEventListener('input', () => {
      const v = fromSlider(spec, Number(slider.value))
      if (v === undefined) return
      if (apply(spec, v)) {
        showField(v)
        slider.setAttribute('aria-valuetext', formatValue(spec, v))
      }
    })
    slider.addEventListener('change', () => showSlider(values[spec.key]!))

    field.addEventListener('change', () => {
      const v = clampValue(spec, parseNumber(field.value))
      if (v !== undefined && apply(spec, v)) showSlider(v)
      // Show the applied value: the clamped one, or the old one after bad input.
      field.value = formatValue(spec, values[spec.key]!)
    })

    head.append(label, field)
    row.append(head, slider)
    showField(values[spec.key]!)
    showSlider(values[spec.key]!)
    return row
  }

  /** The Kalman toggle's row; the box below it shows while the box is checked. */
  function toggleRow(spec: ParamSpec, onToggle: (on: boolean) => void): HTMLElement {
    const id = `condition-${spec.key}`
    const row = doc.createElement('div')
    row.className = 'param-row param-toggle'
    const box = doc.createElement('input')
    box.type = 'checkbox'
    box.id = id
    box.className = 'param-check'
    box.setAttribute('aria-label', spec.accessibleName)
    box.checked = values[spec.key] !== 0
    const label = doc.createElement('label')
    label.htmlFor = id
    label.className = 'param-label'
    label.textContent = spec.label
    box.addEventListener('change', () => {
      apply(spec, box.checked ? 1 : 0)
      onToggle(box.checked)
    })
    row.append(box, label)
    return row
  }

  const specOf = (key: string) => CONDITION_SPECS.find((s) => s.key === key)!

  const kalmanBox = doc.createElement('div')
  kalmanBox.className = 'kalman-box'
  const note = doc.createElement('p')
  note.className = 'kalman-note'
  note.textContent =
    'Blends the aircraft model with noisy measurements. Raise Q to trust the model less; raise R to trust the altimeter less.'
  kalmanBox.append(note, ...KALMAN_CONDITIONS.map((key) => sliderRow(specOf(key))))
  kalmanBox.hidden = values.kalman === 0

  list.append(
    ...CARD_CONDITIONS.map((key) => sliderRow(specOf(key))),
    toggleRow(specOf('kalman'), (on) => {
      kalmanBox.hidden = !on
    }),
    kalmanBox,
  )
  body.append(list)
  element.append(header, body)

  return { element }
}
