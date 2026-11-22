import { clamp } from '../sim/clamp.ts'
import { PLANT } from '../sim/plant.ts'
import type { ControlContext } from '../sim/types.ts'
import type { AlgorithmModule, Params } from './index.ts'
import { polyRoots } from './lib/poly.ts'

const pid: AlgorithmModule = {
  id: 'pid',
  name: 'PID',
  tag: 'Three-term',
  lesson:
    'P pushes toward the target, I removes leftover error, D damps the overshoot. ' +
    'Try: raise Kp until it oscillates, then add Kd, and turn on the downdraft to see why Ki exists.',
  modes: ['semi-auto', 'autopilot'],
  params: [
    { key: 'Kp', label: 'Kp (proportional)', accessibleName: 'Kp, proportional gain', min: 0, max: 1, step: 0.01, default: 0.2 },
    { key: 'Ki', label: 'Ki (integral)', accessibleName: 'Ki, integral gain', min: 0, max: 0.5, step: 0.005, default: 0.03 },
    { key: 'Kd', label: 'Kd (derivative)', accessibleName: 'Kd, derivative gain', min: 0, max: 0.3, step: 0.005, default: 0.05 },
    { key: 'aw', label: 'Anti-windup', accessibleName: 'Anti-windup', min: 0, max: 1, step: 1, default: 1, toggle: true },
    {
      key: 'dmeas',
      label: 'Derivative on measurement (no kick)',
      accessibleName: 'Derivative on measurement, no setpoint kick',
      min: 0,
      max: 1,
      step: 1,
      default: 1,
      toggle: true,
    },
  ],
  create(params: Params) {
    // Integrator and previous setpoint are this controller's own state;
    // gains are read from `params` on every call so retuning is live.
    let I = 0
    let rPrev: number | null = null
    return {
      compute(ctx: ControlContext): number {
        const p = params
        const e = ctx.ref - ctx.h
        const dr = rPrev === null ? 0 : (ctx.ref - rPrev) / ctx.T
        if (Number.isFinite(ctx.ref)) rPrev = ctx.ref
        const D = p.dmeas ? -p.Kd * ctx.v : p.Kd * (dr - ctx.v)
        const raw = p.Kp * e + I + D
        if (!Number.isFinite(raw)) return 0 // integrator untouched
        const u = clamp(raw, -1, 1)
        // Anti-windup: stop integrating while saturated and pushing further.
        if (!(p.aw && raw !== u && Math.sign(e) === Math.sign(raw))) I += p.Ki * e * ctx.T
        I = clamp(I, -50, 50)
        return u
      },
    }
  },
  analysis(params: Params) {
    // Closed loop of v' = -a·v + b·u, h' = v with u = Kp·e + Ki·∫e − Kd·v, unsaturated:
    // s³ + (a + b·Kd)·s² + b·Kp·s + b·Ki. The toggles do not move the poles.
    const { a, b } = PLANT
    return { poles: polyRoots([1, a + b * params.Kd, b * params.Kp, b * params.Ki]) }
  },
}

export default pid
