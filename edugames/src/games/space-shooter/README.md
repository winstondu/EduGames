# Space Shooter

Horizontal lane shooter. The ship sits on the leading edge (left for `ltr`,
right for `rtl`) and moves between 3–5 lanes. Asteroids drift in from the far
edge carrying a problem from a **generator plugin**; the player loads an answer
into the ship's **quiver** (bubble above the ship) and fires it down the lane.
A correct answer destroys the asteroid; a wrong one fizzles and breaks the
streak. An asteroid reaching the leading edge costs a life (shield absorbs).

URL: `/space-shooter?gen=<generatorId>&<generator options>`
(e.g. `?gen=math&format=mc&ops=add,sub`, `?gen=kindermath&lesson=<uuid>`)

Answer input is decided **per problem**: a problem with `choices` lists them in
a strip along the leading edge (pick with 1–4 or tap → fires); otherwise the
player types into the quiver bubble (Space/Enter fires). Answers are checked
through the plugin (possibly server-side): the hit asteroid freezes as
*pending* until the verdict arrives.

Generator plugins are **not bundled** with any game (m games + n generators):
`GET https://api.games.winstondu.com/v1/generators` returns a manifest and the
registry `import()`s the named module. Hybrid plugins reach their server half
at `<API_BASE>/v1/generators/<id>/*` (API Worker pass-through to e.g.
api.kindermath.org). Leaderboards are per `plugin.boardKey(options)` — one per
kindermath lesson. The space shooter supports both problem formats.

## Module boundaries

```
src/games/types.ts         GameDefinition (formats it supports); src/games/registry.ts lists games
src/generators/            plugin contract + registry (no game/DOM imports)
  types.ts                 GeneratorPlugin, ProblemSource, Problem, manifest
  registry.ts              manifest fetch → dynamic import from the API origin (CORS)
  math/                    client plugin: generator.ts, checker.ts, index.ts
  kindermath/              hybrid plugin (browser half)
src/shared/kit/            game-agnostic: fixed stepper, check broker, HUD store, FSM, audio
src/shared/mathtext/       $…$ TeX-subset parser + canvas/React renderers
src/games/space-shooter/
  engine/                  pure deterministic sim (types.ts is the contract)
  render/                  Excalibur view (scene, actors, FX); render/sprites/ procedural art
  assets/                  SVG ships + powerup icons, spec.ts art contract
  ui/                      React shell: menu, settings, HUD overlay, game over, leaderboard
  settings.ts              ship / direction / lanes (localStorage)
src/shared/                rng, apiBase, highscores API types + client
api/                       API Worker → https://api.games.winstondu.com (own wrangler.jsonc)
  src/index.ts             router + CORS: /v1/scores (D1), /v1/generators (manifest), /plugins/* (modules)
  src/generators/          server halves of hybrid plugins (kindermath.ts)
  migrations/              D1 schema
```

Dependency rule: `engine` → `generators/types` only. `render` → `engine`,
`assets`, `shared/kit`, `shared/mathtext`, excalibur. `ui` → everything except
concrete generators. Generators import only `generators/types`, `shared/rng`,
`shared/mathtext` — never games, React, or Excalibur. Nothing under
`src/generators/` or `api/` may mention a specific game.
