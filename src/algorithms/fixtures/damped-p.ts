// The example module from the README's "Add an algorithm" section, kept here,
// outside the registry's reach, so tests can prove the example works.

import { PLANT } from '../../sim/plant.ts'
import type { ControlContext } from '../../sim/types.ts'
import type { AlgorithmModule, Params } from '../index.ts'
import { polyRoots } from '../lib/poly.ts'

/** P control with a climb-rate brake: u = Kp·(ref − h) − Kv·v. */
const dampedP: AlgorithmModule = {
  id: 'damped-p',
  name: 'Damped P',
  tag: 'Example',
  lesson:
    'The elevator pushes toward the target like P, and a second term brakes the climb rate so the plane settles without swinging. ' +
    'Try: set Kv to 0 to get plain P back, then raise it until the swing is gone.',
  modes: ['semi-auto', 'autopilot'],
  params: [
    { key: 'Kp', label: 'Kp (proportional)', accessibleName: 'Kp, proportional gain', min: 0, max: 1, step: 0.01, default: 0.1 },
    { key: 'Kv', label: 'Kv (climb-rate damping)', accessibleName: 'Kv, climb-rate damping gain', min: 0, max: 0.5, step: 0.005, default: 0.05 },
  ],
  create(params: Params) {
    return {
      compute(ctx: ControlContext): number {
        const u = params.Kp * (ctx.ref - ctx.h) - params.Kv * ctx.v
        return Number.isFinite(u) ? u : 0
      },
    }
  },
  analysis(params: Params) {
    // Closed loop of v' = -a·v + b·u, h' = v: s² + (a + b·Kv)·s + b·Kp.
    const { a, b } = PLANT
    return { poles: polyRoots([1, a + b * params.Kv, b * params.Kp]) }
  },
}

export default dampedP
