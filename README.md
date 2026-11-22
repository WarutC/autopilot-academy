<img src="public/favicon.svg" width="64" height="64" alt="">

# Autopilot Academy

A browser flight game for control engineering classes. Students fly a plane
through a course of rings, then hand the stick to an autopilot and tune it.
The app is at https://autopilot.ruk-com.dev.

## Run locally

You need Node.js 22.12 or later.

```sh
npm ci
npm run dev        # dev server at http://localhost:5173
npm test           # Vitest in watch mode; add -- --run for one pass
npm run typecheck  # tsc --noEmit
npm run build      # production build in dist/
```

## Add an algorithm

An algorithm is one TypeScript file in `src/algorithms/`. The app finds every
`.ts` file at the top of that folder (except `index.ts` and tests), so a new
file is all it takes: no list to edit, no import to add. The file name must
equal the module's `id`, in kebab-case: `my-controller.ts` holds
`id: 'my-controller'`. A file whose default export is not a module, or whose
id is not kebab-case or does not match its name, is skipped with a console
warning.

### The parts of a module, using PID

Open `src/algorithms/pid.ts` next to this. Its default export is an
`AlgorithmModule` (defined in `src/algorithms/index.ts`):

- `id`: `'pid'`, the file name. It also appears in the page URL.
- `name`: `'PID'`, shown on the lesson chip and above the lesson.
- `tag`: `'Three-term'`, the short line under the name on a built-in chip.
  Every module needs one, but the chip of a module you add reads `Community`
  in its place.
- `lesson`: plain text, no HTML, ending with a sentence that starts with
  `Try:`. The card shows "Try:" in bold, so end with something to do.
- `modes`: the flight modes the module can fly, here
  `['semi-auto', 'autopilot']`.
- `params`: one `ParamSpec` per tunable value. Each has a `key` (the name in
  the params record, such as `Kp`), a visible `label`, an `accessibleName` for
  screen readers, `min`, `max`, `step`, a `default` and an optional `unit`.
  Set `toggle: true` for an on/off switch stored as 0 or 1 (PID's `aw` and
  `dmeas`), or `log: true` for a slider that moves on a log scale. A key like
  `Kp` shows as K with a subscript p.
- `create(params)`: returns a controller, an object with
  `compute(ctx): number`. The controller keeps its own state in the closure
  (PID keeps its integrator `I` and the previous setpoint) and reads `params`
  on every call, because the sliders change that record in place while the
  plane flies. `compute` returns the elevator command `u` in [-1, 1]; values
  outside are clipped, and a non-finite value counts as 0, but it is better
  to return 0 yourself and never throw.
- `ctx` is a `ControlContext` (in `src/sim/types.ts`): `t` (time, s), `T`
  (control period, s), `ref` (altitude setpoint, m), `h` (altitude, m), `v`
  (climb rate, m/s), `input` (the manual stick) and `refAhead(seconds)`, the
  reference that far in front of the plane.
- `analysis(params)`: optional; without it the Pole readout is hidden for
  your lesson. Return `poles` (closed-loop poles of the linear loop, drawn in
  the Pole readout), `gains` (computed gains by name) and `lookahead` (seconds
  the controller plans ahead). It runs on every parameter change, so keep it
  quick and pure, and never throw: if it does, the readout stays hidden and
  the console shows a warning. PID builds its
  characteristic polynomial from the plant constants in `src/sim/plant.ts`
  (`v' = -a·v + b·u`, `h' = v`) and finds its roots with `polyRoots` from
  `src/algorithms/lib/poly.ts`.

### A complete example

Save this as `src/algorithms/damped-p.ts`. It is P control plus a brake on the
climb rate:

```ts
import { PLANT } from '../sim/plant.ts'
import type { ControlContext } from '../sim/types.ts'
import type { AlgorithmModule, Params } from './index.ts'
import { polyRoots } from './lib/poly.ts'

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
```

Reload the page. The new lesson appears as a chip after MPC; every module not
in the built-in set reads "Community" on its chip, in place of its tag.
Selecting it shows one row per entry in `params`, here Kp and Kv. Delete the
file and the chip is gone.

Put code shared by several modules in a subfolder such as
`src/algorithms/lib/`; files in subfolders are not loaded as modules.

### Test it

Add `src/algorithms/damped-p.test.ts` and check that the module flies course
101 with `flyCourse` from `src/algorithms/lib/fly-course.ts`:

```ts
import { expect, it } from 'vitest'
import dampedP from './damped-p.ts'
import { defaultParams } from './index.ts'
import { flyCourse } from './lib/fly-course.ts'

it('flies course 101 in Autopilot', () => {
  const flight = flyCourse(dampedP, defaultParams(dampedP), 'autopilot')
  expect(flight.status).not.toBe('crashed')
  expect(flight.ringsPassed).toBeGreaterThanOrEqual(6)
})
```

Then run the tests and the type check:

```sh
npm test -- --run
npm run typecheck
```

## Run the container

The image serves the production build with nginx on port 8080 as a
non-root user.

```sh
docker build -t autopilot-academy .
docker run --rm -p 8080:8080 autopilot-academy
```

Then open http://localhost:8080.

Every push to `main` publishes `ghcr.io/warutc/autopilot-academy:<commit sha>`.
A `v*` tag also publishes the version, for example `0.1.0`.

## Fonts

The app ships [Barlow](https://github.com/jpt/barlow) and Barlow Condensed by
Jeremy Tribby, under the SIL Open Font License 1.1. The license is in
[public/fonts/OFL.txt](public/fonts/OFL.txt).

## License

MIT. See [LICENSE](LICENSE).
