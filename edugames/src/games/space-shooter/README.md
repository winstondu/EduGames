# Space Shooter

Horizontal lane shooter. The ship sits on the leading edge (left for `ltr`,
right for `rtl`) and moves between 3–5 lanes. Asteroids drift in from the far
edge carrying a problem from a **generator plugin**; the player loads an answer
into the ship's **quiver** (bubble above the ship) and fires it down the lane.
A correct answer destroys the asteroid; a wrong one fizzles and breaks the
streak. An asteroid reaching the leading edge costs a life (shield absorbs).

URL: `/space-shooter?gen=<generatorId>&<generator options>`
(e.g. `?gen=math&mode=choice&ops=add,sub`, `?gen=kindermath&lesson=<uuid>`)

Answer input is decided **per problem**: a problem with `choices` lists them in
a strip along the leading edge (pick with 1–4 or tap → fires); otherwise the
player types into the quiver bubble (Space/Enter fires). Answers are checked
through the plugin (possibly server-side): the hit asteroid freezes as
*pending* until the verdict arrives.

Generator plugins are **not bundled** with the game: `GET /api/generators`
returns a manifest and the registry `import()`s the named module. Hybrid
plugins reach their server half at `/api/generators/<id>/*` (Worker
pass-through to e.g. api.kindermath.org). Leaderboards are per
`plugin.boardKey(options)` — one per kindermath lesson.

## Module boundaries

```
src/generators/            plugin contract + registry (no game/DOM imports)
  types.ts                 GeneratorPlugin, ProblemSource, Problem, manifest
  registry.ts              manifest fetch → same-origin dynamic import
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
src/shared/                rng, highscores API types + client
worker/                    Cloudflare Worker: /api/scores (D1), /api/generators (manifest + hybrid pass-through)
  generators/              server halves of hybrid plugins (kindermath.ts)
migrations/                D1 schema
```

Dependency rule: `engine` → `generators/types` only. `render` → `engine`,
`assets`, `shared/kit`, `shared/mathtext`, excalibur. `ui` → everything except
concrete generators. Generators import only `generators/types` (type-only) and
`shared/rng`, `shared/mathtext` — never games, React, or Excalibur.
