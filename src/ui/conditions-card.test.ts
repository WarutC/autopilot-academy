import { describe, expect, it, vi } from 'vitest'
import { CALM } from '../sim/run.ts'
import { createConditionsCard } from './conditions-card.ts'

/** Just enough of an element for the card: inputs, labels, text and events. */
class FakeElement {
  className = ''
  id = ''
  type = ''
  htmlFor = ''
  inputMode = ''
  autocomplete = ''
  min = ''
  max = ''
  step = ''
  checked = false
  disabled = false
  hidden = false
  readonly attrs = new Map<string, string>()
  children: Array<FakeElement | string> = []
  readonly listeners = new Map<string, Array<() => void>>()
  private text = ''
  private val = ''
  readonly tagName: string
  private readonly doc: FakeDoc
  constructor(tagName: string, doc: FakeDoc) {
    this.tagName = tagName
    this.doc = doc
  }
  get value(): string {
    return this.val
  }
  set value(v: string) {
    this.val = v
  }
  get textContent(): string {
    return this.text + this.children.map((c) => (typeof c === 'string' ? c : c.textContent)).join('')
  }
  set textContent(value: string) {
    this.text = value
  }
  setAttribute(name: string, value: string): void {
    this.attrs.set(name, value)
  }
  getAttribute(name: string): string | null {
    return this.attrs.get(name) ?? null
  }
  addEventListener(type: string, listener: () => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener])
  }
  append(...nodes: Array<FakeElement | string>): void {
    this.children.push(...nodes)
  }
  replaceChildren(...nodes: Array<FakeElement | string>): void {
    this.children = [...nodes]
  }
  focus(): void {
    this.doc.activeElement = this
  }
  fire(type: string): void {
    for (const l of this.listeners.get(type) ?? []) l()
  }
  /** Every descendant element, depth first. */
  all(): FakeElement[] {
    return this.children.flatMap((c) => (typeof c === 'string' ? [] : [c, ...c.all()]))
  }
}

class FakeDoc {
  activeElement: FakeElement | null = null
  createElement(tag: string): FakeElement {
    return new FakeElement(tag, this)
  }
}

function setup(conditions = { ...CALM }) {
  const doc = new FakeDoc()
  const change = vi.fn<(key: string, value: number) => void>()
  const card = createConditionsCard(doc as unknown as Document, conditions, { change })
  const root = card.element as unknown as FakeElement
  const byClass = (c: string) => root.all().filter((e) => e.className.split(' ').includes(c))
  const row = (index: number) => {
    const inner = byClass('param-row')[index]!.all()
    const find = (c: string) => inner.find((e) => e.className === c)!
    return { field: find('param-number'), slider: find('param-slider'), label: find('param-label') }
  }
  return { change, root, byClass, row }
}

describe('createConditionsCard', () => {
  it('builds the heading and rows for the downdraft and gusts only', () => {
    const { root, byClass, row } = setup({ ...CALM, down: 2.5, gusts: 4 })
    expect(root.className).toBe('card conditions-card')
    expect(root.getAttribute('aria-labelledby')).toBe('conditions-card-title')
    const header = byClass('card-header')[0]!
    expect(header.textContent).toBe('Flight conditions')
    expect(header.id).toBe('conditions-card-title')
    expect(byClass('param-row')).toHaveLength(2)
    const down = row(0)
    expect(down.label.textContent).toBe('Steady downdraft (m/s²)')
    expect(down.label.htmlFor).toBe('condition-down')
    expect(down.field.id).toBe('condition-down')
    expect(down.field.value).toBe('2.5')
    expect(down.slider.value).toBe('2.5')
    expect(down.slider.max).toBe('10')
    expect(down.field.getAttribute('aria-label')).toBe('Steady downdraft, meters per second squared')
    const gusts = row(1)
    expect(gusts.label.textContent).toBe('Gusts (m/s², rms)')
    expect(gusts.field.id).toBe('condition-gusts')
    expect(gusts.field.value).toBe('4')
    expect(gusts.slider.getAttribute('aria-valuetext')).toBe('4')
    expect(gusts.slider.getAttribute('aria-label')).toBe('Gusts, meters per second squared, rms, slider')
  })

  it('applies slider moves live with the snapped value', () => {
    const { change, row } = setup()
    const { slider, field } = row(1)
    slider.value = '7.3'
    slider.fire('input')
    expect(change).toHaveBeenLastCalledWith('gusts', 7.5)
    expect(field.value).toBe('7.5')
    expect(slider.getAttribute('aria-valuetext')).toBe('7.5')
    slider.fire('change')
    expect(slider.value).toBe('7.5')
    expect(change).toHaveBeenCalledTimes(1)
  })

  it('commits a typed value clamped and shows it', () => {
    const { change, row } = setup()
    const { slider, field } = row(0)
    field.value = '42'
    field.fire('change')
    expect(change).toHaveBeenLastCalledWith('down', 10)
    expect(field.value).toBe('10')
    expect(slider.value).toBe('10')
    field.value = '3,2'
    field.fire('change')
    expect(change).toHaveBeenLastCalledWith('down', 3)
  })

  it('restores the shown value after bad input or no change', () => {
    const { change, row } = setup({ ...CALM, gusts: 4 })
    const { field } = row(1)
    field.value = 'abc'
    field.fire('change')
    expect(field.value).toBe('4')
    field.value = '4.0'
    field.fire('change')
    expect(field.value).toBe('4')
    expect(change).not.toHaveBeenCalled()
  })
})
