import { clamp } from '../sim/clamp.ts'
import { PLANT } from '../sim/plant.ts'
import type { ControlContext } from '../sim/types.ts'
import type { AlgorithmModule, Params } from './index.ts'
import { polyRoots } from './lib/poly.ts'

/** Proportional-integral control: P plus the running sum of the altitude error. */
const pi: AlgorithmModule = {
  id: 'pi',
  name: 'PI',
  tag: 'Proportional-integral',
  lesson:
    'The integral adds up the altitude error over time and keeps pushing until none is left, removing the steady error P leaves behind. ' +
    'The price is a slow pole and extra overshoot, because the sum has to unwind after the plane reaches the target. ' +
    'Try: raise Ki and watch the slow pole move in the Pole readout, then turn off anti-windup on a big climb.',
  modes: ['semi-auto', 'autopilot'],
  params: [
    { key: 'Kp', label: 'Kp (proportional)', accessibleName: 'Kp, proportional gain', min: 0, max: 1, step: 0.01, default: 0.15 },
    { key: 'Ki', label: 'Ki (integral)', accessibleName: 'Ki, integral gain', min: 0, max: 0.5, step: 0.005, default: 0.01 },
    { key: 'aw', label: 'Anti-windup', accessibleName: 'Anti-windup', min: 0, max: 1, step: 1, default: 1, toggle: true },
  ],
  create(params: Params) {
    // The integrator is this controller's own state; gains are read from
    // `params` on every call so retuning is live.
    let I = 0
    return {
      compute(ctx: ControlContext): number {
        const p = params
        const e = ctx.ref - ctx.h
        const raw = p.Kp * e + I
        if (!Number.isFinite(raw) || !Number.isFinite(p.Ki)) return 0 // integrator untouched
        const u = clamp(raw, -1, 1)
        // Anti-windup: stop integrating while saturated and pushing further.
        if (!(p.aw && raw !== u && Math.sign(e) === Math.sign(raw))) I += p.Ki * e * ctx.T
        I = clamp(I, -50, 50)
        return u
      },
    }
  },
  analysis(params: Params) {
    // Closed loop of v' = -a·v + b·u, h' = v with u = Kp·e + Ki·∫e, unsaturated:
    // s³ + a·s² + b·Kp·s + b·Ki. The anti-windup toggle does not move the poles.
    const { a, b } = PLANT
    return { poles: polyRoots([1, a, b * params.Kp, b * params.Ki]) }
  },
}

export default pi
