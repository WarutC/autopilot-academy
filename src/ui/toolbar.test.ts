import { describe, expect, it, vi } from 'vitest'
import { createScoreMirror } from './score-mirror.ts'
import { fixtureSnapshot } from '../render/fixture.ts'
import { createToolbar, type ToolbarHandlers } from './toolbar.ts'

/** A button or div stand-in with the members the toolbar and the score mirror use. */
class FakeElement {
  className = ''
  type = ''
  disabled = false
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
  const handlers: ToolbarHandlers = { fly: vi.fn(), togglePause: vi.fn(), setSpeed: vi.fn() }
  const toolbar = createToolbar(fake as unknown as Document, handlers)
  const root = toolbar.element as unknown as FakeElement
  const [fly, pause, seg] = root.children
  return { fake, handlers, toolbar, fly: fly!, pause: pause!, speeds: seg!.children }
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
    toolbar.update('ready', 1)
    expect(fly.textContent).toBe('Fly')
    expect(pause.disabled).toBe(true)
    expect(pressed(speeds)).toEqual(['true', 'false', 'false'])
  })

  it('enables Pause while running and moves aria-pressed with the speed', () => {
    const { toolbar, pause, speeds } = setup()
    toolbar.update('ready', 1)
    toolbar.update('running', 4)
    expect(pause.disabled).toBe(false)
    expect(pressed(speeds)).toEqual(['false', 'false', 'true'])
  })

  it('hands focus to Fly before disabling a focused Pause', () => {
    const { fake, toolbar, fly, pause } = setup()
    toolbar.update('running', 1)
    pause.focus()
    toolbar.update('ended', 1)
    expect(pause.disabled).toBe(true)
    expect(fake.activeElement).toBe(fly)
  })

  it('leaves focus alone when Pause was not focused', () => {
    const { fake, toolbar, pause } = setup()
    toolbar.update('running', 1)
    fake.activeElement = null
    toolbar.update('ended', 1)
    expect(pause.disabled).toBe(true)
    expect(fake.activeElement).toBeNull()
  })

  it('writes nothing when the phase and speed are unchanged', () => {
    const { fake, toolbar } = setup()
    toolbar.update('running', 2)
    const writes = fake.writes
    toolbar.update('running', 2)
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
