/*
 * HOW AN SSO SIGN-IN IS HANDED BACK TO THE MOBILE APP (#9989).
 *
 * The app signs in with single sign-on in the phone's browser and is handed
 * the sign-in back on its deep link, oneuptime://sso-callback. The link
 * carries a one-time code and the app's own state, never a token: the app
 * redeems the code at POST /identity/mobile-sso-exchange with the PKCE code
 * verifier whose SHA-256 it sent when the sign-in started
 * (Server/Services/MobileSsoHandOffService says why, and how).
 *
 * React-free and server-safe: the identity routers, their tests and the
 * mobile app's contract tests read it.
 */

// Where every SSO sign-in the app starts ends: the app's own scheme and host.
export const MOBILE_SSO_CALLBACK_URL: string = "oneuptime://sso-callback";

// The identity route where the app redeems a code.
export const MOBILE_SSO_EXCHANGE_ROUTE: string = "/mobile-sso-exchange";

/*
 * The field of GET /identity/sign-in-methods that says, as true, that this
 * server hands an SSO sign-in back to the app as a one-time code. The app
 * reads it before it takes a deep link that carries tokens instead - what a
 * server from before #9989 sends, and what nobody else's link may make it
 * take from a server that hands back codes.
 */
export const MOBILE_SSO_HAND_OFF_SUPPORTED_FIELD: string =
  "isMobileSsoHandOffSupported";

/*
 * What the app is told for a code or a flow that is not one, has expired or
 * was used: the same words for each, so the answer says nothing about which.
 */
export const MOBILE_SSO_HAND_OFF_EXPIRED_MESSAGE: string =
  "This sign-in has expired or was already used. Sign in with single sign-on again in the app.";

/*
 * The reason on the deep link when a sign-in the app started with a
 * hand-off can no longer be handed back: it took longer than the flow lives,
 * or was finished already.
 */
export const MOBILE_SSO_HAND_OFF_EXPIRED_ERROR: string =
  "sso_mobile_sign_in_expired";

/*
 * What a code stands for, and what the exchange answers: the very values
 * the deep link carried before, so the app keeps them as it always has.
 */
export interface MobileSsoSignIn {
  accessToken: string;
  refreshToken: string;
  // ISO 8601.
  refreshTokenExpiresAt: string;
  userId: string;
  email: string;
  name: string;
  isMasterAdmin: boolean;
  /*
   * Instance-wide Global SSO/OIDC token: satisfies SSO enforcement for every
   * project the person belongs to.
   */
  globalSsoToken?: string | undefined;
  // A project's SSO token, with that project.
  ssoToken?: string | undefined;
  projectId?: string | undefined;
}
