import type { ControlContext } from '../sim/types.ts'
import type { AlgorithmAnalysis, AlgorithmModule, Params } from './index.ts'
import { lqrRiccati, stateFeedbackCommand, stateFeedbackPoles } from './lib/state-feedback.ts'

function gainsOf(params: Params) {
  return lqrRiccati(params.qh, params.qv, params.r)
}

/** Linear-quadratic regulator: state feedback whose gains minimize a weighted cost. */
const lqr: AlgorithmModule = {
  id: 'lqr',
  name: 'LQR',
  tag: 'Optimal',
  lesson:
    'Instead of placing poles, say what you care about and let the math find the best gains. ' +
    'Q weights the altitude error and the climb rate, R weights elevator effort, and solving the Riccati equation gives u = k1·e − k2·v, where e is the altitude error and v the climb rate. ' +
    'Cheap effort buys an aggressive loop; expensive effort buys a gentle one. ' +
    'Try: raise Q altitude error or Q climb rate, or lower R elevator effort, and watch the poles and k1 and k2 in the Pole readout move as the loop gets bolder.',
  modes: ['semi-auto', 'autopilot'],
  params: [
    {
      key: 'qh',
      label: 'Q altitude error',
      accessibleName: 'Q altitude error, weight on altitude error',
      min: 0.01,
      max: 100,
      step: 0.01,
      default: 1,
      log: true,
    },
    {
      key: 'qv',
      label: 'Q climb rate',
      accessibleName: 'Q climb rate, weight on climb rate',
      min: 0.001,
      max: 10,
      step: 0.001,
      default: 0.01,
      log: true,
    },
    {
      key: 'r',
      label: 'R elevator effort',
      accessibleName: 'R elevator effort, weight on elevator effort',
      min: 0.1,
      max: 1000,
      step: 0.01,
      default: 10,
      log: true,
    },
  ],
  create(params: Params) {
    return {
      compute(ctx: ControlContext): number {
        return stateFeedbackCommand(gainsOf(params), ctx.ref, ctx.h, ctx.v)
      },
    }
  },
  analysis(params: Params): AlgorithmAnalysis {
    const sol = gainsOf(params)
    if (!sol) return { poles: [], gains: {} }
    return { poles: stateFeedbackPoles(sol.k1, sol.k2), gains: { k1: sol.k1, k2: sol.k2 } }
  },
}

export default lqr
