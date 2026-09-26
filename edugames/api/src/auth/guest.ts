/** Stub verifier: no accounts yet, so every caller is a guest. Not wired in (docs/AUTH.md). */
import { GUEST, type IdentityVerifier } from './types'

export const guestVerifier: IdentityVerifier = {
  async identify() {
    return GUEST
  },
}
