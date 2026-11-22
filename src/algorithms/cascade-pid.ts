import { clamp } from '../sim/clamp.ts'
import type { ControlContext, Controller } from '../sim/types.ts'
import type { AlgorithmModule, Params } from './index.ts'

/**
 * The outer loop: altitude error `e` (m) to a climb-rate command (m/s),
 * `Kh·e` limited to ±|vmax|.
 */
export function climbRateCommand(params: Params, e: number): number {
  const limit = Math.abs(params.vmax)
  return clamp(params.Kh * e, -limit, limit)
}

/** A cascade controller that also exposes the climb rate it last asked for. */
export interface CascadeController extends Controller {
  /** Last commanded climb rate, in m/s; 0 before the first tick. */
  readonly climbRate: number
}

/** An algorithm module whose controllers also report their climb-rate command. */
type CascadeModule = Omit<AlgorithmModule, 'create'> & { create(params: Params): CascadeController }

const cascadePid: CascadeModule = {
  id: 'cascade-pid',
  name: 'Cascade PID',
  tag: 'Two loops',
  lesson:
    'The outer loop turns altitude error into a climb rate to fly, capped at a limit, ' +
    'and the inner loop moves the elevator until the plane climbs at exactly that rate. ' +
    'Try: lower the climb-rate limit from 12 to 4 m/s and watch the climbs between rings get flatter and the plane miss rings.',
  modes: ['semi-auto', 'autopilot'],
  params: [
    { key: 'Kh', label: 'Kh (outer altitude gain)', accessibleName: 'Kh, outer altitude gain', unit: '1/s', min: 0, max: 3, step: 0.05, default: 0.8 },
    { key: 'vmax', label: 'Climb-rate limit', accessibleName: 'Climb-rate limit', unit: 'm/s', min: 1, max: 30, step: 0.5, default: 12 },
    { key: 'Kv', label: 'Kv (inner climb-rate proportional)', accessibleName: 'Kv, inner climb-rate proportional gain', min: 0, max: 0.5, step: 0.005, default: 0.1 },
    { key: 'Ki', label: 'Ki (inner climb-rate integral)', accessibleName: 'Ki, inner climb-rate integral gain', min: 0, max: 0.5, step: 0.005, default: 0.05 },
  ],
  create(params: Params): CascadeController {
    // Integrator and last command are this controller's own state; gains are
    // read from `params` on every call so retuning is live.
    let I = 0
    let climbRate = 0
    return {
      get climbRate() {
        return climbRate
      },
      compute(ctx: ControlContext): number {
        const p = params
        const inputs = [ctx.ref, ctx.h, ctx.v, ctx.T, p.Kh, p.vmax, p.Kv, p.Ki]
        if (!inputs.every(Number.isFinite)) return 0 // state untouched
        const cmd = climbRateCommand(p, ctx.ref - ctx.h)
        const ev = cmd - ctx.v
        const raw = p.Kv * ev + I
        if (!Number.isFinite(cmd) || !Number.isFinite(raw)) return 0
        const u = clamp(raw, -1, 1)
        // Anti-windup: stop integrating while saturated and pushing further.
        if (!(raw !== u && Math.sign(ev) === Math.sign(raw))) I += p.Ki * ev * ctx.T
        // The integrator is in elevator units, so it stays within the elevator range.
        I = clamp(I, -1, 1)
        climbRate = cmd
        return u
      },
    }
  },
}

export default cascadePid satisfies AlgorithmModule
