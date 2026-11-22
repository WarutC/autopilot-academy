// Pure helpers for the parameter rows: formatting, clamping, the slider
// mapping and the labels recorder markers carry.

import type { ParamSpec, Params } from '../algorithms/index.ts'

/** Decimal places in `step`, such as 3 for 0.005; 0 for a whole or invalid step. */
export function stepDecimals(step: number): number {
  if (!(step > 0) || !Number.isFinite(step)) return 0
  for (let d = 0; d <= 10; d++) {
    const scaled = step * 10 ** d
    if (Math.abs(scaled - Math.round(scaled)) < 1e-9 * Math.max(1, scaled)) return d
  }
  return 10
}

/** `v` with the decimals of `spec.step`, trailing zeros trimmed: "0", "0.05". */
export function formatValue(spec: ParamSpec, v: number): string {
  if (!Number.isFinite(v)) return String(v)
  const text = v.toFixed(stepDecimals(spec.step))
  const trimmed = text.includes('.') ? text.replace(/\.?0+$/, '') : text
  return trimmed === '-0' ? '0' : trimmed
}

/** How a change reads on a recorder marker, such as "Kd 0 → 0.05"; toggles read on and off. */
export function changeLabel(spec: ParamSpec, from: number, to: number): string {
  const show = (v: number) => (spec.toggle ? (v ? 'on' : 'off') : formatValue(spec, v))
  return `${spec.key} ${show(from)} → ${show(to)}`
}

/**
 * `v` clamped to the spec's range and rounded to the nearest multiple of
 * `step` from `min`, as a range input snaps; toggles
 * become 0 or 1. NaN gives undefined, so the caller can keep the old value.
 */
export function clampValue(spec: ParamSpec, v: number): number | undefined {
  if (typeof v !== 'number' || Number.isNaN(v)) return undefined
  if (spec.toggle) return v ? 1 : 0
  const clamped = Math.min(spec.max, Math.max(spec.min, v))
  const snapped = spec.step > 0 ? spec.min + Math.round((clamped - spec.min) / spec.step) * spec.step : clamped
  // Trim float noise with the step's decimals, then keep it in range.
  const factor = 10 ** stepDecimals(spec.step)
  const rounded = Math.round(snapped * factor) / factor
  return Math.min(spec.max, Math.max(spec.min, rounded))
}

/** True when the slider maps log10 of the value. */
export function isLogSlider(spec: ParamSpec): boolean {
  return spec.log === true && spec.min > 0
}

/** The range input's min, max and step for `spec`. */
export function sliderRange(spec: ParamSpec): { min: number; max: number; step: number | 'any' } {
  if (isLogSlider(spec)) return { min: Math.log10(spec.min), max: Math.log10(spec.max), step: 'any' }
  return { min: spec.min, max: spec.max, step: spec.step }
}

/** Slider position for value `v`. */
export function toSlider(spec: ParamSpec, v: number): number {
  return isLogSlider(spec) ? Math.log10(Math.min(spec.max, Math.max(spec.min, v))) : v
}

/** Value for slider position `s`, clamped and rounded; undefined for NaN. */
export function fromSlider(spec: ParamSpec, s: number): number | undefined {
  return clampValue(spec, isLogSlider(spec) ? 10 ** s : s)
}

export interface ParamChange {
  readonly key: string
  /** The default the key goes back to. */
  readonly value: number
  readonly label: string
}

/** The keys whose value differs from the default, with the change back to it. */
export function resetChanges(specs: readonly ParamSpec[], params: Params): ParamChange[] {
  const changes: ParamChange[] = []
  for (const spec of specs) {
    const current = params[spec.key]
    if (current === undefined || current === spec.default) continue
    changes.push({ key: spec.key, value: spec.default, label: changeLabel(spec, current, spec.default) })
  }
  return changes
}

/** A typed number; a comma counts as the decimal point, as phone keypads type it. Blank or unparsable text is NaN. */
export function parseNumber(text: string): number {
  const trimmed = text.trim().replace(',', '.')
  return trimmed === '' ? NaN : Number(trimmed)
}
