// 8-bit mascots for the page: the Whale instructor beside the lesson text and
// the Penguin student beside the end banners. Each is a pixel grid drawn as an
// inline SVG, one run-merged path per color with crisp edges, so it stays
// sharp at any device pixel ratio. Decoration only: hidden from assistive tech.

import { SPRITE_PIXEL } from './scene-geometry.ts'
import type { Palette, SpriteGrid } from './sprites.ts'

export const SVG_NS = 'http://www.w3.org/2000/svg'

/** Transparent pixel. */
const CLEAR = '.'

/** The Whale facing left, tail raised. Keys: K outline and eye, C body, W belly. */
export const WHALE: SpriteGrid = [
  '............KKKKKK',
  '............KCKKCK',
  '....KKKKKKK.KKCCKK',
  '..KKKCCCCCKKKKCKK.',
  '.KKCCCCCCCCCKKCK..',
  'KKCKCCCCCCCCCCCK..',
  'KCCCCCCCCCCCCCKK..',
  'KCWWWWWWCCCCCKK...',
  'KKWWWWWWWWCKKK....',
  '.KKKKKKKKKKK......',
]

export const WHALE_PALETTE: Palette = { K: '#1A2A3A', C: '#8FE3F0', W: '#FFFFFF' }

/** The Penguin cheering, both flippers raised. Keys: O outline, N body, W belly and eyes, Y beak and feet. */
export const PENGUIN_CHEER: SpriteGrid = [
  'OOO..OOOO..OOO',
  'ONOOOONNOOOONO',
  'ONOONNNNNNOONO',
  'ONNONWNNWNONNO',
  'OONONNYYNNONOO',
  '.ONNNNNNNNNNO.',
  '.OOONNWWNNOOO.',
  '..ONNWWWWNNO..',
  '..ONWWWWWWNO..',
  '..ONWWWWWWNO..',
  '..ONWWWWWWNO..',
  '..ONWWWWWWNO..',
  '..ONNWWWWNNO..',
  '..OONNNNNNOO..',
  '..OYYYOOYYYO..',
  '..OOOOOOOOOO..',
]

/** The Penguin shrugging, flippers out and down; the same size as the cheer. */
export const PENGUIN_SHRUG: SpriteGrid = [
  '.....OOOO.....',
  '...OOONNOOO...',
  '...ONNNNNNO...',
  '...ONWNNWNO...',
  '...ONNYYNNO...',
  '...ONNNNNNO...',
  '..OONNWWNNOO..',
  '.OONNWWWWNNOO.',
  'OONNWWWWWWNNOO',
  'ONONWWWWWWNONO',
  'ONONWWWWWWNONO',
  'OOONWWWWWWNOOO',
  '..ONNWWWWNNO..',
  '..OONNNNNNOO..',
  '..OYYYOOYYYO..',
  '..OOOOOOOOOO..',
]

/** The Penguin's white outline reads on the navy banner whatever the scene shows through it. */
export const PENGUIN_PALETTE: Palette = { O: '#FFFFFF', N: '#1F2A44', W: '#FFFFFF', Y: '#F7A21B' }

export type MascotKind = 'whale' | 'cheer' | 'shrug'

const MASCOTS: Readonly<Record<MascotKind, { readonly grid: SpriteGrid; readonly palette: Palette }>> = {
  whale: { grid: WHALE, palette: WHALE_PALETTE },
  cheer: { grid: PENGUIN_CHEER, palette: PENGUIN_PALETTE },
  shrug: { grid: PENGUIN_SHRUG, palette: PENGUIN_PALETTE },
}

/**
 * Path data for `grid`, one entry per palette color in first-seen order. Each
 * horizontal run of one key is a `M x yhnv1h-nz` rectangle in grid units.
 */
export function gridPaths(grid: SpriteGrid, palette: Palette): { readonly fill: string; readonly d: string }[] {
  const byColor = new Map<string, string>()
  grid.forEach((row, y) => {
    let x = 0
    while (x < row.length) {
      const key = row[x]!
      let end = x + 1
      while (end < row.length && row[end] === key) end++
      const color = palette[key]
      if (key !== CLEAR && color !== undefined) {
        const n = end - x
        byColor.set(color, `${byColor.get(color) ?? ''}M${x} ${y}h${n}v1h-${n}z`)
      }
      x = end
    }
  })
  return [...byColor].map(([fill, d]) => ({ fill, d }))
}

/** An aria-hidden inline SVG of the `kind` mascot, one sprite pixel to `SPRITE_PIXEL` CSS px. */
export function createMascot(doc: Document, kind: MascotKind): SVGSVGElement {
  const { grid, palette } = MASCOTS[kind]
  const cols = grid[0]?.length ?? 0
  const rows = grid.length
  const svg = doc.createElementNS(SVG_NS, 'svg')
  svg.setAttribute('class', `mascot mascot-${kind}`)
  svg.setAttribute('viewBox', `0 0 ${cols} ${rows}`)
  svg.setAttribute('width', String(cols * SPRITE_PIXEL))
  svg.setAttribute('height', String(rows * SPRITE_PIXEL))
  svg.setAttribute('shape-rendering', 'crispEdges')
  svg.setAttribute('aria-hidden', 'true')
  svg.setAttribute('focusable', 'false')
  for (const { fill, d } of gridPaths(grid, palette)) {
    const path = doc.createElementNS(SVG_NS, 'path')
    path.setAttribute('fill', fill)
    path.setAttribute('d', d)
    svg.append(path)
  }
  return svg
}
