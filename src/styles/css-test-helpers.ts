// Helpers for the CSS and contrast tests: reading blocks, rules and tokens out
// of stylesheet text, and WCAG contrast arithmetic on `#RRGGBB` colors.
// This module imports no CSS; the CSS readers take stylesheet text as an argument.

export type Tokens = Record<string, string>

const COMMENT = /\/\*[\s\S]*?\*\//g

/** The text between the brace that opens after `from` and its matching close. */
export function blockAfter(css: string, from: number): string {
  if (from < 0) throw new Error('no start position: the search for it missed')
  const open = css.indexOf('{', from)
  if (open < 0) throw new Error('no block after the given position')
  let depth = 0
  for (let i = open; i < css.length; i++) {
    if (css[i] === '{') depth++
    else if (css[i] === '}' && --depth === 0) return css.slice(open + 1, i)
  }
  throw new Error('unbalanced braces')
}

/** The custom properties declared in `block`, by name without the leading dashes. */
export function declarations(block: string): Tokens {
  const out: Tokens = {}
  for (const match of block.matchAll(/--([\w-]+):\s*([^;]+);/g)) out[match[1]!] = match[2]!.trim()
  return out
}

/** The light and dark theme tokens in `tokensCss`; dark redefines some tokens and inherits the rest. */
export function themeTokens(tokensCss: string): { light: Tokens; dark: Tokens } {
  const light = declarations(blockAfter(tokensCss, tokensCss.indexOf(':root')))
  const dark = { ...light, ...declarations(blockAfter(tokensCss, tokensCss.indexOf('prefers-color-scheme: dark'))) }
  return { light, dark }
}

/** The body of the first rule in `css` whose selector list includes exactly `selector`, comments removed. */
export function ruleBody(css: string, selector: string): string {
  const flat = css.replace(COMMENT, '')
  for (const m of flat.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (m[1]!.split(',').some((s) => s.trim() === selector)) return m[2]!
  }
  throw new Error(`no ${selector} rule`)
}

/** The trimmed text between each `@media` and its `{`, comments removed. */
export function mediaPreludes(css: string): string[] {
  const flat = css.replace(COMMENT, '')
  return [...flat.matchAll(/@media([^{]*)\{/g)].map((m) => m[1]!.trim())
}

/** The red, green and blue channels of a `#RRGGBB` color. */
function rgb(hex: string): [number, number, number] {
  const m = /^#([0-9a-f]{6})$/i.exec(hex)
  if (!m) throw new Error(`not a #RRGGBB color: ${hex}`)
  const n = parseInt(m[1]!, 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

function toHex(channels: readonly number[]): string {
  return `#${channels.map((c) => c.toString(16).padStart(2, '0')).join('')}`
}

function channel(c: number): number {
  const s = c / 255
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
}

/** WCAG relative luminance of a `#RRGGBB` color. */
export function luminance(hex: string): number {
  const [r, g, b] = rgb(hex)
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}

/** WCAG contrast ratio between two `#RRGGBB` colors. */
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi! + 0.05) / (lo! + 0.05)
}

/** `fg` at opacity `alpha` painted over `bg`, as `#RRGGBB`. */
export function over(fg: string, bg: string, alpha: number): string {
  const [f, b] = [rgb(fg), rgb(bg)]
  return toHex(f.map((c, i) => Math.round(c * alpha + b[i]! * (1 - alpha))))
}

/** `rgba(r, g, b, a)` painted over the `#RRGGBB` color `under`, as `#RRGGBB`. */
export function rgbaOver(r: number, g: number, b: number, a: number, under: string): string {
  return over(toHex([r, g, b]), under, a)
}
