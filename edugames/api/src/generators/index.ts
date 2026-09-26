/**
 * Placeholder — implemented by the "generator hosting" step.
 * `handleGeneratorRequest` serves:
 *   GET /v1/generators                 → GeneratorManifest (src/generators/types.ts)
 *   *   /v1/generators/<id>/<subpath>  → that plugin's GeneratorServer.handle()
 */
import type { GeneratorEnv } from './types'

export async function handleGeneratorRequest(
  _request: Request,
  _env: GeneratorEnv,
  _ctx: ExecutionContext,
): Promise<Response> {
  return new Response(JSON.stringify({ error: 'not implemented' }), { status: 501 })
}
