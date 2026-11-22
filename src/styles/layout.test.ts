import { describe, expect, it } from 'vitest'
import { COMPACT, MEDIA_QUERIES, PHONE, PHONE_LANDSCAPE, PHONE_PORTRAIT } from '../ui/media.ts'
import layoutCss from './layout.css?raw'

/** The text between the brace that opens after `from` and its matching close. */
function blockAfter(css: string, from: number): string {
  const open = css.indexOf('{', from)
  let depth = 0
  for (let i = open; i < css.length; i++) {
    if (css[i] === '{') depth++
    else if (css[i] === '}' && --depth === 0) return css.slice(open + 1, i)
  }
  throw new Error('unbalanced braces')
}

/** The trimmed text between each `@media` and its `{`, comments removed. */
function mediaPreludes(css: string): string[] {
  const flat = css.replace(/\/\*[\s\S]*?\*\//g, '')
  return [...flat.matchAll(/@media([^{]*)\{/g)].map((m) => m[1].trim())
}

describe('layout.css phone layouts', () => {
  it('has a phone landscape block on the same query the drawer uses', () => {
    const at = layoutCss.indexOf(`@media ${PHONE_LANDSCAPE} {`)
    expect(at).toBeGreaterThanOrEqual(0)
    const block = blockAfter(layoutCss, at)
    expect(block).toContain('.layout-side')
    expect(block).toContain('.drawer-scrim')
  })

  it('draws a 4:3 scene below 600 px', () => {
    const at = layoutCss.indexOf(`@media ${PHONE_PORTRAIT} {`)
    expect(at).toBeGreaterThanOrEqual(0)
    expect(blockAfter(layoutCss, at)).toMatch(/\.scene\s*\{[^}]*aspect-ratio: 4 \/ 3;/)
  })
})

describe('layout.css media queries', () => {
  const preludes = mediaPreludes(layoutCss)

  it('uses only the queries the scripts share', () => {
    expect(preludes.length).toBeGreaterThan(0)
    for (const prelude of preludes) expect(MEDIA_QUERIES, prelude).toContain(prelude)
  })

  it.each([
    ['PHONE_LANDSCAPE', PHONE_LANDSCAPE],
    ['PHONE_PORTRAIT', PHONE_PORTRAIT],
    ['PHONE', PHONE],
    ['COMPACT', COMPACT],
  ])('has a block on %s', (_name, query) => {
    expect(preludes).toContain(query)
  })
})
