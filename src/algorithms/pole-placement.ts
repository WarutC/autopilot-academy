import type { ControlContext } from '../sim/types.ts'
import type { AlgorithmAnalysis, AlgorithmModule, Params } from './index.ts'
import { placementGains, stateFeedbackCommand, stateFeedbackPoles } from './lib/state-feedback.ts'

/** State feedback whose gains are chosen so the closed-loop poles sit where the student asks. */
const polePlacement: AlgorithmModule = {
  id: 'pole-placement',
  name: 'Pole Placement',
  tag: 'State feedback',
  lesson:
    'Instead of tuning gains by feel, pick where the closed-loop poles should sit and solve for the gains. ' +
    'The elevator uses both states: u = k1·e − k2·v, the altitude error and the climb rate. ' +
    'The natural frequency ωn sets how fast the plane responds and the damping ratio ζ sets how much it overshoots. ' +
    'Try: raise ωn, then lower ζ, and watch the crosses, pole list and k1 and k2 in the Pole readout follow your request.',
  modes: ['semi-auto', 'autopilot'],
  params: [
    {
      key: 'wn',
      label: 'Natural frequency ωn',
      accessibleName: 'omega n, natural frequency',
      unit: 'rad/s',
      min: 0.5,
      max: 6,
      step: 0.1,
      default: 2,
    },
    {
      key: 'zeta',
      label: 'Damping ratio ζ',
      accessibleName: 'zeta, damping ratio',
      min: 0.1,
      max: 1.5,
      step: 0.05,
      default: 0.8,
    },
  ],
  create(params: Params) {
    return {
      compute(ctx: ControlContext): number {
        return stateFeedbackCommand(placementGains(params.wn, params.zeta), ctx.ref, ctx.h, ctx.v)
      },
    }
  },
  analysis(params: Params): AlgorithmAnalysis {
    const gains = placementGains(params.wn, params.zeta)
    if (!gains) return { poles: [], gains: {} }
    return { poles: stateFeedbackPoles(gains.k1, gains.k2), gains: { k1: gains.k1, k2: gains.k2 } }
  },
}

export default polePlacement
