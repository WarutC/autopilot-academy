import { describe, expect, it } from 'vitest'
import { READING_ALPHA, RING_BAR_OUTLINE_TOKEN } from '../render/recorder.ts'
import { cssVarName } from '../ui/theme.ts'
import { contrast, over, themeTokens } from './css-test-helpers.ts'
import layoutCss from './layout.css?raw'
import tokensCss from './tokens.css?raw'

/** The share of Ghost in the wingman logbook tag's text color, mixed with Ink in layout.css. */
const wingmanTagGhost = (() => {
  const m = /\.logbook-tag-wingman\s*\{[^}]*color:\s*color-mix\(in srgb, var\(--ghost\) (\d+)%, var\(--ink\)\)/.exec(layoutCss)
  if (!m) throw new Error('no wingman tag color in layout.css')
  return Number(m[1]) / 100
})()

const { light, dark } = themeTokens(tokensCss)

describe.each([
  ['light', light],
  ['dark', dark],
] as const)('%s theme contrast', (_name, t) => {
  const surfaces = ['bg', 'panel', 'field']

  it.each([
    ['ink', 'bg'], ['ink', 'panel'], ['ink', 'field'],
    ['muted', 'bg'], ['muted', 'panel'], ['muted', 'field'],
    ['tab-ink', 'tab'],
    ['chip-on-ink', 'chip-on'],
  ])('text %s on %s is at least 4.5:1', (fg, bg) => {
    expect(contrast(t[fg], t[bg])).toBeGreaterThanOrEqual(4.5)
  })

  it.each(surfaces)('strong on %s is at least 3:1', (bg) => {
    expect(contrast(t.strong, t[bg])).toBeGreaterThanOrEqual(3)
  })

  it.each(['accent', 'refline'])('%s on panel is at least 3:1', (fg) => {
    expect(contrast(t[fg], t.panel)).toBeGreaterThanOrEqual(3)
  })

  it.each(['bg', 'panel'])('focus is visible on %s', (bg) => {
    const best = Math.max(contrast(t.focus, t[bg]), contrast(t['focus-halo'], t[bg]))
    expect(best).toBeGreaterThanOrEqual(3)
  })

  it('the recorder altimeter dots, Muted at their opacity, are at least 3:1 on panel', () => {
    expect(contrast(over(t.muted, t.panel, READING_ALPHA), t.panel)).toBeGreaterThanOrEqual(3)
  })

  it('the wingman logbook tag text, Ghost mixed toward Ink, is at least 4.5:1 on panel', () => {
    expect(contrast(over(t.ghost, t.ink, wingmanTagGhost), t.panel)).toBeGreaterThanOrEqual(4.5)
  })

  it('the ring bar outline is at least 3:1 on panel', () => {
    const token = cssVarName(RING_BAR_OUTLINE_TOKEN).slice(2)
    expect(t[token]).toBeDefined()
    expect(contrast(t[token], t.panel)).toBeGreaterThanOrEqual(3)
  })

  it('the wingman logbook tag border, Ghost, is at least 3:1 on panel', () => {
    expect(contrast(t.ghost, t.panel)).toBeGreaterThanOrEqual(3)
  })

  it('focus on its halo is at least 3:1', () => {
    expect(contrast(t.focus, t['focus-halo'])).toBeGreaterThanOrEqual(3)
  })
})

/** Every rule in `css` as its selector and body, ignoring at-rule wrappers. */
function rules(css: string): { selector: string; body: string }[] {
  const out: { selector: string; body: string }[] = []
  const flat = css.replace(/\/\*[\s\S]*?\*\//g, '')
  for (const match of flat.matchAll(/([^{}]+)\{([^{}]*)\}/g)) out.push({ selector: match[1].trim(), body: match[2] })
  return out
}

describe('layout.css control borders and focus', () => {
  const all = rules(layoutCss)

  it.each(['.param-number', '.course-field', '.lesson-chip'])('%s has no Line border', (cls) => {
    const own = all.filter((r) => r.selector.split(',').some((s) => s.trim() === cls))
    expect(own.length).toBeGreaterThan(0)
    for (const r of own) expect(r.body).not.toMatch(/border[\w-]*:[^;]*var\(--line\)/)
  })

  it.each([
    '.btn',
    '.seg-btn',
    '.course-field',
    '.param-number',
    '.param-slider',
    '.param-check',
    '.lesson-chip',
    '.stick-btn',
    '.scene',
    '.setpoint-input',
  ])('draws a halo around a focused %s', (cls) => {
    const ringed = all.filter(
      (r) => r.selector.split(',').some((s) => s.trim() === `${cls}:focus-visible`) && r.body.includes('--focus-halo'),
    )
    expect(ringed.length).toBeGreaterThan(0)
  })

  it('draws a halo for every focus selector in the file', () => {
    const selectorsOf = (r: { selector: string }) => r.selector.split(',').map((s) => s.trim())
    const focusSelectors = new Set(all.flatMap(selectorsOf).filter((s) => s.includes(':focus-visible')))
    expect(focusSelectors.size).toBeGreaterThan(0)
    for (const sel of focusSelectors) {
      const ringed = all.some((r) => selectorsOf(r).includes(sel) && r.body.includes('--focus-halo'))
      expect(ringed, sel).toBe(true)
    }
  })
})
