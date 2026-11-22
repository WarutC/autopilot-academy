import { describe, expect, it, vi } from 'vitest'
import { createScoreMirror } from './score-mirror.ts'
import { fixtureSnapshot } from '../render/fixture.ts'
import { createToolbar, type ToolbarHandlers } from './toolbar.ts'

/** A button, input, label or div stand-in with the members the toolbar and the score mirror use. */
class FakeElement {
  className = ''
  type = ''
  id = ''
  htmlFor = ''
  inputMode = ''
  autocomplete = ''
  disabled = false
  private val = ''
  readonly attrs = new Map<string, string>()
  readonly children: FakeElement[] = []
  readonly listeners = new Map<string, () => void>()
  private text = ''
  private readonly doc: FakeDoc
  constructor(doc: FakeDoc) {
    this.doc = doc
  }
  get textContent(): string {
    return this.text
  }
  set textContent(value: string) {
    this.doc.writes++
    this.text = value
  }
  get value(): string {
    return this.val
  }
  set value(value: string) {
    this.doc.writes++
    this.val = value
  }
  setAttribute(name: string, value: string): void {
    this.doc.writes++
    this.attrs.set(name, value)
  }
  getAttribute(name: string): string | null {
    return this.attrs.get(name) ?? null
  }
  addEventListener(type: string, listener: () => void): void {
    this.listeners.set(type, listener)
  }
  append(...nodes: FakeElement[]): void {
    this.children.push(...nodes)
  }
  focus(): void {
    this.doc.activeElement = this
  }
  click(): void {
    this.listeners.get('click')?.()
  }
  /** Types `text` and commits it, as Enter or leaving the field does. */
  commit(text: string): void {
    this.val = text
    this.listeners.get('change')?.()
  }
}

class FakeDoc {
  activeElement: FakeElement | null = null
  writes = 0
  createElement(): FakeElement {
    return new FakeElement(this)
  }
}

function setup() {
  const fake = new FakeDoc()
  const handlers: ToolbarHandlers = {
    fly: vi.fn(),
    togglePause: vi.fn(),
    setSpeed: vi.fn(),
    setCourse: vi.fn(),
    newCourse: vi.fn(),
  }
  const toolbar = createToolbar(fake as unknown as Document, handlers)
  const root = toolbar.element as unknown as FakeElement
  const [fly, pause, seg, courseLabel, newCourse] = root.children
  return {
    fake,
    handlers,
    toolbar,
    fly: fly!,
    pause: pause!,
    speeds: seg!.children,
    courseLabel: courseLabel!,
    field: courseLabel!.children[0]!,
    newCourse: newCourse!,
  }
}

const pressed = (speeds: FakeElement[]) => speeds.map((b) => b.getAttribute('aria-pressed'))

