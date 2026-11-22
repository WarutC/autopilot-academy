// The About page: who made Autopilot Academy, with whom, where its source
// lives and its license. It is shown in place of the flight; Close or Escape
// asks the caller to return to it.

export const ABOUT_TITLE = 'About'
export const ABOUT_INTRO = 'Autopilot Academy is a cartoon flight lesson for control engineering classes.'
export const MADE_BY = 'Made by'
export const AUTHOR_NAME = 'Warut.C'
export const AVATAR_SRC = '/about/whale-avatar.png'
export const AVATAR_ALT = "Warut.C's GitHub avatar, a whale"
export const WITH = 'With'
export const COMPANY_NAME = 'Ruk-Com Co., Ltd.'
export const LOGO_SRC = '/about/logo-ruk-com.svg'
export const LOGO_ALT = 'Ruk-Com Cloud logo'
export const SOURCE_URL = 'https://github.com/WarutC/autopilot-academy'
export const SOURCE_TEXT = 'github.com/WarutC/autopilot-academy'
export const LICENSE_TEXT = 'Free and open source under the MIT License.'
export const CLOSE_TEXT = 'Close'

export interface AboutOptions {
  /** Called on Close or Escape; the caller closes the page and restores the address. */
  onClose(): void
}

export interface About {
  /** The page, hidden until opened; the caller inserts it after the flight. */
  readonly element: HTMLElement
  readonly isOpen: boolean
  /** Shows the page and focuses its heading; `opener` gets focus back on close. */
  open(opener: HTMLElement | null): void
  /** Hides the page and returns focus to the opener if it is still in the page. */
  close(): void
}

function el<K extends keyof HTMLElementTagNameMap>(
  doc: Document,
  tag: K,
  className: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const e = doc.createElement(tag)
  if (className) e.className = className
  if (text !== undefined) e.textContent = text
  return e
}

function image(doc: Document, className: string, src: string, alt: string, width?: number, height?: number): HTMLImageElement {
  const img = el(doc, 'img', className)
  img.src = src
  img.alt = alt
  if (width !== undefined) img.width = width
  if (height !== undefined) img.height = height
  return img
}

export function createAbout(doc: Document, { onClose }: AboutOptions): About {
  const element = el(doc, 'main', 'about')
  element.hidden = true
  element.setAttribute('aria-labelledby', 'about-title')

  const card = el(doc, 'section', 'card about-card')
  const title = el(doc, 'h2', 'card-header', ABOUT_TITLE)
  title.id = 'about-title'
  title.tabIndex = -1

  const body = el(doc, 'div', 'card-body about-body')
  const intro = el(doc, 'p', 'about-intro', ABOUT_INTRO)

  const credits = el(doc, 'div', 'about-credits')

  const author = el(doc, 'div', 'about-credit')
  author.append(
    el(doc, 'p', 'about-credit-label', MADE_BY),
    image(doc, 'about-avatar', AVATAR_SRC, AVATAR_ALT, 96, 96),
    el(doc, 'p', 'about-credit-name', AUTHOR_NAME),
  )

  const company = el(doc, 'div', 'about-credit')
  const plate = el(doc, 'div', 'about-logo-plate')
  plate.append(image(doc, 'about-logo', LOGO_SRC, LOGO_ALT))
  company.append(el(doc, 'p', 'about-credit-label', WITH), el(doc, 'p', 'about-credit-name', COMPANY_NAME), plate)

  credits.append(author, company)

  const sourceLine = el(doc, 'p', 'about-source')
  const link = el(doc, 'a', 'about-source-link', SOURCE_TEXT)
  link.href = SOURCE_URL
  link.target = '_blank'
  link.rel = 'noopener noreferrer'
  sourceLine.append(link)

  const license = el(doc, 'p', 'about-license', LICENSE_TEXT)

  const close = el(doc, 'button', 'btn btn-primary about-close', CLOSE_TEXT)
  close.type = 'button'
  close.addEventListener('click', () => onClose())

  body.append(intro, credits, sourceLine, license, close)
  card.append(title, body)
  element.append(card)

  let isOpen = false
  let opener: HTMLElement | null = null

  doc.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || !isOpen) return
    event.preventDefault()
    onClose()
  })

  return {
    element,
    get isOpen() {
      return isOpen
    },
    open(from) {
      if (!isOpen) opener = from
      isOpen = true
      element.hidden = false
      title.focus()
    },
    close() {
      if (!isOpen) return
      isOpen = false
      element.hidden = true
      const back = opener
      opener = null
      if (back?.isConnected) back.focus()
    },
  }
}
