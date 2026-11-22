import { describe, expect, it, vi } from 'vitest'
import { defaultParams, type Params } from '../algorithms/index.ts'
import manual from '../algorithms/manual.ts'
import p from '../algorithms/p.ts'
import pid from '../algorithms/pid.ts'
import { createWingmanCard, NO_WINGMAN, wingmanChoices, wingmanPlayer } from './wingman-card.ts'

/** Just enough of an element for the card: a select with options, text and events. */
class FakeElement {
  className = ''
  id = ''
  disabled = false
  value = ''
  readonly attrs = new Map<string, string>()
  children: Array<FakeElement | string> = []
  readonly listeners = new Map<string, Array<() => void>>()
  private text = ''
  readonly tagName: string
  constructor(tagName: string) {
    this.tagName = tagName
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
  fire(type: string): void {
    for (const l of this.listeners.get(type) ?? []) l()
  }
  /** Every descendant element, depth first. */
  all(): FakeElement[] {
    return this.children.flatMap((c) => (typeof c === 'string' ? [] : [c, ...c.all()]))
  }
}

class FakeDoc {
  createElement(tag: string): FakeElement {
    return new FakeElement(tag)
  }
}

const modules = [manual, p, pid]

function setup(selected: string | null = null) {
  const change = vi.fn<(id: string | null) => void>()
  const card = createWingmanCard(new FakeDoc() as unknown as Document, modules, selected, { change })
  const root = card.element as unknown as FakeElement
  const select = root.all().find((e) => e.tagName === 'select')!
  const options = select.all().filter((e) => e.tagName === 'option')
  return { card, change, root, select, options }
}

describe('wingmanChoices', () => {
  it('keeps only lessons offering Autopilot, in registry order', () => {
    expect(wingmanChoices(modules).map((m) => m.id)).toEqual(['p', 'pid'])
  })
})

describe('wingmanPlayer', () => {
  const params = (id: string): Params => (id === 'p' ? { ...defaultParams(p), Kp: 0.5 } : {})

  it('flies the lesson with its saved params', () => {
    const w = wingmanPlayer(modules, 'p', params)
    expect(w?.algorithm).toBe(p)
    expect(w?.params).toEqual({ ...defaultParams(p), Kp: 0.5 })
  })

  it('is undefined for none, an unknown id or a Manual-only lesson', () => {
    expect(wingmanPlayer(modules, null, params)).toBeUndefined()
    expect(wingmanPlayer(modules, 'nope', params)).toBeUndefined()
    expect(wingmanPlayer(modules, 'manual', params)).toBeUndefined()
  })
})

describe('createWingmanCard', () => {
  it('builds the heading, the select of No wingman then the Autopilot lessons, and the note', () => {
    const { root, select, options } = setup()
    expect(root.className).toBe('card wingman-card')
    expect(root.getAttribute('aria-labelledby')).toBe('wingman-card-title')
    const header = root.all().find((e) => e.className === 'card-header')!
    expect(header.id).toBe('wingman-card-title')
    expect(header.textContent).toBe('Wingman')
    expect(select.className).toBe('wingman-select')
    expect(select.id).toBe('wingman-select')
    expect(select.getAttribute('aria-label')).toBe('Wingman autopilot')
    expect(options.map((o) => o.value)).toEqual([NO_WINGMAN, 'p', 'pid'])
    expect(options.map((o) => o.textContent)).toEqual(['No wingman', 'P', 'PID'])
    expect(select.value).toBe('none')
    const note = root.all().find((e) => e.className === 'wingman-note')!
    expect(note.textContent).toBe(
      'A second autopilot flies the same course, in the same conditions, using its own saved parameters.',
    )
  })

  it('shows the selected wingman, and none for an id it cannot fly', () => {
    expect(setup('pid').select.value).toBe('pid')
    expect(setup('manual').select.value).toBe('none')
  })

  it('reports a change as the id, or null for No wingman', () => {
    const { select, change } = setup()
    select.value = 'p'
    select.fire('change')
    expect(change).toHaveBeenLastCalledWith('p')
    select.value = 'none'
    select.fire('change')
    expect(change).toHaveBeenLastCalledWith(null)
    select.fire('change')
    expect(change).toHaveBeenCalledTimes(2)
  })

  it('is disabled while running or paused, and enabled when ready or ended', () => {
    const { card, select } = setup()
    card.setPhase('running')
    expect(select.disabled).toBe(true)
    card.setPhase('paused')
    expect(select.disabled).toBe(true)
    card.setPhase('ended')
    expect(select.disabled).toBe(false)
    card.setPhase('running')
    card.setPhase('ready')
    expect(select.disabled).toBe(false)
  })
})
