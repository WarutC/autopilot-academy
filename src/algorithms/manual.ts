import type { ControlContext } from '../sim/types.ts'
import type { AlgorithmModule } from './index.ts'

/** The player flies by hand: the elevator follows the stick. */
const manual: AlgorithmModule = {
  id: 'manual',
  name: 'Manual',
  tag: 'By hand',
  lesson:
    'Fly it yourself. Hold ▲ / ▼, the ↑ / ↓ keys or W / S to climb and dive through each ring; release and the elevator returns to neutral. ' +
    'Try: fly course 101 by hand, then watch the altitude line on the recorder to see how far you overshoot each ring.',
  modes: ['manual'],
  params: [],
  create() {
    return {
      compute(ctx: ControlContext): number {
        return ctx.input
      },
    }
  },
}

export default manual
