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

## The plant model

Every algorithm flies the same plant, defined in `src/sim/plant.ts`. If you
want to design a controller offline (in MATLAB, Python or on paper), this is
the model to design against.

### Continuous-time dynamics

The plane flies at a constant forward speed, so only its altitude is
controlled. The state is the altitude `h` (m) and the climb rate `v` (m/s);
the input is the elevator command `u`, clipped to [-1, 1]:

```math
\begin{aligned}
\dot h &= v \\
\dot v &= -a\,v + b\,u + d \\
\dot x &= V
\end{aligned}
```

| Symbol | Meaning | Value |
| --- | --- | --- |
| `a` | climb-rate damping | 0.5 1/s |
| `b` | elevator gain | 20 m/s² per unit of `u` |
| `V` | forward speed | 20 m/s |
| `d` | disturbance acceleration (see below) | 0 in calm air |
| `h(0)`, `v(0)` | initial altitude and climb rate | 50 m, 0 m/s |

In state-space form, with `x = [h, v]ᵀ` and the altitude as the output:

```math
A = \begin{bmatrix} 0 & 1 \\ 0 & -a \end{bmatrix},\quad
B = \begin{bmatrix} 0 \\ b \end{bmatrix},\quad
C = \begin{bmatrix} 1 & 0 \end{bmatrix}
```

From the elevator to the altitude it is an integrator in series with a first-order lag:

```math
G(s) = \frac{H(s)}{U(s)} = \frac{b}{s\,(s + a)} = \frac{20}{s\,(s + 0.5)}
```

The open-loop poles are at `s = 0` and `s = -0.5`. Full up elevator
(`u = 1`) settles at a climb rate of `b/a = 40 m/s`.
With a state feedback `u = -k_h·h - k_v·v` (plus a reference term), the closed loop has the characteristic polynomial
`s² + (a + b·k_v)·s + b·k_h`. The built-in Pole Placement, LQR and PID
lessons all start from this.

### Sampling and the simulation step

- The controller runs every `Tc = 0.02 s` (50 Hz). Its output is held
  constant until the next tick (zero-order hold).
- The physics steps every `dt = 0.005 s`, four steps per control tick,
  with semi-implicit Euler: `v` is updated first, then `h` with the new `v`.
- For a discrete-time design at `Tc`, the Kalman filter in `src/sim/kalman.ts`
  uses the Euler model
  `A_d = [[1, Tc], [0, 1 - a·Tc]]`, `B_d = [0, b·Tc]ᵀ`. For an exact
  zero-order-hold discretization, apply `c2d` to `(A, B)` with `Tc`.

### What the controller sees

`compute(ctx)` gets the altitude reference `ref`, the measured altitude
`h` and a climb rate `v`, not the true state:

- With the altimeter noise at σ = 0 (the default), `h` is the true altitude.
- With noise, the altimeter reads `y = h + σ·n`, where `n ~ N(0, 1)` is drawn
  fresh each step.
- With the Kalman filter off, `ctx.h = y` and `ctx.v` is the finite difference
  `(y − y_prev) / Tc`, which is 0 on the first tick. Noise in `y` therefore
  shows up amplified in `ctx.v`.
- With the Kalman filter on, `ctx.h` and `ctx.v` are the filter's estimates.
  It uses the model above, white-acceleration process noise of intensity `Q`
  and a measurement variance `R` (the Q and R sliders).

### Disturbances

The Flight conditions card sets the disturbance acceleration `d`:

```math
d(t) = -d_{\text{down}} + \sigma_g\, g(t), \qquad
dg = -g\,dt + \sqrt{2}\, dW
```

`d_down` is the steady downdraft and `σ_g` the gust strength (rms, m/s²).
`g(t)` is an Ornstein–Uhlenbeck process with unit variance and a 1 s
correlation time. It is seeded from the course number, so a course always
has the same gusts. A steady downdraft is a constant input disturbance, and
only a controller with integral action removes the error it causes.

### The course and the score

- The reference `ref(x)` is piecewise constant, a series of steps. It starts
  at 50 m and switches to each ring's altitude halfway between rings (80 m
  before the first ring). `ctx.refAhead(τ)` returns the reference
  `V·τ` meters ahead, for predictive controllers such as MPC.
- There are 10 rings, 160 m apart starting at `x = 200 m` (one every 8 s),
  each 22–88 m high and 10–45 m above or below the previous one. The course
  ends 100 m after the last ring.
- A ring is passed when `|h − h_ring| ≤ 7 m` as the plane crosses it. It
  scores `4 + 6·(1 − err/7)` points: 10 at the center, 4 at the rim, 0 when
  missed.
- Leaving the safe band 6 m ≤ `h` ≤ 110 m is a crash and ends the flight.
- The logbook also records the IAE, `∫|ref − h| dt`, and the control energy,
  `∫u² dt`, so you can compare tracking against effort.

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
