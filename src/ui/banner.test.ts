import { describe, expect, it } from 'vitest'
import { defaultParams } from '../algorithms/index.ts'
import pid from '../algorithms/pid.ts'
import { createRun, type RunAlgorithm } from '../sim/run.ts'
import type { PlaneResult } from '../sim/scoring.ts'
import type { RingResult } from '../sim/types.ts'
import { bannerContent, createBanner } from './banner.ts'
import { DIVE } from './dive.ts'
import { createFlight, type Flight, type Speed } from './flight.ts'

function ring(i: number, pass: boolean): RingResult {
  return { ring: i, pass, err: pass ? 1 : 20, points: pass ? 9 : 0 }
}

function result(status: PlaneResult['status'], points = 0, passed = 0, total = 10): PlaneResult {
  return {
    lesson: 'pid',
    mode: 'autopilot',
    course: 101,
    status,
    points,
    results: Array.from({ length: total }, (_, i) => ring(i, i < passed)),
    ringsTotal: total,
    iae: 0,
    energy: 0,
    retuned: false,
  }
}

const runWith = (algorithm: RunAlgorithm) => () =>
  createRun({
    course: 101,
    mode: 'autopilot',
    player: { algorithm, params: algorithm === pid ? defaultParams(pid) : {} },
  })

function flyToEnd(f: Flight, speed: Speed): void {
  f.setSpeed(speed)
  f.fly()
  for (let i = 0; f.phase === 'running' && i < 1e6; i++) f.advance(1 / 60)
}

const shown = (f: Flight) => bannerContent(f.phase, f.run.result('player'))

describe('bannerContent', () => {
  it('says Ready for takeoff when ready', () => {
    expect(bannerContent('ready', undefined)).toEqual({
      title: 'Ready for takeoff',
      body: 'Pick an autopilot, then press Fly.',
    })
  })

  it('says New course loaded when ready with a loaded course', () => {
    expect(bannerContent('ready', undefined, 555)).toEqual({
      title: 'New course loaded',
      body: 'Course 555. Share the number so classmates fly the same rings.',
    })
  })

  it('ignores a loaded course outside the ready phase', () => {
    expect(bannerContent('running', result('flying'), 555)).toBeUndefined()
    expect(bannerContent('paused', result('flying'), 555)?.title).toBe('Paused')
    expect(bannerContent('ended', result('finished', 74.2, 8, 10), 555)?.title).toBe('Mission complete')
  })

  it('shows nothing while running', () => {
    expect(bannerContent('running', result('flying'))).toBeUndefined()
  })

  it('says Paused when paused', () => {
    expect(bannerContent('paused', result('flying'))).toEqual({
      title: 'Paused',
      body: 'Retune freely. Changes apply the moment you resume.',
    })
  })

  it('reports points and rings when finished', () => {
    expect(bannerContent('ended', result('finished', 74.2, 8, 10))).toEqual({
      title: 'Mission complete',
      body: '74.2 points, 8 of 10 rings.',
    })
  })

  it('says Crashed when the player crashed', () => {
    expect(bannerContent('ended', result('crashed', 12, 2))).toEqual({
      title: 'Crashed',
      body: 'The aircraft left the safe altitude band. Retune and fly again.',
    })
  })

  it('adds a Retuned note to Mission complete and Crashed for retuned results only', () => {
    const retuned = (status: PlaneResult['status']) => ({ ...result(status, 74.2, 8), retuned: true })
    expect(bannerContent('ended', retuned('finished'))).toEqual({
      title: 'Mission complete',
      body: '74.2 points, 8 of 10 rings.',
      note: 'Retuned',
    })
    expect(bannerContent('ended', retuned('crashed'))?.note).toBe('Retuned')
    expect(bannerContent('ended', result('finished', 74.2, 8))).not.toHaveProperty('note')
    expect(bannerContent('ended', result('crashed'))).not.toHaveProperty('note')
    expect(bannerContent('paused', retuned('flying'))).not.toHaveProperty('note')
  })

  it('shows nothing for an ended flight without a result', () => {
    expect(() => bannerContent('ended', undefined)).not.toThrow()
    expect(bannerContent('ended', undefined)).toBeUndefined()
  })
})

