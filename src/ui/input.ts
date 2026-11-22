// The player's stick: one value fed by any number of held sources (stick
// buttons, keys). Pure logic with no globals, so the page wires the events.

import type { StickInput } from '../sim/types.ts'

export type StickDirection = 'climb' | 'dive'

export interface Stick {
  /** -1 (dive), 0 (neutral) or 1 (climb); both directions held is 0. */
  readonly value: StickInput
  /** Holds `direction` from `source`, such as `'key:ArrowUp'` or `'pointer:climb'`. */
  press(direction: StickDirection, source: string): void
  /** Lets go of `source`; unknown sources are ignored. */
  release(source: string): void
  /** Lets go of every source. */
  releaseAll(): void
}

/** Creates a stick that calls `onChange` with the new value only when it changes. */
export function createStick(onChange: (value: StickInput) => void): Stick {
  const held = new Map<string, StickDirection>()
  let value: StickInput = 0

  function sync(): void {
    let climb = false
    let dive = false
    for (const d of held.values()) {
      if (d === 'climb') climb = true
      else dive = true
    }
    const next: StickInput = climb === dive ? 0 : climb ? 1 : -1
    if (next === value) return
    value = next
    onChange(value)
  }

  return {
    get value() {
      return value
    },
    press(direction, source) {
      held.set(source, direction)
      sync()
    },
    release(source) {
      if (held.delete(source)) sync()
    },
    releaseAll() {
      held.clear()
      sync()
    },
  }
}

/** The key fields `gameKey` reads. */
export interface GameKeyEvent {
  readonly key: string
  readonly ctrlKey: boolean
  readonly metaKey: boolean
  readonly altKey: boolean
}

/** The stick direction for ArrowUp/W and ArrowDown/S; undefined for other keys or with Ctrl, Meta or Alt held. */
export function gameKey(event: GameKeyEvent): StickDirection | undefined {
  if (event.ctrlKey || event.metaKey || event.altKey) return undefined
  switch (event.key) {
    case 'ArrowUp':
    case 'w':
    case 'W':
      return 'climb'
    case 'ArrowDown':
    case 's':
    case 'S':
      return 'dive'
    default:
      return undefined
  }
}

/** The element fields `typingTarget` reads. */
export interface TypingTargetElement {
  readonly tagName: string
  readonly type?: string
  readonly isContentEditable?: boolean
}

const NOT_TYPING_INPUTS = new Set(['checkbox', 'radio', 'button', 'submit', 'reset', 'image'])

/**
 * True when keys typed at `el` belong to it: a text or number field, a range
 * slider, a select, a textarea or contenteditable. Checkboxes, radios and
 * buttons do not count.
 */
export function typingTarget(el: TypingTargetElement | null | undefined): boolean {
  if (!el) return false
  if (el.isContentEditable) return true
  const tag = el.tagName.toUpperCase()
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true
  if (tag === 'INPUT') return !NOT_TYPING_INPUTS.has((el.type ?? 'text').toLowerCase())
  return false
}
