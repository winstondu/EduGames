/**
 * Fails if the production build (dist/) contains DEV-only harness code.
 * Run after `bun run build`: `bun run check:dist`.
 */
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

const MARKERS = ['__edugames', 'createShooterHarness', 'installHarnessRuntime', 'takeOpenRequest', 'createBrowserHarness', 'edugames-harness', 'exportReplay']

async function* files(dir: string): AsyncGenerator<string> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) yield* files(path)
    else if (/\.(js|mjs|html|css)$/.test(entry.name)) yield path
  }
}

const dist = process.argv[2] ?? 'dist'
let scanned = 0
const hits: string[] = []
for await (const file of files(dist)) {
  scanned++
  const text = await readFile(file, 'utf8')
  for (const marker of MARKERS) if (text.includes(marker)) hits.push(`${file}: ${marker}`)
}
if (!scanned) {
  console.error(`check-dist: no files under ${dist}/ (run \`bun run build\` first)`)
  process.exit(1)
}
if (hits.length) {
  console.error(`check-dist: DEV harness code in the production build:\n  ${hits.join('\n  ')}`)
  process.exit(1)
}
console.log(`check-dist: ${scanned} files, no harness code`)
