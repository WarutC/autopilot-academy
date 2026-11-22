import { describe, expect, it, vi } from 'vitest'
import type { AlgorithmAnalysis, AlgorithmModule } from '../algorithms/index.ts'
import { createPoleReadout, formatNumber, lessonAnalysis, readoutContent } from './pole-readout.ts'

/** Just enough of an element for the readout: classes, attributes, text and children. */
class FakeElement {
  className = ''
  id = ''
  hidden = false
  readonly attrs = new Map<string, string>()
  children: Array<FakeElement | string> = []
  private text = ''
  readonly tagName: string
  constructor(tagName: string) {
    this.tagName = tagName
  }
  get textContent(): string {
    return this.text + this.children.map((c) => (typeof c === 'string' ? c : c.textContent)).join('')
  }
  set textContent(value: string) {
    this.text = value
  }
  setAttribute(name: string, value: string): void {
    this.attrs.set(name, value)
  }
  getAttribute(name: string): string | null {
    return this.attrs.get(name) ?? null
  }
  append(...nodes: Array<FakeElement | string>): void {
    this.children.push(...nodes)
  }
  replaceChildren(...nodes: Array<FakeElement | string>): void {
    this.children = [...nodes]
  }
  all(): FakeElement[] {
    return this.children.flatMap((c) => (typeof c === 'string' ? [] : [c, ...c.all()]))
  }
}

const fakeDoc = { createElement: (tag: string) => new FakeElement(tag) } as unknown as Document

function setup() {
  const readout = createPoleReadout(fakeDoc)
  const root = readout.element as unknown as FakeElement
  const byClass = (c: string) => root.all().filter((e) => e.className.split(' ').includes(c))
  const lines = (title: string) => {
    const nodes = byClass('pole-readout-text')[0]!.children as FakeElement[]
    const at = nodes.findIndex((n) => n.tagName === 'h3' && n.textContent === title)
    return at < 0 ? undefined : nodes[at + 1]!.children.map((li) => (li as FakeElement).textContent)
  }
  return { readout, root, byClass, lines, canvas: readout.canvas as unknown as FakeElement }
}

const PAIR = [
  { re: -0.25, im: -1.3919 },
  { re: -0.25, im: 1.3919 },
]

describe('formatNumber', () => {
  it('uses a Unicode minus and drops the sign of a rounded zero', () => {
    expect(formatNumber(-0.25, 2)).toBe('−0.25')
    expect(formatNumber(1.391, 2)).toBe('1.39')
    expect(formatNumber(-0.001, 2)).toBe('0.00')
    expect(formatNumber(0.2, 3)).toBe('0.200')
  })
})

