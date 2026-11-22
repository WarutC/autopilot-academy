import { describe, expect, it, vi } from 'vitest'
import { createSetpointSlider, nudgeValue } from './setpoint-slider.ts'

/** An element stand-in with the members the slider uses. */
class FakeElement {
  className = ''
  type = ''
  hidden = false
  min = ''
  max = ''
  step = ''
  value = ''
  readonly attrs = new Map<string, string>()
  readonly children: FakeElement[] = []
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
  append(...nodes: FakeElement[]): void {
    this.children.push(...nodes)
  }
  fire(type: string): void {
    this.listeners.get(type)?.()
  }
}

function setup(value = 50) {
  const doc = { createElement: () => new FakeElement() }
  const onChange = vi.fn()
  const slider = createSetpointSlider(doc as unknown as Document, { min: 6, max: 110, step: 1, value }, onChange)
  const root = slider.element as unknown as FakeElement
  const input = root.children[0]!
  return { slider, root, input, onChange }
}

describe('nudgeValue', () => {
  it('moves one step and clamps to the range', () => {
    expect(nudgeValue(50, 1, 1, 6, 110)).toBe(51)
    expect(nudgeValue(50, -1, 1, 6, 110)).toBe(49)
    expect(nudgeValue(110, 1, 1, 6, 110)).toBe(110)
    expect(nudgeValue(6, -1, 1, 6, 110)).toBe(6)
    expect(nudgeValue(109.5, 1, 1, 6, 110)).toBe(110)
  })
})

describe('createSetpointSlider', () => {
  it('builds a labeled range input inside a .setpoint wrapper', () => {
    const { slider, root, input } = setup()
    expect(root.className).toBe('setpoint')
    expect(input.type).toBe('range')
    expect(input.className).toBe('setpoint-input')
    expect([input.min, input.max, input.step, input.value]).toEqual(['6', '110', '1', '50'])
    expect(input.getAttribute('aria-label')).toBe('Target altitude')
    expect(input.getAttribute('aria-valuetext')).toBe('50 m')
    expect(slider.value).toBe(50)
  })

  it('reports drags through input events', () => {
    const { slider, input, onChange } = setup()
    input.value = '80'
    input.fire('input')
    expect(onChange).toHaveBeenCalledWith(80)
    expect(slider.value).toBe(80)
    expect(input.getAttribute('aria-valuetext')).toBe('80 m')
    input.fire('input')
    expect(onChange).toHaveBeenCalledTimes(1)
  })

  it('nudges one step, clamped, and reports only a change', () => {
    const { slider, input, onChange } = setup(109)
    slider.nudge(1)
    expect(slider.value).toBe(110)
    expect(input.value).toBe('110')
    expect(input.getAttribute('aria-valuetext')).toBe('110 m')
    expect(onChange).toHaveBeenLastCalledWith(110)
    slider.nudge(1)
    expect(onChange).toHaveBeenCalledTimes(1)
    slider.nudge(-1)
    slider.nudge(-1)
    expect(slider.value).toBe(108)
    expect(onChange).toHaveBeenCalledTimes(3)
  })

  it('shows and hides', () => {
    const { slider, root } = setup()
    slider.setVisible(false)
    expect(root.hidden).toBe(true)
    slider.setVisible(true)
    expect(root.hidden).toBe(false)
  })
})
