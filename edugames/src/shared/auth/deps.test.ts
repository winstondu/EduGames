/** Dependency rule for the auth layer (docs/AUTH.md): auth never imports games, generators or the launcher; the core is React-free. */
import { describe, expect, test } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOT = import.meta.dir
const IMPORT = /(?:^|\n)\s*(?:import|export)[^'"]*from\s+['"]([^'"]+)['"]/g

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((d) =>
    d.isDirectory() ? files(join(dir, d.name)) : /\.tsx?$/.test(d.name) && !d.name.endsWith('.test.ts') ? [join(dir, d.name)] : [],
  )
}

function imports(file: string): string[] {
  return [...readFileSync(file, 'utf8').matchAll(IMPORT)].map((m) => m[1])
}

describe('shared/auth dependency rule', () => {
  test('only shared/{highscores,unrecorded,apiBase} and itself (+ React in ui/)', () => {
    const allowedShared = ['../highscores/', '../unrecorded', '../apiBase', '../../highscores/']
    const bad: string[] = []
    for (const file of files(ROOT)) {
      const rel = relative(ROOT, file)
      const inUi = rel.startsWith('ui/')
      for (const spec of imports(file)) {
        const ok =
          (spec.startsWith('./') && !spec.includes('/ui/')) ||
          (inUi && (spec === '../types' || spec === 'react' || spec.startsWith('./'))) ||
          allowedShared.some((p) => spec.startsWith(p))
        if (!ok) bad.push(`${rel} → ${spec}`)
      }
    }
    expect(bad).toEqual([])
  })
})
