// Pauses the flight when the player looks away: the tab is hidden or the
// phone rotates. A rotation is any change of the portrait media query, which
// covers both the orientation event and a resize that flips the aspect.

/** The window members the watcher uses. */
export type AutoPauseWindow = Pick<Window, 'matchMedia'> & {
  readonly document: Pick<Document, 'hidden' | 'addEventListener' | 'removeEventListener'>
}

/** Calls `pause` when the tab turns hidden or the orientation flips; returns an unsubscribe function. */
export function watchAutoPause(win: AutoPauseWindow, pause: () => void): () => void {
  const doc = win.document
  const onVisibility = () => {
    if (doc.hidden) pause()
  }
  const onRotate = () => pause()
  const portrait = win.matchMedia('(orientation: portrait)')
  doc.addEventListener('visibilitychange', onVisibility)
  portrait.addEventListener('change', onRotate)
  return () => {
    doc.removeEventListener('visibilitychange', onVisibility)
    portrait.removeEventListener('change', onRotate)
  }
}
