// Pauses the flight when the player looks away: the tab is hidden or the
// phone rotates. A rotation is a change of the portrait media query on a
// coarse pointer; on a desktop the same change is only a window resize.

/** The window members the watcher uses. */
export type AutoPauseWindow = Pick<Window, 'matchMedia'> & {
  readonly document: Pick<Document, 'hidden' | 'addEventListener' | 'removeEventListener'>
}

/** Calls `pause` when the tab turns hidden or a touch device's orientation flips; returns an unsubscribe function. */
export function watchAutoPause(win: AutoPauseWindow, pause: () => void): () => void {
  const doc = win.document
  const onVisibility = () => {
    if (doc.hidden) pause()
  }
  const coarse = win.matchMedia('(pointer: coarse)')
  const onRotate = () => {
    if (coarse.matches) pause()
  }
  const portrait = win.matchMedia('(orientation: portrait)')
  doc.addEventListener('visibilitychange', onVisibility)
  portrait.addEventListener('change', onRotate)
  return () => {
    doc.removeEventListener('visibilitychange', onVisibility)
    portrait.removeEventListener('change', onRotate)
  }
}
