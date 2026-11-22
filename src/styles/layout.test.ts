import { describe, expect, it } from 'vitest'
import { COMPACT, MEDIA_QUERIES, PHONE, PHONE_LANDSCAPE, PHONE_PORTRAIT } from '../ui/media.ts'
import { blockAfter, mediaPreludes } from './css-test-helpers.ts'
import layoutCss from './layout.css?raw'

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

  it('stacks the About credits in one column below 600 px', () => {
    const at = layoutCss.indexOf(`@media ${PHONE_PORTRAIT} {`)
    expect(blockAfter(layoutCss, at)).toMatch(/\.about-credits\s*\{[^}]*grid-template-columns: minmax\(0, 1fr\);/)
  })
})

describe('layout.css media queries', () => {
  const preludes = mediaPreludes(layoutCss)

  it('uses only the queries the scripts share', () => {
    expect(preludes.length).toBeGreaterThan(0)
    for (const prelude of preludes) expect(MEDIA_QUERIES, prelude).toContain(prelude)
  })

  it('has one block per query', () => {
    const seen = new Set<string>()
    for (const prelude of preludes) {
      expect(seen.has(prelude), `repeated @media ${prelude}`).toBe(false)
      seen.add(prelude)
    }
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
