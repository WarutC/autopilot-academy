import { describe, expect, it, vi } from 'vitest'
import { createStick } from './input.ts'
import { createStickButtons } from './stick-buttons.ts'

type Listener = (event: FakeEvent) => void

interface FakeEvent {
  key?: string
  repeat?: boolean
  button: number
  pointerId: number
  defaultPrevented: boolean
  preventDefault(): void
}

const event = (button = 0, key?: string, repeat = false): FakeEvent => ({
  key,
  repeat,
  button,
  pointerId: 7,
  defaultPrevented: false,
  preventDefault() {
    this.defaultPrevented = true
  },
})

class FakeElement {
  className = ''
  type = ''
  hidden = false
  textContent = ''
  readonly attrs = new Map<string, string>()
  readonly children: FakeElement[] = []
  readonly listeners = new Map<string, Listener[]>()
  readonly classes = new Set<string>()
  readonly captured: number[] = []
  readonly classList = {
    toggle: (name: string, on: boolean) => {
      if (on) this.classes.add(name)
      else this.classes.delete(name)
    },
  }
  setAttribute(name: string, value: string): void {
    this.attrs.set(name, value)
  }
  getAttribute(name: string): string | null {
    return this.attrs.get(name) ?? null
  }
  addEventListener(type: string, listener: Listener): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener])
  }
  append(...nodes: FakeElement[]): void {
    this.children.push(...nodes)
  }
  setPointerCapture(id: number): void {
    this.captured.push(id)
  }
  fire(type: string, e: FakeEvent = event()): FakeEvent {
    for (const l of this.listeners.get(type) ?? []) l(e)
    return e
  }
}

function setup() {
  const doc = { createElement: () => new FakeElement() }
  const onChange = vi.fn()
  const stick = createStick(onChange)
  const buttons = createStickButtons(doc as unknown as Document, stick)
  const root = buttons.element as unknown as FakeElement
  const [climb, dive] = root.children
  return { stick, onChange, buttons, root, climb: climb!, dive: dive! }
}

describe('createStickButtons', () => {
  it('builds ▲ Climb and ▼ Dive as native buttons with accessible names', () => {
    const { climb, dive } = setup()
    expect([climb.type, dive.type]).toEqual(['button', 'button'])
    expect([climb.textContent, dive.textContent]).toEqual(['▲', '▼'])
    expect([climb.getAttribute('aria-label'), dive.getAttribute('aria-label')]).toEqual(['Climb', 'Dive'])
    expect(climb.getAttribute('aria-pressed')).toBe('false')
  })

  it('presses the stick on pointerdown with capture, and releases on pointerup', () => {
    const { stick, climb } = setup()
    climb.fire('pointerdown')
    expect(climb.captured).toEqual([7])
    expect(stick.value).toBe(1)
    expect(climb.getAttribute('aria-pressed')).toBe('true')
    expect(climb.classes.has('held')).toBe(true)
    climb.fire('pointerup')
    expect(stick.value).toBe(0)
    expect(climb.getAttribute('aria-pressed')).toBe('false')
    expect(climb.classes.has('held')).toBe(false)
  })

  it('releases on pointercancel and lostpointercapture', () => {
    const { stick, dive } = setup()
    dive.fire('pointerdown')
    expect(stick.value).toBe(-1)
    dive.fire('pointercancel')
    expect(stick.value).toBe(0)
    dive.fire('pointerdown')
    dive.fire('lostpointercapture')
    expect(stick.value).toBe(0)
  })

  it('gives 0 with both held, and the other direction after one is released', () => {
    const { stick, climb, dive } = setup()
    climb.fire('pointerdown')
    dive.fire('pointerdown')
    expect(stick.value).toBe(0)
    climb.fire('pointerup')
    expect(stick.value).toBe(-1)
  })

  it('ignores a secondary button and prevents the context menu', () => {
    const { stick, climb } = setup()
    climb.fire('pointerdown', event(2))
    expect(stick.value).toBe(0)
    expect(climb.fire('contextmenu').defaultPrevented).toBe(true)
  })

  it('holds a focused button with Space or Enter, and releases on keyup or blur', () => {
    const { stick, climb, dive } = setup()
    const down = climb.fire('keydown', event(0, ' '))
    expect(down.defaultPrevented).toBe(true)
    expect(stick.value).toBe(1)
    expect(climb.getAttribute('aria-pressed')).toBe('true')
    expect(climb.classes.has('held')).toBe(true)
    climb.fire('keydown', event(0, ' ', true))
    climb.fire('keyup', event(0, ' '))
    expect(stick.value).toBe(0)
    expect(climb.getAttribute('aria-pressed')).toBe('false')
    expect(climb.classes.has('held')).toBe(false)
    dive.fire('keydown', event(0, 'Enter'))
    expect(stick.value).toBe(-1)
    dive.fire('blur')
    expect(stick.value).toBe(0)
    expect(dive.getAttribute('aria-pressed')).toBe('false')
    climb.fire('keydown', event(0, 'a'))
    expect(stick.value).toBe(0)
  })

  it('releases held buttons when hidden', () => {
    const { stick, buttons, root, climb } = setup()
    climb.fire('pointerdown')
    buttons.setVisible(false)
    expect(root.hidden).toBe(true)
    expect(stick.value).toBe(0)
    expect(climb.getAttribute('aria-pressed')).toBe('false')
    buttons.setVisible(true)
    expect(root.hidden).toBe(false)
  })
})
