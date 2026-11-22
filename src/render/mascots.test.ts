import { describe, expect, it } from 'vitest'
import layoutCss from '../styles/layout.css?raw'
import tokensCss from '../styles/tokens.css?raw'
import {
  createMascot,
  gridPaths,
  type MascotKind,
  PENGUIN_CHEER,
  PENGUIN_PALETTE,
  PENGUIN_SHRUG,
  SVG_NS,
  WHALE,
  WHALE_PALETTE,
} from './mascots.ts'
import { SPRITE_PIXEL } from './scene-geometry.ts'
import type { Palette, SpriteGrid } from './sprites.ts'

const GRIDS: readonly [string, SpriteGrid, Palette, string][] = [
  ['whale', WHALE, WHALE_PALETTE, 'K'],
  ['cheer', PENGUIN_CHEER, PENGUIN_PALETTE, 'O'],
  ['shrug', PENGUIN_SHRUG, PENGUIN_PALETTE, 'O'],
]

describe('mascot grids', () => {
  it.each(GRIDS)('%s has equal rows of palette keys only', (_, grid, palette) => {
    expect(grid.length).toBeGreaterThan(0)
    const width = grid[0]!.length
    for (const row of grid) {
      expect(row).toHaveLength(width)
      for (const key of row) expect(key === '.' || key in palette).toBe(true)
    }
  })

  it.each(GRIDS)('%s is fully outlined', (_, grid, __, outline) => {
    const at = (x: number, y: number) => grid[y]?.[x] ?? '.'
    grid.forEach((row, y) => {
      for (let x = 0; x < row.length; x++) {
        const key = row[x]!
        if (key === '.' || key === outline) continue
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
          expect(at(x + dx, y + dy), `${key} at ${x},${y}`).not.toBe('.')
        }
      }
    })
  })

  it('has a whale about 18 by 10 and penguins about 14 by 16', () => {
    expect([WHALE[0]!.length, WHALE.length]).toEqual([18, 10])
    expect([PENGUIN_CHEER[0]!.length, PENGUIN_CHEER.length]).toEqual([14, 16])
  })

  it('draws the cheer and the shrug the same size, and differently', () => {
    expect(PENGUIN_SHRUG.length).toBe(PENGUIN_CHEER.length)
    expect(PENGUIN_SHRUG[0]!.length).toBe(PENGUIN_CHEER[0]!.length)
    expect(PENGUIN_SHRUG).not.toEqual(PENGUIN_CHEER)
  })

  it('uses only the fixed palettes', () => {
    expect(WHALE_PALETTE).toEqual({ K: '#1A2A3A', C: '#8FE3F0', W: '#FFFFFF' })
    expect(PENGUIN_PALETTE).toEqual({ O: '#FFFFFF', N: '#1F2A44', W: '#FFFFFF', Y: '#F7A21B' })
  })
})

/** The cells `d` covers, as "x,y" strings; throws on anything but integer run rectangles. */
function cells(d: string): string[] {
  const out: string[] = []
  const rest = d.replace(/M(\d+) (\d+)h(\d+)v1h-(\d+)z/g, (_, x, y, n, back) => {
    expect(back).toBe(n)
    for (let i = 0; i < Number(n); i++) out.push(`${Number(x) + i},${y}`)
    return ''
  })
  expect(rest).toBe('')
  return out
}

describe('gridPaths', () => {
  it.each(GRIDS)('%s covers exactly its opaque pixels, one entry per color', (_, grid, palette) => {
    const paths = gridPaths(grid, palette)
    const fills = paths.map((p) => p.fill)
    expect(new Set(fills).size).toBe(fills.length)
    for (const { fill, d } of paths) {
      const expected: string[] = []
      grid.forEach((row, y) => {
        for (let x = 0; x < row.length; x++) if (row[x] !== '.' && palette[row[x]!] === fill) expected.push(`${x},${y}`)
      })
      expect(cells(d).sort()).toEqual(expected.sort())
    }
    expect(fills.sort()).toEqual([...new Set(Object.values(palette))].sort())
  })

  it('merges runs', () => {
    expect(gridPaths(['.AAB', 'AA..'], { A: '#000000', B: '#FFFFFF' })).toEqual([
      { fill: '#000000', d: 'M1 0h2v1h-2zM0 1h2v1h-2z' },
      { fill: '#FFFFFF', d: 'M3 0h1v1h-1z' },
    ])
  })
})

