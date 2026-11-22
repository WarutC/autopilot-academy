import { describe, expect, it, vi } from 'vitest'
import { createStick, gameKey, typingTarget } from './input.ts'

const key = (k: string, mods: Partial<{ ctrlKey: boolean; metaKey: boolean; altKey: boolean }> = {}) => ({
  key: k,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  ...mods,
})

describe('createStick', () => {
  it('starts neutral and follows one held source', () => {
    const onChange = vi.fn()
    const stick = createStick(onChange)
    expect(stick.value).toBe(0)
    stick.press('climb', 'key:ArrowUp')
    expect(stick.value).toBe(1)
    stick.release('key:ArrowUp')
    expect(stick.value).toBe(0)
    stick.press('dive', 'pointer:dive')
    expect(stick.value).toBe(-1)
    expect(onChange.mock.calls).toEqual([[1], [0], [-1]])
  })

  it('is 0 with both directions held, and releasing one leaves the other', () => {
    const stick = createStick(() => {})
    stick.press('climb', 'pointer:climb')
    stick.press('dive', 'key:s')
    expect(stick.value).toBe(0)
    stick.release('key:s')
    expect(stick.value).toBe(1)
    stick.press('dive', 'key:s')
    stick.release('pointer:climb')
    expect(stick.value).toBe(-1)
  })

  it('stays pressed while another source of the same direction is held', () => {
    const onChange = vi.fn()
    const stick = createStick(onChange)
    stick.press('climb', 'key:ArrowUp')
    stick.press('climb', 'key:w')
    stick.release('key:ArrowUp')
    expect(stick.value).toBe(1)
    expect(onChange).toHaveBeenCalledTimes(1)
  })

  it('calls onChange only on a change, and ignores unknown releases', () => {
    const onChange = vi.fn()
    const stick = createStick(onChange)
    stick.release('key:ArrowUp')
    stick.press('climb', 'key:ArrowUp')
    stick.press('climb', 'key:ArrowUp')
    expect(onChange).toHaveBeenCalledTimes(1)
  })

  it('releases every source on releaseAll (focus lost)', () => {
    const onChange = vi.fn()
    const stick = createStick(onChange)
    stick.press('climb', 'key:ArrowUp')
    stick.press('climb', 'pointer:climb')
    stick.releaseAll()
    expect(stick.value).toBe(0)
    expect(onChange.mock.calls).toEqual([[1], [0]])
    stick.releaseAll()
    expect(onChange).toHaveBeenCalledTimes(2)
  })
})

describe('gameKey', () => {
  it('maps arrows and W/S in either case', () => {
    for (const k of ['ArrowUp', 'w', 'W']) expect(gameKey(key(k))).toBe('climb')
    for (const k of ['ArrowDown', 's', 'S']) expect(gameKey(key(k))).toBe('dive')
    for (const k of ['a', 'ArrowLeft', ' ', 'Enter']) expect(gameKey(key(k))).toBeUndefined()
  })

  it('ignores keys with Ctrl, Meta or Alt held', () => {
    expect(gameKey(key('s', { ctrlKey: true }))).toBeUndefined()
    expect(gameKey(key('s', { metaKey: true }))).toBeUndefined()
    expect(gameKey(key('ArrowUp', { altKey: true }))).toBeUndefined()
  })
})

describe('typingTarget', () => {
  it('is true for text and number fields, range sliders, selects, textareas and contenteditable', () => {
    expect(typingTarget({ tagName: 'INPUT', type: 'text' })).toBe(true)
    expect(typingTarget({ tagName: 'INPUT', type: 'number' })).toBe(true)
    expect(typingTarget({ tagName: 'INPUT', type: 'range' })).toBe(true)
    expect(typingTarget({ tagName: 'input' })).toBe(true)
    expect(typingTarget({ tagName: 'TEXTAREA' })).toBe(true)
    expect(typingTarget({ tagName: 'SELECT' })).toBe(true)
    expect(typingTarget({ tagName: 'DIV', isContentEditable: true })).toBe(true)
  })

  it('is false for checkboxes, radios, buttons, other elements and no element', () => {
    for (const type of ['checkbox', 'radio', 'button', 'submit']) {
      expect(typingTarget({ tagName: 'INPUT', type })).toBe(false)
    }
    expect(typingTarget({ tagName: 'BUTTON' })).toBe(false)
    expect(typingTarget({ tagName: 'BODY', isContentEditable: false })).toBe(false)
    expect(typingTarget(null)).toBe(false)
  })
})
