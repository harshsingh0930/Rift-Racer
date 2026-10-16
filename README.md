# Rift Racer

Rift Racer is a local, single-player arcade driving prototype built for
the Buildathon. The game uses a custom movement model rather than a full
physics engine. The first route moves from a coastal boulevard through a
tunnel and into an underwater section before returning to the coast.

## Current setup

The repository is an ESM package (`"type": "module"`) with the following
toolchain:

| Area | Version / choice |
| --- | --- |
| Runtime | Node.js 22 LTS or newer (Vite 7 also supports the current Node 20.19+ / 22.12+ lines) |
| Language | TypeScript 5.9 |
| Dev server and bundler | Vite 7.1 |
| 3D runtime | Three.js 0.180 with `@types/three` 0.180 |
| Test runner | Vitest 3.2 |
| Module format | Native ESM in the browser and Node tooling |

The game logic is intentionally renderer- and UI-independent:

- `src/game/arcade.ts` contains responsive acceleration, steering, drift,
  grip, and soft-wall collision helpers.
- `src/game/track.ts` builds and samples the deterministic route.
- `src/game/performance.ts` probes browser capabilities, selects a quality
  profile, persists the welcome-screen choice, and adapts resolution and
  particle budgets from frame time.
- `src/game/storage.ts` stores a best time in browser-local storage when that
  API is available.

`tsconfig.json` is the non-source TypeScript configuration required by the
existing `npm run build` script. It uses strict checking, ES2022 output
semantics, Vite's bundler module resolution, DOM types, and no emit because
Vite owns the final bundle.

The browser entry (`index.html` plus `src/main.ts`) is included, so both the dev
server and production bundle render the game. `package-lock.json` is also
included for reproducible installs; use `npm ci` in CI or Docker and `npm
install` when developing locally.

## Install and commands

From the project root:

```bash
npm install
```

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start Vite's development server (normally `http://localhost:5173`). |
| `npm run dev -- --host 0.0.0.0` | Start the dev server on all container/network interfaces. |
| `npm run build` | Run `tsc --noEmit`, then create the Vite production bundle in `dist/`. |
| `npm test` | Run the Vitest suite once in CI-friendly mode. |
| `npm run preview` | Serve the built `dist/` bundle locally (normally port 4173). |
| `npm run preview -- --host 0.0.0.0 --port 4173` | Preview from a container or another device. |

The test file under `tests/` exercises the pure arcade, route, performance, and
storage helpers without requiring a DOM or WebGL context. A browser entrypoint
is not needed to run those tests. `npm run build` does require the Vite entry
described above; until that entry is supplied, Vite will report its normal
missing-entry error after the TypeScript check succeeds.

## Controls

The simulation accepts normalized `ArcadeInput` values, so a keyboard or
gamepad adapter can be kept separate from the game loop:

| Action | Recommended keyboard mapping | Input contract |
| --- | --- | --- |
| Accelerate | `W` or `ArrowUp` | `throttle: 1` |
| Reverse | `S` or `ArrowDown` | `throttle: -1` |
| Steer left/right | `A` / `D` or `ArrowLeft` / `ArrowRight` | `steer: -1` / `1` |
| Brake / handbrake | `Space` | `brake: 1` |
| Explicit drift | `Shift` (optional adapter mapping) | `drift: 1` |
| Reset run | `R` (UI/scene adapter) | Reset the car and timer |

Steering and throttle values are clamped to `-1..1`; brake and drift values
are clamped to `0..1`. Braking while steering automatically produces a
readable drift, so the explicit drift input is optional. The current game
modules do not bind DOM keyboard events themselves; the browser shell should
translate events into this contract.

## Performance tiers and low-end goals

`src/game/performance.ts` exposes three renderer profiles:

| Tier | Resolution scale | Particle multiplier / cap | Antialiasing | Real-time lighting | Shadow quality |
| --- | ---: | ---: | --- | --- | --- |
| **Eco** | `0.75` | `0.5` / `700` | Off | Off | Off |
| **Balanced** | `1.0` | `1.0` / `1,400` | On | On | Standard |
| **Ultra** | `1.5` | `1.75` / `3,200` | On | On | High |

Initial selection is conservative: no WebGL 2, at most two hardware threads, or
at most 2 GB of reported device memory selects Eco. Ultra requires WebGL 2 plus
at least eight hardware threads, at least 8 GB of reported memory, and a 4096+
texture limit; other capable devices start at Balanced. Browser capability
values are treated as hints and the game remains usable when a privacy setting
omits them.

The welcome screen also provides an explicit Eco/Balanced/Ultra selector. A
selection is stored under `rift-racer.quality-profile` in local storage and is
used on the next reload. When changed while the title screen is ready, Rift
Racer safely rebuilds the quality-sensitive scene groups before the next run.
Older locally stored `high` values are migrated to Ultra.

The adaptive frame-time governor targets roughly 16.7 ms per frame (60 FPS).
It lowers resolution and particle budgets when frames remain slow and restores
them gradually after several fast samples. Renderer integration should keep
effects pooled, lighting simple, and resolution dynamic rather than allocating
objects in the hot loop.

The low-end acceptance goal is a stable, readable 30 FPS on an integrated-GPU
class device with two cores and around 2 GB of available memory using Eco. The
Balanced target is 60 FPS on a typical modern laptop. These are buildathon
targets to verify on representative hardware, not a claim about every browser
or GPU.

### Browser graphics requirement

Rift Racer uses Three.js with WebGL 2. The welcome screen and graphics error
screen call out the requirement directly. If the browser reports an unavailable
or exhausted graphics driver, enable hardware acceleration in the browser
settings and reload the game; without it the 3D route cannot run as intended.

## Docker

The included multi-stage Dockerfile uses the existing npm scripts. It installs
dependencies, runs `npm run build`, and serves the resulting bundle with Vite
Preview on port 4173:

```bash
docker build -t rift-racer .
docker run --rm -p 4173:4173 rift-racer
```

Open <http://localhost:4173> after the container starts. The container command
is equivalent to:

```bash
npm run preview -- --host 0.0.0.0 --port 4173
```

The build stage uses `npm ci` from the checked-in lockfile. As with local
`npm run build`, the browser entrypoint is compiled before the container serves
the page.
