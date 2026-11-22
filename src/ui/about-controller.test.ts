import { describe, expect, it } from 'vitest'
import { createAboutController, type LinkClick } from './about-controller.ts'

const el = (name: string) => ({ name }) as unknown as HTMLElement

const plainClick: LinkClick = { button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, defaultPrevented: false }

function setup({ drawerOpen = false, focused = null as HTMLElement | null } = {}) {
  const log: string[] = []
  const state = { lesson: 'pid', course: 101, flying: true, focused }
  const app = { hidden: false }
  const toggle = el('toggle') as HTMLButtonElement
  const aboutLink = el('about-link')
  const drawer = {
    isOpen: drawerOpen,
    toggle,
    closeDrawer() {
      log.push('drawer closed')
      drawer.isOpen = false
    },
  }
  const about = {
    isOpen: false,
    opener: null as HTMLElement | null,
    open(opener: HTMLElement | null) {
      about.isOpen = true
      about.opener = opener
      log.push('about open')
    },
    close(fallbacks: readonly (HTMLElement | null)[] = []) {
      about.isOpen = false
      // Focus moves here, so the app must already be shown.
      log.push(`about close, app hidden ${app.hidden}, fallbacks ${fallbacks.map((f) => (f as unknown as { name: string })?.name).join(' ')}`)
    },
  }
  const controller = createAboutController({
    about,
    drawer,
    app,
    router: { restore: (lesson, course) => log.push(`restore ${lesson} ${course}`) },
    history: { back: () => log.push('back') },
    pause() {
      state.flying = false
      log.push('pause')
    },
    redraw: () => log.push('redraw'),
    current: () => ({ lesson: state.lesson, course: state.course }),
    focused: () => state.focused,
    fallbacks: () => [aboutLink, toggle],
  })
  return { controller, log, state, app, about, toggle, aboutLink }
}

describe('createAboutController', () => {
  it('pauses a running flight, hides the app and closes the drawer on open', () => {
    const { controller, log, state, app, about } = setup({ drawerOpen: true })
    controller.open('address')
    expect(state.flying).toBe(false)
    expect(app.hidden).toBe(true)
    expect(about.isOpen).toBe(true)
    expect(log).toEqual(['drawer closed', 'pause', 'about open'])
  })

  it('returns focus to Cards when opened from the open drawer', () => {
    const { controller, about, toggle, aboutLink } = setup({ drawerOpen: true })
    controller.linkClicked(aboutLink, plainClick)
    controller.open('address')
    expect(about.opener).toBe(toggle)
  })

  it('returns focus to the clicked link, else to the focused element', () => {
    const clicked = setup({ focused: el('elsewhere') })
    clicked.controller.linkClicked(clicked.aboutLink, plainClick)
    clicked.controller.open('address')
    expect(clicked.about.opener).toBe(clicked.aboutLink)

    const focused = el('course field')
    const typed = setup({ focused })
    typed.controller.open('address')
    expect(typed.about.opener).toBe(focused)
  })

  it.each([
    ['meta', { metaKey: true }],
    ['ctrl', { ctrlKey: true }],
    ['shift', { shiftKey: true }],
    ['alt', { altKey: true }],
    ['middle button', { button: 1 }],
    ['handled', { defaultPrevented: true }],
  ])('ignores a %s click on an About link as the opener', (_name, change) => {
    const { controller, about, aboutLink } = setup()
    controller.linkClicked(aboutLink, { ...plainClick, ...change })
    controller.open('address')
    expect(about.opener).toBeNull()
  })

  it('goes Back on Close after an in-page open, showing the app before focus returns and redrawing all', () => {
    const { controller, log, app } = setup()
    controller.open('address')
    log.length = 0
    controller.dismiss()
    expect(app.hidden).toBe(false)
    expect(log).toEqual(['back', 'about close, app hidden false, fallbacks about-link toggle', 'redraw'])
  })

  it('replaces the address with the lesson route on Close after a load at About', () => {
    const { controller, log, state, app } = setup({ drawerOpen: false })
    state.lesson = 'lqr'
    state.course = 7
    controller.open('load')
    // Opening never changes the lesson or the course.
    expect(state).toMatchObject({ lesson: 'lqr', course: 7 })
    expect(log).not.toContain('back')
    log.length = 0
    controller.dismiss()
    expect(app.hidden).toBe(false)
    expect(log).toEqual(['restore lqr 7', 'about close, app hidden false, fallbacks about-link toggle', 'redraw'])
  })

  it('closes without touching the address when the address left About', () => {
    const { controller, log } = setup()
    controller.open('address')
    log.length = 0
    controller.close()
    expect(log).toEqual(['about close, app hidden false, fallbacks about-link toggle', 'redraw'])
    controller.close()
    controller.dismiss()
    expect(log).toHaveLength(2)
  })

  it('blocks the game keys only while About shows', () => {
    const { controller } = setup()
    expect(controller.blocksGameKeys()).toBe(false)
    controller.open('load')
    expect(controller.blocksGameKeys()).toBe(true)
    controller.dismiss()
    expect(controller.blocksGameKeys()).toBe(false)
  })

  it('opens once, keeping the first opener', () => {
    const { controller, log, about, aboutLink } = setup()
    controller.linkClicked(aboutLink, plainClick)
    controller.open('address')
    controller.open('address')
    expect(log.filter((l) => l === 'about open')).toHaveLength(1)
    expect(about.opener).toBe(aboutLink)
  })
})
