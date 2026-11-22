import { describe, expect, it, vi } from 'vitest'
import dampedP from '../algorithms/fixtures/damped-p.ts'
import { algorithms, BUILT_IN_ORDER, buildRegistry, defaultParams, type AlgorithmModule } from '../algorithms/index.ts'
import manual from '../algorithms/manual.ts'
import pid from '../algorithms/pid.ts'
import { createAutopilotCard, type AutopilotCardHandlers } from './autopilot-card.ts'

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

function setup(params = defaultParams(pid)) {
  const doc = new FakeDoc()
  const calls: string[] = []
  const handlers: AutopilotCardHandlers = {
    change: vi.fn((key: string, value: number) => void calls.push(`change ${key} ${value}`)),
    commit: vi.fn((label: string) => void calls.push(`commit ${label}`)),
    select: vi.fn((id: string) => void calls.push(`select ${id}`)),
  }
  const card = createAutopilotCard(doc as unknown as Document, algorithms, 'pid', params, handlers)
  const root = card.element as unknown as FakeElement
  const els = root.all()
  const byClass = (c: string) => els.filter((e) => e.className.split(' ').includes(c))
  /** Like `byClass`, but reads the card as it is now. */
  const live = (c: string) => root.all().filter((e) => e.className.split(' ').includes(c))
  const row = (key: string) => {
    const index = pid.params.findIndex((p) => p.key === key)
    const r = byClass('param-row')[index]!
    const inner = r.all()
    const find = (c: string) => inner.find((e) => e.className === c)
    return { field: find('param-number'), slider: find('param-slider'), check: find('param-check'), label: find('param-label')! }
  }
  /** The chip for module `id`, found by its index in the registry. */
  const chip = (id: string) => byClass('lesson-chip')[algorithms.findIndex((m) => m.id === id)]!
  return { doc, calls, handlers, card, root, els, byClass, live, row, chip }
}

