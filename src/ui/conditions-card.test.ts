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
  it('builds the heading and the condition rows in order', () => {
    const { root, byClass, row } = setup({ ...CALM, down: 2.5, gusts: 4 })
    expect(root.className).toBe('card conditions-card')
    expect(root.getAttribute('aria-labelledby')).toBe('conditions-card-title')
    const header = byClass('card-header')[0]!
    expect(header.textContent).toBe('Flight conditions')
    expect(header.id).toBe('conditions-card-title')
    expect(byClass('param-row')).toHaveLength(6)
    expect(byClass('param-label').map((l) => l.textContent)).toEqual([
      'Steady downdraft (m/s²)',
      'Gusts (m/s², rms)',
      'Altimeter noise σ (m)',
      'Kalman filter on the altimeter',
      'Q, process noise',
      'R, assumed sensor variance (m²)',
    ])
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

  it('shows the altimeter noise row', () => {
    const { change, row } = setup({ ...CALM, noise: 1.5 })
    const noise = row(2)
    expect(noise.field.id).toBe('condition-noise')
    expect(noise.field.value).toBe('1.5')
    noise.slider.value = '2'
    noise.slider.fire('input')
    expect(change).toHaveBeenLastCalledWith('noise', 2)
  })

  it('toggles the Kalman filter and shows its box at once', () => {
    const { change, root, byClass } = setup()
    const check = root.all().find((e) => e.id === 'condition-kalman')!
    expect(check.type).toBe('checkbox')
    expect(check.className).toBe('param-check')
    expect(check.getAttribute('aria-label')).toBe('Kalman filter on the altimeter')
    expect(byClass('param-toggle')[0]!.all()).toContain(check)
    const box = byClass('kalman-box')[0]!
    expect(check.checked).toBe(false)
    expect(box.hidden).toBe(true)
    expect(byClass('kalman-note')[0]!.textContent).toBe(
      'Blends the aircraft model with noisy measurements. Raise Q to trust the model less; raise R to trust the altimeter less.',
    )
    const inBox = box.all().filter((e) => e.className === 'param-number').map((e) => e.id)
    expect(inBox).toEqual(['condition-kq', 'condition-kr'])
    check.checked = true
    check.fire('change')
    expect(change).toHaveBeenLastCalledWith('kalman', 1)
    expect(box.hidden).toBe(false)
    check.checked = false
    check.fire('change')
    expect(change).toHaveBeenLastCalledWith('kalman', 0)
    expect(box.hidden).toBe(true)
    expect(change).toHaveBeenCalledTimes(2)
  })

  it('starts with the box shown when the filter is on', () => {
    const { root, byClass } = setup({ ...CALM, kalman: 1 })
    expect(root.all().find((e) => e.id === 'condition-kalman')!.checked).toBe(true)
    expect(byClass('kalman-box')[0]!.hidden).toBe(false)
  })

  it('maps the Q and R sliders on a log scale', () => {
    const { change, row } = setup({ ...CALM, kq: 10, kr: 4 })
    const q = row(4)
    const r = row(5)
    expect(q.slider.min).toBe(String(Math.log10(0.1)))
    expect(q.slider.max).toBe('3')
    expect(q.slider.step).toBe('any')
    expect(q.slider.value).toBe('1')
    expect(q.field.value).toBe('10')
    expect(r.field.value).toBe('4')
    expect(Number(r.slider.value)).toBeCloseTo(Math.log10(4), 12)
    q.slider.value = '2'
    q.slider.fire('input')
    expect(change).toHaveBeenLastCalledWith('kq', 100)
    expect(q.field.value).toBe('100')
    q.slider.value = 'abc'
    q.slider.fire('input')
    expect(change).toHaveBeenCalledTimes(1)
    r.field.value = '0.25'
    r.field.fire('change')
    expect(change).toHaveBeenLastCalledWith('kr', 0.25)
  })
})
