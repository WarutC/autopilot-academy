// The Pole readout card under the Autopilot card: an s-plane canvas beside a
// text list of the closed-loop poles, the computed gains, or the look-ahead
// time. Built from `AlgorithmAnalysis` alone, so any module that reports one
// gets the card; the page paints the canvas with `render/splane`.

import type { AlgorithmAnalysis, Complex } from '../algorithms/index.ts'

/** What the card shows for one analysis. */
export interface ReadoutContent {
  /** False when there is nothing to show; the whole card is hidden. */
  readonly visible: boolean
  /** True when the s-plane canvas is shown, which is when there are poles. */
  readonly plane: boolean
  /** One line per real pole or conjugate pair, such as "−0.25 ± 1.39j". */
  readonly poles: readonly string[]
  /** One line per gain, such as "k1 = 0.200". */
  readonly gains: readonly string[]
  /** The look-ahead sentence, if the analysis has one. */
  readonly lookahead?: string
}

const MINUS = '−'

/** `x` to `digits` decimals with a Unicode minus; a value that rounds to zero is unsigned. */
export function formatNumber(x: number, digits: number): string {
  const text = x.toFixed(digits)
  if (Number(text) === 0) return (0).toFixed(digits)
  return text.replace('-', MINUS)
}

/** Lines for `poles`: a conjugate pair as "re ± imj", a real pole as "re", a lone complex pole as "re + imj" or "re − imj". */
function poleLines(poles: readonly Complex[]): string[] {
  const finite = poles.filter((p) => Number.isFinite(p.re) && Number.isFinite(p.im))
  const scale = Math.max(1, ...finite.map((p) => Math.hypot(p.re, p.im)))
  const tol = 1e-9 * scale
  const used = new Set<number>()
  const lines: string[] = []
  finite.forEach((p, i) => {
    if (used.has(i)) return
    used.add(i)
    const re = formatNumber(p.re, 2)
    if (p.im === 0) {
      lines.push(re)
      return
    }
    const partner = finite.findIndex(
      (q, j) => !used.has(j) && Math.abs(q.re - p.re) <= tol && Math.abs(q.im + p.im) <= tol,
    )
    const im = formatNumber(Math.abs(p.im), 2)
    if (partner >= 0) {
      used.add(partner)
      lines.push(`${re} ± ${im}j`)
    } else {
      lines.push(`${re} ${p.im < 0 ? MINUS : '+'} ${im}j`)
    }
  })
  return lines
}

/** What the readout shows for `analysis`; pure. */
export function readoutContent(analysis: AlgorithmAnalysis | undefined): ReadoutContent {
  const poles = analysis?.poles ? poleLines(analysis.poles) : []
  const gains = analysis?.gains
    ? Object.entries(analysis.gains).map(([name, value]) => `${name} = ${formatNumber(value, 3)}`)
    : []
  const ahead = analysis?.lookahead
  let lookahead: string | undefined
  if (typeof ahead === 'number' && Number.isFinite(ahead)) {
    lookahead =
      ahead > 0
        ? `Looks ${formatNumber(ahead, 1)} s ahead`
        : 'Preview off: assumes the target stays where it is now.'
  }
  const plane = poles.length > 0
  return {
    visible: plane || gains.length > 0 || lookahead !== undefined,
    plane,
    poles,
    gains,
    ...(lookahead !== undefined ? { lookahead } : {}),
  }
}

export interface PoleReadout {
  readonly element: HTMLElement
  /** The s-plane canvas; hidden when there are no poles. */
  readonly canvas: HTMLCanvasElement
  /** Shows `analysis`, or hides the card when there is nothing to show. */
  update(analysis: AlgorithmAnalysis | undefined): void
}

export function createPoleReadout(doc: Document): PoleReadout {
  const element = doc.createElement('section')
  element.className = 'card pole-readout'
  element.setAttribute('aria-labelledby', 'pole-readout-title')
  element.hidden = true

  const header = doc.createElement('h2')
  header.className = 'card-header'
  header.id = 'pole-readout-title'
  header.textContent = 'Pole readout'

  const body = doc.createElement('div')
  body.className = 'card-body pole-readout-body'

  const canvas = doc.createElement('canvas')
  canvas.className = 'pole-readout-plot'
  canvas.setAttribute('role', 'img')
  canvas.setAttribute('aria-label', 'Closed-loop poles on the s-plane')
  canvas.hidden = true

  const text = doc.createElement('div')
  text.className = 'pole-readout-text'

  body.append(canvas, text)
  element.append(header, body)

  function list(title: string, lines: readonly string[]): HTMLElement[] {
    const heading = doc.createElement('h3')
    heading.className = 'pole-readout-heading'
    heading.textContent = title
    const ul = doc.createElement('ul')
    ul.className = 'pole-readout-list'
    for (const line of lines) {
      const li = doc.createElement('li')
      li.textContent = line
      ul.append(li)
    }
    return [heading, ul]
  }

  return {
    element,
    canvas,
    update(analysis) {
      const content = readoutContent(analysis)
      element.hidden = !content.visible
      canvas.hidden = !content.plane
      const nodes: HTMLElement[] = []
      if (content.poles.length > 0) nodes.push(...list('Closed-loop poles', content.poles))
      if (content.gains.length > 0) nodes.push(...list('Gains', content.gains))
      if (content.lookahead !== undefined) {
        const p = doc.createElement('p')
        p.className = 'pole-readout-lookahead'
        p.textContent = content.lookahead
        nodes.push(p)
      }
      text.replaceChildren(...nodes)
    },
  }
}