describe('createToolbar', () => {
  it('builds Fly, Pause and a labeled speed group of native buttons', () => {
    const { fly, pause, speeds } = setup()
    expect([fly.type, pause.type, ...speeds.map((b) => b.type)]).toEqual(Array(5).fill('button'))
    expect(speeds.map((b) => b.textContent)).toEqual(['×1', '×2', '×4'])
  })

  it('disables Pause when ready and marks ×1 pressed', () => {
    const { toolbar, fly, pause, speeds } = setup()
    toolbar.update('ready', 1, 101)
    expect(fly.textContent).toBe('Fly')
    expect(pause.disabled).toBe(true)
    expect(pressed(speeds)).toEqual(['true', 'false', 'false'])
  })

  it('enables Pause while running and moves aria-pressed with the speed', () => {
    const { toolbar, pause, speeds } = setup()
    toolbar.update('ready', 1, 101)
    toolbar.update('running', 4, 101)
    expect(pause.disabled).toBe(false)
    expect(pressed(speeds)).toEqual(['false', 'false', 'true'])
  })

  it('hands focus to Fly before disabling a focused Pause', () => {
    const { fake, toolbar, fly, pause } = setup()
    toolbar.update('running', 1, 101)
    pause.focus()
    toolbar.update('ended', 1, 101)
    expect(pause.disabled).toBe(true)
    expect(fake.activeElement).toBe(fly)
  })

  it('leaves focus alone when Pause was not focused', () => {
    const { fake, toolbar, pause } = setup()
    toolbar.update('running', 1, 101)
    fake.activeElement = null
    toolbar.update('ended', 1, 101)
    expect(pause.disabled).toBe(true)
    expect(fake.activeElement).toBeNull()
  })

  it('writes nothing when the phase and speed are unchanged', () => {
    const { fake, toolbar } = setup()
    toolbar.update('running', 2, 101)
    const writes = fake.writes
    toolbar.update('running', 2, 101)
    expect(fake.writes).toBe(writes)
  })

  it('calls the matching handler on each click', () => {
    const { handlers, fly, pause, speeds } = setup()
    fly.click()
    pause.click()
    speeds.forEach((b) => b.click())
    expect(handlers.fly).toHaveBeenCalledTimes(1)
    expect(handlers.togglePause).toHaveBeenCalledTimes(1)
    expect(vi.mocked(handlers.setSpeed).mock.calls).toEqual([[1], [2], [4]])
  })

  it('builds a labeled numeric Course field and a New course button after the speed group', () => {
    const { courseLabel, field, newCourse } = setup()
    expect(courseLabel.className).toBe('course-label')
    expect(courseLabel.textContent).toBe('Course')
    expect(courseLabel.htmlFor).toBe(field.id)
    expect(field.id).not.toBe('')
    expect(field.type).toBe('text')
    expect(field.className).toBe('course-field')
    expect(field.inputMode).toBe('numeric')
    expect(field.getAttribute('aria-label')).toBe('Course number')
    expect(newCourse.type).toBe('button')
    expect(newCourse.className).toBe('btn')
    expect(newCourse.textContent).toBe('New course')
  })

  it('shows the course and commits a valid, different number', () => {
    const { handlers, toolbar, field } = setup()
    toolbar.update('ready', 1, 101)
    expect(field.value).toBe('101')
    field.commit('555')
    expect(vi.mocked(handlers.setCourse).mock.calls).toEqual([[555]])
    toolbar.update('ready', 1, 555)
    expect(field.value).toBe('555')
  })

  it('restores the current course on invalid or unchanged input', () => {
    const { handlers, toolbar, field } = setup()
    toolbar.update('ready', 1, 101)
    for (const text of ['0', 'abc', '12.5', '100000', '', '-3', '101']) {
      field.commit(text)
      expect(field.value).toBe('101')
    }
    expect(handlers.setCourse).not.toHaveBeenCalled()
  })

  it('shows the current course again when the page rejects a committed one', () => {
    const { handlers, toolbar, field } = setup()
    toolbar.update('ready', 1, 101)
    field.commit('555')
    expect(handlers.setCourse).toHaveBeenCalledWith(555)
    expect(field.value).toBe('101')
  })

  it('calls newCourse on a New course click', () => {
    const { handlers, newCourse } = setup()
    newCourse.click()
    expect(handlers.newCourse).toHaveBeenCalledTimes(1)
  })

  it('disables the Course field and New course in flight only', () => {
    const { toolbar, field, newCourse } = setup()
    const state = () => [field.disabled, newCourse.disabled]
    toolbar.update('ready', 1, 101)
    expect(state()).toEqual([false, false])
    toolbar.update('running', 1, 101)
    expect(state()).toEqual([true, true])
    toolbar.update('paused', 1, 101)
    expect(state()).toEqual([true, true])
    toolbar.update('ended', 1, 101)
    expect(state()).toEqual([false, false])
  })

  it('hands focus to Fly before disabling a focused Course field or New course', () => {
    for (const pick of ['field', 'newCourse'] as const) {
      const parts = setup()
      parts.toolbar.update('ready', 1, 101)
      parts[pick].focus()
      parts.toolbar.update('running', 1, 101)
      expect(parts.fake.activeElement).toBe(parts.fly)
    }
  })

  it('does not rewrite the field while the course is unchanged, so typing survives', () => {
    const { toolbar, field } = setup()
    toolbar.update('ready', 1, 101)
    field.value = '55'
    toolbar.update('ready', 1, 101)
    toolbar.update('ready', 2, 101)
    expect(field.value).toBe('55')
  })
})

describe('createScoreMirror', () => {
  it('is a polite live region that rewrites only a changed score', () => {
    const fake = new FakeDoc()
    const mirror = createScoreMirror(fake as unknown as Document)
    const el = mirror.element as unknown as FakeElement
    expect(el.getAttribute('aria-live')).toBe('polite')
    const s = fixtureSnapshot()
    mirror.update(s)
    expect(el.textContent).toBe(`${s.planes[0]!.points.toFixed(1)} points`)
    const writes = fake.writes
    mirror.update(fixtureSnapshot())
    expect(fake.writes).toBe(writes)
  })
})
