/** Generator plugins for dev tooling: import src/generators/<id>/index.ts directly (never bundled). */
import { existsSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { GeneratorPlugin } from '../../src/generators/types'

const ROOT = resolve(import.meta.dir, '../..')
const GENERATORS = join(ROOT, 'src/generators')
const ID_RE = /^[a-z0-9-]+$/

export async function loadPlugin(id: string): Promise<GeneratorPlugin<unknown> | null> {
  if (!ID_RE.test(id)) return null
  const entry = join(GENERATORS, id, 'index.ts')
  if (!existsSync(entry)) return null
  const mod = (await import(pathToFileURL(entry).href)) as { default?: GeneratorPlugin<unknown> }
  return mod.default ?? null
}

/** Ids of every generator directory with an index.ts. */
export async function generatorIds(): Promise<string[]> {
  const entries = await readdir(GENERATORS, { withFileTypes: true })
  return entries.filter((e) => e.isDirectory() && ID_RE.test(e.name) && existsSync(join(GENERATORS, e.name, 'index.ts'))).map((e) => e.name).sort()
}