describe('createAutopilotCard', () => {
  it('builds the heading, name, lesson with a bold Try:, five PID rows and Reset', () => {
    const { root, els, byClass, row } = setup()
    expect(byClass('card-header')[0]!.textContent).toBe('Autopilot')
    expect(byClass('autopilot-name')[0]!.textContent).toBe('PID')
    const lesson = byClass('lesson')[0]!
    expect(lesson.textContent).toBe(pid.lesson)
    expect(lesson.children.find((c) => typeof c !== 'string')).toMatchObject({ tagName: 'strong' })
    expect(byClass('param-row')).toHaveLength(5)
    for (const spec of pid.params) {
      const r = row(spec.key)
      const input = spec.toggle ? r.check! : r.field!
      expect(r.label.htmlFor).toBe(input.id)
      expect(r.label.textContent).toBe(spec.label)
      const sub = r.label.children.find((c) => typeof c !== 'string' && c.tagName === 'sub')
      if (/^K[a-z]$/.test(spec.key)) expect(sub).toMatchObject({ textContent: spec.key.slice(1) })
      else expect(sub).toBeUndefined()
      expect(input.getAttribute('aria-label')).toBe(spec.accessibleName)
      if (!spec.toggle) expect(r.slider!.getAttribute('aria-label')).toBe(`${spec.accessibleName}, slider`)
    }
    expect(row('Kd').field!.value).toBe('0.05')
    expect(row('Kd').slider!.value).toBe('0.05')
    expect(row('Kd').slider!.min).toBe('0')
    expect(row('Kd').slider!.max).toBe('0.3')
    expect(row('aw').check!.checked).toBe(true)
    expect(els.find((e) => e.className.includes('btn-reset'))!.textContent).toBe('Reset this autopilot to defaults')
    expect(root.className).toContain('card')
  })

  it('keeps the field in step with the slider and commits once per release', () => {
    const { calls, row } = setup({ ...defaultParams(pid), Kd: 0 })
    const { slider, field } = row('Kd')
    for (const v of ['0.01', '0.03', '0.05']) {
      slider!.value = v
      slider!.fire('input')
      expect(field!.value).toBe(v)
    }
    slider!.fire('change')
    expect(calls).toEqual(['change Kd 0.01', 'change Kd 0.03', 'change Kd 0.05', 'commit Kd 0 → 0.05'])
  })

  it('commits nothing when a drag ends where it started', () => {
    const { handlers, row } = setup()
    const { slider } = row('Kd')
    slider!.value = '0.1'
    slider!.fire('input')
    slider!.value = '0.05'
    slider!.fire('input')
    slider!.fire('change')
    expect(handlers.commit).not.toHaveBeenCalled()
  })

  it('starts the next drag label from a typed value after a drag that sent no change', () => {
    const { handlers, row } = setup()
    const { slider, field } = row('Kd')
    // A drag that ends at its start value: the browser sends no change event.
    slider!.value = '0.1'
    slider!.fire('input')
    slider!.value = '0.05'
    slider!.fire('input')
    field!.value = '0.2'
    field!.fire('change')
    slider!.value = '0.25'
    slider!.fire('input')
    slider!.fire('change')
    expect(vi.mocked(handlers.commit).mock.calls).toEqual([['Kd 0.05 → 0.2'], ['Kd 0.2 → 0.25']])
  })

  it('commits a typed number, clamps it and reverts bad input', () => {
    const { calls, row } = setup({ ...defaultParams(pid), Kd: 0.1 })
    const { field, slider } = row('Kd')
    field!.value = 'abc'
    field!.fire('change')
    expect(field!.value).toBe('0.1')
    field!.value = '9'
    field!.fire('change')
    expect(field!.value).toBe('0.3')
    expect(slider!.value).toBe('0.3')
    field!.value = '-1'
    field!.fire('change')
    expect(field!.value).toBe('0')
    field!.value = '0'
    field!.fire('change')
    expect(calls).toEqual(['change Kd 0.3', 'commit Kd 0.1 → 0.3', 'change Kd 0', 'commit Kd 0.3 → 0'])
  })

  it('changes and commits a toggle', () => {
    const { calls, row } = setup()
    const { check } = row('aw')
    check!.checked = false
    check!.fire('change')
    expect(calls).toEqual(['change aw 0', 'commit aw on → off'])
  })

  it('resets every changed key, then commits once with the labels joined', () => {
    const { calls, row, els } = setup({ ...defaultParams(pid), Kp: 0.5, Kd: 0 })
    els.find((e) => e.className.includes('btn-reset'))!.fire('click')
    expect(calls).toEqual(['change Kp 0.2', 'change Kd 0.05', 'commit Kp 0.5 → 0.2, Kd 0 → 0.05'])
    expect(row('Kp').field!.value).toBe('0.2')
    expect(row('Kd').slider!.value).toBe('0.05')
  })

  it('fires nothing on Reset when nothing changed', () => {
    const { handlers, els } = setup()
    els.find((e) => e.className.includes('btn-reset'))!.fire('click')
    expect(handlers.change).not.toHaveBeenCalled()
    expect(handlers.commit).not.toHaveBeenCalled()
  })

  it('lists one chip per registry entry, in order, with the selected one pressed', () => {
    const { byClass, els } = setup()
    const group = els.find((e) => e.className === 'lesson-chips')!
    expect(group.getAttribute('role')).toBe('group')
    expect(group.getAttribute('aria-label')).toBe('Lessons')
    const chips = byClass('lesson-chip')
    expect(chips).toHaveLength(algorithms.length)
    expect(chips.map((c) => c.type)).toEqual(algorithms.map(() => 'button'))
    algorithms.forEach((m, i) => {
      const lines = chips[i]!.children.map((c) => (typeof c === 'string' ? c : c.textContent))
      expect(lines).toEqual([`Lesson ${i + 1}`, m.name, m.community ? 'Community' : m.tag])
      expect(chips[i]!.getAttribute('aria-pressed')).toBe(String(m.id === 'pid'))
    })
    const chipOf = (id: string) => chips[algorithms.findIndex((m) => m.id === id)]!
    expect(chipOf('manual').children[1]).toMatchObject({ textContent: 'Manual' })
    expect(chipOf('pid').children[1]).toMatchObject({ textContent: 'PID' })
  })

  it('calls select when a chip is clicked', () => {
    const { calls, chip } = setup()
    chip('manual').fire('click')
    expect(calls).toEqual(['select manual'])
  })

  it('ignores a click on another chip in flight', () => {
    const { calls, card, chip } = setup()
    card.setPhase('running')
    chip('manual').fire('click')
    expect(calls).toEqual([])
    card.setPhase('ended')
    chip('manual').fire('click')
    expect(calls).toEqual(['select manual'])
  })

  it('disables every chip but the selected one in flight, moving focus off a disabled chip', () => {
    const { doc, card, byClass, chip } = setup()
    const chips = byClass('lesson-chip')
    const pidChip = chip('pid')
    chip('manual').focus()
    for (const phase of ['running', 'paused'] as const) {
      card.setPhase(phase)
      expect(chips.map((c) => c.disabled)).toEqual(algorithms.map((m) => m.id !== 'pid'))
    }
    expect(doc.activeElement).toBe(pidChip)
    card.setPhase('ended')
    expect(chips.every((c) => !c.disabled)).toBe(true)
    card.setPhase('ready')
    expect(chips.every((c) => !c.disabled)).toBe(true)
  })

  it('switches to a lesson with no params, then back to PID with the given values', () => {
    const { card, live } = setup()
    card.setLesson(manual, {})
    expect(live('autopilot-name')[0]!.textContent).toBe('Manual')
    expect(live('lesson')[0]!.textContent).toBe(manual.lesson)
    expect(live('param-row')).toHaveLength(0)
    expect(live('btn-reset')[0]!.hidden).toBe(true)
    expect(live('lesson-chip').map((c) => c.getAttribute('aria-pressed'))).toEqual(
      algorithms.map((m) => String(m.id === 'manual')),
    )

    card.setLesson(pid, { ...defaultParams(pid), Kd: 0.1 })
    expect(live('autopilot-name')[0]!.textContent).toBe('PID')
    expect(live('lesson')[0]!.textContent).toBe(pid.lesson)
    const rows = live('param-row')
    expect(rows).toHaveLength(5)
    expect(live('btn-reset')[0]!.hidden).toBe(false)
    const kd = rows[pid.params.findIndex((p) => p.key === 'Kd')]!.all().find((e) => e.className === 'param-number')!
    expect(kd.value).toBe('0.1')
  })

  it('keeps the selected chip enabled after switching lessons in flight', () => {
    const { card, live } = setup()
    card.setLesson(manual, {})
    card.setPhase('running')
    expect(live('lesson-chip').map((c) => c.disabled)).toEqual(algorithms.map((m) => m.id !== 'manual'))
  })
})

