import { describe, expect, it } from 'vitest'
import {
  blockAfter,
  contrast,
  declarations,
  luminance,
  mediaPreludes,
  over,
  rgbaOver,
  ruleBody,
  themeTokens,
} from './css-test-helpers.ts'

describe('contrast helper', () => {
  it('gives the WCAG extremes', () => {
    expect(contrast('#000000', '#FFFFFF')).toBeCloseTo(21, 5)
    expect(contrast('#777777', '#777777')).toBe(1)
  })

  it.each(['#FFF', '000000', '#GGGGGG', 'rgb(0, 0, 0)'])('rejects the malformed color %s', (hex) => {
    expect(() => luminance(hex)).toThrow(/not a #RRGGBB color/)
  })

  it('composites a color over another', () => {
    expect(over('#FFFFFF', '#000000', 0.5)).toBe('#808080')
    expect(over('#123456', '#FFFFFF', 1)).toBe('#123456')
    expect(rgbaOver(255, 0, 0, 0.5, '#FFFFFF')).toBe('#ff8080')
  })
})

describe('css text helpers', () => {
  it('reads a block with nested braces to its matching close', () => {
    const css = 'a { b } @media x { .p { q: 1; } .r { s: 2; } } .t { u }'
    expect(blockAfter(css, css.indexOf('@media'))).toBe(' .p { q: 1; } .r { s: 2; } ')
  })

  it('throws on a missed start position instead of reading the first block', () => {
    expect(() => blockAfter('a { b }', 'a { b }'.indexOf('@media'))).toThrow(/no start position/)
  })

  it('finds a rule by one selector in a selector list', () => {
    const css = '/* .b { color: red; } */ .a, .b ,.c { color: blue; } .b { color: green; }'
    expect(ruleBody(css, '.b')).toBe(' color: blue; ')
    expect(() => ruleBody(css, '.d')).toThrow(/no \.d rule/)
  })

  it('lists media preludes without commented-out ones', () => {
    const css = '/* @media (old) { } */ @media (width > 960px) { } /* note */ @media (a), (b) {}'
    expect(mediaPreludes(css)).toEqual(['(width > 960px)', '(a), (b)'])
  })

  it('reads the dark tokens over the light ones', () => {
    const css = ':root { --a: #111111; --b: #222222; } @media (prefers-color-scheme: dark) { :root { --a: #EEEEEE; } }'
    expect(declarations(':root { --x-y: 1px ; }')).toEqual({ 'x-y': '1px' })
    expect(themeTokens(css)).toEqual({
      light: { a: '#111111', b: '#222222' },
      dark: { a: '#EEEEEE', b: '#222222' },
    })
  })
})
