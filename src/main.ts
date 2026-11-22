import './styles/tokens.css'
import './styles/layout.css'
import { defaultParams, findAlgorithm } from './algorithms/index.ts'
import { draw as drawRecorder } from './render/recorder.ts'
import { draw as drawScene } from './render/scene.ts'
import { createRun, type Run, type RunPlayer } from './sim/run.ts'
import type { Snapshot } from './sim/types.ts'
import { createAutopilotCard } from './ui/autopilot-card.ts'
import { bannerContent, createBanner } from './ui/banner.ts'
import { createFlight, inFlight, type Phase } from './ui/flight.ts'
import { createScoreMirror } from './ui/score-mirror.ts'
import { loadTheme, watchTheme } from './ui/theme.ts'
import { createToolbar } from './ui/toolbar.ts'

const canvas = document.createElement('canvas')
canvas.className = 'scene'
canvas.setAttribute('role', 'img')
canvas.setAttribute('aria-label', 'Flight scene')
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

const pid = findAlgorithm('pid')!
/** The player's autopilot; each Fly starts a run with the current one. */
let player: RunPlayer = { algorithm: pid, params: defaultParams(pid) }
const flight = createFlight(() => createRun({ course: 101, mode: 'autopilot', player }))

const autopilotCard = createAutopilotCard(document, pid, player.params, {
  change(key, value) {
    // A new record each time, so a finished run's params are never touched.
    player = { ...player, params: { ...player.params, [key]: value } }
    if (inFlight(flight.phase)) flight.run.setParam('player', key, value)
  },
  commit(label) {
    if (inFlight(flight.phase)) {
      flight.run.markChange(label)
      requestDraw()
    }
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
    if (document.hidden && flight.phase === 'running') {
      flight.togglePause()
      syncUi()
    }
  })
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
