/*
 * The one place an SSO callback is turned into a signed-in session.
 *
 * There are four ways a callback can reach the app - the login screen, the
 * Settings re-authentication flow, the Android dismiss-race fallback, and a
 * cold start after the OS killed the app mid-login - and every one of them has
 * to persist exactly the same things in exactly the same order. Doing that in
 * four places is how a flow ends up storing the auth tokens but not the global
 * SSO token, leaving the user signed in and permission-denied at the same time.
 *
 * And it is the one place that decides whether a callback is this app's to
 * take at all (#9989). oneuptime://sso-callback is a custom scheme anybody
 * can open, so a callback is taken only for the sign-in the app started and
 * is waiting for (./handOff):
 *
 *   - a one-time code with that sign-in's state, redeemed with its verifier
 *     at the server it started on - what every server since #9989 sends;
 *   - a link carrying the session itself only when that server, asked when
 *     the sign-in started, said it does not hand back codes - a server from
 *     before #9989;
 *   - and nothing at all while no sign-in is waiting: a link the app did not
 *     ask for signs nobody in, whatever it carries.
 */

import { exchangeSsoCode } from "../api/sso";
import { storeTokens } from "../storage/keychain";
import { storeGlobalSsoToken, storeSsoToken } from "../storage/ssoTokens";
import { getFriendlyErrorMessage } from "../utils/error";
import {
  parseSsoCallbackUrl,
  UNVERIFIED_SSO_CALLBACK_MESSAGE,
  type SsoCallbackResult,
  type SsoCallbackSuccess,
} from "./callbackUrl";
import {
  clearPendingSsoHandOff,
  getCachedPendingSsoHandOff,
  readPendingSsoHandOff,
  type PendingSsoHandOff,
} from "./handOff";
import { clearAllSsoDenials, clearProjectSsoDenial } from "./ssoDenials";

export type CompleteSsoLoginOutcome =
  | {
      status: "success";
      // True when the login produced an instance-wide Global SSO/OIDC token.
      isGlobal: boolean;
      // Set when the login produced a token scoped to a single project.
      projectId: string | null;
    }
  | {
      status: "error";
      message: string;
    };

// What a callback for a sign-in the app is not waiting for is answered with.
export const SSO_SIGN_IN_NOT_STARTED_MESSAGE: string =
  "This sign-in was not started in this app, or took too long. Please sign in with single sign-on again.";

/**
 * Persists the result of an SSO callback URL - once it is the callback of
 * the sign-in the app is waiting for, its code redeemed.
 *
 * Auth tokens are written first: without them nothing else is usable. The SSO
 * tokens follow, and both the global and per-project shapes are handled, so a
 * caller does not have to know which flavour of SSO the user just completed.
 */
export async function completeSsoLoginFromUrl(
  url: string | null | undefined,
): Promise<CompleteSsoLoginOutcome> {
  const parsed: SsoCallbackResult = parseSsoCallbackUrl(url);

  /*
   * A sign-in this run of the app started is in memory: no wait before a
   * session it hands back is stored. One the OS stopped the app in the
   * middle of is read from storage.
   */
  const handOff: PendingSsoHandOff | null =
    getCachedPendingSsoHandOff() || (await readPendingSsoHandOff());

  if (!handOff) {
    return { status: "error", message: SSO_SIGN_IN_NOT_STARTED_MESSAGE };
  }

  if (parsed.status === "invalid") {
    // Not the server's answer: the sign-in it waits for may still come.
    return { status: "error", message: parsed.message };
  }

  if (parsed.status === "error") {
    await clearPendingSsoHandOff();

    return { status: "error", message: parsed.message };
  }

  if (parsed.status === "code") {
    // Another sign-in's code, or one somebody made up: not this one's.
    if (parsed.state !== handOff.state) {
      return { status: "error", message: UNVERIFIED_SSO_CALLBACK_MESSAGE };
    }

    // One code per sign-in, redeemed or not.
    await clearPendingSsoHandOff();

    let redeemed: SsoCallbackSuccess;

    try {
      redeemed = await exchangeSsoCode({
        serverUrl: handOff.serverUrl,
        code: parsed.code,
        codeVerifier: handOff.codeVerifier,
        state: handOff.state,
      });
    } catch (error) {
      return { status: "error", message: getFriendlyErrorMessage(error) };
    }

    return persistSsoSignIn(redeemed);
  }

  /*
   * The session on the link: only from a server that said, when this
   * sign-in started, that it hands back no codes.
   */
  if (handOff.serverHandsBackCodes) {
    return { status: "error", message: UNVERIFIED_SSO_CALLBACK_MESSAGE };
  }

  try {
    return await persistSsoSignIn(parsed);
  } finally {
    await clearPendingSsoHandOff();
  }
}

/*
 * Stores a sign-in: the auth tokens first, synchronously started, then the
 * SSO token of the server or the project.
 */
async function persistSsoSignIn(
  signIn: SsoCallbackSuccess,
): Promise<CompleteSsoLoginOutcome> {
  await storeTokens(signIn.tokens);

  if (signIn.globalSsoToken) {
    await storeGlobalSsoToken(signIn.globalSsoToken);
  }

  if (signIn.projectSsoToken) {
    await storeSsoToken(
      signIn.projectSsoToken.projectId,
      signIn.projectSsoToken.ssoToken,
    );

    clearProjectSsoDenial(signIn.projectSsoToken.projectId);
  }

  /*
   * A global login can satisfy any number of projects at once and the token
   * does not say which, so every recorded denial is dropped and the server
   * gets to answer again.
   */
  if (signIn.globalSsoToken) {
    clearAllSsoDenials();
  }

  return {
    status: "success",
    isGlobal: Boolean(signIn.globalSsoToken),
    projectId: signIn.projectSsoToken?.projectId || null,
  };
}
