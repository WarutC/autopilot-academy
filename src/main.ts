import './styles/tokens.css'
import './styles/layout.css'
import { algorithms, findAlgorithm, type AlgorithmModule } from './algorithms/index.ts'
import { draw as drawRecorder } from './render/recorder.ts'
import { draw as drawScene } from './render/scene.ts'
import { draw as drawSplane } from './render/splane.ts'
import { PLANT, SETPOINT_MAX, SETPOINT_MIN } from './sim/plant.ts'
import { createRun, type Run, type RunPlayer } from './sim/run.ts'
import type { FlightMode, Snapshot } from './sim/types.ts'
import { watchAutoPause } from './ui/auto-pause.ts'
import { createAutopilotCard } from './ui/autopilot-card.ts'
import { bannerContent, createBanner } from './ui/banner.ts'
import { createDrawer, PHONE_LANDSCAPE } from './ui/drawer.ts'
import { createFlight, inFlight, pauseForInterruption, type Phase } from './ui/flight.ts'
import { createStick, gameKey, typingTarget } from './ui/input.ts'
import { createModeSwitch } from './ui/mode-switch.ts'
import { createPoleReadout } from './ui/pole-readout.ts'
import { browserStorage, validCourse } from './ui/persistence.ts'
import { createRouter, drawCourse, parseRoute } from './ui/router.ts'
import { createScoreMirror } from './ui/score-mirror.ts'
import { createSetpointSlider } from './ui/setpoint-slider.ts'
import { createStickButtons } from './ui/stick-buttons.ts'
import { createStore } from './ui/store.ts'
import { loadTheme, watchTheme } from './ui/theme.ts'
import { createToolbar } from './ui/toolbar.ts'
import { createTuningHandlers } from './ui/tuning.ts'

const canvas = document.createElement('canvas')
canvas.className = 'scene'
canvas.setAttribute('role', 'img')
canvas.setAttribute('aria-label', 'Flight scene')
// Focusable so the arrow keys can nudge the setpoint slider in Semi-auto.
canvas.tabIndex = 0
const banner = createBanner(document)
const stage = document.createElement('div')
stage.className = 'stage'
stage.append(canvas, banner.element)
const app = document.querySelector('#app')!
const ctx = canvas.getContext('2d')!

// Wide screens: the flight on the left, the cards in a 380 px column on the right.
const layout = document.createElement('div')
layout.className = 'layout'
const main = document.createElement('div')
main.className = 'layout-main'
const side = document.createElement('div')
side.className = 'layout-side'
side.id = 'cards'
layout.append(main, side)
app.append(layout)
main.append(stage)

const recorderCanvas = document.createElement('canvas')
recorderCanvas.className = 'recorder'
recorderCanvas.setAttribute('role', 'img')
recorderCanvas.setAttribute('aria-label', 'Flight recorder: target, altitude and elevator over time, ring results, and a marker at each parameter change')
const recorderCtx = recorderCanvas.getContext('2d')!
const recorderCard = document.createElement('section')
recorderCard.className = 'card recorder-card'
recorderCard.setAttribute('aria-labelledby', 'recorder-card-title')
const recorderTitle = document.createElement('h2')
recorderTitle.className = 'card-header'
recorderTitle.id = 'recorder-card-title'
recorderTitle.textContent = 'Flight recorder'
const recorderBody = document.createElement('div')
recorderBody.className = 'card-body'
recorderBody.append(recorderCanvas)
recorderCard.append(recorderTitle, recorderBody)

/** The address: `#/lesson/<id>?course=<n>`, rewritten after every lesson or course change. */
const router = createRouter(window)
/** The remembered lesson, modes, params and course, and the flight phase. */
const store = createStore(algorithms, browserStorage, { onRouteChange: (l, c) => router.write(l, c) })
// On load the address wins over the remembered lesson and course.
const route = parseRoute(router.read(), algorithms)
if (route.lesson !== undefined) store.setLesson(route.lesson)
if (route.course !== undefined) store.setCourse(route.course)
router.write(store.lesson, store.course)
/** The selected lesson. */
let lesson: AlgorithmModule = findAlgorithm(store.lesson) ?? algorithms[0]!
/** The player's autopilot; each Fly starts a run with the current one. */
let player: RunPlayer = { algorithm: lesson, params: store.params(lesson.id) }

