import './styles/tokens.css'
import './styles/layout.css'
import { defaultParams, findAlgorithm } from './algorithms/index.ts'
import { draw as drawScene } from './render/scene.ts'
import { createRun } from './sim/run.ts'
import type { Snapshot } from './sim/types.ts'
import { createScoreMirror } from './ui/score-mirror.ts'
import { loadTheme, watchTheme } from './ui/theme.ts'

const canvas = document.createElement('canvas')
canvas.className = 'scene'
canvas.setAttribute('role', 'img')
canvas.setAttribute('aria-label', 'Flight scene')
const app = document.querySelector('#app')!
app.append(canvas)
const ctx = canvas.getContext('2d')!

const mirror = createScoreMirror(document)
app.append(mirror.element)

let theme = loadTheme()
let snapshot = readySnapshot()

function readySnapshot(): Snapshot {
  const algorithm = findAlgorithm('pid')!
  return createRun({ course: 101, mode: 'autopilot', player: { algorithm, params: defaultParams(algorithm) } }).snapshot()
}

function draw(): void {
  const dpr = window.devicePixelRatio || 1
  const width = canvas.clientWidth
  const height = canvas.clientHeight
  canvas.width = Math.round(width * dpr)
  canvas.height = Math.round(height * dpr)
  drawScene(ctx, snapshot, theme, { width, height, dpr })
}

// ResizeObserver only sees CSS size, so a devicePixelRatio change (another screen) needs its own watch.
function watchPixelRatio(): void {
  matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`).addEventListener(
    'change',
    () => {
      draw()
      watchPixelRatio()
    },
    { once: true },
  )
}

async function start(): Promise<void> {
  const query = new URLSearchParams(location.search)
  if (import.meta.env.DEV && query.has('fixture')) {
    const { FIXTURE_ID, fixtureSnapshot } = await import('./render/fixture.ts')
    const flown = query.get('fixture')
    snapshot = fixtureSnapshot(flown ? Number(flown) : undefined)
    canvas.dataset.fixture = FIXTURE_ID
  }
  mirror.update(snapshot)
  watchTheme(() => {
    theme = loadTheme()
    draw()
  })
  new ResizeObserver(draw).observe(canvas)
  watchPixelRatio()
  // Canvas text does not wait for web fonts, so redraw once the HUD and badge fonts are loaded.
  void Promise.all([
    document.fonts.load(`700 22px ${theme.fontCondensed}`),
    document.fonts.load(`500 18px ${theme.fontBody}`),
  ]).then(draw, () => {})
}

void start()
