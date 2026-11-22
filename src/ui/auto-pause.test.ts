import { describe, expect, it, vi } from 'vitest'
import { watchAutoPause, type AutoPauseWindow } from './auto-pause.ts'

/** An event target stand-in that records its listeners by type. */
class FakeTarget {
  matches = false
  readonly listeners = new Map<string, Set<() => void>>()
  addEventListener(type: string, listener: () => void): void {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set())
    this.listeners.get(type)!.add(listener)
  }
  removeEventListener(type: string, listener: () => void): void {
    this.listeners.get(type)?.delete(listener)
  }
  fire(type: string): void {
    for (const l of this.listeners.get(type) ?? []) l()
  }
  count(type: string): number {
    return this.listeners.get(type)?.size ?? 0
  }
}

class FakeDocument extends FakeTarget {
  hidden = false
}

function setup(coarse = true) {
  const document = new FakeDocument()
  const queries = new Map<string, FakeTarget>()
  const pointer = new FakeTarget()
  pointer.matches = coarse
  queries.set('(pointer: coarse)', pointer)
  const win = {
    document,
    matchMedia(query: string) {
      if (!queries.has(query)) queries.set(query, new FakeTarget())
      return queries.get(query)!
    },
  }
  const pause = vi.fn()
  const stop = watchAutoPause(win as unknown as AutoPauseWindow, pause)
  const portrait = queries.get('(orientation: portrait)')!
  return { document, portrait, pointer, pause, stop }
}

describe('watchAutoPause', () => {
  it('pauses when the tab turns hidden', () => {
    const { document, pause } = setup()
    document.hidden = true
    document.fire('visibilitychange')
    expect(pause).toHaveBeenCalledTimes(1)
  })

  it('does nothing when the tab turns visible', () => {
    const { document, pause } = setup()
    document.hidden = false
    document.fire('visibilitychange')
    expect(pause).not.toHaveBeenCalled()
  })

  it('ignores an orientation flip with a fine pointer, such as a desktop window resize', () => {
    const { portrait, pause } = setup(false)
    portrait.fire('change')
    expect(pause).not.toHaveBeenCalled()
  })

  it('reads the pointer at the flip, not at setup', () => {
    const { portrait, pointer, pause } = setup(false)
    pointer.matches = true
    portrait.fire('change')
    expect(pause).toHaveBeenCalledTimes(1)
  })

  it('pauses on each orientation flip with a coarse pointer', () => {
    const { portrait, pause } = setup()
    portrait.fire('change')
    expect(pause).toHaveBeenCalledTimes(1)
    portrait.fire('change')
    expect(pause).toHaveBeenCalledTimes(2)
  })

  it('stops listening after unsubscribe', () => {
    const { document, portrait, pause, stop } = setup()
    stop()
    expect(document.count('visibilitychange')).toBe(0)
    expect(portrait.count('change')).toBe(0)
    document.hidden = true
    document.fire('visibilitychange')
    portrait.fire('change')
    expect(pause).not.toHaveBeenCalled()
  })
})
