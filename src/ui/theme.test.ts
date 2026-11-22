import { afterEach, describe, expect, it, vi } from 'vitest'
import { LIGHT, TOKEN_KEYS, cssVarName, loadTheme, readTheme, watchTheme } from './theme.ts'

describe('readTheme', () => {
  it('reads every token from its CSS custom property', () => {
    const asked: string[] = []
    const theme = readTheme((name) => {
      asked.push(name)
      return ` value-of${name} `
    })
    for (const key of TOKEN_KEYS) {
      expect(theme[key]).toBe(`value-of${cssVarName(key)}`)
    }
    expect(asked).toContain('--tab-ink')
    expect(asked).toContain('--chip-on-ink')
    expect(asked).toContain('--font-condensed')
    expect(asked).toContain('--font-body')
    expect(asked).toHaveLength(TOKEN_KEYS.length)
  })

  it('covers the 17 color tokens and two fonts', () => {
    expect(TOKEN_KEYS).toHaveLength(19)
    expect(TOKEN_KEYS).not.toContain('reducedMotion')
  })

  it('carries the reduced-motion setting, off by default', () => {
    expect(readTheme(() => '').reducedMotion).toBe(false)
    expect(readTheme(() => '', true).reducedMotion).toBe(true)
    expect(LIGHT.reducedMotion).toBe(false)
  })

  it('falls back to the light value for an empty, missing or failing token', () => {
    expect(readTheme(() => '')).toEqual(LIGHT)
    expect(readTheme(() => '   ')).toEqual(LIGHT)
    expect(readTheme(() => null)).toEqual(LIGHT)
    expect(readTheme(() => undefined)).toEqual(LIGHT)
    expect(
      readTheme(() => {
        throw new Error('no style')
      }),
    ).toEqual(LIGHT)
  })

  it('mixes defined and missing tokens', () => {
    const theme = readTheme((name) => (name === '--accent' ? '#FF5960' : ''))
    expect(theme.accent).toBe('#FF5960')
    expect(theme.ink).toBe(LIGHT.ink)
  })
})

describe('LIGHT', () => {
  it('matches the light token values', () => {
    expect(LIGHT.accent).toBe('#D7262E')
    expect(LIGHT.ink).toBe('#13294B')
    expect(LIGHT.tabInk).toBe('#13294B')
    expect(LIGHT.chipOnInk).toBe('#FFFFFF')
  })
})

describe('LIGHT against tokens.css', () => {
  it('equals the light :root values', async () => {
    const css: string = (await import('../styles/tokens.css?raw')).default
    // The first :root block, up to its closing brace, holds the light tokens.
    const start = css.indexOf(':root')
    expect(start).toBeGreaterThanOrEqual(0)
    const root = css.slice(start, css.indexOf('}', start))
    const missing: string[] = []
    const fromCss = readTheme((name) => {
      const match = new RegExp(`${name}:\\s*([^;]+);`).exec(root)
      if (!match) missing.push(name)
      return match ? match[1] : ''
    })
    expect(missing).toEqual([])
    expect(fromCss).toEqual(LIGHT)
  })
})

/** A `matchMedia` stand-in: `matches` per query, and the listeners added and removed per query. */
function stubMatchMedia(matches: Record<string, boolean>) {
  const added: Record<string, (() => void)[]> = {}
  const removed: Record<string, (() => void)[]> = {}
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: matches[query] ?? false,
    addEventListener: (_type: string, fn: () => void) => (added[query] ??= []).push(fn),
    removeEventListener: (_type: string, fn: () => void) => (removed[query] ??= []).push(fn),
  }))
  return { added, removed }
}

const REDUCE = '(prefers-reduced-motion: reduce)'
const DARK = '(prefers-color-scheme: dark)'

describe('loadTheme', () => {
  afterEach(() => vi.unstubAllGlobals())

  const root = { style: {} } as unknown as Element
  const stubStyle = () => vi.stubGlobal('getComputedStyle', () => ({ getPropertyValue: () => '' }))

  it.each([true, false])('reads reduced motion %s from the system', (reduce) => {
    stubStyle()
    stubMatchMedia({ [REDUCE]: reduce })
    const theme = loadTheme(root)
    expect(theme.reducedMotion).toBe(reduce)
    expect(theme.ink).toBe(LIGHT.ink)
  })

  it('reads no reduced motion where matchMedia is missing', () => {
    stubStyle()
    vi.stubGlobal('matchMedia', undefined)
    expect(loadTheme(root).reducedMotion).toBe(false)
  })
})

describe('watchTheme', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('fires on either query and unsubscribes both', () => {
    const { added, removed } = stubMatchMedia({})
    const onChange = vi.fn()
    const stop = watchTheme(onChange)
    expect(added[DARK]).toHaveLength(1)
    expect(added[REDUCE]).toHaveLength(1)
    added[DARK]![0]!()
    added[REDUCE]![0]!()
    expect(onChange).toHaveBeenCalledTimes(2)
    stop()
    expect(removed[DARK]).toEqual(added[DARK])
    expect(removed[REDUCE]).toEqual(added[REDUCE])
  })
})
