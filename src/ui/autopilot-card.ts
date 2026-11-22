// The Autopilot card: the module's name, its lesson, one row per parameter and
// a reset button. Built from the module's `ParamSpec` list only, so every
// algorithm gets the same panel.

import type { AlgorithmModule, ParamSpec, Params } from '../algorithms/index.ts'
import { changeLabel, clampValue, formatValue, fromSlider, parseNumber, resetChanges, sliderRange, toSlider } from './params.ts'

export interface AutopilotCardHandlers {
  /** A parameter took a new value; fires on every slider move, number commit and toggle. */
  change(key: string, value: number): void
  /** A change is finished, labeled like "Kd 0 → 0.05"; several changes are joined with ", ". */
  commit(label: string): void
}

export interface AutopilotCard {
  readonly element: HTMLElement
  /** Shows `params`; fields whose value did not change are not rewritten. */
  update(params: Params): void
}

interface Row {
  readonly spec: ParamSpec
  readonly element: HTMLElement
  /** Sets the row's inputs to `v`. */
  show(v: number): void
}

/**
 * Puts a parameter label in `label`. A gain whose key is K plus a lowercase
 * suffix ("Kp (proportional)") shows the suffix as a subscript: K<sub>p</sub>.
 */
function labelText(doc: Document, label: HTMLElement, spec: ParamSpec, text: string): void {
  const gain = /^K([a-z0-9]+)$/.exec(spec.key)
  if (!gain || !text.startsWith(spec.key)) {
    label.textContent = text
    return
  }
  const sub = doc.createElement('sub')
  sub.textContent = gain[1]
  label.append('K', sub, text.slice(spec.key.length))
}

/** Puts the lesson in `p`, with "Try:" in bold. */
function lessonText(doc: Document, p: HTMLElement, lesson: string): void {
  const at = lesson.indexOf('Try:')
  if (at < 0) {
    p.textContent = lesson
    return
  }
  const strong = doc.createElement('strong')
  strong.textContent = 'Try:'
  p.append(lesson.slice(0, at), strong, lesson.slice(at + 'Try:'.length))
}

export function createAutopilotCard(
  doc: Document,
  module: AlgorithmModule,
  params: Params,
  handlers: AutopilotCardHandlers,
): AutopilotCard {
  const values: Record<string, number> = {}
  for (const spec of module.params) values[spec.key] = params[spec.key] ?? spec.default

  const element = doc.createElement('section')
  element.className = 'card autopilot-card'
  element.setAttribute('aria-labelledby', 'autopilot-card-title')

  const header = doc.createElement('h2')
  header.className = 'card-header'
  header.id = 'autopilot-card-title'
  header.textContent = 'Autopilot'

  const body = doc.createElement('div')
  body.className = 'card-body'

  const name = doc.createElement('h3')
  name.className = 'autopilot-name'
  name.textContent = module.name

  const lesson = doc.createElement('p')
  lesson.className = 'lesson'
  lessonText(doc, lesson, module.lesson)

  body.append(name, lesson)

  /** Records `v` for `spec` and tells the handler; false when nothing changed. */
  function apply(spec: ParamSpec, v: number): boolean {
    if (values[spec.key] === v) return false
    values[spec.key] = v
    handlers.change(spec.key, v)
    return true
  }

  function toggleRow(spec: ParamSpec, id: string): Row {
    const row = doc.createElement('div')
    row.className = 'param-row param-toggle'
    const box = doc.createElement('input')
    box.type = 'checkbox'
    box.id = id
    box.className = 'param-check'
    box.setAttribute('aria-label', spec.accessibleName)
    const label = doc.createElement('label')
    label.htmlFor = id
    label.className = 'param-label'
    labelText(doc, label, spec, spec.label)
    box.addEventListener('change', () => {
      const old = values[spec.key]
      const v = box.checked ? 1 : 0
      if (apply(spec, v)) handlers.commit(changeLabel(spec, old, v))
    })
    row.append(box, label)
    const show = (v: number) => {
      const checked = v !== 0
      if (box.checked !== checked) box.checked = checked
    }
    return { spec, element: row, show }
  }

  function sliderRow(spec: ParamSpec, id: string): Row {
    const row = doc.createElement('div')
    row.className = 'param-row'
    const head = doc.createElement('div')
    head.className = 'param-head'
    const label = doc.createElement('label')
    label.htmlFor = id
    label.className = 'param-label'
    labelText(doc, label, spec, spec.unit ? `${spec.label} (${spec.unit})` : spec.label)

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
    slider.setAttribute('aria-label', spec.accessibleName)
    const range = sliderRange(spec)
    slider.min = String(range.min)
    slider.max = String(range.max)
    slider.step = String(range.step)

    /** The value when the current drag started, or undefined between drags. */
    let dragFrom: number | undefined
    const showField = (v: number) => {
      const text = formatValue(spec, v)
      if (field.value !== text) field.value = text
    }
    // Setting the slider from outside a drag ends any drag whose `change` never came.
    const showSlider = (v: number) => {
      dragFrom = undefined
      const pos = String(toSlider(spec, v))
      if (slider.value !== pos) slider.value = pos
      slider.setAttribute('aria-valuetext', formatValue(spec, v))
    }

    slider.addEventListener('input', () => {
      const v = fromSlider(spec, Number(slider.value))
      if (v === undefined) return
      dragFrom ??= values[spec.key]
      if (apply(spec, v)) showField(v)
    })
    slider.addEventListener('change', () => {
      const from = dragFrom
      dragFrom = undefined
      const v = values[spec.key]
      showSlider(v)
      if (from !== undefined && from !== v) handlers.commit(changeLabel(spec, from, v))
    })

    field.addEventListener('change', () => {
      const old = values[spec.key]
      const v = clampValue(spec, parseNumber(field.value))
      if (v !== undefined && apply(spec, v)) {
        showSlider(v)
        handlers.commit(changeLabel(spec, old, v))
      }
      // Show the applied value: the clamped one, or the old one after bad input.
      field.value = formatValue(spec, values[spec.key])
    })

    head.append(label, field)
    row.append(head, slider)
    return {
      spec,
      element: row,
      show(v) {
        showField(v)
        showSlider(v)
      },
    }
  }

  const rows: Row[] = module.params.map((spec) => {
    const id = `param-${module.id}-${spec.key}`
    const row = spec.toggle ? toggleRow(spec, id) : sliderRow(spec, id)
    row.show(values[spec.key])
    return row
  })

  const list = doc.createElement('div')
  list.className = 'param-list'
  list.append(...rows.map((r) => r.element))

  const reset = doc.createElement('button')
  reset.type = 'button'
  reset.className = 'btn btn-reset'
  reset.textContent = 'Reset this autopilot to defaults'
  reset.addEventListener('click', () => {
    const changes = resetChanges(module.params, values)
    if (changes.length === 0) return
    for (const c of changes) {
      const row = rows.find((r) => r.spec.key === c.key)!
      apply(row.spec, c.value)
      row.show(c.value)
    }
    handlers.commit(changes.map((c) => c.label).join(', '))
  })

  body.append(list, reset)
  element.append(header, body)

  return {
    element,
    update(next) {
      for (const row of rows) {
        const v = next[row.spec.key]
        if (v === undefined || v === values[row.spec.key]) continue
        values[row.spec.key] = v
        row.show(v)
      }
    },
  }
}
