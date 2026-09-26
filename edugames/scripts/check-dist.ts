/**
 * Fails if the production build (dist/) contains DEV-only harness code.
 * Run after `bun run build`: `bun run check:dist` (`bun run deploy` runs it before uploading).
 *
 * Three independent checks, because minification renames identifiers:
 *  1. Module paths — `.vite/modules.json` (written by the module-map plugin in vite.config.ts) lists
 *     every source module in every chunk; `.vite/manifest.json` lists entry / dynamic chunks. No path
 *     may lie in a `harness/` directory (src/shared/harness, src/games/<game>/harness).
 *  2. String literals that exist only in harness code (a DOM id, a window property, error texts).
 *     Minifiers keep string contents, so any bundled harness module leaves one of these behind.
 *     Each literal must still occur in a harness source file, or this script fails (no silent rot).
 *  3. `.vite/` is build metadata: `.assetsignore` must keep it out of the deployed assets.
 */
import { existsSync } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import { join, relative } from 'node:path'

const HARNESS_PATH = /(^|\/)harness\//

/** Literals found only in harness modules (src/shared/harness, src/games/space-shooter/harness). */
const LITERALS = [
  '__edugames', // runtime.ts: window property
  'edugames-harness', // mountMetaPanel.tsx / MetaPanel.tsx: host element id
  'superseded by another open()', // runtime.ts
  'resolveCheck is host-only', // commands.ts
  'Freeform shortcut: clear + type <text> + fire.', // commands.ts
]

async function* walk(dir: string, filter: (name: string) => boolean): AsyncGenerator<string> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules') yield* walk(path, filter)
    } else if (filter(entry.name)) yield path
  }
}

async function readJson<T>(path: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as T
  } catch {
    return null
  }
}

interface ManifestChunk {
  file: string
  src?: string
  imports?: string[]
  dynamicImports?: string[]
}

const dist = process.argv[2] ?? 'dist'
/** Distinct failure messages (a chunk can reach the same module through several manifest entries). */
const problems = new Set<string>()

// ── 0. Sanity: literals must still be live in harness sources ─────────────────
const harnessSources: string[] = []
for await (const file of walk('src', (n) => /\.(ts|tsx)$/.test(n) && !/\.test\.tsx?$/.test(n))) {
  if (HARNESS_PATH.test(relative('.', file).split('\\').join('/'))) harnessSources.push(await readFile(file, 'utf8'))
}
if (!harnessSources.length) problems.add('no harness sources found under src/ (run from the edugames/ directory)')
for (const literal of LITERALS) {
  if (!harnessSources.some((text) => text.includes(literal))) {
    problems.add(`marker "${literal}" no longer occurs in any harness source — update LITERALS in scripts/check-dist.ts`)
  }
}

// ── 1. Module paths ──────────────────────────────────────────────────────────
const manifest = await readJson<Record<string, ManifestChunk>>(join(dist, '.vite/manifest.json'))
const modules = await readJson<{ chunks: { file: string; modules: string[] }[] }>(join(dist, '.vite/modules.json'))
if (!manifest) problems.add(`${dist}/.vite/manifest.json missing (build.manifest in vite.config.ts; run \`bun run build\`)`)
if (!modules) problems.add(`${dist}/.vite/modules.json missing (module-map plugin in vite.config.ts; run \`bun run build\`)`)
for (const [key, chunk] of Object.entries(manifest ?? {})) {
  for (const path of [key, chunk.src, ...(chunk.imports ?? []), ...(chunk.dynamicImports ?? [])]) {
    if (path && HARNESS_PATH.test(path)) problems.add(`manifest: ${chunk.file} ← ${path}`)
  }
}
let moduleCount = 0
for (const chunk of modules?.chunks ?? []) {
  for (const id of chunk.modules) {
    moduleCount++
    if (HARNESS_PATH.test(id)) problems.add(`module map: ${chunk.file} bundles ${id}`)
  }
}
if (modules && moduleCount === 0) problems.add('module map lists no modules — the check would pass vacuously')

// ── 2. Harness-only string literals ──────────────────────────────────────────
let scanned = 0
if (existsSync(dist)) {
  for await (const file of walk(dist, (n) => /\.(js|mjs|html|css)$/.test(n))) {
    scanned++
    const text = await readFile(file, 'utf8')
    for (const literal of LITERALS) if (text.includes(literal)) problems.add(`${file}: contains "${literal}"`)
  }
}
if (!scanned) problems.add(`no .js/.html/.css files under ${dist}/ (run \`bun run build\` first)`)

// ── 3. Build metadata stays out of the deploy ────────────────────────────────
const ignore = await readFile(join(dist, '.assetsignore'), 'utf8').catch(() => '')
if (!/^\/?\.vite\/?$/m.test(ignore)) problems.add(`${dist}/.assetsignore must list ".vite" (public/.assetsignore) so build metadata isn't deployed`)

if (problems.size) {
  console.error(`check-dist: FAILED — DEV harness code (or an unverifiable build) in ${dist}/:\n  ${[...problems].join('\n  ')}`)
  process.exit(1)
}
console.log(`check-dist: ${scanned} files, ${moduleCount} modules, ${LITERALS.length} markers — no harness code`)
