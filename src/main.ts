import './styles/tokens.css'
import './styles/layout.css'
import { algorithms, defaultParams, findAlgorithm, type AlgorithmModule } from './algorithms/index.ts'
import { draw as drawRecorder } from './render/recorder.ts'
import { draw as drawScene } from './render/scene.ts'
import { PLANT } from './sim/plant.ts'
import { createRun, type Run, type RunPlayer } from './sim/run.ts'
import type { FlightMode, Snapshot } from './sim/types.ts'
import { createAutopilotCard } from './ui/autopilot-card.ts'
import { bannerContent, createBanner } from './ui/banner.ts'
import { createFlight, inFlight, type Phase } from './ui/flight.ts'
import { createStick, gameKey, typingTarget } from './ui/input.ts'
import { createModeSwitch } from './ui/mode-switch.ts'
import { createScoreMirror } from './ui/score-mirror.ts'
import { createSetpointSlider } from './ui/setpoint-slider.ts'
import { createStickButtons } from './ui/stick-buttons.ts'
import { loadTheme, watchTheme } from './ui/theme.ts'
import { createToolbar } from './ui/toolbar.ts'

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
layout.append(main, side)
app.append(layout)
main.append(stage)

const recorderCanvas = document.createElement('canvas')
recorderCanvas.className = 'recorder'
recorderCanvas.setAttribute('role', 'img')
recorderCanvas.setAttribute('aria-label', 'Flight recorder: target and altitude over time, with a marker at each parameter change')
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

/** Each lesson's current params this session, starting from its defaults. */
const paramsById = new Map(algorithms.map((m) => [m.id, defaultParams(m)]))
/** The selected lesson. */
let lesson: AlgorithmModule = findAlgorithm('pid') ?? algorithms[0]!
/** The player's autopilot; each Fly starts a run with the current one. */
let player: RunPlayer = { algorithm: lesson, params: paramsById.get(lesson.id)! }

/** A lesson whose modes include Manual flies by hand with the stick. */
const flysByHand = (m: AlgorithmModule) => m.modes.includes('manual')
/** A lesson's mode until the player picks another: Autopilot when it has one, else its first mode. */
const defaultMode = (m: AlgorithmModule): FlightMode => (m.modes.includes('autopilot') ? 'autopilot' : m.modes[0]!)
/** Each lesson's flight mode this session. */
const modeById = new Map<string, FlightMode>()
const runMode = (): FlightMode => modeById.get(lesson.id) ?? defaultMode(lesson)

/** The player's target altitude in Semi-auto; it keeps its value across runs. */
let setpoint: number = PLANT.hStart

/** The one source of the player's stick; buttons and keys only press and release it. */
const stick = createStick((value) => {
  if (inFlight(flight.phase)) flight.run.setInput(value)
})

// Every new run takes the player's live inputs, so a button held across Fly
// counts from the first step and the setpoint holds across runs.
const flight = createFlight(() => {
  const run = createRun({ course: 101, mode: runMode(), player })
  run.setSetpoint(setpoint)
  run.setInput(stick.value)
  return run
})

const stickButtons = createStickButtons(document, stick)
stage.append(stickButtons.element)
stickButtons.setVisible(flysByHand(lesson))

const setpointSlider = createSetpointSlider(
  document,
  { min: PLANT.hFloor, max: PLANT.hCeil, step: 1, value: setpoint },
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
    modeById.set(lesson.id, mode)
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
  change(key, value) {
    // A new record each time, so a finished run's params are never touched.
    const params = { ...(paramsById.get(lesson.id) ?? defaultParams(lesson)), [key]: value }
    paramsById.set(lesson.id, params)
    player = { ...player, params }
    if (inFlight(flight.phase)) flight.run.setParam('player', key, value)
  },
  commit(label) {
    if (inFlight(flight.phase)) {
      flight.run.markChange(label)
      requestDraw()
    }
  },
  select(id) {
    const next = findAlgorithm(id)
    if (!next || inFlight(flight.phase) || next.id === lesson.id) return
    lesson = next
    player = { algorithm: next, params: paramsById.get(next.id) ?? defaultParams(next) }
    autopilotCard.setLesson(next, player.params)
    stickButtons.setVisible(flysByHand(next))
    stick.releaseAll()
    // Outside a flight the run is the next flight's preview, so show it in the new lesson's mode.
    if (!inFlight(flight.phase)) flight.reset()
    syncMode()
    requestDraw()
  },
})
side.append(autopilotCard.element)

const toolbar = createToolbar(document, {
  fly() {
    flight.fly()
    delete canvas.dataset.fixture
    fixture = undefined
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
})
toolbar.element.prepend(modeSwitch.element)
main.append(toolbar.element, recorderCard)

const mirror = createScoreMirror(document)
main.append(mirror.element)

let theme = loadTheme()
/** A dev-only fixture shown instead of the run while the flight is ready. */
let fixture: Snapshot | undefined
let needsDraw = true

function requestDraw(): void {
  needsDraw = true
}

let bannerPhase: Phase | undefined
let bannerRun: Run | undefined

/** Reflects the flight into the toolbar and the banner; cheap, so it runs every frame. */
function syncUi(): void {
  toolbar.update(flight.phase, flight.speed)
  autopilotCard.setPhase(flight.phase)
  // The banner depends only on the phase and the run's result, so recompute it when either changes.
  if (flight.phase !== bannerPhase || flight.run !== bannerRun) {
    bannerPhase = flight.phase
    bannerRun = flight.run
    banner.update(bannerContent(flight.phase, flight.run.result('player')))
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
}

/** True when the stick buttons are shown, so the game keys fly the plane. */
function stickVisible(): boolean {
  return flysByHand(lesson)
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
      requestDraw()
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
    requestDraw()
  })
  const resize = new ResizeObserver(requestDraw)
  resize.observe(canvas)
  resize.observe(recorderCanvas)
  watchPixelRatio()
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) return
    stick.releaseAll()
    if (flight.phase === 'running') {
      flight.togglePause()
      syncUi()
    }
  })
  window.addEventListener('blur', () => stick.releaseAll())
  window.addEventListener('keydown', (event) => {
    const direction = gameKey(event)
    if (!direction || !stickVisible() || typingTarget(document.activeElement as HTMLElement | null)) return
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
  ]).then(requestDraw, () => {})
  requestAnimationFrame(frame)
  // The loop already runs, so a failed dev import only loses its switch.
  if (import.meta.env.DEV) loadDevSwitches().catch((error: unknown) => console.error(error))
}

start()
