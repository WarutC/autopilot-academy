import { PLANT } from '../sim/plant.ts'
import type { ControlContext } from '../sim/types.ts'
import type { AlgorithmModule, Params } from './index.ts'
import { polyRoots } from './lib/poly.ts'

/** Proportional control: the elevator is the altitude error times Kp. */
const p: AlgorithmModule = {
  id: 'p',
  name: 'P',
  tag: 'Proportional',
  lesson:
    'The elevator pushes in proportion to the altitude error: the further from the target, the harder it climbs or dives. ' +
    'With nothing to brake the climb, the plane swings past the target before it settles. ' +
    'Try: raise Kp and watch the crosses in the Pole readout move away from the real axis as the flight swings harder.',
  modes: ['semi-auto', 'autopilot'],
  params: [
    { key: 'Kp', label: 'Kp (proportional)', accessibleName: 'Kp, proportional gain', min: 0, max: 1, step: 0.01, default: 0.1 },
  ],
  create(params: Params) {
    return {
      compute(ctx: ControlContext): number {
        const u = params.Kp * (ctx.ref - ctx.h)
        return Number.isFinite(u) ? u : 0
      },
    }
  },
  analysis(params: Params) {
    // Closed loop of v' = -a·v + b·u, h' = v with u = Kp·(r − h): s² + a·s + b·Kp.
    return { poles: polyRoots([1, PLANT.a, PLANT.b * params.Kp]) }
  },
}

export default p
