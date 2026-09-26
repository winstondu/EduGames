# Space Shooter

Horizontal lane shooter. The ship sits on the leading edge (left for `ltr`,
right for `rtl`) and moves between 3–5 lanes. Asteroids drift in from the far
edge carrying a problem from a **generator plugin**; the player loads an answer
into the ship's **quiver** (bubble above the ship) and fires it down the lane.
A correct answer destroys the asteroid; a wrong one fizzles and breaks the
streak. An asteroid reaching the leading edge costs a life (shield absorbs).

URL: `/space-shooter?gen=<generatorId>[&mode=typed|choice][&<generator options>]`

- **typed** mode: type the answer (bubble shows it), Space/Enter fires.
- **choice** mode: 4 answers for the target in your lane are listed in a strip
  along the leading edge; pick with 1–4 or tap (loads + fires).

## Module boundaries

```
src/generators/            plugin contract + registry (no game/DOM imports)
  types.ts                 GeneratorPlugin, ProblemSource, Problem
  registry.ts              id → lazy import
  math/                    arithmetic plugin: generator.ts, checker.ts, index.ts
src/games/space-shooter/
  engine/                  pure deterministic sim (types.ts is the contract)
  render/                  Canvas 2D renderer; render/sprites/ procedural art
  assets/                  SVG ships + powerup icons, spec.ts art contract
  ui/                      React shell: menu, settings, HUD overlay, game over, leaderboard
  settings.ts              ship / direction / lanes (localStorage)
src/shared/                rng, highscores API types + client
worker/                    Cloudflare Worker: /api/scores on D1
migrations/                D1 schema
```

Dependency rule: `engine` → `generators/types` only. `render` → `engine/types`,
`assets`. `ui` → everything. Generators never import from games.
