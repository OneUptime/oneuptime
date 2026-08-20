/*
 * The one place an SSO callback is turned into a signed-in session.
 *
 * There are four ways a callback can reach the app - the login screen, the
 * Settings re-authentication flow, the Android dismiss-race fallback, and a
 * cold start after the OS killed the app mid-login - and every one of them has
 * to persist exactly the same things in exactly the same order. Doing that in
 * four places is how a flow ends up storing the auth tokens but not the global
 * SSO token, leaving the user signed in and permission-denied at the same time.
 */

import { storeTokens } from "../storage/keychain";
import { storeGlobalSsoToken, storeSsoToken } from "../storage/ssoTokens";
import { parseSsoCallbackUrl, type SsoCallbackResult } from "./callbackUrl";
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

/**
 * Persists the result of an SSO callback URL.
 *
 * Auth tokens are written first: without them nothing else is usable. The SSO
 * tokens follow, and both the global and per-project shapes are handled, so a
 * caller does not have to know which flavour of SSO the user just completed.
 */
export async function completeSsoLoginFromUrl(
  url: string | null | undefined,
): Promise<CompleteSsoLoginOutcome> {
  const parsed: SsoCallbackResult = parseSsoCallbackUrl(url);

  if (parsed.status !== "success") {
    return {
      status: "error",
      message: parsed.message,
    };
  }

  await storeTokens(parsed.tokens);

  if (parsed.globalSsoToken) {
    await storeGlobalSsoToken(parsed.globalSsoToken);
  }

  if (parsed.projectSsoToken) {
    await storeSsoToken(
      parsed.projectSsoToken.projectId,
      parsed.projectSsoToken.ssoToken,
    );

    clearProjectSsoDenial(parsed.projectSsoToken.projectId);
  }

  /*
   * A global login can satisfy any number of projects at once and the token
   * does not say which, so every recorded denial is dropped and the server
   * gets to answer again.
   */
  if (parsed.globalSsoToken) {
    clearAllSsoDenials();
  }

  return {
    status: "success",
    isGlobal: Boolean(parsed.globalSsoToken),
    projectId: parsed.projectSsoToken?.projectId || null,
  };
}
