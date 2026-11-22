// Opens and closes the About page in place of the flight: pauses a running
// flight, hides the app, closes the drawer, picks where focus goes back, and
// on Close puts the address back on the lesson route. The DOM pieces, the
// router and the redraw come in from the caller, so this runs without a page.

import type { About } from './about.ts'
import type { Drawer } from './drawer.ts'
import type { Router } from './router.ts'

/** How About was reached: by the address changing in the page, or by loading the page at `#/about`. */
export type AboutSource = 'address' | 'load'

export interface AboutControllerOptions {
  readonly about: Pick<About, 'isOpen' | 'open' | 'close'>
  readonly drawer: Pick<Drawer, 'isOpen' | 'toggle' | 'closeDrawer'>
  /** The flight, hidden while About shows. */
  readonly app: Pick<HTMLElement, 'hidden'>
  readonly router: Pick<Router, 'restore'>
  readonly history: { back(): void }
  /** Releases the stick and pauses a running flight. */
  pause(): void
  /** Redraws everything on the next frame. */
  redraw(): void
  /** The lesson and course on screen. */
  current(): { readonly lesson: string; readonly course: number }
  /** The focused element, or null for the body. */
  focused(): HTMLElement | null
  /** Where focus goes on close when the opener is gone or hidden, first visible wins. */
  fallbacks(): readonly (HTMLElement | null)[]
}

/** What a click on an About link carries. */
export type LinkClick = Pick<MouseEvent, 'button' | 'metaKey' | 'ctrlKey' | 'shiftKey' | 'altKey' | 'defaultPrevented'>

export interface AboutController {
  /** Shows About; `address` when the address changed to it, `load` for a page loaded there. */
  open(source: AboutSource): void
  /** Hides About after the address left it; the address is already right. */
  close(): void
  /** Close or Escape: hides About and takes the address back to the lesson route. */
  dismiss(): void
  /** Records `link` as the opener for a plain primary click, which Safari does not focus. */
  linkClicked(link: HTMLElement, event: LinkClick): void
  /** Whether a game key should be ignored: true while About shows. */
  blocksGameKeys(): boolean
}

export function createAboutController(o: AboutControllerOptions): AboutController {
  let clicked: HTMLElement | null = null
  /** Whether the entry before About in the session history is the lesson route it was opened from. */
  let cameFromPage = false

  function close(): void {
    if (!o.about.isOpen) return
    clicked = null
    // Shown first, so the opener inside the flight can take focus back.
    o.app.hidden = false
    o.about.close(o.fallbacks())
    o.redraw()
  }

  return {
    open(source) {
      if (o.about.isOpen) return
      const link = clicked
      clicked = null
      cameFromPage = source === 'address'
      const focused = o.focused()
      // From the open drawer focus goes back to Cards, since the drawer is closed by then.
      const opener = o.drawer.isOpen ? o.drawer.toggle : (link ?? focused)
      o.drawer.closeDrawer()
      o.pause()
      o.app.hidden = true
      o.about.open(opener)
    },
    close,
    dismiss() {
      if (!o.about.isOpen) return
      // Back returns to the entry About was opened from, so Back is never a dead
      // step; a page loaded at About has no such entry, so its address is replaced.
      if (cameFromPage) o.history.back()
      else {
        const { lesson, course } = o.current()
        o.router.restore(lesson, course)
      }
      close()
    },
    linkClicked(link, event) {
      const plain = event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey
      if (plain && !event.defaultPrevented) clicked = link
    },
    blocksGameKeys() {
      return o.about.isOpen
    },
  }
}
