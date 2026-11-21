// UI colors and fonts read from the CSS custom properties in tokens.css, so the
// canvas follows the same light and dark themes as the page.

export interface Theme {
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

/** The light theme, used for any token the page does not define. */
export const LIGHT: Theme = {
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

/** `fooBar` → `--foo-bar`. */
export function cssVarName(key: keyof Theme): string {
  return `--${key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`
}

/** Builds a theme from `getVar('--name')`; an empty, missing or failing value falls back to `LIGHT`. */
export function readTheme(getVar: (name: string) => string | null | undefined): Theme {
  const theme: Record<string, string> = {}
  for (const key of Object.keys(LIGHT) as (keyof Theme)[]) {
    let value: string | null | undefined
    try {
      value = getVar(cssVarName(key))
    } catch {
      value = undefined
    }
    const trimmed = typeof value === 'string' ? value.trim() : ''
    theme[key] = trimmed === '' ? LIGHT[key] : trimmed
  }
  return theme as unknown as Theme
}

/** The theme currently applied to the document root. */
export function loadTheme(root: Element = document.documentElement): Theme {
  const style = getComputedStyle(root)
  return readTheme((name) => style.getPropertyValue(name))
}

/** Calls `onChange` when the system switches between light and dark; returns an unsubscribe. */
export function watchTheme(onChange: () => void): () => void {
  const query = matchMedia('(prefers-color-scheme: dark)')
  const listener = (): void => onChange()
  query.addEventListener('change', listener)
  return () => query.removeEventListener('change', listener)
}
