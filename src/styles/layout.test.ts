import { describe, expect, it } from 'vitest'
import { PHONE_LANDSCAPE } from '../ui/drawer.ts'
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

describe('layout.css phone layouts', () => {
  it('has a phone landscape block on the same query the drawer uses', () => {
    const at = layoutCss.indexOf(`@media ${PHONE_LANDSCAPE}`)
    expect(at).toBeGreaterThanOrEqual(0)
    const block = blockAfter(layoutCss, at)
    expect(block).toContain('.layout-side')
    expect(block).toContain('.drawer-scrim')
  })

  it('draws a 4:3 scene below 600 px', () => {
    const at = layoutCss.indexOf('@media (max-width: 599px)')
    expect(at).toBeGreaterThanOrEqual(0)
    expect(blockAfter(layoutCss, at)).toMatch(/\.scene\s*\{[^}]*aspect-ratio: 4 \/ 3;/)
  })
})
