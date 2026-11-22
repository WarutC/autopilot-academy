// The Flight conditions card: one slider and number row per condition the
// player can set, built from the condition specs. It stays enabled in every
// phase; the page decides what a change does to the run.

import type { ParamSpec } from '../algorithms/index.ts'
import type { Conditions } from '../sim/types.ts'
import { CARD_CONDITIONS, CONDITION_SPECS } from './conditions.ts'
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

  const specs = CARD_CONDITIONS.map((key) => CONDITION_SPECS.find((s) => s.key === key)!)
  list.append(...specs.map(sliderRow))
  body.append(list)
  element.append(header, body)

  return { element }
}
