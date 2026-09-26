/**
 * Server-side player identity (design: docs/AUTH.md "Server seam"). NOT wired in yet —
 * nothing imports this. The router will call `identify()` once per request and hand the
 * Identity to /v1/scores and to GeneratorServer.handle(); handlers never parse cookies.
 */

export type Identity =
  | { kind: 'guest' }
  | {
      kind: 'account'
      /** Opaque account id (D1 `accounts.id`), never an email. */
      accountId: string
      /** Server-owned display name; overrides any `name` a client sends with a score. */
      displayName: string
    }

export interface IdentityVerifier {
  /**
   * Resolve the caller from the request (e.g. an HttpOnly session cookie on the API origin).
   * Must not throw for missing/invalid/expired sessions: those are guests.
   */
  identify(request: Request): Promise<Identity>
}

export const GUEST: Identity = Object.freeze({ kind: 'guest' })
