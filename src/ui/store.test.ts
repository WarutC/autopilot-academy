import { describe, expect, it, vi } from 'vitest'
import { defaultParams } from '../algorithms/index.ts'
import manual from '../algorithms/manual.ts'
import p from '../algorithms/p.ts'
import pid from '../algorithms/pid.ts'
import { defaultConditions } from './conditions.ts'
import { STORAGE_KEY, type StorageGetter } from './persistence.ts'
import { createPhase, createStore } from './store.ts'

const modules = [manual, pid]

type FakeStorage = NonNullable<ReturnType<StorageGetter>>
const pidDefaults = defaultParams(pid)

function fakeStorage() {
  const items = new Map<string, string>()
  const storage = {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => void items.set(key, value),
  } as unknown as FakeStorage
  return { items, get: () => storage }
}

describe('createStore', () => {
  it('starts on first-visit defaults', () => {
    const store = createStore(modules, fakeStorage().get)
    expect(store.lesson).toBe('pid')
    expect(store.mode('pid')).toBe('autopilot')
    expect(store.mode('manual')).toBe('manual')
    expect(store.params('pid')).toEqual(pidDefaults)
    expect(store.course).toBe(101)
    expect(store.phase).toBe('ready')
  })

  it('persists every setter and reloads it', () => {
    const fake = fakeStorage()
    const store = createStore(modules, fake.get)
    store.setParam('pid', 'Kp', 0.5)
    store.setMode('pid', 'semi-auto')
    store.setLesson('manual')
    store.setCourse(202)
    const again = createStore(modules, fake.get)
    expect(again.lesson).toBe('manual')
    expect(again.mode('pid')).toBe('semi-auto')
    expect(again.params('pid')).toEqual({ ...pidDefaults, Kp: 0.5 })
    expect(again.course).toBe(202)
  })

  it('clamps a param value', () => {
    const store = createStore(modules, fakeStorage().get)
    store.setParam('pid', 'Kp', 7)
    store.setParam('pid', 'aw', 0)
    expect(store.params('pid')).toEqual({ ...pidDefaults, Kp: 1, aw: 0 })
  })

  it('ignores invalid setter input and does not save it', () => {
    const fake = fakeStorage()
    const store = createStore(modules, fake.get)
    store.setLesson('nope')
    store.setMode('pid', 'manual')
    store.setMode('nope', 'autopilot')
    store.setParam('pid', 'foo', 1)
    store.setParam('nope', 'Kp', 1)
    store.setParam('pid', 'Kp', NaN)
    store.setParam('pid', 'Kp', Infinity)
    store.setCourse(0)
    store.setCourse(1.5)
    store.setCourse(100000)
    expect(store.lesson).toBe('pid')
    expect(store.mode('pid')).toBe('autopilot')
    expect(store.params('pid')).toEqual(pidDefaults)
    expect(store.params('pid')).not.toHaveProperty('foo')
    expect(store.course).toBe(101)
    expect(fake.items.has(STORAGE_KEY)).toBe(false)
  })

  it('never mutates a params record it handed out', () => {
    const store = createStore(modules, fakeStorage().get)
    const before = store.params('pid')
    store.setParam('pid', 'Kp', 0.5)
    expect(before).toEqual(pidDefaults)
    expect(store.params('pid')).not.toBe(before)
    expect(store.params('pid').Kp).toBe(0.5)
  })

  it('keeps working in memory when storage throws', () => {
    const throwing = (): never => {
      throw new Error('blocked')
    }
    const store = createStore(modules, throwing)
    store.setParam('pid', 'Kp', 0.5)
    store.setMode('pid', 'semi-auto')
    store.setLesson('manual')
    expect(store.params('pid').Kp).toBe(0.5)
    expect(store.mode('pid')).toBe('semi-auto')
    expect(store.lesson).toBe('manual')
    const failing = { getItem: throwing, setItem: throwing } as unknown as FakeStorage
    const other = createStore(modules, () => failing)
    other.setCourse(303)
    expect(other.course).toBe(303)
  })

  it('reports each real lesson or course change once, and nothing else', () => {
    const onRouteChange = vi.fn()
    const store = createStore(modules, fakeStorage().get, { onRouteChange })
    store.setLesson('pid')
    store.setLesson('nope')
    store.setCourse(101)
    store.setCourse(0)
    store.setMode('pid', 'semi-auto')
    store.setParam('pid', 'Kp', 0.5)
    store.setPhase('running')
    expect(onRouteChange).not.toHaveBeenCalled()
    store.setLesson('manual')
    store.setCourse(555)
    store.setCourse(555)
    expect(onRouteChange.mock.calls).toEqual([
      ['manual', 101],
      ['manual', 555],
    ])
  })

  it('does not save the phase', () => {
    const fake = fakeStorage()
    const store = createStore(modules, fake.get)
    store.setPhase('running')
    expect(store.phase).toBe('running')
    expect(fake.items.has(STORAGE_KEY)).toBe(false)
    expect(createStore(modules, fake.get).phase).toBe('ready')
  })
})

