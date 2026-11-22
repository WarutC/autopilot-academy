import type { ControlContext } from '../sim/types.ts'
import type { AlgorithmModule, Params } from './index.ts'

/** Bang-bang control: full climb below the target, full dive above, with a hysteresis band. */
const onOff: AlgorithmModule = {
  id: 'on-off',
  name: 'On-Off',
  tag: 'Bang-bang',
  lesson:
    'The elevator has only two settings: climb at its output level when the plane is below the target, and dive at the same level when it is above. ' +
    'It never settles, so it chatters around the target and the recorder shows the elevator as a square wave. ' +
    'Try: widen the hysteresis band and see how much calmer the flight gets, and what it costs in accuracy.',
  modes: ['semi-auto', 'autopilot'],
  params: [
    { key: 'U', label: 'Output level', accessibleName: 'Output level', min: 0.1, max: 1, step: 0.05, default: 0.4 },
    {
      key: 'hyst',
      label: 'Hysteresis band (m)',
      accessibleName: 'Hysteresis band in meters',
      min: 0,
      max: 10,
      step: 0.5,
      default: 0.5,
    },
  ],
  create(params: Params) {
    // The switch position (-1, 0 or +1) is this controller's own state; the
    // output level and band are read from `params` on every call.
    let state = 0
    return {
      compute(ctx: ControlContext): number {
        const e = ctx.ref - ctx.h
        const { U, hyst } = params
        if (Number.isFinite(e) && Number.isFinite(hyst)) {
          if (e > hyst) state = 1
          else if (e < -hyst) state = -1
        }
        if (state === 0 || !Number.isFinite(U)) return 0
        return state * U
      },
    }
  },
}

export default onOff