/** Just enough of an SVG element for createMascot. */
class FakeNode {
  readonly attrs = new Map<string, string>()
  readonly children: FakeNode[] = []
  readonly ns: string
  readonly tagName: string
  constructor(ns: string, tagName: string) {
    this.ns = ns
    this.tagName = tagName
  }
  setAttribute(name: string, value: string): void {
    this.attrs.set(name, value)
  }
  append(...nodes: FakeNode[]): void {
    this.children.push(...nodes)
  }
}

const fakeDoc = { createElementNS: (ns: string, tag: string) => new FakeNode(ns, tag) } as unknown as Document

describe('createMascot', () => {
  it.each([
    ['whale', WHALE, WHALE_PALETTE],
    ['cheer', PENGUIN_CHEER, PENGUIN_PALETTE],
    ['shrug', PENGUIN_SHRUG, PENGUIN_PALETTE],
  ] as const)('builds a crisp, hidden %s SVG', (kind, grid, palette) => {
    const svg = createMascot(fakeDoc, kind as MascotKind) as unknown as FakeNode
    const cols = grid[0]!.length
    expect(svg.ns).toBe(SVG_NS)
    expect(svg.tagName).toBe('svg')
    expect(Object.fromEntries(svg.attrs)).toEqual({
      class: `mascot mascot-${kind}`,
      viewBox: `0 0 ${cols} ${grid.length}`,
      width: String(cols * SPRITE_PIXEL),
      height: String(grid.length * SPRITE_PIXEL),
      'shape-rendering': 'crispEdges',
      'aria-hidden': 'true',
      focusable: 'false',
    })
    expect(svg.children.map((p) => [p.ns, p.tagName, p.attrs.get('fill'), p.attrs.get('d')])).toEqual(
      gridPaths(grid, palette).map(({ fill, d }) => [SVG_NS, 'path', fill, d]),
    )
  })
})

// Contrast helpers, as in the theme contrast tests.
function declarations(block: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const match of block.matchAll(/--([\w-]+):\s*([^;]+);/g)) out[match[1]!] = match[2]!.trim()
  return out
}

function blockAfter(css: string, from: number): string {
  const open = css.indexOf('{', from)
  let depth = 0
  for (let i = open; i < css.length; i++) {
    if (css[i] === '{') depth++
    else if (css[i] === '}' && --depth === 0) return css.slice(open + 1, i)
  }
  throw new Error('unbalanced braces')
}

function channel(c: number): number {
  const s = c / 255
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
}

function rgb(hex: string): [number, number, number] {
  const m = /^#([0-9a-f]{6})$/i.exec(hex)
  if (!m) throw new Error(`not a #RRGGBB color: ${hex}`)
  const n = parseInt(m[1]!, 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

function luminance([r, g, b]: readonly number[]): number {
  return 0.2126 * channel(r!) + 0.7152 * channel(g!) + 0.0722 * channel(b!)
}

function contrast(a: readonly number[], b: readonly number[]): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi! + 0.05) / (lo! + 0.05)
}

/** The body of the first rule whose selector list is exactly `selector`. */
function ruleBody(selector: string): string {
  const flat = layoutCss.replace(/\/\*[\s\S]*?\*\//g, '')
  for (const m of flat.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (m[1]!.split(',').some((s) => s.trim() === selector)) return m[2]!
  }
  throw new Error(`no ${selector} rule in layout.css`)
}

describe('mascot contrast', () => {
  it('keeps the Penguin outline at 3:1 on the banner over black and over white', () => {
    const bg = /background:\s*rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)/.exec(ruleBody('.banner'))
    expect(bg).not.toBeNull()
    const [r, g, b, a] = bg!.slice(1).map(Number) as [number, number, number, number]
    const over = (under: number) => [r, g, b].map((c) => Math.round(c * a + under * (1 - a)))
    const outline = rgb(PENGUIN_PALETTE.O!)
    expect(contrast(outline, over(0))).toBeGreaterThanOrEqual(3)
    expect(contrast(outline, over(255))).toBeGreaterThanOrEqual(3)
  })

  it('keeps the Whale outline on the light panel and its body on the dark panel at 3:1', () => {
    const light = declarations(blockAfter(tokensCss, tokensCss.indexOf(':root')))
    const dark = { ...light, ...declarations(blockAfter(tokensCss, tokensCss.indexOf('prefers-color-scheme: dark'))) }
    expect(contrast(rgb(WHALE_PALETTE.K!), rgb(light.panel!))).toBeGreaterThanOrEqual(3)
    expect(contrast(rgb(WHALE_PALETTE.C!), rgb(dark.panel!))).toBeGreaterThanOrEqual(3)
  })
})
