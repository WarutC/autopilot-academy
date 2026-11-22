import { describe, expect, it } from 'vitest'
import { READING_ALPHA } from '../render/recorder.ts'
import layoutCss from './layout.css?raw'
import tokensCss from './tokens.css?raw'

type Tokens = Record<string, string>

/** The custom properties declared in `block`, by name without the leading dashes. */
function declarations(block: string): Tokens {
  const out: Tokens = {}
  for (const match of block.matchAll(/--([\w-]+):\s*([^;]+);/g)) out[match[1]] = match[2].trim()
  return out
}

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

/** The share of Ghost in the wingman logbook tag's text color, mixed with Ink in layout.css. */
const wingmanTagGhost = (() => {
  const m = /\.logbook-tag-wingman\s*\{[^}]*color:\s*color-mix\(in srgb, var\(--ghost\) (\d+)%, var\(--ink\)\)/.exec(layoutCss)
  if (!m) throw new Error('no wingman tag color in layout.css')
  return Number(m[1]) / 100
})()

const light = declarations(blockAfter(tokensCss, tokensCss.indexOf(':root')))
// Dark redefines some tokens and inherits the rest from the light block.
const dark = { ...light, ...declarations(blockAfter(tokensCss, tokensCss.indexOf('prefers-color-scheme: dark'))) }

function channel(c: number): number {
  const s = c / 255
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
}

/** WCAG relative luminance of a `#RRGGBB` color. */
function luminance(hex: string): number {
  const m = /^#([0-9a-f]{6})$/i.exec(hex)
  if (!m) throw new Error(`not a #RRGGBB color: ${hex}`)
  const n = parseInt(m[1], 16)
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255)
}

/** `fg` at opacity `alpha` painted over `bg`, as `#RRGGBB`. */
function over(fg: string, bg: string, alpha: number): string {
  const rgb = (hex: string) => [0, 2, 4].map((i) => parseInt(hex.slice(1 + i, 3 + i), 16))
  const [f, b] = [rgb(fg), rgb(bg)]
  return `#${f.map((c, i) => Math.round(c * alpha + b[i] * (1 - alpha)).toString(16).padStart(2, '0')).join('')}`
}

/** WCAG contrast ratio between two `#RRGGBB` colors. */
function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

describe('contrast helper', () => {
  it('gives the WCAG extremes', () => {
    expect(contrast('#000000', '#FFFFFF')).toBeCloseTo(21, 5)
    expect(contrast('#777777', '#777777')).toBe(1)
  })
})

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
