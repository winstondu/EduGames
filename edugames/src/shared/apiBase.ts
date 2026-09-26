/** Origin of the API Worker (scores, generator manifest/modules, hybrid pass-throughs). */
export const API_BASE: string =
  import.meta.env.VITE_API_BASE ?? (import.meta.env.DEV ? 'http://localhost:8787' : 'https://api.games.winstondu.com')
