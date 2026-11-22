// The Logbook card: the newest flights as a table with tags, or one line when
// there are none. Plain DOM through an injected document.

import type { LogEntry } from '../sim/scoring.ts'

/** The line shown when there are no rows. */
export const EMPTY_LOGBOOK =
  "Finished flights appear here. Best scores only count finished Autopilot or Manual flights you didn't retune."

const DASH = '—'

/** `x` to `digits` decimals, or a dash when it is not finite. */
function fixed(x: number, digits: number): string {
  return Number.isFinite(x) ? x.toFixed(digits) : DASH
}

/** `rings/ringsTotal`, with a dash for a non-finite part. */
function ringsText(row: LogEntry): string {
  const n = Number.isFinite(row.rings) ? String(row.rings) : DASH
  const total = Number.isFinite(row.ringsTotal) ? String(row.ringsTotal) : DASH
  return `${n}/${total}`
}

const COLUMNS: ReadonlyArray<{ readonly label: string; readonly title?: string }> = [
  { label: 'Autopilot' },
  { label: 'Score' },
  { label: 'Rings' },
  { label: 'IAE', title: 'Integral of absolute altitude error' },
  { label: 'Energy', title: 'Integral of u squared' },
]

export interface LogbookCard {
  readonly element: HTMLElement
  /** Shows `rows` as a table, or the empty line when there are none. */
  update(rows: readonly LogEntry[]): void
}

export function createLogbookCard(doc: Document, nameOf: (lesson: string) => string | undefined): LogbookCard {
  const element = doc.createElement('section')
  element.className = 'card logbook'
  element.setAttribute('aria-labelledby', 'logbook-title')

  const header = doc.createElement('h2')
  header.className = 'card-header'
  header.id = 'logbook-title'
  header.textContent = 'Logbook'

  const body = doc.createElement('div')
  body.className = 'card-body logbook-body'
  // The table can scroll sideways on a narrow screen, so the body takes focus to scroll by keyboard.
  body.tabIndex = 0
  body.setAttribute('role', 'region')
  body.setAttribute('aria-labelledby', 'logbook-title')
  element.append(header, body)

  function cell(tag: 'td' | 'th', text: string): HTMLElement {
    const el = doc.createElement(tag)
    el.textContent = text
    return el
  }

  function table(rows: readonly LogEntry[]): HTMLElement {
    const tbl = doc.createElement('table')
    tbl.className = 'logbook-table'
    const thead = doc.createElement('thead')
    const headRow = doc.createElement('tr')
    for (const col of COLUMNS) {
      const th = cell('th', col.label)
      th.setAttribute('scope', 'col')
      if (col.title) th.setAttribute('title', col.title)
      headRow.append(th)
    }
    thead.append(headRow)

    const tbody = doc.createElement('tbody')
    for (const row of rows) {
      const tr = doc.createElement('tr')
      const name = cell('td', '')
      name.className = 'logbook-name'
      name.append(nameOf(row.lesson) || row.lesson)
      for (const t of row.tags) {
        const span = doc.createElement('span')
        span.className = 'logbook-tag'
        span.textContent = t
        name.append(' ', span)
      }
      tr.append(
        name,
        cell('td', fixed(row.points, 1)),
        cell('td', ringsText(row)),
        cell('td', fixed(row.iae, 0)),
        cell('td', fixed(row.energy, 1)),
      )
      tbody.append(tr)
    }
    tbl.append(thead, tbody)
    return tbl
  }

  function update(rows: readonly LogEntry[]): void {
    if (rows.length === 0) {
      const p = doc.createElement('p')
      p.className = 'logbook-empty'
      p.textContent = EMPTY_LOGBOOK
      body.replaceChildren(p)
    } else {
      body.replaceChildren(table(rows))
    }
  }

  update([])
  return { element, update }
}
