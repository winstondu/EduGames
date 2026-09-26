/**
 * Placeholder — implemented by the "generator hosting" step.
 * `handleGeneratorRequest` serves:
 *   GET /api/generators                 → GeneratorManifest (src/generators/types.ts)
 *   *   /api/generators/<id>/<subpath>  → that plugin's GeneratorServer.handle()
 */
import type { GeneratorEnv } from './types'

export async function handleGeneratorRequest(
  _request: Request,
  _env: GeneratorEnv,
  _ctx: ExecutionContext,
): Promise<Response> {
  return new Response(JSON.stringify({ error: 'not implemented' }), { status: 501 })
}
