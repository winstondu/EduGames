# Handoff — EduGames space shooter (branch `feat/space-math`)

Status as of 2026-09-26. Read `src/games/space-shooter/README.md` first (architecture,
module boundaries, dev ports).

## Where things stand

Built and merged (317 tests, typecheck + lint clean):

- **Platform contracts** — m games + n generators. `src/generators/types.ts` (plugin,
  problem formats `freeform | multiple-choice`, requirements, manifest, auth hook),
  `src/games/types.ts` + `registry.ts` (games declare formats), `src/shared/harness/types.ts`.
- **Generators** (served by the API, loaded at runtime via manifest + `import()`):
  `math` (client), `kindermath` (hybrid: browser half + `api/src/generators/kindermath.ts`
  pass-through), `fixture` (client, hidden, test-only sets incl. slow/flaky checks).
- **Engine** — pure deterministic sim (`engine/`), async answer checks via
  `checkRequested` / `resolveCheck`; bolts carry `targetId`.
- **Shared kit** — fixed stepper, check broker, HUD store, FSM, AudioDirector (ZzFX +
  chiptune sequencer), mathtext (`$…$` → canvas + React), time controller
  (`kit/time.ts`), keymap + `KeymapEditor` (`kit/input/`), hidden `unrecorded` flag.
- **Art** — 3 ship SVGs, powerup + UI icons, procedural asteroids/background/FX.
- **View** — Excalibur 0.32 (`render/`), `createGameView` contract; dev preview at
  `dev/view-preview.html`.
- **UI** — launcher (game → compatible generators → variants/format), space shooter
  screen, HUD, question banner, choice strip, keypad, pause, game over + leaderboard.
- **API Worker** (`api/`, → `api.games.winstondu.com`) — CORS, `/v1/scores` on D1,
  `/v1/generators` manifest + `/plugins/*` modules + `/v1/generators/<id>/*` pass-throughs.
- **Headless harness** — `src/games/space-shooter/harness/` + `bun run sim`
  (bots random/wrong/oracle, `--repl`, replays, invariant soak tests).

**Browser play-test (session 2, partial):** launcher → start screen → math MC + freeform
runs → game over were driven with Playwright in headless Chromium (swiftshader). Rendering,
HUD, target ring, quiver bubble, choice strip and game-over dialog all work; no console errors.
Fixed: game over showed the nickname prompt under `unrecorded=1` — GameOver now hides it and
`submitScore` refuses to send (`HighScoreError` kind `'unrecorded'`, test in
`src/shared/highscores/client.test.ts`). The scene now paces steps with `createTimeController`
and takes a `step` override (`GameView.time`, `GameViewOptions.speed/step`) — groundwork for
part 2 below. Not yet covered: RTL, lanes 3/5, ships, powerups, pause/settings dialog, phone
layout, kindermath lessons (needs the password). DOM-only bots are too slow for real-time
play — finish `window.__edugames` first, then play-test through it.
Review/fix pass not run.

## Verification layers (the plan)

1. **Generator harness** — TODO: a conformance suite (`src/generators/conformance.ts`)
   run against every plugin: formats honored, requirements respected (and
   `IncompatibleGeneratorError` by name), determinism per seed, `boardKey` pattern,
   check behavior (MC ids, freeform normalization), parse/serialize round trip.
2. **Text-layer game harness** — built (`bun run sim`, `--repl`). TODO: expose it as
   tools for an LLM agent (e.g. a Sonnet driver) — either WebMCP on the DEV page or a
   small stdio MCP server wrapping the same `GameHarness` API (`state/send/act/events/time`).
