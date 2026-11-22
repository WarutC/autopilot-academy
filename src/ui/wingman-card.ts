// The Wingman card: a select of "No wingman" and every lesson that can fly
// Autopilot. The wingman flies the same course and conditions beside the
// player, on its own saved parameters. The choice is locked while a run flies.

import type { AlgorithmModule, Params } from '../algorithms/index.ts'
import type { RunPlayer } from '../sim/run.ts'
import { inFlight, type Phase } from './flight.ts'

/** The select value for no wingman. */
export const NO_WINGMAN = 'none'

/** The lessons that can fly as the wingman: those offering Autopilot, in registry order. */
export function wingmanChoices<M extends AlgorithmModule>(modules: readonly M[]): M[] {
  return modules.filter((m) => m.modes.includes('autopilot'))
}

/** The wingman a run flies: lesson `id` with its saved params, or undefined for none or an id that cannot fly. */
export function wingmanPlayer(
  modules: readonly AlgorithmModule[],
  id: string | null,
  params: (id: string) => Params,
): RunPlayer | undefined {
  if (id === null) return undefined
  const algorithm = wingmanChoices(modules).find((m) => m.id === id)
  return algorithm ? { algorithm, params: params(algorithm.id) } : undefined
}

export interface WingmanCardHandlers {
  /** The player picked another wingman, or none. */
  change(id: string | null): void
}

export interface WingmanCard {
  readonly element: HTMLElement
  /** Locks the select while a run flies or is paused. */
  setPhase(phase: Phase): void
}

export function createWingmanCard(
  doc: Document,
  modules: readonly AlgorithmModule[],
  selected: string | null,
  handlers: WingmanCardHandlers,
): WingmanCard {
  const element = doc.createElement('section')
  element.className = 'card wingman-card'
  element.setAttribute('aria-labelledby', 'wingman-card-title')

  const header = doc.createElement('h2')
  header.className = 'card-header'
  header.id = 'wingman-card-title'
  header.textContent = 'Wingman'

  const body = doc.createElement('div')
  body.className = 'card-body'

  const select = doc.createElement('select')
  select.className = 'wingman-select'
  select.id = 'wingman-select'
  select.setAttribute('aria-label', 'Wingman autopilot')

  const option = (value: string, text: string): HTMLOptionElement => {
    const o = doc.createElement('option')
    o.value = value
    o.textContent = text
    return o
  }
  const choices = wingmanChoices(modules)
  select.append(option(NO_WINGMAN, 'No wingman'), ...choices.map((m) => option(m.id, m.name)))
  let current = selected !== null && choices.some((m) => m.id === selected) ? selected : NO_WINGMAN
  select.value = current

  select.addEventListener('change', () => {
    const value = select.value
    if (value === current) return
    current = value
    handlers.change(value === NO_WINGMAN ? null : value)
  })

  const note = doc.createElement('p')
  note.className = 'wingman-note'
  note.textContent = 'A second autopilot flies the same course, in the same conditions, using its own saved parameters.'

  body.append(select, note)
  element.append(header, body)

  return {
    element,
    setPhase(phase) {
      const disabled = inFlight(phase)
      if (select.disabled !== disabled) select.disabled = disabled
    },
  }
}