describe('createAutopilotCard with a contributed module', () => {
  /** A built-in stand-in: enough of a module for a chip. */
  const stub = (id: string): AlgorithmModule => ({
    id,
    name: id.toUpperCase(),
    tag: `Tag ${id}`,
    lesson: 'Stub. Try: nothing.',
    modes: ['autopilot'],
    params: [],
    create: () => ({ compute: () => 0 }),
  })

  function setupCommunity() {
    const entries: Record<string, unknown> = { './damped-p.ts': { default: dampedP } }
    for (const id of BUILT_IN_ORDER) entries[`./${id}.ts`] = { default: stub(id) }
    const warn = vi.fn()
    const registry = buildRegistry(entries, warn)
    const handlers: AutopilotCardHandlers = { change: vi.fn(), commit: vi.fn(), select: vi.fn() }
    const card = createAutopilotCard(
      new FakeDoc() as unknown as Document,
      registry,
      dampedP.id,
      defaultParams(dampedP),
      handlers,
    )
    const root = card.element as unknown as FakeElement
    const byClass = (c: string) => root.all().filter((e) => e.className.split(' ').includes(c))
    return { registry, warn, card, root, byClass }
  }

  it('registers the module last, after MPC, as Community', () => {
    const { registry, warn } = setupCommunity()
    expect(warn).not.toHaveBeenCalled()
    expect(registry.map((m) => m.id)).toEqual([...BUILT_IN_ORDER, 'damped-p'])
    expect(registry[BUILT_IN_ORDER.length]).toMatchObject({ id: 'damped-p', community: true })
    expect(registry[BUILT_IN_ORDER.length - 1]).toMatchObject({ id: BUILT_IN_ORDER.at(-1), community: false })
  })

  it('reads "Community" in place of the tag on its chip, in text and accessible name', () => {
    const { byClass } = setupCommunity()
    const chips = byClass('lesson-chip')
    const n = BUILT_IN_ORDER.length + 1
    expect(chips).toHaveLength(n)
    const chip = chips[n - 1]!
    expect(chip.className.split(' ')).toContain('lesson-chip-community')
    expect(chip.children.map((c) => (typeof c === 'string' ? c : c.textContent))).toEqual([
      `Lesson ${n}`,
      'Damped P',
      'Community',
    ])
    expect(chip.getAttribute('aria-label')).toBe(`Lesson ${n}, Damped P, Community`)
    expect(chip.textContent).not.toContain(dampedP.tag)
  })

  it('shows the best on a Community chip, which keeps its class', () => {
    const { card, byClass } = setupCommunity()
    const chips = byClass('lesson-chip')
    const n = chips.length
    card.setBests({ [dampedP.id]: 12 })
    const chip = chips[n - 1]!
    expect(chip.className.split(' ')).toContain('lesson-chip-community')
    expect(chip.children.map((c) => (typeof c === 'string' ? c : c.textContent))).toEqual([`Lesson ${n}`, 'Damped P', 'Best 12.0'])
    expect(chip.getAttribute('aria-label')).toBe(`Lesson ${n}, Damped P, Best 12.0`)
  })

  it('leaves built-in chips showing their own tag', () => {
    const { byClass } = setupCommunity()
    const chips = byClass('lesson-chip')
    BUILT_IN_ORDER.forEach((id, i) => {
      const chip = chips[i]!
      expect(chip.className).toBe('lesson-chip')
      const tag = chip.all().find((e) => e.className === 'lesson-chip-tag')!
      expect(tag.textContent).toBe(`Tag ${id}`)
      expect(chip.getAttribute('aria-label')).toBe(`Lesson ${i + 1}, ${id.toUpperCase()}, Tag ${id}`)
    })
  })

  it('builds one row per parameter from its ParamSpec list', () => {
    const { byClass } = setupCommunity()
    expect(byClass('autopilot-name')[0]!.textContent).toBe('Damped P')
    const rows = byClass('param-row')
    expect(rows).toHaveLength(dampedP.params.length)
    dampedP.params.forEach((spec, i) => {
      const inner = rows[i]!.all()
      const field = inner.find((e) => e.className === 'param-number')!
      const slider = inner.find((e) => e.className === 'param-slider')!
      expect(inner.find((e) => e.className === 'param-label')!.textContent).toBe(spec.label)
      expect(field.getAttribute('aria-label')).toBe(spec.accessibleName)
      expect(slider.getAttribute('aria-label')).toBe(`${spec.accessibleName}, slider`)
      expect(Number(field.value)).toBe(spec.default)
    })
  })
})