3. **Real-game harness** (part 2) — DONE in session 3 (see the shooter README "DEV
   harness"): `window.__edugames` (`open`, `harness`, `session`, `close`), meta panel,
   single broker via `harness.tick`, player speed setting (+ 🐢 on HUD and leaderboard),
   key presets / rebinding via `KeymapEditor`, `deriveSeeds` in browser sessions (browser
   replays reproduce in `bun run sim --replay`), `bun run check:dist`. Original plan:
   - DONE: the view loop uses `createTimeController` (`GameView.time`). TODO: in DEV pass
     `step: harness.tick` to `createGameView` and skip the session's own check broker
     (single broker — don't run two). Plan: route verdict/`send()` events from
     `harness.subscribe` (outside a view tick) into `view.pushEvents` + the session pipeline;
     `advanceSteps(n)` resolves when `harness.stepIndex` reaches the target;
     `onTimeChange` → `view.time.setScale/setLockstep`; `harness.time.step(n)` runs ticks
     directly (the scene shows alpha = 1 in lockstep, so that's fine).
   - Player settings: add `speed: GameSpeed` (1/0.75/0.5/0.25) and key presets via
     `<KeymapEditor>`; route keyboard through `keymap.match(e, {textEntry})` +
     `mapActionToCommand` (replace `ui/controls.ts` hard-coded mapping).
   - DEV-only (`import.meta.env.DEV`, dynamic import): `window.__edugames` (`open({game,
     gen, params, seed, speed, lockstep})`, `harness`), meta panel (generator + variant id,
     seed, format, lanes, direction, ship, time scale, lockstep, step, command console,
     event log, state inspector, export replay), fixture generator visible only here.
   - Harness time scale **overrides** the player's speed while active and restores it.
   - Seed browser sessions with `deriveSeeds(seed)` (harness/session.ts) so replays run
     in `scripts/sim.ts`.
   - Guard score submission + name prompt with `!isUnrecorded()`; harness forces it on.
   - Verify: play a full lockstep session through `window.__edugames` (unrecorded), and
     confirm `dist/` contains no harness code (grep for `__edugames`).

## Feature TODO

- DONE (session 3): **Drag to steer** (user request): mouse/touch drag on the stage moves the ship between
  lanes, snapping cleanly — lane changes as the pointer crosses into a lane (with a little
  hysteresis at the boundaries so it doesn't jitter), the ship eases into the lane like
  keyboard moves, taps keep working. Pointer capture so drags that leave the canvas still
  track; don't start a drag from buttons / choice strip / keypad.

## Decisions from the user (don't re-litigate)

- Generators are plugins selected by URL (`?gen=…`), hosted by the API, never bundled
  into games. Leaderboards are per `plugin.boardKey(options)` (one per kindermath lesson).
- All server code → Cloudflare Worker at `api.games.winstondu.com`. Frontend stays
  assets-only at `games.winstondu.com`.
- Rendering: Excalibur, with our pure engine as source of truth.
- Harness is **DEV-only**. LLM play must **never record scores** (hidden `unrecorded`
  flag; not in any settings UI). Slow-mo scores go on the normal board with a 🐢 badge.
- Key presets (arrows / WASD / both, rebinding) are a **game player setting**, not harness.
- kindermath auth is a demo-account stub (server logs in with
  `KINDERMATH_DEV_USER_EMAIL` + `KINDERMATH_DEMO_PASSWORD` secret); the plugin contract has
  a `login` hook for real per-user login later. Checks POST practice attempts to the demo
  account — keep live checks to a handful.
- Confirm architecture changes with the user before large implementation.

## Environment notes

- Cloud sessions: use the **WinstonKinderMath** environment; it should carry
  `KINDERMATH_DEMO_PASSWORD` as an env var. At start: `cp api/.dev.vars.example api/.dev.vars`
  and fill the password line from `$KINDERMATH_DEMO_PASSWORD` (never print it). Playwright:
  `/opt/node22/lib/node_modules/playwright/index.mjs`, `executablePath: '/opt/pw-browsers/chromium'`,
  args `--use-gl=swiftshader --enable-unsafe-swiftshader`. The user wants **Sonnet subagents**
  for play-testing (report-only; they must use `unrecorded=1`).
- Secrets are NOT in git: `api/.dev.vars` (copy from `.dev.vars.example`; the demo
  password must be provided by the user). Without it, kindermath lesson routes 502 at login;
  `courses` still works.
- Dev ports: frontend 5173, API **8788** (`bun run dev:api`). On the user's Mac, 8787 and
  5173 are used by other projects — if Vite moves ports, update `GENERATORS_DEV_ORIGIN` /
  `ALLOWED_ORIGINS` in `api/.dev.vars` or pin `server.port` in `vite.config.ts`.
- kindermath `practice` returns a fixed 5 of a lesson's 10 questions; the pool cycles them.
- Local D1: `bun run db:migrate:local`. Remote D1 is not created; nothing is deployed.
  Deploying needs the user's go-ahead: `wrangler d1 create` (or auto-provision), custom
  domain `api.games.winstondu.com`, `wrangler secret put KINDERMATH_DEMO_PASSWORD`,
  `bun run deploy:api`, then `bun run deploy`.

## Commands

```
bun install
bun run test            # all unit + soak tests
bun run typecheck && bun run lint
bun run generators:build
bun run db:migrate:local && bun run dev:api   # API on :8788
bun run dev                                   # frontend
bun run sim -- --gen math --bot oracle --games 5
bun run sim -- --gen math --params 'format=mc&ops=add' --seed 1 --repl
```
