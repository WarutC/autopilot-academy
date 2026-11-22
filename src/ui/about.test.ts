import { describe, expect, it, vi } from 'vitest'
import layoutCss from '../styles/layout.css?raw'
import { contrast, ruleBody as cssRuleBody, themeTokens } from '../styles/css-test-helpers.ts'
import tokensCss from '../styles/tokens.css?raw'
import {
  ABOUT_INTRO,
  AUTHOR_NAME,
  AVATAR_ALT,
  AVATAR_SRC,
  COMPANY_NAME,
  createAbout,
  LICENSE_TEXT,
  LOGO_ALT,
  LOGO_SRC,
  SOURCE_TEXT,
  SOURCE_URL,
} from './about.ts'

type Listener = (event: FakeEvent) => void

interface FakeEvent {
  key?: string
  defaultPrevented: boolean
  preventDefault(): void
}

const event = (key?: string): FakeEvent => ({
  key,
  defaultPrevented: false,
  preventDefault() {
    this.defaultPrevented = true
  },
})

class FakeTarget {
  readonly listeners = new Map<string, Listener[]>()
  addEventListener(type: string, listener: Listener): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener])
  }
  fire(type: string, e: FakeEvent = event()): FakeEvent {
    for (const l of this.listeners.get(type) ?? []) l(e)
    return e
  }
}

class FakeDocument extends FakeTarget {
  activeElement: FakeElement | null = null
  createElement(tag: string): FakeElement {
    return new FakeElement(this, tag)
  }
}

class FakeElement extends FakeTarget {
  id = ''
  className = ''
  type = ''
  hidden = false
  tabIndex = 0
  textContent = ''
  src = ''
  alt = ''
  width = 0
  height = 0
  href = ''
  target = ''
  rel = ''
  isConnected = true
  readonly children: FakeElement[] = []
  readonly attrs = new Map<string, string>()
  readonly doc: FakeDocument
  readonly tag: string
  constructor(doc: FakeDocument, tag: string) {
    super()
    this.doc = doc
    this.tag = tag
  }
  append(...items: FakeElement[]): void {
    this.children.push(...items)
  }
  setAttribute(name: string, value: string): void {
    this.attrs.set(name, value)
  }
  getAttribute(name: string): string | null {
    return this.attrs.get(name) ?? null
  }
  focus(): void {
    this.doc.activeElement = this
  }
  click(): void {
    this.fire('click')
  }
  /** Every descendant, depth first. */
  all(): FakeElement[] {
    return this.children.flatMap((c) => [c, ...c.all()])
  }
  find(className: string): FakeElement {
    const found = this.all().find((e) => e.className.split(' ').includes(className))
    if (!found) throw new Error(`no .${className}`)
    return found
  }
  text(): string {
    return [this.textContent, ...this.children.map((c) => c.text())].filter(Boolean).join(' ')
  }
}

function setup() {
  const doc = new FakeDocument()
  const onClose = vi.fn()
  const about = createAbout(doc as unknown as Document, { onClose })
  const element = about.element as unknown as FakeElement
  return { doc, onClose, about, element }
}