describe('createPhase', () => {
  it('holds a phase in memory, starting ready', () => {
    const owner = createPhase()
    expect(owner.phase).toBe('ready')
    owner.setPhase('paused')
    expect(owner.phase).toBe('paused')
  })
})

describe('Store conditions', () => {
  it('starts calm', () => {
    expect(createStore(modules, fakeStorage().get).conditions).toEqual(defaultConditions())
  })

  it('clamps and snaps a condition and ignores an unknown key or a non-finite value', () => {
    const store = createStore(modules, fakeStorage().get)
    store.setCondition('gusts', 99)
    store.setCondition('down', 0.3)
    store.setCondition('nope', 1)
    store.setCondition('down', NaN)
    store.setCondition('gusts', Infinity)
    expect(store.conditions).toEqual({ ...defaultConditions(), gusts: 20, down: 0.5 })
    expect(store.conditions).not.toHaveProperty('nope')
  })

  it('remembers a condition across stores and leaves other settings alone', () => {
    const fake = fakeStorage()
    const store = createStore(modules, fake.get)
    store.setParam('pid', 'Kp', 0.5)
    store.setCourse(202)
    store.setCondition('gusts', 4)
    const again = createStore(modules, fake.get)
    expect(again.conditions.gusts).toBe(4)
    expect(again.params('pid')).toEqual({ ...pidDefaults, Kp: 0.5 })
    expect(again.course).toBe(202)
    expect(JSON.parse(fake.items.get(STORAGE_KEY)!).version).toBe(1)
  })

  it('never mutates a conditions record it handed out, and skips an unchanged value', () => {
    const fake = fakeStorage()
    const store = createStore(modules, fake.get)
    const before = store.conditions
    store.setCondition('gusts', 0)
    expect(store.conditions).toBe(before)
    expect(fake.items.has(STORAGE_KEY)).toBe(false)
    store.setCondition('gusts', 5)
    expect(before.gusts).toBe(0)
    expect(store.conditions).not.toBe(before)
  })

  it('keeps working in memory when storage is blocked', () => {
    const store = createStore(modules, (): never => {
      throw new Error('blocked')
    })
    store.setCondition('down', 3)
    expect(store.conditions.down).toBe(3)
  })
})

describe('store wingman', () => {
  const withP = [manual, p, pid]

  it('starts with no wingman', () => {
    expect(createStore(withP, fakeStorage().get).wingman).toBeNull()
  })

  it('remembers the wingman across a reload', () => {
    const fake = fakeStorage()
    createStore(withP, fake.get).setWingman('p')
    expect(JSON.parse(fake.items.get(STORAGE_KEY)!).wingman).toBe('p')
    expect(createStore(withP, fake.get).wingman).toBe('p')
  })

  it('ignores an id that is unregistered or lacks Autopilot, and skips an unchanged value', () => {
    const fake = fakeStorage()
    const store = createStore(withP, fake.get)
    store.setWingman('nope')
    store.setWingman('manual')
    store.setWingman(null)
    expect(store.wingman).toBeNull()
    expect(fake.items.has(STORAGE_KEY)).toBe(false)
    store.setWingman('pid')
    store.setWingman(null)
    expect(store.wingman).toBeNull()
  })

  it('keeps the wingman in memory when storage is blocked', () => {
    const store = createStore(withP, (): never => {
      throw new Error('blocked')
    })
    store.setWingman('p')
    expect(store.wingman).toBe('p')
  })
})