/** A lesson whose modes include Manual flies by hand with the stick. */
const flysByHand = (m: AlgorithmModule) => m.modes.includes('manual')
const runMode = (): FlightMode => store.mode(lesson.id)

/** A course the player just loaded, announced by the banner until Fly, a lesson or a mode change. */
let loadedCourse: number | undefined

/** The player's target altitude in Semi-auto; it keeps its value across runs. */
let setpoint: number = PLANT.hStart

/** The one source of the player's stick; buttons and keys only press and release it. */
const stick = createStick((value) => {
  if (inFlight(flight.phase)) flight.run.setInput(value)
})

// Every new run takes the player's live inputs, so a button held across Fly
// counts from the first step and the setpoint holds across runs.
const flight = createFlight(() => {
  const run = createRun({ course: store.course, mode: runMode(), player })
  run.setSetpoint(setpoint)
  run.setInput(stick.value)
  return run
}, store)

const stickButtons = createStickButtons(document, stick)
stage.append(stickButtons.element)
stickButtons.setVisible(flysByHand(lesson))

const setpointSlider = createSetpointSlider(
  document,
  { min: SETPOINT_MIN, max: SETPOINT_MAX, step: 1, value: setpoint },
  (value) => {
    setpoint = value
    // A finished run keeps the target it flew; the next Fly picks the setpoint up.
    if (flight.phase !== 'ended') flight.run.setSetpoint(value)
    requestDraw()
  },
)
stage.append(setpointSlider.element)

const modeSwitch = createModeSwitch(document, {
  select(mode) {
    if (!lesson.modes.includes(mode)) return
    store.setMode(lesson.id, mode)
    loadedCourse = undefined
    if (inFlight(flight.phase)) flight.fly()
    else flight.reset()
    syncUi()
    syncMode()
    requestDraw()
  },
})

/** Reflects the lesson's modes into the mode switch and shows the slider in Semi-auto. */
function syncMode(): void {
  const mode = runMode()
  modeSwitch.update(lesson.modes, mode)
  setpointSlider.setVisible(mode === 'semi-auto')
}
syncMode()

const autopilotCard = createAutopilotCard(document, algorithms, lesson.id, player.params, {
  ...createTuningHandlers({
    store,
    flight,
    lesson: () => lesson.id,
    setParams(params) {
      player = { ...player, params }
      requestReadout()
    },
    marked: requestDraw,
  }),
  select: selectLesson,
})
side.append(autopilotCard.element)

/** The selected lesson's closed-loop poles, gains or look-ahead, under the Autopilot card. */
const poleReadout = createPoleReadout(document)
const poleCtx = poleReadout.canvas.getContext('2d')!
side.append(poleReadout.element)

/** Switches to another lesson outside a flight, from a chip or the address. */
function selectLesson(id: string): void {
  const next = findAlgorithm(id)
  if (!next || inFlight(flight.phase) || next.id === lesson.id) return
  store.setLesson(next.id)
  lesson = next
  player = { algorithm: next, params: store.params(next.id) }
  autopilotCard.setLesson(next, player.params)
  requestReadout()
  stickButtons.setVisible(flysByHand(next))
  stick.releaseAll()
  loadedCourse = undefined
  // Outside a flight the run is the next flight's preview, so show it in the new lesson's mode.
  flight.reset()
  syncMode()
  syncUi()
  requestDraw()
}

/** Loads another course outside a flight, from the field, New course or the address. */
function loadCourse(course: number): void {
  if (!validCourse(course) || inFlight(flight.phase) || course === store.course) return
  store.setCourse(course)
  loadedCourse = course
  // The ready preview shows the new course's rings, not a dev fixture.
  clearFixture()
  flight.reset()
  syncUi()
  requestDraw()
}