describe('bannerContent: wingman', () => {
  const wingman = (status: PlaneResult['status'], points: number) => ({ name: 'P', result: { ...result(status, points), lesson: 'p' } })

  it('appends the wingman score to Mission complete', () => {
    expect(bannerContent('ended', result('finished', 74.2, 8, 10), undefined, wingman('finished', 61))).toEqual({
      title: 'Mission complete',
      body: '74.2 points, 8 of 10 rings. Wingman P: 61.0 points.',
    })
  })

  it('says when the wingman crashed', () => {
    expect(bannerContent('ended', result('finished', 74.2, 8, 10), undefined, wingman('crashed', 12.25))?.body).toBe(
      '74.2 points, 8 of 10 rings. Wingman P crashed with 12.3 points.',
    )
  })

  it('appends the wingman score to Crashed, keeping the Retuned note', () => {
    expect(bannerContent('ended', result('crashed', 12, 2), undefined, wingman('finished', 61))).toEqual({
      title: 'Crashed',
      body: 'The aircraft left the safe altitude band. Retune and fly again. Wingman P: 61.0 points.',
    })
    const retuned = { ...result('crashed', 12, 2), retuned: true }
    expect(bannerContent('ended', retuned, undefined, wingman('crashed', 4))).toEqual({
      title: 'Crashed',
      body: 'The aircraft left the safe altitude band. Retune and fly again. Wingman P crashed with 4.0 points.',
      note: 'Retuned',
    })
  })

  it('changes nothing in the other banners', () => {
    const w = wingman('finished', 61)
    expect(bannerContent('ready', undefined, undefined, w)).toEqual(bannerContent('ready', undefined))
    expect(bannerContent('paused', result('flying'), undefined, w)).toEqual(bannerContent('paused', result('flying')))
    expect(bannerContent('running', result('flying'), undefined, w)).toBeUndefined()
  })
})

describe('banner end to end', () => {
  it('gives PID on course 101 the same Mission complete text at x1 and x4', () => {
    const a = createFlight(runWith(pid))
    expect(shown(a)?.title).toBe('Ready for takeoff')
    a.fly()
    expect(shown(a)).toBeUndefined()
    a.togglePause()
    expect(shown(a)?.title).toBe('Paused')
    flyToEnd(a, 1)
    const b = createFlight(runWith(pid))
    flyToEnd(b, 4)
    expect(a.phase).toBe('ended')
    expect(a.run.result('player')!.status).toBe('finished')
    expect(b.run.result('player')!.status).toBe('finished')
    expect(shown(a)!.title).toBe('Mission complete')
    expect(shown(a)!.body).toMatch(/^\d+\.\d points, \d+ of 10 rings\.$/)
    expect(shown(b)).toEqual(shown(a))
  })

  it('shows Retuned at the end of a flight retuned mid-flight, and not otherwise', () => {
    const retuned = createFlight(runWith(pid))
    retuned.fly()
    for (let i = 0; i < 120; i++) retuned.advance(1 / 60)
    retuned.run.setParam('player', 'Kd', 0.1)
    retuned.run.markChange('Kd 0.05 → 0.1')
    for (let i = 0; retuned.phase === 'running' && i < 1e6; i++) retuned.advance(1 / 60)
    expect(retuned.phase).toBe('ended')
    expect(shown(retuned)?.note).toBe('Retuned')
    const plain = createFlight(runWith(pid))
    flyToEnd(plain, 4)
    expect(shown(plain)?.title).toBe('Mission complete')
    expect(shown(plain)?.note).toBeUndefined()
  })

  it('crashes the dive controller on course 101', () => {
    expect(DIVE.id).toBe('dive')
    const f = createFlight(runWith(DIVE))
    flyToEnd(f, 4)
    expect(f.phase).toBe('ended')
    expect(shown(f)).toEqual({
      title: 'Crashed',
      body: 'The aircraft left the safe altitude band. Retune and fly again.',
    })
  })
})

