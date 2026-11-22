import './styles/tokens.css'
import './styles/layout.css'
import { defaultParams, findAlgorithm } from './algorithms/index.ts'
import { draw as drawScene } from './render/scene.ts'
import { createRun, type Run, type RunPlayer } from './sim/run.ts'
import type { Snapshot } from './sim/types.ts'
import { bannerContent, createBanner } from './ui/banner.ts'
import { createFlight, type Phase } from './ui/flight.ts'
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
app.append(stage)
const ctx = canvas.getContext('2d')!

const pid = findAlgorithm('pid')!
/** The player's autopilot; each Fly starts a run with the current one. */
let player: RunPlayer = { algorithm: pid, params: defaultParams(pid) }
const flight = createFlight(() => createRun({ course: 101, mode: 'autopilot', player }))

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
app.append(toolbar.element)

const mirror = createScoreMirror(document)
app.append(mirror.element)

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

function draw(): void {
  const snapshot = fixture && flight.phase === 'ready' ? fixture : flight.snapshot()
  const dpr = window.devicePixelRatio || 1
  const width = canvas.clientWidth
  const height = canvas.clientHeight
  const pxWidth = Math.round(width * dpr)
  const pxHeight = Math.round(height * dpr)
  // Assigning the size reallocates the backing store, so only do it on a change.
  if (canvas.width !== pxWidth) canvas.width = pxWidth
  if (canvas.height !== pxHeight) canvas.height = pxHeight
  drawScene(ctx, snapshot, theme, { width, height, dpr })
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
  new ResizeObserver(requestDraw).observe(canvas)
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
