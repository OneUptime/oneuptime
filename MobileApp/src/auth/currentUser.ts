import { decodeJwtPayload, type JwtPayload } from "../utils/jwt";
import { getCachedAccessToken, getTokens } from "../storage/keychain";

/*
 * Who is signed in, from the app's own point of view.
 *
 * The auth context only knows the user once a LOGIN has happened in this
 * process; on a cold start the app restores a session from stored tokens and
 * never sees a login response, so `useAuth().user` is null for the rest of the
 * run. Every on-call screen has to compare the signed-in user against a roster
 * ("is that me on call?"), and getting null there does not degrade the screen,
 * it inverts it - the user is shown as off duty while their handset is the one
 * that will ring.
 *
 * The access token already carries the id (the server puts `userId` in the
 * payload), so read it from there. The token is not trusted for anything - the
 * server verifies it on every request - it is just the one place the id is
 * guaranteed to be, session after session.
 */

/**
 * The user id inside a JWT, or null for anything that is not a readable token
 * with a string `userId` claim.
 */
export function getUserIdFromToken(
  token: string | null | undefined,
): string | null {
  if (!token) {
    return null;
  }

  const payload: JwtPayload | null = decodeJwtPayload(token);

  if (!payload) {
    return null;
  }

  const userId: unknown = payload["userId"];

  if (typeof userId !== "string" || userId.length === 0) {
    return null;
  }

  return userId;
}

/**
 * The signed-in user's id, reading the in-memory token first and falling back
 * to storage.
 *
 * The fallback is what makes this work on a cold start: the cached token is
 * only populated once something has read the keychain, and on the very first
 * render after launch nothing has.
 */
export async function loadCurrentUserId(): Promise<string | null> {
  const cached: string | null = getUserIdFromToken(getCachedAccessToken());

  if (cached) {
    return cached;
  }

  const stored: { accessToken: string } | null = await getTokens();

  return getUserIdFromToken(stored?.accessToken ?? null);
}
