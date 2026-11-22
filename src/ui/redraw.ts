// What the next animation frame has to redraw: the scene and recorder after
// any change or simulation step, and the Pole readout only when asked (its
// lesson, its params, the theme, its size, the pixel ratio or a font load),
// since rebuilding it every frame would waste the frame budget.

export interface Redraw {
  /** Redraws the scene and recorder on the next frame. */
  request(): void
  /** Also rebuilds the Pole readout on the next frame: after a parameter, lesson, theme, size, pixel-ratio or font change. */
  requestReadout(): void
  /** Whether this frame draws: after a request (taken, so it draws once) or when the run `stepped`. */
  takeDraw(stepped?: boolean): boolean
  /** True once per readout request: the draw should rebuild the readout. */
  takeReadout(): boolean
}

/** Both start pending, so the first frame draws everything. */
export function createRedraw(): Redraw {
  let draw = true
  let readout = true
  return {
    request() {
      draw = true
    },
    requestReadout() {
      readout = true
      draw = true
    },
    takeDraw(stepped = false) {
      const pending = draw || stepped
      draw = false
      return pending
    },
    takeReadout() {
      const pending = readout
      readout = false
      return pending
    },
  }
}