describe('AutopilotCard best scores', () => {
  const text = (chip: FakeElement) => chip.children.map((c) => (typeof c === 'string' ? c : c.textContent))

  it('shows "Best <score>" in place of the tag on a chip with a best score, in text and accessible name', () => {
    const { card, chip } = setup()
    const n = algorithms.findIndex((m) => m.id === 'pid') + 1
    card.setBests({ pid: 87.44 })
    expect(text(chip('pid'))).toEqual([`Lesson ${n}`, 'PID', 'Best 87.4'])
    expect(chip('pid').getAttribute('aria-label')).toBe(`Lesson ${n}, PID, Best 87.4`)
    const m = algorithms.findIndex((a) => a.id === 'manual')
    expect(text(chip('manual'))[2]).toBe(algorithms[m]!.tag)
    expect(chip('manual').getAttribute('aria-label')).toBe(`Lesson ${m + 1}, Manual, ${algorithms[m]!.tag}`)
  })

  it('puts the tag back when the best score is removed', () => {
    const { card, chip } = setup()
    const n = algorithms.findIndex((m) => m.id === 'pid') + 1
    card.setBests({ pid: 87.44 })
    card.setBests({})
    expect(text(chip('pid'))[2]).toBe(pid.tag)
    expect(chip('pid').getAttribute('aria-label')).toBe(`Lesson ${n}, PID, ${pid.tag}`)
  })

  it('leaves the chips alone when the shown text is unchanged', () => {
    const { card, byClass } = setup()
    card.setBests({ pid: 87.44 })
    const textWrites = vi.spyOn(FakeElement.prototype, 'textContent', 'set')
    const attrWrites = byClass('lesson-chip').map((b) => vi.spyOn(b, 'setAttribute'))
    card.setBests({ pid: 87.44 })
    card.setBests({ pid: 87.41 })
    expect(textWrites).not.toHaveBeenCalled()
    for (const spy of attrWrites) expect(spy).not.toHaveBeenCalled()
    textWrites.mockRestore()
  })
})
