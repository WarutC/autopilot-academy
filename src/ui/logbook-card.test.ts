import { describe, expect, it } from 'vitest'
import type { LogEntry } from '../sim/scoring.ts'
import { EMPTY_LOGBOOK, createLogbookCard } from './logbook-card.ts'

/** Just enough of an element for the card: classes, attributes, text and children. */
class FakeElement {
  className = ''
  id = ''
  hidden = false
  tabIndex = -1
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
    this.children = []
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

const NAMES: Record<string, string> = { pid: 'PID', lqr: 'LQR' }

function setup() {
  const card = createLogbookCard(fakeDoc, (lesson) => NAMES[lesson])
  const root = card.element as unknown as FakeElement
  const byTag = (t: string) => root.all().filter((e) => e.tagName === t)
  const byClass = (c: string) => root.all().filter((e) => e.className.split(' ').includes(c))
  return { card, root, byTag, byClass }
}

const row = (over: Partial<LogEntry> = {}): LogEntry => ({
  lesson: 'pid',
  mode: 'autopilot',
  course: 101,
  points: 72.345,
  rings: 9,
  ringsTotal: 10,
  iae: 123.6,
  energy: 4.25,
  tags: [],
  ...over,
})

describe('createLogbookCard', () => {
  it('builds a card titled Logbook showing only the empty line', () => {
    const { root, byClass, byTag } = setup()
    expect(root.tagName).toBe('section')
    expect(root.className).toBe('card logbook')
    const header = byClass('card-header')[0]!
    expect(header.textContent).toBe('Logbook')
    expect(root.getAttribute('aria-labelledby')).toBe(header.id)
    const body = byClass('card-body')[0]!
    expect(body.children).toHaveLength(1)
    expect(body.textContent).toBe(EMPTY_LOGBOOK)
    // A focusable, labelled region, so the keyboard can scroll a wide table.
    expect(body.tabIndex).toBe(0)
    expect(body.getAttribute('role')).toBe('region')
    expect(body.getAttribute('aria-labelledby')).toBe(header.id)
    expect(EMPTY_LOGBOOK).toBe(
      "Finished flights appear here. Best scores only count finished Autopilot or Manual flights you didn't retune.",
    )
    expect(byTag('table')).toEqual([])
  })

  it('renders rows as a table with five columns, formatted numbers and tags', () => {
    const { card, byTag, byClass } = setup()
    card.update([
      row(),
      row({ lesson: 'lqr', tags: ['wingman', 'crashed', 'retuned'] }),
      row({ lesson: 'custom', mode: 'semi-auto', tags: ['semi-auto'] }),
    ])
    expect(byClass('logbook-empty')).toEqual([])
    const ths = byTag('th')
    expect(ths.map((th) => th.textContent)).toEqual(['Autopilot', 'Score', 'Rings', 'IAE', 'Energy'])
    expect(ths[3]!.getAttribute('title')).toBe('Integral of absolute altitude error')
    expect(ths[4]!.getAttribute('title')).toBe('Integral of u squared')

    const rows = byTag('tbody')[0]!.children as FakeElement[]
    expect(rows).toHaveLength(3)
    const cells = (tr: FakeElement) => (tr.children as FakeElement[]).map((td) => td.textContent)
    expect(cells(rows[0]!)).toEqual(['PID', '72.3', '9/10', '124', '4.3'])
    const tagsOf = (tr: FakeElement) =>
      (tr.children[0] as FakeElement).all().filter((e) => e.className.split(' ').includes('logbook-tag')).map((e) => e.textContent)
    expect(tagsOf(rows[0]!)).toEqual([])
    expect(tagsOf(rows[1]!)).toEqual(['wingman', 'crashed', 'retuned'])
    expect(tagsOf(rows[2]!)).toEqual(['semi-auto'])
    // Only the wingman tag takes the wingman's Ghost style.
    const ghostTags = (rows[1]!.children[0] as FakeElement).all().filter((e) => e.className.includes('logbook-tag-wingman'))
    expect(ghostTags.map((e) => e.textContent)).toEqual(['wingman'])
    expect((rows[1]!.children[0] as FakeElement).children[0]).toBe('LQR')
    expect((rows[2]!.children[0] as FakeElement).children[0]).toBe('custom')
  })

  it('falls back to the lesson id when the lookup returns an empty name', () => {
    const card = createLogbookCard(fakeDoc, () => '')
    card.update([row()])
    const root = card.element as unknown as FakeElement
    const td = root.all().find((e) => e.className === 'logbook-name')!
    expect(td.textContent).toBe('pid')
  })

  it('renders non-finite numbers as a dash', () => {
    const { card, byTag } = setup()
    card.update([row({ points: Number.NaN, iae: Number.POSITIVE_INFINITY, energy: Number.NaN, rings: Number.NaN })])
    const tr = byTag('tbody')[0]!.children[0] as FakeElement
    expect((tr.children as FakeElement[]).map((td) => td.textContent)).toEqual(['PID', '—', '—/10', '—', '—'])
  })

  it('replaces the table with the empty line when the rows go away', () => {
    const { card, byTag, byClass } = setup()
    card.update([row()])
    expect(byTag('table')).toHaveLength(1)
    card.update([])
    expect(byTag('table')).toEqual([])
    expect(byClass('card-body')[0]!.textContent).toBe(EMPTY_LOGBOOK)
  })
})
