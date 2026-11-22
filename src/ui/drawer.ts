// The cards drawer for phone landscape: a Cards button in the toolbar opens
// the card column as a panel from the right, over a scrim. Close, a scrim tap
// or Escape closes it. Outside phone landscape the column sits in the page and
// the drawer controls are not displayed.

/** Phone landscape: phones on their side are 340–430 px tall; laptops and projectors are taller. */
export const PHONE_LANDSCAPE = '(orientation: landscape) and (max-height: 540px)'

export interface DrawerOptions {
  /** The card column; it needs an id for `aria-controls`. */
  readonly panel: HTMLElement
  /** Called once each time the drawer opens. */
  onOpen(): void
}

export interface Drawer {
  /** The Cards toolbar button. */
  readonly toggle: HTMLButtonElement
  /** The Close button, for the caller to prepend to the panel. */
  readonly close: HTMLButtonElement
  /** The scrim behind the open panel, for the caller to append to the page. */
  readonly scrim: HTMLElement
  readonly isOpen: boolean
  open(): void
  /** Closes the drawer; focus returns to Cards only if it was inside the panel. */
  closeDrawer(): void
  /** Inactive outside phone landscape: closes the drawer without moving focus, and ignores opens. */
  setActive(active: boolean): void
}

const OPEN_CLASS = 'drawer-open'

function button(doc: Document, className: string, text: string): HTMLButtonElement {
  const b = doc.createElement('button')
  b.type = 'button'
  b.className = className
  b.textContent = text
  return b
}

export function createDrawer(doc: Document, { panel, onOpen }: DrawerOptions): Drawer {
  const toggle = button(doc, 'btn drawer-toggle', 'Cards')
  toggle.setAttribute('aria-controls', panel.id)
  toggle.setAttribute('aria-expanded', 'false')
  const close = button(doc, 'btn drawer-close', 'Close')
  const scrim = doc.createElement('div')
  scrim.className = 'drawer-scrim'
  scrim.hidden = true

  let isOpen = false
  let active = true

  function setOpen(next: boolean): void {
    isOpen = next
    panel.classList.toggle(OPEN_CLASS, next)
    scrim.hidden = !next
    toggle.setAttribute('aria-expanded', String(next))
  }

  function open(): void {
    if (isOpen || !active) return
    setOpen(true)
    onOpen()
    close.focus()
  }

  /** `inside` returns focus to Cards only if it was in the panel; `always` returns it regardless. */
  function shut(returnFocus: 'inside' | 'always' | 'never'): void {
    if (!isOpen) return
    const focusInside = panel.contains(doc.activeElement)
    setOpen(false)
    if (returnFocus === 'always' || (returnFocus === 'inside' && focusInside)) toggle.focus()
  }

  toggle.addEventListener('click', () => (isOpen ? shut('inside') : open()))
  close.addEventListener('click', () => shut('inside'))
  // Pressing the scrim blurs the focused control first, so it always hands focus back to Cards.
  scrim.addEventListener('click', () => shut('always'))
  doc.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || !isOpen) return
    event.preventDefault()
    shut('inside')
  })

  return {
    toggle,
    close,
    scrim,
    get isOpen() {
      return isOpen
    },
    open,
    closeDrawer: () => shut('inside'),
    setActive(next) {
      active = next
      if (!next) shut('never')
    },
  }
}
