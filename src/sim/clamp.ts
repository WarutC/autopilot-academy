export function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return Math.min(max, Math.max(min, 0))
  return Math.min(max, Math.max(min, value))
}
