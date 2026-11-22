// UI colors and fonts read from the CSS custom properties in tokens.css, so the
// canvas follows the same light and dark themes as the page, plus the system's
// reduced-motion setting.

/** The string tokens, one per CSS custom property. */
export interface ThemeTokens {
  readonly bg: string
  readonly ink: string
  readonly muted: string
  readonly panel: string
  readonly line: string
  readonly strong: string
  readonly tab: string
  readonly tabInk: string
  readonly field: string
  readonly accent: string
  readonly ghost: string
  readonly ok: string
  readonly amber: string
  readonly refline: string
  readonly chipOn: string
  readonly chipOnInk: string
  readonly focus: string
  readonly fontCondensed: string
  readonly fontBody: string
}

export interface Theme extends ThemeTokens {
  /** The system asks for reduced motion: the scene backdrop holds still. */
  readonly reducedMotion: boolean
}

/** The light theme's string tokens, used for any token the page does not define. */
const LIGHT_TOKENS: ThemeTokens = {
  bg: '#E7EEF5',
  ink: '#13294B',
  muted: '#4C617D',
  panel: '#FFFFFF',
  line: '#C5D3E1',
  strong: '#13294B',
  tab: '#F5B700',
  tabInk: '#13294B',
  field: '#F1F5F9',
  accent: '#D7262E',
  ghost: '#2F6BFF',
  ok: '#1C8A4A',
  amber: '#D98200',
  refline: '#13294B',
  chipOn: '#13294B',
  chipOnInk: '#FFFFFF',
  focus: '#F5B700',
  fontCondensed: "'Barlow Condensed', 'Arial Narrow', Barlow, sans-serif",
  fontBody: "Barlow, 'Segoe UI', system-ui, sans-serif",
}

/** The light theme, with full motion. */
export const LIGHT: Theme = { ...LIGHT_TOKENS, reducedMotion: false }

/** Every string token, in `LIGHT` order. */
export const TOKEN_KEYS = Object.keys(LIGHT_TOKENS) as readonly (keyof ThemeTokens)[]

const DARK_QUERY = '(prefers-color-scheme: dark)'
const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)'

/** `fooBar` → `--foo-bar`. */
export function cssVarName(key: keyof ThemeTokens): string {
  return `--${key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`
}

/** Builds a theme from `getVar('--name')`; an empty, missing or failing value falls back to `LIGHT`. */
export function readTheme(getVar: (name: string) => string | null | undefined, reducedMotion = false): Theme {
  const theme: Record<string, string | boolean> = {}
  for (const key of TOKEN_KEYS) {
    let value: string | null | undefined
    try {
      value = getVar(cssVarName(key))
    } catch {
      value = undefined
    }
    const trimmed = typeof value === 'string' ? value.trim() : ''
    theme[key] = trimmed === '' ? LIGHT[key] : trimmed
  }
  theme.reducedMotion = reducedMotion
  return theme as unknown as Theme
}

/** Whether the system asks for reduced motion; false where `matchMedia` is missing. */
function prefersReducedMotion(): boolean {
  if (typeof matchMedia !== 'function') return false
  try {
    return matchMedia(REDUCED_MOTION_QUERY).matches === true
  } catch {
    return false
  }
}

/** The theme currently applied to the document root. */
export function loadTheme(root: Element = document.documentElement): Theme {
  const style = getComputedStyle(root)
  return readTheme((name) => style.getPropertyValue(name), prefersReducedMotion())
}

/**
 * Calls `onChange` when the system switches between light and dark or toggles
 * reduced motion; returns an unsubscribe. Watches nothing where `matchMedia`
 * is missing.
 */
export function watchTheme(onChange: () => void): () => void {
  if (typeof matchMedia !== 'function') return () => {}
  const queries = [matchMedia(DARK_QUERY), matchMedia(REDUCED_MOTION_QUERY)]
  const listener = (): void => onChange()
  for (const query of queries) query.addEventListener('change', listener)
  return () => {
    for (const query of queries) query.removeEventListener('change', listener)
  }
}
