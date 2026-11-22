import { describe, expect, it } from 'vitest'
import manual from '../algorithms/manual.ts'
import pid from '../algorithms/pid.ts'
import { createRouter, drawCourse, followAddress, lessonHash, parseRoute, type RouterWindow } from './router.ts'

const modules = [manual, pid]

describe('parseRoute', () => {
  it('reads a shared lesson link', () => {
    expect(parseRoute('#/lesson/pid?course=202', modules)).toEqual({ lesson: 'pid', course: 202 })
    expect(parseRoute('#/lesson/manual?course=99999', modules)).toEqual({ lesson: 'manual', course: 99999 })
    expect(parseRoute('#/lesson/manual?course=1', modules)).toEqual({ lesson: 'manual', course: 1 })
  })

  it('leaves out an unknown or empty lesson, keeping a valid course', () => {
    expect(parseRoute('#/lesson/nope?course=7', modules)).toEqual({ course: 7 })
    expect(parseRoute('#/lesson/nope', modules)).toEqual({})
    expect(parseRoute('#/lesson/', modules)).toEqual({})
    expect(parseRoute('#/lesson', modules)).toEqual({})
    expect(parseRoute('#/lesson/pid', [manual])).toEqual({})
  })

  it('treats a decode error as an unknown lesson', () => {
    expect(parseRoute('#/lesson/%E0%A4?course=3', modules)).toEqual({ course: 3 })
  })

  it('decodes the lesson id', () => {
    expect(parseRoute('#/lesson/%6Danual', modules)).toEqual({ lesson: 'manual' })
  })

  it('leaves out a course that is not a valid whole number', () => {
    for (const course of ['0', '100000', '1.5', 'abc', '', '-3', '+5', '1e3', ' 5']) {
      expect(parseRoute(`#/lesson/pid?course=${course}`, modules)).toEqual({ lesson: 'pid' })
    }
    expect(parseRoute('#/lesson/pid', modules)).toEqual({ lesson: 'pid' })
    expect(parseRoute('#/lesson/pid?other=5', modules)).toEqual({ lesson: 'pid' })
  })

  it('applies nothing for other routes, whatever their query', () => {
    for (const hash of ['', '#', '#/', '#/abouts', '#/foo', '#/about/x', '#/lessons/pid', 'lesson/pid']) {
      expect(parseRoute(hash, modules)).toEqual({})
    }
  })

  it('reads the About route, whatever its query', () => {
    for (const hash of ['#/about', '#/about?course=5', '#/about?lesson=pid', '/about']) {
      expect(parseRoute(hash, modules)).toEqual({ about: true })
    }
  })
})

describe('lessonHash', () => {
  it('builds the canonical route and encodes the id', () => {
    expect(lessonHash('pid', 202)).toBe('#/lesson/pid?course=202')
    expect(lessonHash('a b/c', 7)).toBe('#/lesson/a%20b%2Fc?course=7')
  })

  it('round-trips through parseRoute', () => {
    expect(parseRoute(lessonHash('manual', 555), modules)).toEqual({ lesson: 'manual', course: 555 })
  })
})

describe('drawCourse', () => {
  it('draws from 1 to 99999', () => {
    expect(drawCourse(() => 0, 5)).toBe(1)
    expect(drawCourse(() => 0.999999999, 5)).toBe(99999)
    expect(drawCourse(() => 0.5, 5)).toBe(50000)
  })

  it('draws again when the course equals the current one', () => {
    const values = [0, 0, 0.5]
    let i = 0
    expect(drawCourse(() => values[i++]!, 1)).toBe(50000)
    expect(i).toBe(3)
  })

  it('still returns a different valid course when every draw repeats', () => {
    expect(drawCourse(() => 0, 1)).toBe(2)
    expect(drawCourse(() => 0.999999999, 99999)).toBe(1)
  })
})

function fakeWindow(hash: string, pathname = '/autopilot-academy/', search = '?fixture') {
  const calls: string[] = []
  const listeners: (() => void)[] = []
  const location = { hash, pathname, search }
  const win: RouterWindow = {
    location,
    history: {
      state: null,
      replaceState(_data, _unused, url) {
        calls.push(url)
        location.hash = url.slice(url.indexOf('#'))
      },
    },
    addEventListener(_type, listener) {
      listeners.push(listener)
    },
  }
  return { win, calls, location, fire: () => listeners.forEach((l) => l()) }
}

