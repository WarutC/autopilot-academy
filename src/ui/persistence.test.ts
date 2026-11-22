import { describe, expect, it } from 'vitest'
import { algorithms, defaultParams } from '../algorithms/index.ts'
import manual from '../algorithms/manual.ts'
import pid from '../algorithms/pid.ts'
import { defaultConditions } from './conditions.ts'
import {
  defaultSettings,
  loadSettings,
  mergeParams,
  parseSettings,
  saveSettings,
  STORAGE_KEY,
  type Settings,
} from './persistence.ts'

const modules = [manual, pid]

/** A storage holding `initial` under the settings key. */
function fakeStorage(initial?: string) {
  const items = new Map<string, string>()
  if (initial !== undefined) items.set(STORAGE_KEY, initial)
  const storage = {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => void items.set(key, value),
  } as unknown as Storage
  return { items, storage, get: () => storage }
}

const throwing = (): never => {
  throw new Error('blocked')
}

const stored = (data: unknown) => JSON.stringify(data)
const pidDefaults = defaultParams(pid)

describe('defaultSettings', () => {
  it('is PID, no picked modes, course 101, calm conditions and every module at its defaults', () => {
    expect(defaultSettings(modules)).toEqual({
      lesson: 'pid',
      modes: {},
      params: { manual: {}, pid: pidDefaults },
      course: 101,
      conditions: defaultConditions(),
    })
  })

  it("falls back to the registry's first lesson without PID", () => {
    expect(defaultSettings([manual]).lesson).toBe('manual')
  })

  it('covers the real registry', () => {
    expect(Object.keys(defaultSettings(algorithms).params)).toEqual(algorithms.map((m) => m.id))
  })
})

describe('mergeParams', () => {
  it('keeps stored keys and fills missing ones with defaults', () => {
    expect(mergeParams(pid, { Kp: 0.3 })).toEqual({ ...pidDefaults, Kp: 0.3 })
  })

  it('drops unknown keys', () => {
    expect(mergeParams(pid, { foo: 3 })).toEqual(pidDefaults)
  })

  it('clamps out-of-range values and makes toggles 0 or 1', () => {
    expect(mergeParams(pid, { Kp: 7, Kd: -1, aw: 0.4, dmeas: 0 })).toEqual({
      ...pidDefaults,
      Kp: 1,
      Kd: 0,
      aw: 1,
      dmeas: 0,
    })
  })

  it('ignores non-numbers and non-finite numbers', () => {
    expect(mergeParams(pid, { Kp: '0.5', Ki: null, Kd: NaN, aw: Infinity })).toEqual(pidDefaults)
  })

  it('gives defaults for a non-object', () => {
    expect(mergeParams(pid, 5)).toEqual(pidDefaults)
    expect(mergeParams(pid, [0.5])).toEqual(pidDefaults)
  })

  it('returns a fresh record each time', () => {
    expect(mergeParams(pid, undefined)).not.toBe(mergeParams(pid, undefined))
  })
})

