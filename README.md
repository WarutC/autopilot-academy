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