const toolbar = createToolbar(document, {
  fly() {
    flight.fly()
    loadedCourse = undefined
    clearFixture()
    syncUi()
    requestDraw()
  },
  togglePause() {
    flight.togglePause()
    syncUi()
  },
  setSpeed(speed) {
    flight.setSpeed(speed)
    syncUi()
  },
  setCourse: loadCourse,
  newCourse() {
    loadCourse(drawCourse(Math.random, store.course))
  },
})
toolbar.element.prepend(modeSwitch.element)
main.append(toolbar.element, recorderCard)

/** Releases the stick and pauses a running flight, so the Paused banner shows. */
function releaseAndPause(): void {
  if (pauseForInterruption(flight, stick)) syncUi()
  requestDraw()
}

// Phone landscape: the cards open as a drawer from the right, and opening it releases the stick and pauses the run.
const drawer = createDrawer(document, {
  panel: side,
  background: main,
  onOpen: releaseAndPause,
})
toolbar.element.querySelector('.seg:not(.mode-switch)')!.after(drawer.toggle)
side.prepend(drawer.close)
app.append(drawer.scrim)

// On a phone a tap on the recorder expands it to the full viewport width.
const phoneQuery = `(width <= 960px), ${PHONE_LANDSCAPE}`
recorderCanvas.addEventListener('click', () => {
  if (matchMedia(phoneQuery).matches) recorderCard.classList.toggle('expanded')
})

const mirror = createScoreMirror(document)
main.append(mirror.element)

let theme = loadTheme()
/** A dev-only fixture shown instead of the run while the flight is ready. */
let fixture: Snapshot | undefined
let needsDraw = true
/** The Pole readout needs its text and plot rebuilt on the next draw. */
let readoutDirty = true

function requestDraw(): void {
  needsDraw = true
}

/** Rebuilds the Pole readout on the next frame: after a parameter, lesson, theme or size change. */
function requestReadout(): void {
  readoutDirty = true
  needsDraw = true
}

/** Drops the dev fixture, so the scene shows the run again. */
function clearFixture(): void {
  delete canvas.dataset.fixture
  fixture = undefined
}

let bannerPhase: Phase | undefined
let bannerRun: Run | undefined
let bannerCourse: number | undefined

/** Reflects the flight into the toolbar and the banner; cheap, so it runs every frame. */
function syncUi(): void {
  toolbar.update(flight.phase, flight.speed, store.course)
  autopilotCard.setPhase(flight.phase)
  // The banner depends only on the phase, the run's result and a loaded course, so recompute it when one changes.
  if (flight.phase !== bannerPhase || flight.run !== bannerRun || loadedCourse !== bannerCourse) {
    bannerPhase = flight.phase
    bannerRun = flight.run
    bannerCourse = loadedCourse
    banner.update(bannerContent(flight.phase, flight.run.result('player'), loadedCourse))
  }
}

/** Sizes `el`'s backing store to its CSS size at the device pixel ratio; returns the size. */
function fitCanvas(el: HTMLCanvasElement): { width: number; height: number; dpr: number } {
  const dpr = window.devicePixelRatio || 1
  const width = el.clientWidth
  const height = el.clientHeight
  const pxWidth = Math.round(width * dpr)
  const pxHeight = Math.round(height * dpr)
  // Assigning the size reallocates the backing store, so only do it on a change.
  if (el.width !== pxWidth) el.width = pxWidth
  if (el.height !== pxHeight) el.height = pxHeight
  return { width, height, dpr }
}

function draw(): void {
  const snapshot = fixture && flight.phase === 'ready' ? fixture : flight.snapshot()
  drawScene(ctx, snapshot, theme, fitCanvas(canvas))
  drawRecorder(recorderCtx, snapshot, theme, fitCanvas(recorderCanvas))
  mirror.update(snapshot)
  if (readoutDirty) {
    readoutDirty = false
    // The selected lesson and its own params, not the flying algorithm's, so a dev controller never hides the readout.
    const analysis = lesson.analysis?.(store.params(lesson.id))
    poleReadout.update(analysis)
    if (analysis && !poleReadout.canvas.hidden) drawSplane(poleCtx, analysis, theme, fitCanvas(poleReadout.canvas))
  }
}

let lastTime: number | undefined

