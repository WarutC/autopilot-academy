import { describe, expect, it } from 'vitest'
import type { LogEntry, PlaneResult, ScoredRun } from '../sim/scoring.ts'
import { LOGBOOK_SIZE, appendRun, createRunLogger, type LogbookOwner } from './logbook.ts'

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
    const rows = Object.freeze(old(3).map((r) => Object.freeze(r)))
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

  it('keeps the best for an ineligible, lower, equal or non-finite score, without touching the old rows', () => {
    const rows = Object.freeze(old(2).map((r) => Object.freeze(r)))
    const copy = structuredClone(rows)
    const keep = (player: PlaneResult, wingman?: PlaneResult) => {
      const next = appendRun(rows, runOf(player, wingman), 40)
      expect(next.rows.slice(-2)).toEqual(copy)
      return next.best
    }
    expect(keep(result({ points: 30 }))).toBe(40)
    expect(keep(result({ points: 40 }))).toBe(40)
    expect(keep(result({ points: Number.NaN }))).toBe(40)
    expect(keep(result({ points: Number.POSITIVE_INFINITY }))).toBe(40)
    expect(keep(result({ status: 'crashed', points: 90 }))).toBe(40)
    expect(keep(result({ retuned: true, points: 90 }))).toBe(40)
    expect(keep(result({ mode: 'semi-auto', points: 90 }))).toBe(40)
    expect(keep(result({ points: 10 }), result({ points: 90 }))).toBe(40)
    expect(appendRun([], runOf(result({ status: 'crashed' })), undefined).best).toBeUndefined()
    expect(rows).toEqual(copy)
  })
})

/** An in-memory logbook owner that counts its writes. */
function owner(best: Record<string, number> = {}) {
  const state = {
    logbook: [] as readonly LogEntry[],
    best: { ...best } as Record<string, number>,
    logWrites: 0,
    bestWrites: 0,
  }
  const o: LogbookOwner = {
    get logbook() {
      return state.logbook
    },
    setLogbook(rows) {
      state.logbook = rows.slice()
      state.logWrites++
    },
    get best() {
      return state.best
    },
    setBest(id, points) {
      state.best = { ...state.best, [id]: points }
      state.bestWrites++
    },
  }
  return { o, state }
}

describe('createRunLogger', () => {
  it('logs an ended run: the player row, then the wingman row', () => {
    const { o, state } = owner()
    const log = createRunLogger(o)
    expect(log(runOf(result(), result({ lesson: 'p', status: 'crashed' })))).toBe(true)
    expect(state.logbook.map((r) => r.lesson)).toEqual(['pid', 'p'])
    expect(state.logbook[1]!.tags).toContain('wingman')
  })

  it('logs the same run object once', () => {
    const { o, state } = owner()
    const log = createRunLogger(o)
    const run = runOf(result())
    expect(log(run)).toBe(true)
    expect(log(run)).toBe(false)
    expect(log(run)).toBe(false)
    expect(state.logbook).toHaveLength(1)
    expect(state.logWrites).toBe(1)
    expect(state.bestWrites).toBe(1)
  })

  it('skips a run while a plane is flying and logs it once it ends', () => {
    const { o, state } = owner()
    const log = createRunLogger(o)
    let wingmanStatus: PlaneResult['status'] = 'flying'
    const run: ScoredRun = {
      result: (plane) => (plane === 'player' ? result() : result({ lesson: 'p', status: wingmanStatus })),
    }
    expect(log(run)).toBe(false)
    expect(log(runOf(result({ status: 'flying' })))).toBe(false)
    expect(log(runOf(undefined))).toBe(false)
    expect(state.logWrites).toBe(0)
    wingmanStatus = 'finished'
    expect(log(run)).toBe(true)
    expect(state.logbook.map((r) => r.lesson)).toEqual(['pid', 'p'])
  })

  it('raises the best for an eligible higher score', () => {
    const { o, state } = owner({ pid: 70 })
    createRunLogger(o)(runOf(result({ points: 80 })))
    expect(state.best).toEqual({ pid: 80 })
  })

  it('keeps the best for an ineligible or lower run but still logs its row', () => {
    for (const r of [
      result({ points: 90, mode: 'semi-auto' }),
      result({ points: 90, retuned: true }),
      result({ points: 90, status: 'crashed' }),
      result({ points: 70 }),
      result({ points: 60 }),
    ]) {
      const { o, state } = owner({ pid: 70 })
      expect(createRunLogger(o)(runOf(r))).toBe(true)
      expect(state.logbook).toHaveLength(1)
      expect(state.best).toEqual({ pid: 70 })
      expect(state.bestWrites).toBe(0)
    }
  })

  it('never lets the wingman raise a best', () => {
    const { o, state } = owner()
    createRunLogger(o)(runOf(result({ mode: 'semi-auto' }), result({ lesson: 'p', points: 99 })))
    expect(state.best).toEqual({})
  })
})
