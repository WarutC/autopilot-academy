import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Controller } from '../sim/types.ts'
import {
  BUILT_IN_ORDER,
  algorithms,
  buildRegistry,
  defaultParams,
  findAlgorithm,
  type AlgorithmModule,
} from './index.ts'

const stub = (id: string): AlgorithmModule => ({
  id,
  name: id,
  tag: 'Test',
  lesson: 'A test module. Try: nothing.',
  modes: ['semi-auto', 'autopilot'],
  params: [{ key: 'k', label: 'k', accessibleName: 'k', min: 0, max: 1, step: 0.1, default: 0.5 }],
  create: (): Controller => ({ compute: () => 0 }),
})

const file = (id: string) => ({ default: stub(id) })

afterEach(() => {
  vi.restoreAllMocks()
})

describe('algorithms (the real registry)', () => {
  it('contains pid as a built-in', () => {
    const pid = findAlgorithm('pid')
    expect(pid).toBeDefined()
    expect(pid?.community).toBe(false)
    expect(algorithms.map((m) => m.id)).toContain('pid')
  })

  it('lists manual first, then pid', () => {
    expect(algorithms.map((m) => m.id).slice(0, 2)).toEqual(['manual', 'pid'])
  })

  it('loads without warnings, holds pid and has no duplicate ids', async () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.resetModules()
    const fresh = await import('./index.ts')
    expect(spy).not.toHaveBeenCalled()
    const ids = fresh.algorithms.map((m) => m.id)
    expect(ids).toContain('pid')
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('gives each module a plain-text lesson with a Try: sentence', () => {
    for (const m of algorithms) {
      expect(m.lesson).toMatch(/Try:/)
      expect(m.lesson).not.toMatch(/<[a-z/]/i)
    }
  })

  it('has defaults inside each parameter range', () => {
    for (const m of algorithms) {
      for (const spec of m.params) {
        expect(spec.default).toBeGreaterThanOrEqual(spec.min)
        expect(spec.default).toBeLessThanOrEqual(spec.max)
      }
    }
  })
})

describe('buildRegistry', () => {
  it('orders built-ins by the fixed list, then community modules by id', () => {
    const warn = vi.fn()
    const list = buildRegistry(
      {
        './zeta-x.ts': file('zeta-x'),
        './pid.ts': file('pid'),
        './alpha-y.ts': file('alpha-y'),
        './manual.ts': file('manual'),
      },
      warn,
    )
    expect(list.map((m) => m.id)).toEqual(['manual', 'pid', 'alpha-y', 'zeta-x'])
    expect(list.map((m) => m.community)).toEqual([false, false, true, true])
    expect(warn).not.toHaveBeenCalled()
  })

  it('follows BUILT_IN_ORDER for all eleven built-ins', () => {
    const entries = Object.fromEntries(
      [...BUILT_IN_ORDER].reverse().map((id) => [`./${id}.ts`, file(id)]),
    )
    expect(buildRegistry(entries, vi.fn()).map((m) => m.id)).toEqual(BUILT_IN_ORDER)
  })

  it('keeps the first file by path when two share an id', () => {
    const warn = vi.fn()
    const kept = file('pid')
    const skipped = file('pid')
    // './a/pid.ts' sorts before './pid.ts', whatever the object key order.
    const list = buildRegistry({ './pid.ts': skipped, './a/pid.ts': kept }, warn)
    expect(list).toHaveLength(1)
    expect(list[0].create).toBe(kept.default.create)
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0][0]).toContain('./pid.ts')
  })

  it('skips a module whose id is not its file name, even a built-in id', () => {
    const warn = vi.fn()
    const builtIn = file('pid')
    const list = buildRegistry({ './another-pid.ts': file('pid'), './pid.ts': builtIn }, warn)
    expect(list).toHaveLength(1)
    expect(list[0].create).toBe(builtIn.default.create)
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0][0]).toContain('./another-pid.ts')
    expect(warn.mock.calls[0][0]).toContain('file name')
  })

  it('skips non-kebab-case ids with one warning each', () => {
    const warn = vi.fn()
    const bad = ['Bad_Id', 'pidX', '-pid', '']
    const entries = Object.fromEntries(bad.map((id, i) => [`./bad-${i}.ts`, file(id)]))
    expect(buildRegistry(entries, warn)).toEqual([])
    expect(warn).toHaveBeenCalledTimes(bad.length)
    bad.forEach((_, i) => expect(warn.mock.calls[i][0]).toContain(`./bad-${i}.ts`))
  })

  it('skips files without a valid default export with one warning each', () => {
    const warn = vi.fn()
    const list = buildRegistry(
      {
        './empty.ts': {},
        './no-id.ts': { default: { ...stub('x'), id: 42 } },
        './nothing.ts': { default: null },
        './pid.ts': file('pid'),
      },
      warn,
    )
    expect(list.map((m) => m.id)).toEqual(['pid'])
    expect(warn).toHaveBeenCalledTimes(3)
    for (const path of ['./empty.ts', './no-id.ts', './nothing.ts']) {
      expect(warn.mock.calls.some(([msg]) => String(msg).includes(path))).toBe(true)
    }
  })

  it('warns through console.warn by default', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    buildRegistry({ './x.ts': {} })
    expect(spy).toHaveBeenCalledTimes(1)
    expect(spy.mock.calls[0][0]).toContain('./x.ts')
  })
})

describe('defaultParams', () => {
  it('returns each parameter default by key', () => {
    expect(defaultParams(findAlgorithm('pid')!)).toEqual({ Kp: 0.2, Ki: 0.03, Kd: 0.05, aw: 1, dmeas: 1 })
  })

  it('returns a fresh record every time', () => {
    const m = stub('a')
    expect(defaultParams(m)).not.toBe(defaultParams(m))
  })
})