function frame(time: number): void {
  const elapsed = lastTime === undefined ? 0 : (time - lastTime) / 1000
  lastTime = time
  const stepped = flight.advance(elapsed) > 0
  syncUi()
  if (stepped || needsDraw) {
    needsDraw = false
    draw()
  }
  requestAnimationFrame(frame)
}

// ResizeObserver only sees CSS size, so a devicePixelRatio change (another screen) needs its own watch.
function watchPixelRatio(): void {
  matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`).addEventListener(
    'change',
    () => {
      requestReadout()
      watchPixelRatio()
    },
    { once: true },
  )
}

/** Dev-server-only switches: `?fixture[=n]` shows a fixture snapshot, `?controller=dive` flies a full dive. */
async function loadDevSwitches(): Promise<void> {
  const query = new URLSearchParams(location.search)
  if (query.has('fixture')) {
    const { FIXTURE_ID, fixtureSnapshot } = await import('./render/fixture.ts')
    const flown = query.get('fixture')
    // A Fly click during the import wins over the fixture.
    if (flight.phase === 'ready') {
      fixture = fixtureSnapshot(flown ? Number(flown) : undefined)
      canvas.dataset.fixture = FIXTURE_ID
      requestDraw()
    }
  }
  if (query.get('controller') === 'dive') {
    const { DIVE } = await import('./ui/dive.ts')
    player = { algorithm: DIVE, params: {} }
    // A flight started during the import flew the default; start it again with the dive.
    if (flight.phase !== 'ready') {
      flight.fly()
      syncUi()
      requestDraw()
    }
  }
}

function start(): void {
  syncUi()
  watchTheme(() => {
    theme = loadTheme()
    requestReadout()
  })
  const resize = new ResizeObserver(requestDraw)
  resize.observe(canvas)
  resize.observe(recorderCanvas)
  new ResizeObserver(requestReadout).observe(poleReadout.canvas)
  watchPixelRatio()
  // A hidden tab or a rotation releases the stick and pauses a running flight.
  watchAutoPause(window, releaseAndPause)
  const landscape = matchMedia(PHONE_LANDSCAPE)
  drawer.setActive(landscape.matches)
  landscape.addEventListener('change', (event) => drawer.setActive(event.matches))
  matchMedia(phoneQuery).addEventListener('change', (event) => {
    if (!event.matches) recorderCard.classList.remove('expanded')
  })
  window.addEventListener('blur', () => stick.releaseAll())
  // An edited address selects its lesson and course outside a flight; during one it is put back.
  router.onChange((hash) => {
    if (!inFlight(flight.phase)) {
      const next = parseRoute(hash, algorithms)
      if (next.lesson !== undefined) selectLesson(next.lesson)
      if (next.course !== undefined) loadCourse(next.course)
    }
    router.write(store.lesson, store.course)
  })
  window.addEventListener('keydown', (event) => {
    const direction = gameKey(event)
    if (!direction || !flysByHand(lesson) || typingTarget(document.activeElement as HTMLElement | null)) return
    event.preventDefault()
    if (!event.repeat) stick.press(direction, `key:${event.key.toLowerCase()}`)
  })
  // Up and down on the focused scene nudge the setpoint in Semi-auto.
  canvas.addEventListener('keydown', (event) => {
    if (runMode() !== 'semi-auto' || event.ctrlKey || event.metaKey || event.altKey) return
    const direction = event.key === 'ArrowUp' ? 1 : event.key === 'ArrowDown' ? -1 : 0
    if (direction === 0) return
    event.preventDefault()
    setpointSlider.nudge(direction)
  })
  // A key-up always releases its source, whatever the focus or modifiers are by then.
  window.addEventListener('keyup', (event) => stick.release(`key:${event.key.toLowerCase()}`))
  // Canvas text does not wait for web fonts, so redraw once the HUD and badge fonts are loaded.
  void Promise.all([
    document.fonts.load(`700 22px ${theme.fontCondensed}`),
    document.fonts.load(`500 18px ${theme.fontBody}`),
  ]).then(requestReadout, () => {})
  requestAnimationFrame(frame)
  // The loop already runs, so a failed dev import only loses its switch.
  if (import.meta.env.DEV) loadDevSwitches().catch((error: unknown) => console.error(error))
}

start()
