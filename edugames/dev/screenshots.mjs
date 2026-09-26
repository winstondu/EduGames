// Screenshot set of the space shooter (DEV server on :5173, unrecorded via window.__edugames, lockstep).
// usage: node dev/screenshots.mjs <outDir> [nameRegex]   — kindermath checks are answered locally (page.route), never posted.
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs'
import fs from 'node:fs'

const OUT = process.argv[2] ?? 'out'
const FILTER = process.argv[3] ? new RegExp(process.argv[3]) : null
const BASE = process.env.SHOTS_BASE ?? 'http://localhost:5173' // another port (e.g. a worktree's vite) rewrites plugin entries to it
fs.mkdirSync(OUT, { recursive: true })

const VIEWPORTS = {
  desktop: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 },
  'phone-p': { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  'phone-l': { viewport: { width: 844, height: 390 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  tablet: { viewport: { width: 820, height: 1180 }, deviceScaleFactor: 1.5, isMobile: true, hasTouch: true },
  'tablet-l': { viewport: { width: 1180, height: 820 }, deviceScaleFactor: 1.5, isMobile: true, hasTouch: true },
}

const KM_TYPED_LESSON = 'f7f517c6-43f2-4278-9288-d82e7a618d83' // Evaluating expressions (4 MCQ + 1 TYPED)
const MATH_MC = { gen: 'math', params: { format: 'mc', ops: 'add,sub,mul' } }
const MATH_FF = { gen: 'math', params: { format: 'freeform', ops: 'add,sub,mul' } }
const KM = { gen: 'kindermath', params: { lesson: KM_TYPED_LESSON } }
const fx = (set) => ({ gen: 'fixture', params: { set } })

// In-page helpers (installed once per page).
const HELPERS = `
window.__shot = {
  h: () => window.__edugames.harness,
  solve(prompt) {
    let s = prompt.replace(/\\$/g, '').replace(/\\\\times|×|·|\\\\cdot/g, '*').replace(/\\\\div|÷/g, '/').replace(/[−–]/g, '-').replace(/=\\s*\\?/, '').trim()
    if (!/^[\\d\\s+\\-*/().]+$/.test(s)) return null
    try { const v = Function('return (' + s + ')')(); return Number.isFinite(v) ? v : null } catch { return null }
  },
  target(st) { return st.asteroids.find((a) => a.id === st.target) },
  async until(pred, maxSec = 30, step = 0.25) {
    const h = this.h(); let st = h.state()
    for (let t = 0; t < maxSec && !pred(st); t += step) st = (await h.act(null, { advance: step })).state
    return pred(st)
  },
  // One oracle move: answer the target if solvable, else follow powerups.
  async oracle(opts = {}) {
    const h = this.h(); const st = h.state(); const tg = this.target(st)
    const pu = st.powerups.filter((p) => p.x < 700).sort((a, b) => a.x - b.x)[0]
    if (opts.powerups && pu && pu.lane !== st.ship.lane) return h.act('lane ' + pu.lane, { advance: 0.2 })
    if (tg && !tg.pending) {
      const v = this.solve(tg.prompt)
      if (st.inputMode === 'multiple-choice') {
        const c = st.choices.find((c) => v !== null && this.solve(c.text) === v)
        return h.act('choose ' + (c ? c.n : 1), { advance: 0.3 })
      }
      if (st.inputMode === 'freeform' && v !== null) return h.act('answer ' + v, { advance: 0.3 })
    }
    // no target in lane: go to the nearest asteroid's lane
    const next = st.asteroids.filter((a) => !a.pending).sort((a, b) => a.x - b.x)[0]
    if (next && next.lane !== st.ship.lane) return h.act('lane ' + next.lane, { advance: 0.2 })
    return h.act(null, { advance: 0.25 })
  },
}
`

async function open(page, o) {
  await page.evaluate(async (o) => {
    await window.__edugames.open({ game: 'space-shooter', seed: o.seed ?? 7, lockstep: true, ...o })
  }, o)
  await page.waitForFunction(() => window.__edugames.harness !== null)
  await page.evaluate(HELPERS)
}
const ev = (page, fn, arg) => page.evaluate(fn, arg)
const settle = (page) => page.waitForTimeout(350)

/** Advance until an unpended target of the given input mode is at a comfortable distance. */
async function toTarget(page, mode, maxSec = 40) {
  return ev(page, async ({ mode, maxSec }) => {
    const s = window.__shot; const h = s.h()
    for (let t = 0; t < maxSec; t += 0.25) {
      const st = h.state(); const tg = s.target(st)
      if (tg && st.inputMode === mode && tg.x < 950 && tg.x > 250) return true
      // move to lane of nearest asteroid with desired format
      const want = st.asteroids.filter((a) => !a.pending && a.format === mode).sort((a, b) => a.x - b.x)[0]
      if (want && want.lane !== st.ship.lane) { await h.act('lane ' + want.lane, { advance: 0.1 }); continue }
      // clear blocking asteroids of other formats via oracle
      if (tg && st.inputMode !== mode && tg.x < 500) { await s.oracle(); continue }
      await h.act(null, { advance: 0.25 })
    }
    return false
  }, { mode, maxSec })
}

const typeText = (page, text) => ev(page, (t) => window.__shot.h().send('type ' + t), text)
const play = (page, seconds, opts = {}) =>
  ev(page, async ({ seconds, opts }) => {
    const s = window.__shot; const h = s.h()
    while (h.state().time < seconds && h.state().status === 'playing') await s.oracle(opts)
  }, { seconds: seconds, opts })

async function pendingChip(page) {
  // Fire at the target and step (without awaiting the slow check) until it's pending.
  await toTarget(page, 'freeform', 40)
  const ok = await ev(page, () => {
    const s = window.__shot; const h = s.h(); const st = h.state(); const tg = s.target(st)
    const v = s.solve(tg.prompt)
    h.send('answer ' + (v ?? 1))
    for (let i = 0; i < 240; i++) { h.time.step(1); const a = h.state().asteroids.find((a) => a.id === tg.id); if (a?.pending) { h.time.step(8); return true } }
    return false
  })
  return ok
}

async function wrongToast(page, mode) {
  await toTarget(page, mode)
  await ev(page, async (mode) => {
    const s = window.__shot; const h = s.h(); const st = h.state()
    if (mode === 'multiple-choice') {
      const v = s.solve(s.target(st).prompt)
      const c = st.choices.find((c) => s.solve(c.text) !== v) ?? st.choices[0]
      await h.act('choose ' + c.n, { advance: 0.1 })
    } else { const v = s.solve(s.target(st).prompt); await h.act('answer ' + (v === null ? 1 : v + 1), { advance: 0.1 }) }
    for (let i = 0; i < 60 && h.state().wrong === 0; i++) await h.act(null, { advance: 0.05 })
    await h.act(null, { advance: 0.15 })
  }, mode)
}

async function powerups(page) {
  await ev(page, async () => {
    const s = window.__shot; const h = s.h()
    for (let i = 0; i < 1500; i++) {
      const st = h.state()
      if (st.status !== 'playing') break
      if (st.effects.filter((e) => e.remaining > 4).length >= 2 || (st.shield && st.effects.some((e) => e.remaining > 4)) || (st.time > 150 && (st.shield || st.effects.some((e) => e.remaining > 4)))) break
      await s.oracle({ powerups: true })
    }
    await s.until((st) => !!s.target(st), 2)
  })
}

async function clickPause(page) {
  await page.getByRole('button', { name: 'Pause' }).first().click()
  await page.getByRole('dialog', { name: 'Paused' }).waitFor()
}

async function gameOver(page) {
  await ev(page, async () => {
    const h = window.__shot.h()
    for (let i = 0; i < 400 && h.state().status !== 'over'; i++) await h.act(null, { advance: 1 })
  })
  await page.getByRole('dialog').first().waitFor({ timeout: 10000 })
  await page.waitForTimeout(1200) // leaderboard fetch
}

const S = []
const add = (name, vp, open, run) => S.push({ name, vp, open, run })

// ── desktop ──────────────────────────────────────────────────────────────
add('desktop-math-mc-ltr-l4-classic', 'desktop', { ...MATH_MC, settings: { lanes: 4, direction: 'ltr', ship: 'classic' } }, async (p) => { await play(p, 6); await toTarget(p, 'multiple-choice') })
add('desktop-math-ff-rtl-l5-scout', 'desktop', { ...MATH_FF, settings: { lanes: 5, direction: 'rtl', ship: 'scout' } }, async (p) => { await play(p, 6); await toTarget(p, 'freeform'); await typeText(p, '1') })
add('desktop-math-mc-ltr-l3-interceptor', 'desktop', { ...MATH_MC, settings: { lanes: 3, direction: 'ltr', ship: 'interceptor' } }, async (p) => { await play(p, 6); await toTarget(p, 'multiple-choice') })
add('desktop-math-ff-ltr-l5-interceptor', 'desktop', { ...MATH_FF, settings: { lanes: 5, direction: 'ltr', ship: 'interceptor' } }, async (p) => { await play(p, 8); await toTarget(p, 'freeform'); await typeText(p, '12') })
add('desktop-math-mc-rtl-l3-scout', 'desktop', { ...MATH_MC, settings: { lanes: 3, direction: 'rtl', ship: 'scout' } }, async (p) => { await play(p, 6); await toTarget(p, 'multiple-choice') })
add('desktop-km-typed', 'desktop', { ...KM, settings: { lanes: 4 } }, async (p) => { await toTarget(p, 'freeform', 90); await typeText(p, '8') })
add('desktop-km-mcq', 'desktop', { ...KM, settings: { lanes: 4 } }, async (p) => { await toTarget(p, 'multiple-choice', 30) })
add('desktop-fixture-long-mc', 'desktop', { ...fx('long'), settings: { lanes: 4 } }, async (p) => { await toTarget(p, 'multiple-choice', 40) })
add('desktop-fixture-long-ff', 'desktop', { ...fx('long'), settings: { lanes: 4 } }, async (p) => { await toTarget(p, 'freeform', 40) })
add('desktop-fixture-freeform-fraction', 'desktop', { ...fx('freeform'), settings: { lanes: 4 } }, async (p) => { await toTarget(p, 'freeform', 40); await typeText(p, '3/') })
add('desktop-fixture-slow-pending', 'desktop', { ...fx('slow'), settings: { lanes: 4 } }, pendingChip)
add('desktop-wrong-toast-ff', 'desktop', { ...MATH_FF, settings: { lanes: 4 } }, (p) => wrongToast(p, 'freeform'))
add('desktop-wrong-toast-mc', 'desktop', { ...MATH_MC, settings: { lanes: 4 } }, (p) => wrongToast(p, 'multiple-choice'))
add('desktop-powerups', 'desktop', { ...MATH_MC, seed: 11, settings: { lanes: 4 } }, powerups)
add('desktop-pause', 'desktop', { ...MATH_MC, settings: { lanes: 4 } }, async (p) => { await play(p, 5); await clickPause(p) })
add('desktop-settings', 'desktop', { ...MATH_MC, settings: { lanes: 4 } }, async (p) => {
  await play(p, 3); await clickPause(p)
  await p.getByRole('dialog', { name: 'Paused' }).getByRole('button', { name: 'Settings' }).click()
  await p.getByRole('dialog', { name: 'Settings' }).waitFor()
})
add('desktop-settings-keys', 'desktop', { ...MATH_MC, settings: { lanes: 4 } }, async (p) => {
  await play(p, 3); await clickPause(p)
  await p.getByRole('dialog', { name: 'Paused' }).getByRole('button', { name: 'Settings' }).click()
  const d = p.getByRole('dialog', { name: 'Settings' }); await d.waitFor()
  await d.locator('summary', { hasText: 'Keys' }).click()
  await d.locator('summary', { hasText: 'Keys' }).scrollIntoViewIfNeeded()
})
add('desktop-gameover', 'desktop', { ...MATH_MC, settings: { lanes: 4 } }, async (p) => { await play(p, 12); await gameOver(p) })

// ── phones / tablets ─────────────────────────────────────────────────────
for (const vp of ['phone-p', 'phone-l', 'tablet', 'tablet-l']) {
  add(`${vp}-math-mc`, vp, { ...MATH_MC, settings: { lanes: 4 } }, async (p) => { await play(p, 5); await toTarget(p, 'multiple-choice') })
  add(`${vp}-math-ff-numeric`, vp, { ...MATH_FF, settings: { lanes: 4 } }, async (p) => { await play(p, 5); await toTarget(p, 'freeform'); await typeText(p, '1') })
  add(`${vp}-km-typed-text`, vp, { ...KM, settings: { lanes: 4 } }, async (p) => { await toTarget(p, 'freeform', 90); await typeText(p, '8') })
  add(`${vp}-fixture-fraction`, vp, { ...fx('freeform'), settings: { lanes: 4 } }, async (p) => { await toTarget(p, 'freeform', 40); await typeText(p, '3/') })
}
for (const vp of ['phone-p', 'phone-l']) {
  add(`${vp}-rtl-l5-scout-mc`, vp, { ...MATH_MC, settings: { lanes: 5, direction: 'rtl', ship: 'scout' } }, async (p) => { await play(p, 5); await toTarget(p, 'multiple-choice') })
  add(`${vp}-l3-interceptor-ff`, vp, { ...MATH_FF, settings: { lanes: 3, ship: 'interceptor' } }, async (p) => { await play(p, 5); await toTarget(p, 'freeform') })
  add(`${vp}-fixture-long-mc`, vp, { ...fx('long'), settings: { lanes: 4 } }, async (p) => { await toTarget(p, 'multiple-choice', 40) })
  add(`${vp}-slow-pending`, vp, { ...fx('slow'), settings: { lanes: 4 } }, pendingChip)
  add(`${vp}-wrong-toast`, vp, { ...MATH_FF, settings: { lanes: 4 } }, (p) => wrongToast(p, 'freeform'))
  add(`${vp}-powerups`, vp, { ...MATH_MC, seed: 11, settings: { lanes: 4 } }, powerups)
  add(`${vp}-pause`, vp, { ...MATH_MC, settings: { lanes: 4 } }, async (p) => { await play(p, 3); await clickPause(p) })
  add(`${vp}-settings`, vp, { ...MATH_MC, settings: { lanes: 4 } }, async (p) => {
    await play(p, 3); await clickPause(p)
    await p.getByRole('dialog', { name: 'Paused' }).getByRole('button', { name: 'Settings' }).click()
    await p.getByRole('dialog', { name: 'Settings' }).waitFor()
  })
  add(`${vp}-gameover`, vp, { ...MATH_MC, settings: { lanes: 4 } }, async (p) => { await play(p, 8); await gameOver(p) })
}


// ── system keyboard field (portrait text answers): real <input> typing, soft keyboard emulated by shrinking the viewport ──
/** Type into the real field (page.keyboard → input events → quiver diff) and record field value vs engine quiver. */
async function fieldType(page, text) {
  const field = page.locator('.ss-sysfield-input')
  await field.click()
  await page.keyboard.type(text)
  const r = await ev(page, () => ({ field: document.querySelector('.ss-sysfield-input')?.value, quiver: window.__shot.h().state().quiver, focused: document.activeElement?.className, form: document.querySelector('.ss-sysfield')?.className }))
  console.log('  field', JSON.stringify(r))
  return r
}
add('phone-p-km-sysfield-typed', 'phone-p', { ...KM, settings: { lanes: 4 } }, async (p) => { await toTarget(p, 'freeform', 90); await fieldType(p, '2x') })
add('phone-p-km-sysfield-rejected', 'phone-p', { ...KM, settings: { lanes: 4 } }, async (p) => {
  await toTarget(p, 'freeform', 90)
  // Screenshots take far longer than the ~1.6 s refusal cue here: keep its reset timer from firing.
  await ev(p, () => { const st = window.setTimeout; window.setTimeout = (fn, ms, ...a) => (ms === 1600 ? 0 : st(fn, ms, ...a)) })
  await fieldType(p, 'x!')
})
add('phone-p-km-sysfield-kbd', 'phone-p', { ...KM, settings: { lanes: 4 } }, async (p) => {
  await toTarget(p, 'freeform', 90); await fieldType(p, '3x')
  await p.setViewportSize({ width: 390, height: 480 }) // ≈ what a soft keyboard leaves on a 390×844 phone
})
add('phone-p-km-sysfield-kbd-fire', 'phone-p', { ...KM, settings: { lanes: 4 } }, async (p) => {
  await toTarget(p, 'freeform', 90); await fieldType(p, '8')
  await p.setViewportSize({ width: 390, height: 480 })
  await p.keyboard.press('Enter')
  await ev(p, () => window.__shot.h().act(null, { advance: 0.3 }))
  console.log('  after Enter', JSON.stringify(await ev(p, () => ({ field: document.querySelector('.ss-sysfield-input')?.value, quiver: window.__shot.h().state().quiver, fired: window.__shot.h().events().events.filter((e) => e.type === 'fired').length }))))
})
add('tablet-km-sysfield-typed', 'tablet', { ...KM, settings: { lanes: 4 } }, async (p) => { await toTarget(p, 'freeform', 90); await fieldType(p, 'x^2') })
add('desktop-km-typed-keys', 'desktop', { ...KM, settings: { lanes: 4 } }, async (p) => {
  await toTarget(p, 'freeform', 90); await p.keyboard.type('2x')
  console.log('  desktop', JSON.stringify(await ev(p, () => ({ fields: document.querySelectorAll('.ss-sysfield-input').length, quiver: window.__shot.h().state().quiver }))))
})

// ── keyboard mockups (DOM injected into the real deck; not game code) ─────
const MOCKS = {
  // 4-col numeric: digits + extras column (− . /), ⌫ 0 FIRE×2
  numeric: { cols: 4, keys: ['1','2','3','−','4','5','6','.','7','8','9','/','⌫','0','FIRE!:2'] },
  // expression: digits block + operator block
  expression: { cols: 6, keys: ['1','2','3','x','y','^','4','5','6','+','−','=','7','8','9','(',')','/','⌫','0','.','FIRE!:3'] },
  // text: QWERTY rows, 123 toggle
  text: { cols: 10, keys: ['q','w','e','r','t','y','u','i','o','p','a','s','d','f','g','h','j','k','l','·','z','x','c','v','b','n','m','⌫:3','123:2','␣:3','FIRE!:5'] },
}
async function injectMock(page, kind, quiver) {
  await page.evaluate(({ m, quiver, kind }) => {
    const pad = document.querySelector('.ss-keypad'); if (!pad) return
    const ops = new Set(['−','.','/','x','y','^','+','=','(',')','123','␣'])
    pad.className = 'ss-keypad ss-keypad--mock'
    const keys = m.keys.map((k) => {
      const [label, span] = k.split(':')
      if (label === '·') return '<span></span>'
      const st = span ? ` style="grid-column: span ${span}"` : ''
      if (label === 'FIRE!') return `<button class="ss-fire ss-fire--pad"${st}>FIRE!</button>`
      if (label === '⌫') return `<button class="ss-key ss-key--back"${st}>⌫</button>`
      const op = ops.has(label) && !(kind === 'text' && /^[a-z]$/.test(label)) ? ' style="background:#dfe9ff' + (span ? `;grid-column: span ${span}` : '') + '"' : st
      return `<button class="ss-key"${op}>${label}</button>`
    }).join('')
    const small = kind === 'text' ? 'font-size:1.05rem;border-width:2px;border-radius:9px;box-shadow:2px 2px 0 var(--ink);min-height:42px' : kind === 'expression' ? 'font-size:1.25rem;min-height:clamp(42px,6.5dvh,60px)' : ''
    pad.innerHTML = `<style>.ss-keypad--mock .ss-keys{grid-template-columns:repeat(${m.cols},minmax(0,1fr));gap:${kind === 'text' ? 4 : 7}px}.ss-keypad--mock .ss-key{${small}}.ss-keypad--mock .ss-fire--pad{min-height:${kind === 'text' ? '42px' : '0'}}.ss-deck{justify-content:safe center}</style><div class="ss-keys">${keys}</div>`
    // drop the separate FIRE row of the old text pad
    const q = document.querySelector('.ss-quiver-text'); if (q && quiver) { q.textContent = quiver; q.classList.remove('is-empty') }
  }, { m: MOCKS[kind], quiver, kind })
}
for (const vp of ['phone-p', 'phone-l']) {
  add(`mock-${vp}-numeric-signed`, vp, { ...fx('freeform'), settings: { lanes: 4 } }, async (p) => { await toTarget(p, 'freeform', 40); await injectMock(p, 'numeric', '-3/4') })
  add(`mock-${vp}-expression-km`, vp, { ...KM, settings: { lanes: 4 } }, async (p) => { await toTarget(p, 'freeform', 90); await injectMock(p, 'expression', 'x=84') })
  add(`mock-${vp}-text`, vp, { ...KM, settings: { lanes: 4 } }, async (p) => { await toTarget(p, 'freeform', 90); await injectMock(p, 'text', 'yes') })
}

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] })
const results = []
const contexts = {}
for (const sc of S) {
  if (FILTER && !FILTER.test(sc.name)) continue
  contexts[sc.vp] ??= await browser.newContext(VIEWPORTS[sc.vp])
  const page = await contexts[sc.vp].newPage()
  const errors = []
  // Never post kindermath attempts to the demo account: answer checks locally (always correct, MCQ + TYPED).
  await page.route('**/v1/generators/kindermath/check', (route) => route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': BASE, 'access-control-allow-credentials': 'true' }, body: JSON.stringify({ correct: true, explanation: 'Checked locally (screenshot run).' }) }))
  if (!BASE.endsWith(':5173')) {
    await page.route('**/v1/generators', async (route) => {
      const res = await route.fetch(); const body = await res.json()
      for (const g of body.generators ?? []) g.entry = g.entry.replace('http://localhost:5173', BASE)
      await route.fulfill({ response: res, json: body })
    })
  }
  page.on('pageerror', (e) => errors.push(String(e)))
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
  const t0 = Date.now()
  let status = 'ok'
  try {
    await page.goto(BASE + '/?unrecorded=1')
    await page.waitForFunction(() => !!window.__edugames)
    const { gen, params, seed, settings } = sc.open
    await open(page, { gen, params, seed, settings })
    const r = await sc.run(page)
    if (r === false) status = 'setup-incomplete'
    await settle(page)
  } catch (e) {
    status = 'error: ' + String(e.message ?? e).split('\n')[0]
  }
  try { await page.screenshot({ path: `${OUT}/${sc.name}.png` }) } catch { status += ' / shot failed' }
  const meta = await page.evaluate(() => { const h = window.__edugames?.harness; if (!h) return null; const s = h.state(); return { status: s.status, time: s.time, inputMode: s.inputMode, input: s.input, quiver: s.quiver, effects: s.effects, shield: s.shield, lives: s.lives, target: s.asteroids.find((a) => a.id === s.target)?.prompt } }).catch(() => null)
  results.push({ name: sc.name, vp: sc.vp, open: sc.open, status, errors: errors.slice(0, 5), meta, ms: Date.now() - t0 })
  console.log(sc.name, status, errors.length ? `errors:${errors.length}` : '', Date.now() - t0 + 'ms')
  await page.close()
}
fs.writeFileSync(`${OUT}/results-${Date.now()}.json`, JSON.stringify(results, null, 2))
await browser.close()
