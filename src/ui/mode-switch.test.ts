import { describe, expect, it, vi } from 'vitest'
import { createModeSwitch } from './mode-switch.ts'

/** A button or div stand-in with the members the mode switch uses. */
class FakeElement {
  className = ''
  type = ''
  hidden = false
  textContent = ''
  readonly attrs = new Map<string, string>()
  children: FakeElement[] = []
  readonly listeners = new Map<string, () => void>()
  setAttribute(name: string, value: string): void {
    this.attrs.set(name, value)
  }
  getAttribute(name: string): string | null {
    return this.attrs.get(name) ?? null
  }
  addEventListener(type: string, listener: () => void): void {
    this.listeners.set(type, listener)
  }
  replaceChildren(...nodes: FakeElement[]): void {
    this.children = nodes
  }
  click(): void {
    this.listeners.get('click')?.()
  }
}

function setup() {
  const doc = { createElement: () => new FakeElement() }
  const select = vi.fn()
  const sw = createModeSwitch(doc as unknown as Document, { select })
  const root = sw.element as unknown as FakeElement
  return { sw, root, select }
}

const labels = (root: FakeElement) => root.children.map((b) => b.textContent)
const pressed = (root: FakeElement) => root.children.map((b) => b.getAttribute('aria-pressed'))

describe('createModeSwitch', () => {
  it('is a labeled segmented group, hidden until it has two modes', () => {
    const { root } = setup()
    expect(root.className).toContain('seg')
    expect(root.getAttribute('role')).toBe('group')
    expect(root.getAttribute('aria-label')).toBe('Flight mode')
    expect(root.hidden).toBe(true)
  })

  it('shows one native button per mode in order, with the selected one pressed', () => {
    const { sw, root } = setup()
    sw.update(['semi-auto', 'autopilot'], 'autopilot')
    expect(root.hidden).toBe(false)
    expect(labels(root)).toEqual(['Semi-auto', 'Autopilot'])
    expect(root.children.every((b) => b.type === 'button' && b.className === 'seg-btn')).toBe(true)
    expect(pressed(root)).toEqual(['false', 'true'])
    sw.update(['semi-auto', 'autopilot'], 'semi-auto')
    expect(pressed(root)).toEqual(['true', 'false'])
  })

  it('hides with fewer than two modes', () => {
    const { sw, root } = setup()
    sw.update(['semi-auto', 'autopilot'], 'autopilot')
    sw.update(['manual'], 'manual')
    expect(root.hidden).toBe(true)
    expect(labels(root)).toEqual(['Manual'])
  })

  it('rebuilds the buttons only when the modes change', () => {
    const { sw, root } = setup()
    sw.update(['semi-auto', 'autopilot'], 'autopilot')
    const first = root.children
    sw.update(['semi-auto', 'autopilot'], 'semi-auto')
    expect(root.children).toBe(first)
    sw.update(['manual'], 'manual')
    expect(root.children).not.toBe(first)
  })

  it('selects a mode on click and ignores a click on the selected one', () => {
    const { sw, root, select } = setup()
    sw.update(['semi-auto', 'autopilot'], 'autopilot')
    root.children[1]!.click()
    expect(select).not.toHaveBeenCalled()
    root.children[0]!.click()
    expect(select).toHaveBeenCalledWith('semi-auto')
    sw.update(['semi-auto', 'autopilot'], 'semi-auto')
    root.children[0]!.click()
    expect(select).toHaveBeenCalledTimes(1)
  })
})
