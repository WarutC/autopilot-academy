// The logbook model: the newest finished flights and the best score, kept as
// plain data. Rows and eligibility come from `sim/scoring` alone.

import { isBestEligible, summarize, type LogEntry, type ScoredRun } from '../sim/scoring.ts'

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
