/**
 * Generator hosting on the API Worker (game-agnostic):
 *   GET /v1/generators                 → GeneratorManifest with absolute `entry` URLs
 *   *   /v1/generators/<id>/<subpath>  → that plugin's GeneratorServer.handle()
 * Plugin bundles themselves are static assets under /plugins/ (built by
 * scripts/build-generators.ts). CORS is applied by the router.
 */
import type { GeneratorManifest, GeneratorManifestEntry } from '../../../src/generators/types'
import { kindermathServer } from './kindermath'
import type { GeneratorEnv, GeneratorServer } from './types'

/** api/public/plugins/manifest.json as written by the build script. */
export interface BuiltManifest {
  generators: (Omit<GeneratorManifestEntry, 'entry'> & { module: string; source: string })[]
}

/** Server halves of hybrid plugins, keyed by plugin id. Client-only plugins have none. */
const SERVERS: Record<string, GeneratorServer> = {
  kindermath: kindermathServer,
}

const MANIFEST_PATH = /^\/v1\/generators\/?$/
const PLUGIN_PATH = /^\/v1\/generators\/([a-z0-9-]+)(?:\/(.*))?$/

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...headers },
  })
}

async function serveManifest(request: Request, env: GeneratorEnv): Promise<Response> {
  const url = new URL(request.url)
  const res = await env.ASSETS.fetch(new URL('/plugins/manifest.json', url.origin))
  if (!res.ok) return json({ error: 'generator manifest unavailable (run `bun run generators:build`)' }, 503)
  const built = (await res.json()) as BuiltManifest
  const devOrigin = env.GENERATORS_DEV_ORIGIN?.replace(/\/+$/, '')
  const manifest: GeneratorManifest = {
    generators: built.generators.map(({ module, source, ...meta }) => ({
      ...meta,
      // Dev: Vite serves the TS source (HMR, no rebuild); prod: the hashed bundle on this origin.
      entry: devOrigin ? `${devOrigin}/${source}` : new URL(module, `${url.origin}/`).href,
    })),
  }
  return json(manifest, 200, { 'cache-control': devOrigin ? 'no-store' : 'public, max-age=60' })
}

export async function handleGeneratorRequest(
  request: Request,
  env: GeneratorEnv,
  ctx: ExecutionContext,
): Promise<Response> {
  const { pathname } = new URL(request.url)

  if (MANIFEST_PATH.test(pathname)) {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return json({ error: 'method not allowed' }, 405, { allow: 'GET, HEAD' })
    }
    return serveManifest(request, env)
  }

  const match = PLUGIN_PATH.exec(pathname)
  const id = match?.[1]
  if (!match || !id || !Object.hasOwn(SERVERS, id)) return json({ error: 'unknown generator' }, 404)
  return SERVERS[id].handle(request, match[2] ?? '', env, ctx)
}
