// A test algorithm that holds full dive on every tick, so a flight crashes.
// Loaded only from the dev server, by `?controller=dive`; never in a build.

import type { RunAlgorithm } from '../sim/run.ts'

export const DIVE: RunAlgorithm = {
  id: 'dive',
  create: () => ({ compute: () => -1 }),
}
