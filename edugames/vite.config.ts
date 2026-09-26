import react from '@vitejs/plugin-react'
import { relative } from 'node:path'
import { defineConfig, type Plugin } from 'vite'

/**
 * Build only: writes `.vite/modules.json` (every chunk → the source modules bundled into it) next to
 * Vite's `.vite/manifest.json`, so `bun run check:dist` can prove no DEV harness module reached
 * production by path — minification renames identifiers but can't hide a module id. Both files are
 * build metadata; public/.assetsignore keeps `.vite/` out of the deployed assets.
 */
function moduleMap(): Plugin {
  let root = process.cwd()
  return {
    name: 'edugames-module-map',
    apply: 'build',
    configResolved(config) {
      root = config.root
    },
    generateBundle(_options, bundle) {
      const chunks = Object.values(bundle)
        .filter((out) => out.type === 'chunk')
        .map((chunk) => ({
          file: chunk.fileName,
          modules: (chunk.moduleIds ?? Object.keys(chunk.modules))
            .map((id) => id.replace(/^\0/, '').replace(/\?.*$/, ''))
            .map((id) => (id.startsWith('/') ? relative(root, id).split('\\').join('/') : id)),
        }))
      this.emitFile({ type: 'asset', fileName: '.vite/modules.json', source: JSON.stringify({ chunks }, null, 2) })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), moduleMap()],
  build: {
    // .vite/manifest.json: entry/dynamic chunks with their source paths (inspected by check:dist).
    manifest: true,
  },
})
