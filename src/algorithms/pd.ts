import { PLANT } from '../sim/plant.ts'
import type { ControlContext } from '../sim/types.ts'
import type { AlgorithmModule, Params } from './index.ts'
import { polyRoots } from './lib/poly.ts'

/** Proportional-derivative control: P plus a brake on the climb rate. */
const pd: AlgorithmModule = {
  id: 'pd',
  name: 'PD',
  tag: 'Proportional-derivative',
  lesson:
    'P pushes toward the target, and D brakes in proportion to the climb rate, so the plane slows down as it closes in. ' +
    'That damps the swing P alone leaves behind, so it dies out within a few seconds, though at the defaults the plane still overshoots a small step by more than a quarter of the step. ' +
    'Try: raise Kd and watch the crosses in the Pole readout move toward the real axis as the swing fades.',
  modes: ['semi-auto', 'autopilot'],
  params: [
    { key: 'Kp', label: 'Kp (proportional)', accessibleName: 'Kp, proportional gain', min: 0, max: 1, step: 0.01, default: 0.2 },
    { key: 'Kd', label: 'Kd (derivative)', accessibleName: 'Kd, derivative gain', min: 0, max: 0.3, step: 0.005, default: 0.05 },
  ],
  create(params: Params) {
    return {
      compute(ctx: ControlContext): number {
        // Derivative on measurement: braking uses the climb rate only, so a
        // setpoint step gives no kick.
        const u = params.Kp * (ctx.ref - ctx.h) - params.Kd * ctx.v
        return Number.isFinite(u) ? u : 0
      },
    }
  },
  analysis(params: Params) {
    // Closed loop of v' = -a·v + b·u, h' = v with u = Kp·(r − h) − Kd·v: s² + (a + b·Kd)·s + b·Kp.
    const { a, b } = PLANT
    return { poles: polyRoots([1, a + b * params.Kd, b * params.Kp]) }
  },
}

export default pd
