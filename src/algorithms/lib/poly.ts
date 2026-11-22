// Polynomial helpers for pole analysis: the roots of a real polynomial and its
// value at a complex point. Modules use `polyRoots` to turn a closed-loop
// characteristic polynomial into the poles their `analysis` reports.
//
// This folder is not scanned by the algorithm registry, so helpers here are
// never mistaken for algorithm modules.

import type { Complex } from '../index.ts'

/** Iteration cap for Durand–Kerner; repeated roots converge slowly, so it is generous. */
const MAX_ITERATIONS = 1000
/** Relative imaginary part below which a root counts as real. */
const REAL_SNAP = 1e-9

function mul(a: Complex, b: Complex): Complex {
  return { re: a.re * b.re - a.im * b.im, im: a.re * b.im + a.im * b.re }
}

function div(a: Complex, b: Complex): Complex {
  const d = b.re * b.re + b.im * b.im
  return { re: (a.re * b.re + a.im * b.im) / d, im: (a.im * b.re - a.re * b.im) / d }
}

/**
 * Evaluates the polynomial `coeffs` (highest power first) at `s` with Horner's
 * rule. An empty list is the zero polynomial.
 */
export function polyAt(coeffs: readonly number[], s: Complex): Complex {
  let acc: Complex = { re: 0, im: 0 }
  for (const c of coeffs) {
    const m = mul(acc, s)
    acc = { re: m.re + c, im: m.im }
  }
  return acc
}

/** Snaps near-real roots to the real axis and makes complex pairs exact conjugates. */
function tidy(roots: Complex[]): Complex[] {
  const scale = Math.max(1, ...roots.map((r) => Math.hypot(r.re, r.im)))
  const snapped = roots.map((r) => (Math.abs(r.im) < REAL_SNAP * scale ? { re: r.re, im: 0 } : r))
  const upper = snapped.filter((r) => r.im > 0)
  const lower = snapped.filter((r) => r.im < 0)
  const out = snapped.filter((r) => r.im === 0)
  for (const u of upper) {
    let best = -1
    let bestDist = Infinity
    lower.forEach((l, i) => {
      const d = Math.hypot(u.re - l.re, u.im + l.im)
      if (d < bestDist) {
        bestDist = d
        best = i
      }
    })
    if (best < 0) {
      out.push(u)
      continue
    }
    const [l] = lower.splice(best, 1)
    const re = (u.re + l.re) / 2
    const im = (u.im - l.im) / 2
    out.push({ re, im }, { re, im: -im })
  }
  out.push(...lower)
  return out
}

/**
 * The complex roots of the real polynomial `coeffs`, highest power first, by
 * the Durand–Kerner iteration. Leading zeros are dropped and trailing zeros
 * give exact roots at 0. Roots whose imaginary part is below 1e-9 times the
 * largest root magnitude (at least 1) are made real, and complex pairs are
 * made exact conjugates. The result is sorted by real part, then imaginary
 * part. A constant (or empty) polynomial has no roots; any non-finite
 * coefficient gives `[]`.
 *
 * @example polyRoots([1, -3, 2]) // [{re: 1, im: 0}, {re: 2, im: 0}]
 */
export function polyRoots(coeffs: readonly number[]): Complex[] {
  if (!coeffs.every(Number.isFinite)) return []
  let start = 0
  while (start < coeffs.length && coeffs[start] === 0) start++
  let end = coeffs.length
  let zeros = 0
  while (end > start + 1 && coeffs[end - 1] === 0) {
    end--
    zeros++
  }
  const trimmed = coeffs.slice(start, end)
  const roots: Complex[] = []
  for (let i = 0; i < zeros; i++) roots.push({ re: 0, im: 0 })
  const n = trimmed.length - 1
  if (n >= 1) {
    const monic = trimmed.map((c) => c / trimmed[0])
    if (n === 1) {
      roots.push({ re: -monic[1], im: 0 })
    } else {
      // Start on a circle that holds every root (Cauchy's bound), at angles off the axes.
      const radius = 1 + Math.max(...monic.slice(1).map(Math.abs))
      let z: Complex[] = Array.from({ length: n }, (_, k) => {
        const angle = (2 * Math.PI * k) / n + 0.4
        return { re: radius * Math.cos(angle), im: radius * Math.sin(angle) }
      })
      for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
        let change = 0
        const next = z.map((zi, i) => {
          let denom: Complex = { re: 1, im: 0 }
          z.forEach((zj, j) => {
            if (j !== i) denom = mul(denom, { re: zi.re - zj.re, im: zi.im - zj.im })
          })
          const step = div(polyAt(monic, zi), denom)
          if (!Number.isFinite(step.re) || !Number.isFinite(step.im)) return zi
          change = Math.max(change, Math.hypot(step.re, step.im))
          return { re: zi.re - step.re, im: zi.im - step.im }
        })
        z = next
        const size = Math.max(1, ...z.map((r) => Math.hypot(r.re, r.im)))
        if (change <= 1e-15 * size) break
      }
      roots.push(...z)
    }
  }
  // `+ 0` turns -0 into 0, so a root at the origin never prints as "−0".
  return tidy(roots)
    .map((r) => ({ re: r.re + 0, im: r.im + 0 }))
    .sort((a, b) => a.re - b.re || a.im - b.im)
}
