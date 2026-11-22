import { describe, expect, it } from 'vitest'
import { LIGHT, cssVarName, readTheme, type Theme } from './theme.ts'

describe('readTheme', () => {
  it('reads every token from its CSS custom property', () => {
    const asked: string[] = []
    const theme = readTheme((name) => {
      asked.push(name)
      return ` value-of${name} `
    })
    for (const key of Object.keys(LIGHT) as (keyof Theme)[]) {
      expect(theme[key]).toBe(`value-of${cssVarName(key)}`)
    }
    expect(asked).toContain('--tab-ink')
    expect(asked).toContain('--chip-on-ink')
    expect(asked).toContain('--font-condensed')
    expect(asked).toContain('--font-body')
  })

  it('covers the 17 color tokens and two fonts', () => {
    expect(Object.keys(LIGHT)).toHaveLength(19)
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
