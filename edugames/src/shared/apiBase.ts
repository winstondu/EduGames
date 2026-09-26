/**
 * Origin of the API Worker (scores, generator manifest/modules, hybrid pass-throughs).
 * Dev default is port 8788 (`bun run dev:api`); override with VITE_API_BASE.
 */
export const API_BASE: string =
  import.meta.env.VITE_API_BASE ?? (import.meta.env.DEV ? 'http://localhost:8788' : 'https://api.games.winstondu.com')
