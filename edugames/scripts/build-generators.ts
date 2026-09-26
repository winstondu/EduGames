/**
 * Bundle every generator plugin (src/generators/<id>/index.ts) into a
 * standalone, content-hashed ESM module served by the API Worker:
 *   api/public/plugins/<id>.<hash>.js
 *   api/public/plugins/manifest.json   (read by GET /v1/generators)
 * Generators ship independently of games; any game can load any plugin whose
 * formats it supports. Run: `bun run generators:build`.
 */
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readdir, rm, writeFile } from 'node:fs/promises'
import { join, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { PROBLEM_FORMATS, type GeneratorPlugin, type ProblemFormat } from '../src/generators/types'

/** Shape of api/public/plugins/manifest.json (the Worker turns module/source into absolute `entry` URLs). */
interface BuiltManifestEntry {
  id: string
  name: string
  description: string
  kind: 'client' | 'hybrid'
  formats: ProblemFormat[]
  /** Content hash of the bundle. */
  version: string
  /** Path of the bundle relative to the API's static assets root, e.g. "plugins/math.1a2b3c4d5e.js". */
  module: string
  /** Source entry relative to the app root, served as a TS module by Vite in dev. */
  source: string
}

const ROOT = resolve(import.meta.dir, '..')
const SRC_DIR = join(ROOT, 'src/generators')
const PUBLIC_DIR = join(ROOT, 'api/public')
const OUT_DIR = join(PUBLIC_DIR, 'plugins')
const ID_RE = /^[a-z0-9-]+$/

function fail(message: string): never {
  console.error(`generators:build: ${message}`)
  process.exit(1)
}

/** Read and validate the plugin's metadata by importing it (plugins are DOM-free, so this runs under bun). */
async function readMeta(id: string, entry: string) {
  const mod = (await import(pathToFileURL(entry).href)) as { default?: GeneratorPlugin }
  const plugin = mod.default
  if (!plugin || typeof plugin !== 'object') fail(`${id}: index.ts has no default-exported plugin`)
  if (plugin.id !== id) fail(`${id}: plugin.id is "${plugin.id}", expected the directory name "${id}"`)
  if (plugin.kind !== 'client' && plugin.kind !== 'hybrid') fail(`${id}: invalid kind "${plugin.kind}"`)
  if (typeof plugin.name !== 'string' || typeof plugin.description !== 'string') fail(`${id}: name/description must be strings`)
  const formats = Array.isArray(plugin.formats) ? [...plugin.formats] : []
  if (formats.length === 0 || formats.some((f) => !PROBLEM_FORMATS.includes(f))) {
    fail(`${id}: formats must be a non-empty subset of ${PROBLEM_FORMATS.join(', ')}`)
  }
  return { name: plugin.name, description: plugin.description, kind: plugin.kind, formats }
}

async function bundle(id: string, entry: string): Promise<{ file: string; hash: string; code: string }> {
  const result = await Bun.build({
    entrypoints: [entry],
    target: 'browser',
    format: 'esm',
    minify: true,
    splitting: false,
    define: { 'process.env.NODE_ENV': '"production"' },
  })
  if (!result.success) {
    for (const log of result.logs) console.error(log)
    fail(`${id}: bundling failed`)
  }
  const outputs = result.outputs.filter((o) => o.kind === 'entry-point')
  if (outputs.length !== 1 || result.outputs.length !== 1) fail(`${id}: expected exactly one output file`)
  const code = await outputs[0].text()
  const hash = createHash('sha256').update(code).digest('hex').slice(0, 10)
  return { file: `${id}.${hash}.js`, hash, code }
}

async function main() {
  const dirs = (await readdir(SRC_DIR, { withFileTypes: true }))
    .filter((d) => d.isDirectory() && existsSync(join(SRC_DIR, d.name, 'index.ts')))
    .map((d) => d.name)
    .sort()
  for (const id of dirs) if (!ID_RE.test(id)) fail(`generator directory "${id}" must match ${ID_RE}`)

  // Validate and bundle everything before touching the output, so a failed build leaves the last good one.
  const generators: BuiltManifestEntry[] = []
  const files = new Map<string, string>()
  for (const id of dirs) {
    const entry = join(SRC_DIR, id, 'index.ts')
    const meta = await readMeta(id, entry)
    const { file, hash, code } = await bundle(id, entry)
    files.set(file, code)
    generators.push({
      id,
      ...meta,
      version: hash,
      module: `plugins/${file}`,
      source: relative(ROOT, entry).split('\\').join('/'),
    })
    console.log(`  ${id.padEnd(16)} ${meta.kind.padEnd(7)} plugins/${file}`)
  }

  // Clean stale bundles; the directory is build output only.
  await rm(OUT_DIR, { recursive: true, force: true })
  await mkdir(OUT_DIR, { recursive: true })
  for (const [file, code] of files) await writeFile(join(OUT_DIR, file), code)
  await writeFile(join(OUT_DIR, 'manifest.json'), JSON.stringify({ generators }, null, 2) + '\n')
  console.log(`generators:build: ${generators.length} plugin(s) → ${relative(ROOT, OUT_DIR)}/`)
}

await main()
