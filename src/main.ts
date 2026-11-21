import './styles/tokens.css'
import './styles/layout.css'

const SKY: ReadonlyArray<readonly [offset: number, color: string]> = [
  [0, '#2B7FC4'],
  [0.55, '#7EC3EC'],
  [0.85, '#CBEAF7'],
]

const canvas = document.createElement('canvas')
canvas.className = 'scene'
canvas.setAttribute('role', 'img')
canvas.setAttribute('aria-label', 'Flight scene')
document.querySelector('#app')!.append(canvas)
const ctx = canvas.getContext('2d')!

function draw(): void {
  const dpr = window.devicePixelRatio || 1
  canvas.width = Math.round(canvas.clientWidth * dpr)
  canvas.height = Math.round(canvas.clientHeight * dpr)
  const sky = ctx.createLinearGradient(0, 0, 0, canvas.height)
  for (const [offset, color] of SKY) sky.addColorStop(offset, color)
  ctx.fillStyle = sky
  ctx.fillRect(0, 0, canvas.width, canvas.height)
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

new ResizeObserver(draw).observe(canvas)
watchPixelRatio()