describe('createAbout', () => {
  it('builds a hidden main labelled by its card heading', () => {
    const { element } = setup()
    expect(element.tag).toBe('main')
    expect(element.className).toBe('about')
    expect(element.hidden).toBe(true)
    expect(element.getAttribute('aria-labelledby')).toBe('about-title')
    const card = element.children[0]!
    expect([card.tag, card.className]).toEqual(['section', 'card about-card'])
    const title = card.children[0]!
    expect([title.tag, title.className, title.id, title.textContent, title.tabIndex]).toEqual([
      'h2',
      'card-header',
      'about-title',
      'About',
      -1,
    ])
  })

  it('credits Warut.C and Ruk-Com Co., Ltd. with the intro and the license', () => {
    const text = setup().element.text()
    expect(ABOUT_INTRO).toBe('Autopilot Academy is a cartoon flight lesson for control engineering classes.')
    expect(LICENSE_TEXT).toBe('Free and open source under the MIT License.')
    for (const line of [ABOUT_INTRO, 'Made by', AUTHOR_NAME, 'With', COMPANY_NAME, LICENSE_TEXT, 'Close']) {
      expect(text).toContain(line)
    }
    expect(AUTHOR_NAME).toBe('Warut.C')
    expect(COMPANY_NAME).toBe('Ruk-Com Co., Ltd.')
  })

  it('shows the bundled avatar and logo with their alt text', () => {
    const { element } = setup()
    const avatar = element.find('about-avatar')
    expect([avatar.tag, avatar.src, avatar.alt, avatar.width, avatar.height]).toEqual([
      'img',
      '/about/whale-avatar.png',
      "Warut.C's GitHub avatar, a whale",
      96,
      96,
    ])
    expect([AVATAR_SRC, AVATAR_ALT]).toEqual([avatar.src, avatar.alt])
    const plate = element.find('about-logo-plate')
    const logo = plate.children[0]!
    expect([logo.tag, logo.src, logo.alt]).toEqual(['img', '/about/logo-ruk-com.svg', 'Ruk-Com Cloud logo'])
    expect([LOGO_SRC, LOGO_ALT]).toEqual([logo.src, logo.alt])
  })

  it('links the source in a new tab without an opener or referrer', () => {
    const link = setup().element.find('about-source-link')
    expect(link.tag).toBe('a')
    expect(link.href).toBe('https://github.com/WarutC/autopilot-academy')
    expect(link.textContent).toBe('github.com/WarutC/autopilot-academy')
    expect([SOURCE_URL, SOURCE_TEXT]).toEqual([link.href, link.textContent])
    expect(link.target).toBe('_blank')
    expect(link.rel).toBe('noopener noreferrer')
  })

  it('opens shown with focus on its heading', () => {
    const { doc, about, element } = setup()
    expect(about.isOpen).toBe(false)
    about.open(null)
    expect(about.isOpen).toBe(true)
    expect(element.hidden).toBe(false)
    expect(doc.activeElement?.id).toBe('about-title')
  })

  it('calls onClose from the Close button', () => {
    const { onClose, element } = setup()
    const close = element.find('about-close')
    expect([close.tag, close.type, close.className, close.textContent]).toEqual([
      'button',
      'button',
      'btn btn-primary about-close',
      'Close',
    ])
    close.click()
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('calls onClose on Escape only while open', () => {
    const { doc, onClose, about } = setup()
    const idle = doc.fire('keydown', event('Escape'))
    expect(idle.defaultPrevented).toBe(false)
    expect(onClose).not.toHaveBeenCalled()
    about.open(null)
    doc.fire('keydown', event('Enter'))
    expect(onClose).not.toHaveBeenCalled()
    const e = doc.fire('keydown', event('Escape'))
    expect(e.defaultPrevented).toBe(true)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('closes hidden and returns focus to the opener', () => {
    const { doc, about, element } = setup()
    const opener = doc.createElement('a')
    about.open(opener as unknown as HTMLElement)
    about.close()
    expect(about.isOpen).toBe(false)
    expect(element.hidden).toBe(true)
    expect(doc.activeElement).toBe(opener)
  })

  it('keeps the first opener when opened again', () => {
    const { doc, about } = setup()
    const first = doc.createElement('a')
    about.open(first as unknown as HTMLElement)
    about.open(null)
    about.close()
    expect(doc.activeElement).toBe(first)
  })

  it('moves no focus on close without an opener or with one gone from the page', () => {
    const { doc, about } = setup()
    about.open(null)
    const title = doc.activeElement
    about.close()
    expect(doc.activeElement).toBe(title)

    const gone = doc.createElement('a')
    gone.isConnected = false
    about.open(gone as unknown as HTMLElement)
    about.close()
    expect(doc.activeElement).not.toBe(gone)
  })

  it('ignores a close while already closed', () => {
    const { doc, about } = setup()
    const elsewhere = doc.createElement('button')
    elsewhere.focus()
    about.close()
    expect(doc.activeElement).toBe(elsewhere)
  })
})

const { light, dark } = themeTokens(tokensCss)
const ruleBody = (selector: string) => cssRuleBody(layoutCss, selector)

/** The darkest blue in the Ruk-Com logo. */
const LOGO_BLUE = '#0064a2'

describe('About contrast', () => {
  const plate = /background:\s*(#[0-9a-f]{6})\s*;/i.exec(ruleBody('.about-logo-plate'))?.[1]

  it('puts the logo on a white plate', () => {
    expect(plate?.toUpperCase()).toBe('#FFFFFF')
  })

  it('the logo blue reaches 3:1 on the plate but not on the dark panel', () => {
    expect(contrast(LOGO_BLUE, plate!)).toBeGreaterThanOrEqual(3)
    expect(contrast(LOGO_BLUE, dark.panel)).toBeLessThan(3)
  })

  const linkToken = /color:\s*var\(--([\w-]+)\)/.exec(ruleBody('.about-source-link'))?.[1]

  it.each([
    ['light', light],
    ['dark', dark],
  ] as const)('the source link color reaches 4.5:1 on the panel in the %s theme', (_name, t) => {
    expect(linkToken).toBe('ink')
    expect(contrast(t[linkToken!], t.panel)).toBeGreaterThanOrEqual(4.5)
  })
})
