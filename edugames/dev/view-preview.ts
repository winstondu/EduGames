/**
 * Dev preview for the space-shooter view: mounts createGameView with the real
 * engine and a small fake ProblemSource (short freeform prompts, a long prompt,
 * a labelled one, multiple-choice), and auto-plays with delayed checks.
 *
 *   /dev/view-preview.html?direction=rtl&lanes=5&ship=scout&auto=0&shield=3&boost=1&freeze=6&mortal=1&log=1
 */
import type { CheckResult, Problem, ProblemSource } from '../src/generators/types'
import { createEngine } from '../src/games/space-shooter/engine'
import type { Direction, GameEvent } from '../src/games/space-shooter/engine/types'
import type { ShipSkinId } from '../src/games/space-shooter/assets/ships'
import { createGameView } from '../src/games/space-shooter/render'
import { createCheckBroker } from '../src/shared/kit/checkBroker'

const params = new URLSearchParams(location.search)
const direction: Direction = params.get('direction') === 'rtl' ? 'rtl' : 'ltr'
const lanes = Math.min(5, Math.max(3, Number(params.get('lanes')) || 4))
const ship = (['classic', 'scout', 'interceptor'].find((s) => s === params.get('ship')) ?? 'classic') as ShipSkinId
const auto = params.get('auto') !== '0'
const freezeAt = Number(params.get('freeze')) || 0
const seed = Number(params.get('seed')) || 7

interface Spec {
  prompt: string
  label?: string
  answer: string
  choices?: string[]
  /** Index of the right choice. */
  right?: number
}

const SPECS: Spec[] = [
  { prompt: '6 + 7', answer: '13' },
  { prompt: '12 − 5', answer: '7' },
  { prompt: '3 × 4', answer: '12' },
  { prompt: '7 × 8', answer: '56', choices: ['54', '56', '58', '64'], right: 1 },
  { prompt: 'Sam has 12 apples and gives 5 to Ana. How many apples does Sam have left?', answer: '7' },
  { prompt: 'What is $\\frac{1}{2} + \\frac{1}{4}$ as a fraction?', label: '$\\frac{1}{2}+\\frac{1}{4}$', answer: '3/4', choices: ['$\\frac{3}{4}$', '$\\frac{2}{6}$', '$\\frac{1}{8}$'], right: 0 },
  { prompt: '48 ÷ 6', answer: '8' },
  { prompt: '$x^2 = 49$, x = ?', answer: '7', choices: ['6', '7', '8', '9'], right: 1 },
  { prompt: '125 + 250', answer: '375' },
]

let nextId = 1
const fake: ProblemSource = {
  next(level) {
    const spec = SPECS[(nextId - 1) % SPECS.length]
    const id = `p${nextId++}`
    const problem: Problem = {
      id,
      prompt: spec.prompt,
      label: spec.label,
      level,
      format: spec.choices ? 'multiple-choice' : 'freeform',
      choices: spec.choices?.map((text, i) => ({ id: `c${i}`, text })),
      input: spec.choices ? undefined : { kind: 'numeric', maxLength: 6, allow: '/' },
    }
    answers.set(id, spec)
    return problem
  },
  check(problem, given): Promise<CheckResult> {
    const spec = answers.get(problem.id)
    const correct = problem.format === 'multiple-choice' ? given === `c${spec?.right}` : given === spec?.answer
    // Slow on purpose so the pending ring shows.
    return new Promise((resolve) => setTimeout(() => resolve({ correct, expected: spec?.answer }), 450))
  },
}
const answers = new Map<string, Spec>()

const engine = createEngine({
  lanes,
  problems: fake,
  defaultInput: { kind: 'numeric', maxLength: 6 },
  maxLevel: 10,
  seed,
})

const canvas = document.getElementById('game') as HTMLCanvasElement
const broker = createCheckBroker({
  check: (p: Problem, g: string) => fake.check(p, g),
  dispatch: (command) => view.pushEvents(engine.dispatch(command as Parameters<typeof engine.dispatch>[0])),
})

const view = createGameView({
  canvas,
  engine,
  direction,
  ship,
  onStep(events: GameEvent[]) {
    broker.handle(events)
    for (const e of events) if (e.type !== 'asteroidSpawned') log(e)
  },
})

function log(e: GameEvent): void {
  if (params.get('log') === '1') console.log(e.type, e)
}

function send(command: Parameters<typeof engine.dispatch>[0]): void {
  view.pushEvents(engine.dispatch(command))
}

// Preview-only pokes at the live state so screenshots show optional visuals.
const shield = Number(params.get('shield')) || 0
if (shield > 0) engine.state.shield = shield
if (params.get('boost') === '1') engine.state.effects.push({ kind: 'speedBoost', remaining: 999, duration: 999 })
// Keep the demo running unless ?mortal=1.
if (params.get('mortal') !== '1') setInterval(() => (engine.state.lives = Math.max(engine.state.lives, 2)), 500)

void view.ready.then(() => {
  console.log('[view-preview] ready', { direction, lanes, ship })
  if (freezeAt > 0) setTimeout(() => view.setPaused(true), freezeAt * 1000)
})

// ── autoplay: steer to the nearest asteroid, type/pick an answer (sometimes wrong) ──

let typing: string[] = []
let tick = 0
if (auto) {
  setInterval(() => {
    const s = engine.state
    if (s.status !== 'playing') return
    tick++
    const nearest = [...s.asteroids].filter((a) => !a.pending && a.x < 1500).sort((a, b) => a.x - b.x)[0]
    if (nearest && nearest.lane !== s.ship.lane) {
      send({ type: 'moveToLane', lane: nearest.lane })
      typing = []
      return
    }
    const target = s.asteroids.find((a) => a.id === s.targetId)
    if (!target || target.x > 1350) return
    const spec = answers.get(target.problem.id)
    if (!spec) return
    const wrong = tick % 5 === 0
    if (s.inputMode === 'multiple-choice') {
      if (tick % 3 !== 0) return
      const right = spec.right ?? 0
      send({ type: 'choose', index: wrong ? (right + 1) % s.choices.length : right })
      return
    }
    if (!typing.length && !s.quiver) typing = [...(wrong ? String(Number(spec.answer) + 1 || 9) : spec.answer)]
    const ch = typing.shift()
    if (ch) send({ type: 'typeChar', char: ch })
    else if (s.quiver) send({ type: 'fire' })
  }, 260)
}

window.addEventListener('keydown', (e) => {
  const s = engine.state
  if (e.key === 'ArrowUp') send({ type: 'moveUp' })
  else if (e.key === 'ArrowDown') send({ type: 'moveDown' })
  else if (e.key === 'Enter' || e.key === ' ') send({ type: 'fire' })
  else if (e.key === 'Backspace') send({ type: 'backspace' })
  else if (e.key === 'p') view.setPaused(!paused)
  else if (/^[0-9/.-]$/.test(e.key)) {
    if (s.inputMode === 'multiple-choice') send({ type: 'choose', index: Number(e.key) - 1 })
    else send({ type: 'typeChar', char: e.key })
  } else return
  if (e.key === 'p') paused = !paused
  e.preventDefault()
})
let paused = false

canvas.addEventListener('pointerdown', (e) => {
  const w = view.clientToWorld(e.clientX, e.clientY)
  console.log('[view-preview] world', w, '→ client', view.worldToClient(w.x, w.y))
})

Object.assign(window, { engine, view })