describe('parseSettings', () => {
  const defaults = defaultSettings(modules)

  it('gives defaults on a first visit', () => {
    expect(parseSettings(null, modules)).toEqual(defaults)
  })

  it('restores a return visit', () => {
    const s = parseSettings(stored({ version: 1, lesson: 'manual', params: { pid: { Kp: 0.5 } } }), modules)
    expect(s.lesson).toBe('manual')
    expect(s.params.pid).toEqual({ ...pidDefaults, Kp: 0.5 })
    expect(s.modes).toEqual({})
    expect(s.course).toBe(101)
  })

  it('drops unknown keys and unknown modules', () => {
    const s = parseSettings(stored({ version: 1, params: { pid: { foo: 3 }, nope: { a: 1 } } }), modules)
    expect(s.params).toEqual({ manual: {}, pid: pidDefaults })
  })

  it('clamps out-of-range values', () => {
    const s = parseSettings(stored({ version: 1, params: { pid: { Kp: 7, Kd: -1, aw: 0.4 } } }), modules)
    expect(s.params.pid).toEqual({ ...pidDefaults, Kp: 1, Kd: 0, aw: 1 })
  })

  it('treats bad values as defaults', () => {
    // Valid JSON whose values are not numbers.
    const text = '{"version":1,"params":{"pid":{"Kp":"0.5","Ki":null,"Kd":true,"aw":{}}}}'
    expect(parseSettings(text, modules)).toEqual(defaults)
    const s = parseSettings(stored({ version: 1, params: { pid: { Kp: '0.5', Ki: null, Kd: NaN } } }), modules)
    expect(s.params.pid).toEqual(pidDefaults)
  })

  it('gives defaults for bad JSON', () => {
    expect(parseSettings('{nope', modules)).toEqual(defaults)
  })

  it('discards another version or a missing one', () => {
    expect(parseSettings(stored({ version: 2, lesson: 'manual' }), modules)).toEqual(defaults)
    expect(parseSettings(stored({ lesson: 'manual' }), modules)).toEqual(defaults)
    expect(parseSettings(stored({ version: '1', lesson: 'manual' }), modules)).toEqual(defaults)
  })

  it('gives defaults for a non-object', () => {
    for (const text of ['null', '3', '"x"', '[1]']) expect(parseSettings(text, modules)).toEqual(defaults)
  })

  it('replaces a bad lesson, mode and course', () => {
    for (const course of [0, 1.5, '202', 100000, -3, null]) {
      const s = parseSettings(stored({ version: 1, lesson: 'nope', modes: { pid: 'manual' }, course }), modules)
      expect(s.lesson).toBe('pid')
      expect(s.modes).toEqual({})
      expect(s.course).toBe(101)
    }
  })

  it('keeps a valid mode and course', () => {
    const s = parseSettings(
      stored({ version: 1, modes: { pid: 'semi-auto', manual: 'manual', nope: 'autopilot' }, course: 99999 }),
      modules,
    )
    expect(s.modes).toEqual({ pid: 'semi-auto', manual: 'manual' })
    expect(s.course).toBe(99999)
  })
})

describe('loadSettings and saveSettings', () => {
  const custom: Settings = {
    lesson: 'manual',
    modes: { pid: 'semi-auto' },
    params: { manual: {}, pid: { ...pidDefaults, Kp: 0.5 } },
    course: 202,
    conditions: { ...defaultConditions(), down: 2.5, gusts: 4 },
  }

  it('round-trips through storage', () => {
    const fake = fakeStorage()
    expect(saveSettings(fake.get, custom)).toBe(true)
    expect(JSON.parse(fake.items.get(STORAGE_KEY)!)).toMatchObject({ version: 1, lesson: 'manual' })
    expect(loadSettings(fake.get, modules)).toEqual(custom)
  })

  it('reads defaults from empty storage or no storage', () => {
    expect(loadSettings(fakeStorage().get, modules)).toEqual(defaultSettings(modules))
    expect(loadSettings(() => undefined, modules)).toEqual(defaultSettings(modules))
    expect(saveSettings(() => undefined, custom)).toBe(false)
  })

  it('reads defaults from bad stored JSON', () => {
    expect(loadSettings(fakeStorage('{nope').get, modules)).toEqual(defaultSettings(modules))
  })

  it('survives a throwing getter', () => {
    expect(loadSettings(throwing, modules)).toEqual(defaultSettings(modules))
    expect(saveSettings(throwing, custom)).toBe(false)
  })

  it('survives throwing getItem and setItem', () => {
    const storage = { getItem: throwing, setItem: throwing } as unknown as Storage
    expect(loadSettings(() => storage, modules)).toEqual(defaultSettings(modules))
    expect(saveSettings(() => storage, custom)).toBe(false)
  })
})

describe('stored conditions', () => {
  it('merges stored conditions over the defaults, clamped, dropping bad values and unknown keys', () => {
    const s = parseSettings(stored({ version: 1, conditions: { gusts: 'x', down: 50, zzz: 1, kq: 0.01 } }), modules)
    expect(s.conditions).toEqual({ ...defaultConditions(), down: 10, kq: 0.1 })
    expect(s.conditions).not.toHaveProperty('zzz')
  })

  it.each([null, 3, 'calm', [1, 2]])('falls back to the defaults when conditions are %j', (conditions) => {
    expect(parseSettings(stored({ version: 1, conditions }), modules).conditions).toEqual(defaultConditions())
  })

  it('keeps the stored conditions when the rest of the settings load', () => {
    const s = parseSettings(stored({ version: 1, course: 202, conditions: { gusts: 4 } }), modules)
    expect(s.course).toBe(202)
    expect(s.conditions).toEqual({ ...defaultConditions(), gusts: 4 })
  })
})