describe('createRouter', () => {
  it('reads the hash', () => {
    expect(createRouter(fakeWindow('#/about').win).read()).toBe('#/about')
  })

  it('writes the lesson route and keeps the path and query', () => {
    const { win, calls } = fakeWindow('#/foo')
    createRouter(win).write('pid', 202)
    expect(calls).toEqual(['/autopilot-academy/?fixture#/lesson/pid?course=202'])
  })

  it('skips a write when the hash already matches', () => {
    const { win, calls } = fakeWindow('#/lesson/pid?course=202')
    createRouter(win).write('pid', 202)
    expect(calls).toEqual([])
  })

  it('leaves the About route alone on a write', () => {
    for (const hash of ['#/about', '#/about?course=5']) {
      const { win, calls, location } = fakeWindow(hash)
      createRouter(win).write('pid', 202)
      expect(calls).toEqual([])
      expect(location.hash).toBe(hash)
    }
  })

  it('restores the lesson route over the About route', () => {
    const { win, calls, location } = fakeWindow('#/about')
    createRouter(win).restore('pid', 101)
    expect(calls).toEqual(['/autopilot-academy/?fixture#/lesson/pid?course=101'])
    expect(location.hash).toBe('#/lesson/pid?course=101')
  })

  it('skips a restore when the hash already matches', () => {
    const { win, calls } = fakeWindow('#/lesson/pid?course=101')
    createRouter(win).restore('pid', 101)
    expect(calls).toEqual([])
  })

  it('passes the new hash to the change listener', () => {
    const { win, location, fire } = fakeWindow('')
    const seen: string[] = []
    createRouter(win).onChange((hash) => seen.push(hash))
    location.hash = '#/lesson/manual?course=9'
    fire()
    expect(seen).toEqual(['#/lesson/manual?course=9'])
  })
})

describe('followAddress', () => {
  function follow(hash: string, flying: boolean) {
    const fake = fakeWindow('#/lesson/pid?course=101')
    const state = { lesson: 'pid', course: 101 }
    const log: string[] = []
    const router = createRouter(fake.win)
    const recorded = {
      ...router,
      write(lesson: string, course: number) {
        log.push(`write ${lesson} ${course}`)
        router.write(lesson, course)
      },
    }
    followAddress(recorded, modules, {
      flying: () => flying,
      selectLesson(id) {
        log.push(`lesson ${id}`)
        state.lesson = id
      },
      loadCourse(course) {
        log.push(`course ${course}`)
        state.course = course
      },
      current: () => ({ ...state }),
      about(open) {
        log.push(`about ${open}`)
      },
    })
    fake.location.hash = hash
    fake.fire()
    return { log, calls: fake.calls, location: fake.location }
  }

  it('selects the lesson and loads the course outside a flight, then writes them back', () => {
    const { log, calls, location } = follow('#/lesson/manual?course=9', false)
    expect(log).toEqual(['about false', 'lesson manual', 'course 9', 'write manual 9'])
    // The address already names the current route, so nothing is rewritten.
    expect(calls).toEqual([])
    expect(location.hash).toBe('#/lesson/manual?course=9')
  })

  it('selects and loads nothing during a flight and puts the current route back', () => {
    const { log, calls, location } = follow('#/lesson/manual?course=9', true)
    expect(log).toEqual(['about false', 'write pid 101'])
    expect(calls).toEqual(['/autopilot-academy/?fixture#/lesson/pid?course=101'])
    expect(location.hash).toBe('#/lesson/pid?course=101')
  })

  it('ignores an unknown lesson and an invalid course and writes the current route back', () => {
    const { log, calls, location } = follow('#/lesson/nope?course=0', false)
    expect(log).toEqual(['about false', 'write pid 101'])
    expect(calls).toEqual(['/autopilot-academy/?fixture#/lesson/pid?course=101'])
    expect(location.hash).toBe('#/lesson/pid?course=101')
  })

  it('selects only the lesson when the course is invalid', () => {
    const { log, calls, location } = follow('#/lesson/manual?course=0', false)
    expect(log).toEqual(['about false', 'lesson manual', 'write manual 101'])
    expect(calls).toEqual(['/autopilot-academy/?fixture#/lesson/manual?course=101'])
    expect(location.hash).toBe('#/lesson/manual?course=101')
  })

  it('loads only the course when the lesson is unknown', () => {
    const { log, calls, location } = follow('#/lesson/nope?course=7', false)
    expect(log).toEqual(['about false', 'course 7', 'write pid 7'])
    expect(calls).toEqual(['/autopilot-academy/?fixture#/lesson/pid?course=7'])
    expect(location.hash).toBe('#/lesson/pid?course=7')
  })
  it.each([false, true])('opens About on the About route without a rewrite (flying: %s)', (flying) => {
    const { log, calls, location } = follow('#/about', flying)
    expect(log).toEqual(['about true'])
    expect(calls).toEqual([])
    expect(location.hash).toBe('#/about')
  })

  it('opens About on the About route with a query and changes nothing', () => {
    const { log, calls, location } = follow('#/about?course=5', false)
    expect(log).toEqual(['about true'])
    expect(calls).toEqual([])
    expect(location.hash).toBe('#/about?course=5')
  })
})
