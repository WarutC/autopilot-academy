import { describe, expect, it } from 'vitest'
import type { LogEntry, PlaneResult, ScoredRun } from '../sim/scoring.ts'
import { LOGBOOK_SIZE, appendRun } from './logbook.ts'

const result = (over: Partial<PlaneResult> = {}): PlaneResult => ({
  lesson: 'pid',
  mode: 'autopilot',
  course: 101,
  status: 'finished',
  points: 50,
  results: [],
  ringsTotal: 10,
  iae: 100,
  energy: 2,
  retuned: false,
  ...over,
})

const runOf = (player?: PlaneResult, wingman?: PlaneResult): ScoredRun => ({
  result: (plane) => (plane === 'player' ? player : wingman),
})

const old = (n: number): LogEntry[] =>
  Array.from({ length: n }, (_, i) => ({
    lesson: `old${i}`,
    mode: 'autopilot',
    course: 101,
    points: i,
    rings: 0,
    ringsTotal: 10,
    iae: 0,
    energy: 0,
    tags: [],
  }))

describe('appendRun', () => {
  it('puts the player and wingman rows ahead of the newest old rows, keeping 8', () => {
    const rows = old(7)
    const next = appendRun(rows, runOf(result(), result({ lesson: 'lqr' })), undefined)
    expect(LOGBOOK_SIZE).toBe(8)
    expect(next.rows).toHaveLength(8)
    expect(next.rows[0]).toMatchObject({ lesson: 'pid', tags: [] })
    expect(next.rows[1]).toMatchObject({ lesson: 'lqr', tags: ['wingman'] })
    expect(next.rows.slice(2).map((r) => r.lesson)).toEqual(['old0', 'old1', 'old2', 'old3', 'old4', 'old5'])
    expect(rows).toHaveLength(7)
  })

  it('prepends the player row alone when there is no wingman, capped at 8', () => {
    const next = appendRun(old(2), runOf(result()), undefined)
    expect(next.rows.map((r) => r.lesson)).toEqual(['pid', 'old0', 'old1'])
    expect(appendRun(old(8), runOf(result()), undefined).rows.map((r) => r.lesson)).toEqual([
      'pid',
      ...old(7).map((r) => r.lesson),
    ])
  })

  it('changes nothing while a plane is flying or without a player result', () => {
    const rows = old(3)
    for (const run of [
      runOf(result({ status: 'flying' })),
      runOf(result(), result({ status: 'flying' })),
      runOf(undefined, result()),
    ]) {
      const next = appendRun(rows, run, 40)
      expect(next.rows).toEqual(rows)
      expect(next.best).toBe(40)
    }
  })

  it('raises the best for an eligible flight that scores more, or the first one', () => {
    expect(appendRun([], runOf(result({ points: 50 })), undefined).best).toBe(50)
    expect(appendRun([], runOf(result({ points: 50 })), 40).best).toBe(50)
    expect(appendRun([], runOf(result({ mode: 'manual', points: 50 })), 40).best).toBe(50)
  })

  it('keeps the best for an ineligible, lower, equal or non-finite score', () => {
    const keep = (player: PlaneResult, wingman?: PlaneResult) => appendRun([], runOf(player, wingman), 40).best
    expect(keep(result({ points: 30 }))).toBe(40)
    expect(keep(result({ points: 40 }))).toBe(40)
    expect(keep(result({ points: Number.NaN }))).toBe(40)
    expect(keep(result({ points: Number.POSITIVE_INFINITY }))).toBe(40)
    expect(keep(result({ status: 'crashed', points: 90 }))).toBe(40)
    expect(keep(result({ retuned: true, points: 90 }))).toBe(40)
    expect(keep(result({ mode: 'semi-auto', points: 90 }))).toBe(40)
    expect(keep(result({ points: 10 }), result({ points: 90 }))).toBe(40)
    expect(appendRun([], runOf(result({ status: 'crashed' })), undefined).best).toBeUndefined()
  })
})
