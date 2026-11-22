// The logbook model: the newest finished flights and the best score, kept as
// plain data, and the logger that records each ended run once into their
// owner. Rows and eligibility come from `sim/scoring` alone.

import { isBestEligible, summarize, type LogEntry, type ScoredRun } from '../sim/scoring.ts'
import type { Phase } from './store.ts'

/** How many rows the logbook keeps. */
export const LOGBOOK_SIZE = 8

export interface LogbookState {
  readonly rows: LogEntry[]
  /** Best points for the player's lesson, or undefined before any eligible flight. */
  readonly best: number | undefined
}

/**
 * Logs `run`: the player's row, then the wingman's if there is one, ahead of
 * the old rows, keeping the newest `LOGBOOK_SIZE`. `best` rises when the
 * player's flight is best-eligible and scores more. A run with a plane still
 * flying, or without a player result, changes nothing.
 */
export function appendRun(rows: readonly LogEntry[], run: ScoredRun, best: number | undefined): LogbookState {
  const player = run.result('player')
  const wingman = run.result('wingman')
  if (!player || player.status === 'flying' || wingman?.status === 'flying') {
    return { rows: rows.slice(), best }
  }
  const fresh: LogEntry[] = []
  const playerRow = summarize(run, 'player')
  if (playerRow) fresh.push(playerRow)
  const wingmanRow = summarize(run, 'wingman')
  if (wingmanRow) fresh.push(wingmanRow)

  let nextBest = best
  if (
    isBestEligible(player, 'player') &&
    Number.isFinite(player.points) &&
    (best === undefined || player.points > best)
  ) {
    nextBest = player.points
  }
  return { rows: [...fresh, ...rows].slice(0, LOGBOOK_SIZE), best: nextBest }
}

/** Something that holds the logbook rows and the best score per lesson; the store fits. */
export interface LogbookOwner {
  readonly logbook: readonly LogEntry[]
  setLogbook(rows: readonly LogEntry[]): void
  readonly best: Readonly<Record<string, number>>
  setBest(id: string, points: number): void
}

/**
 * A logger that records an ended run into `owner`: its rows through
 * `appendRun`, and the player's lesson's best when it rises. Each run object is
 * logged once; a run with a plane still flying, or without a player result, is
 * skipped and not remembered, so a later call after it ends logs it. Returns
 * true when it logged the run.
 */
export function createRunLogger(owner: LogbookOwner): (run: ScoredRun) => boolean {
  let last: ScoredRun | undefined
  return (run) => {
    if (run === last) return false
    const player = run.result('player')
    const wingman = run.result('wingman')
    if (!player || player.status === 'flying' || wingman?.status === 'flying') return false
    last = run
    const before = owner.best[player.lesson]
    const next = appendRun(owner.logbook, run, before)
    owner.setLogbook(next.rows)
    if (next.best !== undefined && next.best !== before) owner.setBest(player.lesson, next.best)
    return true
  }
}

/** Where a logged run shows: the Logbook card's rows and the lesson chips' best scores. */
export interface LoggedRunView {
  logbook(rows: readonly LogEntry[]): void
  bests(best: Readonly<Record<string, number>>): void
}

/**
 * The frame loop's logging step: once the flight has ended, logs its run into
 * `owner` and refreshes both views; a run that is still running, paused or
 * ready, or one already logged, changes nothing.
 */
export function createEndedRunStep(owner: LogbookOwner, view: LoggedRunView): (phase: Phase, run: ScoredRun) => void {
  const logRun = createRunLogger(owner)
  return (phase, run) => {
    if (phase !== 'ended' || !logRun(run)) return
    view.logbook(owner.logbook)
    view.bests(owner.best)
  }
}