describe('readoutContent', () => {
  it('lists a conjugate pair on one line', () => {
    const c = readoutContent({ poles: PAIR })
    expect(c).toMatchObject({ visible: true, plane: true, poles: ['−0.25 ± 1.39j'], gains: [] })
    expect(c.lookahead).toBeUndefined()
  })

  it('lists real poles and pairs, and a lone pole with its own sign', () => {
    const c = readoutContent({ poles: [{ re: -0.1584, im: 0 }, { re: -0.67, im: -1.83 }, { re: -0.67, im: 1.83 }] })
    expect(c.poles).toEqual(['−0.16', '−0.67 ± 1.83j'])
    expect(readoutContent({ poles: [{ re: -1, im: -2 }] }).poles).toEqual(['−1.00 − 2.00j'])
    expect(readoutContent({ poles: [{ re: 0.5, im: 2 }] }).poles).toEqual(['0.50 + 2.00j'])
    expect(readoutContent({ poles: [{ re: 0, im: 0 }] }).poles).toEqual(['0.00'])
  })

  it('lists gains to 3 decimals beside the poles', () => {
    const c = readoutContent({ poles: PAIR, gains: { k1: 0.2, k2: -1.5 } })
    expect(c).toMatchObject({ visible: true, plane: true, gains: ['k1 = 0.200', 'k2 = −1.500'] })
  })

  it('shows gains alone without the plane', () => {
    expect(readoutContent({ gains: { k1: 0.2 } })).toMatchObject({ visible: true, plane: false, poles: [] })
  })

  it('shows a look-ahead time, or the preview-off sentence at 0, without the plane', () => {
    expect(readoutContent({ lookahead: 2 })).toMatchObject({ visible: true, plane: false, lookahead: 'Looks 2.0 s ahead.' })
    expect(readoutContent({ lookahead: 0 })).toMatchObject({
      visible: true,
      plane: false,
      lookahead: 'Preview off: assumes the target stays where it is now.',
    })
  })

  it('is not visible for undefined, {} or empty lists', () => {
    for (const a of [undefined, {}, { poles: [] }, { gains: {} }, { lookahead: Number.NaN }] as (AlgorithmAnalysis | undefined)[]) {
      expect(readoutContent(a)).toMatchObject({ visible: false, plane: false, poles: [], gains: [] })
    }
  })

  it('drops non-finite gains and malformed or non-finite poles', () => {
    const c = readoutContent({
      poles: [null, 3, { re: Number.NaN, im: 0 }, ...PAIR] as unknown as AlgorithmAnalysis['poles'],
      gains: { k1: 0.2, k2: Number.NaN, k3: Number.POSITIVE_INFINITY },
    })
    expect(c).toMatchObject({ visible: true, plane: true, poles: ['−0.25 ± 1.39j'], gains: ['k1 = 0.200'] })
    expect(readoutContent({ poles: [null] as unknown as AlgorithmAnalysis['poles'], gains: { k1: Number.NaN } })).toMatchObject({
      visible: false,
      plane: false,
    })
  })

  it('ignores a negative or infinite look-ahead', () => {
    for (const lookahead of [-1, -0.5, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      const c = readoutContent({ lookahead })
      expect(c.visible).toBe(false)
      expect(c.lookahead).toBeUndefined()
    }
  })

  it('never writes to its input', () => {
    const analysis = Object.freeze({ poles: Object.freeze(PAIR.map((p) => Object.freeze({ ...p }))), gains: Object.freeze({ k1: 1 }) })
    expect(() => readoutContent(analysis)).not.toThrow()
  })
})

describe('lessonAnalysis', () => {
  const lesson = (analysis?: AlgorithmModule['analysis']): AlgorithmModule => ({
    id: 'probe',
    name: 'Probe',
    tag: 'Test',
    lesson: 'Probe. Try: nothing.',
    modes: ['autopilot'],
    params: [],
    create: () => ({ compute: () => 0 }),
    ...(analysis ? { analysis } : {}),
  })

  it('returns the module analysis for the params given', () => {
    const warn = vi.fn()
    expect(lessonAnalysis(lesson((p) => ({ lookahead: p.N! })), { N: 3 }, warn)).toEqual({ lookahead: 3 })
    expect(lessonAnalysis(lesson(), {}, warn)).toBeUndefined()
    expect(warn).not.toHaveBeenCalled()
  })

  it('returns undefined when the analysis throws, warning once per module', () => {
    const warn = vi.fn()
    const broken = lesson(() => {
      throw new Error('boom')
    })
    expect(lessonAnalysis(broken, {}, warn)).toBeUndefined()
    expect(lessonAnalysis(broken, {}, warn)).toBeUndefined()
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0]![0]).toContain('probe')
    expect(readoutContent(lessonAnalysis(broken, {}, warn)).visible).toBe(false)
  })
})

describe('createPoleReadout', () => {
  it('builds a hidden card titled Pole readout with a labeled canvas', () => {
    const { root, byClass, canvas } = setup()
    expect(root.tagName).toBe('section')
    expect(root.className).toBe('card pole-readout')
    expect(root.hidden).toBe(true)
    const header = byClass('card-header')[0]!
    expect(header.textContent).toBe('Pole readout')
    expect(root.getAttribute('aria-labelledby')).toBe(header.id)
    expect(canvas.tagName).toBe('canvas')
    expect(canvas.getAttribute('role')).toBe('img')
    expect(canvas.getAttribute('aria-label')).toBe('Closed-loop poles on the s-plane')
    expect(byClass('card-body')[0]!.children[0]).toBe(canvas)
  })

  it('shows poles only', () => {
    const { readout, root, canvas, lines } = setup()
    readout.update({ poles: PAIR })
    expect(root.hidden).toBe(false)
    expect(canvas.hidden).toBe(false)
    expect(lines('Closed-loop poles')).toEqual(['−0.25 ± 1.39j'])
    expect(lines('Gains')).toBeUndefined()
  })

  it('shows poles and gains', () => {
    const { readout, lines } = setup()
    readout.update({ poles: PAIR, gains: { k1: 0.2 } })
    expect(lines('Closed-loop poles')).toEqual(['−0.25 ± 1.39j'])
    expect(lines('Gains')).toEqual(['k1 = 0.200'])
  })

  it('shows a look-ahead time with the canvas hidden', () => {
    const { readout, root, canvas, byClass } = setup()
    readout.update({ lookahead: 2 })
    expect(root.hidden).toBe(false)
    expect(canvas.hidden).toBe(true)
    expect(byClass('pole-readout-lookahead')[0]!.textContent).toBe('Looks 2.0 s ahead.')
    readout.update({ lookahead: 0 })
    expect(byClass('pole-readout-lookahead')[0]!.textContent).toBe('Preview off: assumes the target stays where it is now.')
  })

  it('hides the whole card for undefined or {} and replaces old lines', () => {
    const { readout, root, byClass } = setup()
    readout.update({ poles: PAIR })
    readout.update(undefined)
    expect(root.hidden).toBe(true)
    expect(byClass('pole-readout-text')[0]!.children).toEqual([])
    readout.update({ poles: PAIR })
    readout.update({})
    expect(root.hidden).toBe(true)
  })
})
