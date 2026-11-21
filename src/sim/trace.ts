// The recorder's writable trace buffer, preallocated once per plane.

/** A plane's trace while it is recorded; the owner writes rows and moves `length`. */
export interface TraceBuffer {
  length: number
  readonly t: Float64Array
  readonly ref: Float64Array
  readonly h: Float64Array
  readonly hMeas: Float64Array
  readonly hEst: Float64Array
  readonly u: Float64Array
}

/** An empty trace with room for `rows` rows in every column. */
export function createTrace(rows: number): TraceBuffer {
  return {
    length: 0,
    t: new Float64Array(rows),
    ref: new Float64Array(rows),
    h: new Float64Array(rows),
    hMeas: new Float64Array(rows),
    hEst: new Float64Array(rows),
    u: new Float64Array(rows),
  }
}
