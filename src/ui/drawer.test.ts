import { describe, expect, it, vi } from 'vitest'
import { createDrawer } from './drawer.ts'

type Listener = (event: FakeEvent) => void

interface FakeEvent {
  key?: string
  defaultPrevented: boolean
  preventDefault(): void
}

const event = (key?: string): FakeEvent => ({
  key,
  defaultPrevented: false,
  preventDefault() {
    this.defaultPrevented = true
  },
})

class FakeTarget {
  readonly listeners = new Map<string, Listener[]>()
  addEventListener(type: string, listener: Listener): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener])
  }
  fire(type: string, e: FakeEvent = event()): FakeEvent {
    for (const l of this.listeners.get(type) ?? []) l(e)
    return e
  }
}

class FakeDocument extends FakeTarget {
  activeElement: FakeElement | null = null
  createElement(): FakeElement {
    return new FakeElement(this)
  }
}

class FakeElement extends FakeTarget {
  id = ''
  className = ''
  type = ''
  hidden = false
  inert = false
  textContent = ''
  readonly attrs = new Map<string, string>()
  readonly classes = new Set<string>()
  readonly inside: FakeElement[] = []
  readonly classList = {
    toggle: (name: string, on: boolean) => {
      if (on) this.classes.add(name)
      else this.classes.delete(name)
    },
  }
  readonly doc: FakeDocument
  constructor(doc: FakeDocument) {
    super()
    this.doc = doc
  }
  setAttribute(name: string, value: string): void {
    this.attrs.set(name, value)
  }
  getAttribute(name: string): string | null {
    return this.attrs.get(name) ?? null
  }
  removeAttribute(name: string): void {
    this.attrs.delete(name)
  }
  contains(el: FakeElement | null): boolean {
    return el === this || (el !== null && this.inside.includes(el))
  }
  focus(): void {
    this.doc.activeElement = this
  }
  click(): void {
    this.fire('click')
  }
}

function setup() {
  const doc = new FakeDocument()
  const panel = doc.createElement()
  panel.id = 'cards'
  const background = doc.createElement()
  const onOpen = vi.fn()
  const drawer = createDrawer(doc as unknown as Document, {
    panel: panel as unknown as HTMLElement,
    background: background as unknown as HTMLElement,
    onOpen,
  })
  const toggle = drawer.toggle as unknown as FakeElement
  const close = drawer.close as unknown as FakeElement
  const scrim = drawer.scrim as unknown as FakeElement
  // The caller prepends Close to the panel.
  panel.inside.push(close)
  return { doc, panel, background, onOpen, drawer, toggle, close, scrim }
}

describe('createDrawer', () => {
  it('builds a Cards toggle, a Close button and a hidden scrim', () => {
    const { toggle, close, scrim } = setup()
    expect([toggle.type, toggle.className, toggle.textContent]).toEqual(['button', 'btn drawer-toggle', 'Cards'])
    expect([close.type, close.className, close.textContent]).toEqual(['button', 'btn drawer-close', 'Close'])
    expect(toggle.getAttribute('aria-controls')).toBe('cards')
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(scrim.className).toBe('drawer-scrim')
    expect(scrim.hidden).toBe(true)
  })

  it('opens from Cards: panel class, scrim, aria, onOpen and focus on Close', () => {
    const { doc, panel, onOpen, drawer, toggle, close, scrim } = setup()
    toggle.focus()
    toggle.click()
    expect(drawer.isOpen).toBe(true)
    expect(panel.classes.has('drawer-open')).toBe(true)
    expect(scrim.hidden).toBe(false)
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    expect(onOpen).toHaveBeenCalledTimes(1)
    expect(doc.activeElement).toBe(close)
  })

  it('makes the open panel a modal dialog over an inert page, and undoes it on close', () => {
    const { doc, panel, background, drawer, close } = setup()
    expect(panel.getAttribute('role')).toBeNull()
    expect(background.inert).toBe(false)
    drawer.open()
    expect(panel.getAttribute('role')).toBe('dialog')
    expect(panel.getAttribute('aria-modal')).toBe('true')
    expect(panel.getAttribute('aria-label')).toBe('Cards')
    expect(background.inert).toBe(true)
    expect(panel.contains(doc.activeElement)).toBe(true)
    close.click()
    expect([panel.getAttribute('role'), panel.getAttribute('aria-modal'), panel.getAttribute('aria-label')]).toEqual([
      null,
      null,
      null,
    ])
    expect(background.inert).toBe(false)
  })

  it('releases the page when setActive(false) closes the drawer', () => {
    const { panel, background, drawer } = setup()
    drawer.open()
    drawer.setActive(false)
    expect(background.inert).toBe(false)
    expect(panel.getAttribute('role')).toBeNull()
  })

  it('calls onOpen once per open', () => {
    const { onOpen, drawer } = setup()
    drawer.open()
    drawer.open()
    expect(onOpen).toHaveBeenCalledTimes(1)
    drawer.closeDrawer()
    drawer.open()
    expect(onOpen).toHaveBeenCalledTimes(2)
  })

  it('closes from Close and returns focus to Cards', () => {
    const { doc, panel, onOpen, drawer, toggle, close, scrim } = setup()
    drawer.open()
    close.click()
    expect(drawer.isOpen).toBe(false)
    expect(panel.classes.has('drawer-open')).toBe(false)
    expect(scrim.hidden).toBe(true)
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(doc.activeElement).toBe(toggle)
    expect(onOpen).toHaveBeenCalledTimes(1)
  })

  it('closes from Cards when open', () => {
    const { drawer, toggle } = setup()
    drawer.open()
    toggle.click()
    expect(drawer.isOpen).toBe(false)
  })

  it('closes on a scrim click', () => {
    const { drawer, scrim } = setup()
    drawer.open()
    scrim.click()
    expect(drawer.isOpen).toBe(false)
  })

  it('returns focus to Cards on a scrim click even when focus already left the panel', () => {
    const { doc, drawer, toggle, scrim } = setup()
    drawer.open()
    // Pressing the scrim blurs the focused control before the click.
    doc.activeElement = null
    scrim.click()
    expect(doc.activeElement).toBe(toggle)
  })

  it('closes on Escape only when open', () => {
    const { doc, drawer, toggle } = setup()
    const idle = doc.fire('keydown', event('Escape'))
    expect(idle.defaultPrevented).toBe(false)
    drawer.open()
    doc.fire('keydown', event('Enter'))
    expect(drawer.isOpen).toBe(true)
    const e = doc.fire('keydown', event('Escape'))
    expect(e.defaultPrevented).toBe(true)
    expect(drawer.isOpen).toBe(false)
    expect(doc.activeElement).toBe(toggle)
  })

  it('leaves focus alone on close when it was outside the panel', () => {
    const { doc, drawer } = setup()
    const elsewhere = doc.createElement()
    drawer.open()
    elsewhere.focus()
    drawer.closeDrawer()
    expect(doc.activeElement).toBe(elsewhere)
  })

  it('setActive(false) closes without moving focus and ignores opens until active again', () => {
    const { doc, onOpen, drawer, close } = setup()
    drawer.open()
    expect(doc.activeElement).toBe(close)
    drawer.setActive(false)
    expect(drawer.isOpen).toBe(false)
    expect(doc.activeElement).toBe(close)
    drawer.open()
    expect(drawer.isOpen).toBe(false)
    drawer.setActive(true)
    drawer.open()
    expect(drawer.isOpen).toBe(true)
    expect(onOpen).toHaveBeenCalledTimes(2)
  })
})