/** Just enough of the DOM for createBanner, counting every write. */
class FakeElement {
  className = ''
  readonly attrs = new Map<string, string>()
  children: FakeElement[] = []
  private text = ''
  readonly tagName: string
  private readonly log: string[]
  constructor(tagName: string, log: string[]) {
    this.tagName = tagName
    this.log = log
  }
  get textContent(): string {
    return this.text + this.children.map((c) => c.textContent).join('')
  }
  set textContent(value: string) {
    this.log.push(`text ${this.tagName}`)
    this.text = value
  }
  setAttribute(name: string, value: string): void {
    this.attrs.set(name, value)
  }
  append(...nodes: FakeElement[]): void {
    this.log.push(`append ${this.tagName}`)
    this.children.push(...nodes)
  }
  replaceChildren(...nodes: FakeElement[]): void {
    this.log.push(`replace ${this.tagName}`)
    this.children = nodes
  }
}

function fakeDocument(): { doc: Document; log: string[] } {
  const log: string[] = []
  const doc = { createElement: (tag: string) => new FakeElement(tag, log) }
  return { doc: doc as unknown as Document, log }
}

describe('createBanner', () => {
  it('builds a persistent polite status region', () => {
    const { doc } = fakeDocument()
    const region = createBanner(doc).element as unknown as FakeElement
    expect(region.className).toBe('banner-region')
    expect(region.attrs.get('role')).toBe('status')
    expect(region.attrs.get('aria-live')).toBe('polite')
    expect(region.attrs.get('aria-atomic')).toBe('true')
    expect(region.children).toEqual([])
  })

  it('writes nothing when the same content comes twice', () => {
    const { doc, log } = fakeDocument()
    const banner = createBanner(doc)
    banner.update({ title: 'Paused', body: 'Retune freely. Changes apply the moment you resume.' })
    const region = banner.element as unknown as FakeElement
    expect(region.children).toHaveLength(1)
    expect(region.children[0]!.className).toBe('banner')
    expect(region.textContent).toBe('PausedRetune freely. Changes apply the moment you resume.')
    const writes = log.length
    banner.update({ title: 'Paused', body: 'Retune freely. Changes apply the moment you resume.' })
    expect(log.length).toBe(writes)
  })

  it('renders the note as a second paragraph and rewrites when only the note changes', () => {
    const { doc, log } = fakeDocument()
    const banner = createBanner(doc)
    const region = banner.element as unknown as FakeElement
    banner.update({ title: 'Mission complete', body: '74.2 points, 8 of 10 rings.' })
    expect(region.children[0]!.children).toHaveLength(2)
    const writes = log.length
    banner.update({ title: 'Mission complete', body: '74.2 points, 8 of 10 rings.', note: 'Retuned' })
    expect(log.length).toBeGreaterThan(writes)
    const box = region.children[0]!
    expect(box.children.map((c) => c.className)).toEqual(['banner-title', 'banner-body', 'banner-note'])
    expect(box.children[2]!.textContent).toBe('Retuned')
    const after = log.length
    banner.update({ title: 'Mission complete', body: '74.2 points, 8 of 10 rings.', note: 'Retuned' })
    expect(log.length).toBe(after)
  })

  it('removes the box but keeps the region on clear', () => {
    const { doc, log } = fakeDocument()
    const banner = createBanner(doc)
    const region = banner.element as unknown as FakeElement
    banner.update({ title: 'Crashed', body: 'x' })
    banner.update(undefined)
    expect(region.children).toEqual([])
    expect(region.attrs.get('role')).toBe('status')
    const writes = log.length
    banner.update(undefined)
    expect(log.length).toBe(writes)
  })
})
