import ObjectID from "Common/Types/ObjectID";
import Protocol from "Common/Types/API/Protocol";
import Exception from "Common/Types/Exception/Exception";
import {
  MOBILE_SSO_CALLBACK_URL as CALLBACK_URL,
  MOBILE_SSO_HAND_OFF_EXPIRED_ERROR,
  MOBILE_SSO_HAND_OFF_EXPIRED_MESSAGE,
  MobileSsoSignIn,
} from "Common/Types/SSO/MobileSsoHandOff";
import CookieUtil from "Common/Server/Utils/Cookie";
import { HttpProtocol } from "Common/Server/EnvironmentConfig";
import MobileSsoHandOffService, {
  MobileSsoHandOffRequest,
} from "Common/Server/Services/MobileSsoHandOffService";
import { ExpressRequest, ExpressResponse } from "Common/Server/Utils/Express";

/*
 * Shared plumbing for SSO logins started from the mobile app.
 *
 * A mobile login differs from a web login in exactly two ways, and both of
 * them are easy to get subtly wrong in each router:
 *
 *   1. The flow must END on the app's custom-scheme deep link, not on an HTML
 *      page. A browser session that lands on a server-rendered page is a dead
 *      end: the app is watching for `oneuptime://sso-callback`, sees an
 *      ordinary web page instead, and eventually reports the login as
 *      "cancelled" with nothing to tell the user. That applies to FAILURES
 *      just as much as to successes.
 *
 *   2. The server has to still know it is a mobile login by the time the IdP
 *      hands control back, which is many redirects later.
 *
 * Everything here is deliberately pure or near-pure so the deep-link contract
 * between the server and the app can be unit tested on both sides.
 *
 * And the deep link must not carry the session (#9989). An app that starts
 * its sign-in with a state and a PKCE challenge
 * (?mobile=true&state=...&codeChallenge=...&codeChallengeMethod=S256) is
 * handed a one-time code and its state, which it redeems with its verifier
 * (Common/Server/Services/MobileSsoHandOffService). The flow that holds the
 * request rides through the identity provider's round trip in SAML's
 * RelayState ("mobile:<flow id>"), in OIDC's signed state cookie, and in the
 * mobile intent cookie below. Only an app from before this - a start with
 * ?mobile=true and nothing else, marked "mobile" and "true" - is still
 * handed the session on the link, until the store releases have moved
 * everyone on: a sign-in that started with a hand-off is never answered so,
 * even when its flow is lost (MOBILE_SSO_HAND_OFF_EXPIRED_ERROR instead).
 */

export const MOBILE_SSO_CALLBACK_URL: string = CALLBACK_URL;

// SAML RelayState of a mobile sign-in with a hand-off: "mobile:<flow id>".
export const MOBILE_SSO_RELAY_STATE_PREFIX: string = "mobile:";

// SAML RelayState of a mobile sign-in, with its flow when it has one.
export function getMobileSsoRelayState(flowId: string | null): string {
  return flowId ? `${MOBILE_SSO_RELAY_STATE_PREFIX}${flowId}` : "mobile";
}

// Whether a RelayState marks a mobile sign-in, with or without a flow.
export function isMobileRelayState(value: unknown): boolean {
  return (
    value === "mobile" ||
    (typeof value === "string" &&
      value.startsWith(MOBILE_SSO_RELAY_STATE_PREFIX))
  );
}

/**
 * Name of the short-lived cookie that remembers "this login was started by the
 * mobile app", keyed by provider so two logins cannot cross-talk.
 */
export function getMobileSsoIntentCookieName(providerId: ObjectID): string {
  return `sso-mobile-intent-${providerId.toString()}`;
}

/*
 * Long enough for a person to actually complete an IdP login (MFA prompts,
 * password managers, a push approval on another device), short enough that a
 * stale intent cannot silently redirect a later WEB login into the app.
 */
export const MOBILE_SSO_INTENT_TTL_SECONDS: number = 15 * 60;

/**
 * Records that the login now being started came from the mobile app.
 *
 * SAML carries the intent in `RelayState`, but RelayState is only a SHOULD in
 * the specification: several identity providers drop it, truncate it, or
 * refuse to echo it on IdP-initiated flows. When that happens the callback
 * cannot tell a mobile login from a web one and redirects the user's in-app
 * browser to the web dashboard, where the app can never retrieve the session.
 * This cookie is the fallback, and for OIDC error paths - where the state
 * cookie may itself be the thing that went missing - it is the only carrier.
 */
export function setMobileSsoIntentCookie(
  res: ExpressResponse,
  providerId: ObjectID,
  // The sign-in's hand-off flow, when the app started one (#9989).
  flowId?: string | null | undefined,
): void {
  /*
   * SameSite matters here more than anywhere else in the codebase, because of
   * HOW the identity provider hands control back:
   *
   *   SAML  - the IdP auto-submits a form to our ACS endpoint. That is a
   *           top-level CROSS-SITE POST, and a browser does NOT attach a
   *           SameSite=Lax cookie to one. CookieUtil's default is Lax, so a
   *           default-configured cookie would be missing at precisely the
   *           moment this fallback exists to cover.
   *   OIDC  - the IdP 302s back to our callback. A top-level cross-site GET,
   *           where Lax is attached and everything works either way.
   *
   * So the cookie is sent SameSite=None on an HTTPS instance. Browsers reject
   * SameSite=None without Secure, and Secure cookies are not stored over plain
   * HTTP, so an HTTP instance keeps the default instead - it loses the SAML
   * fallback, but that only returns it to relying on RelayState, which is
   * where it was before. Nothing is made worse.
   *
   * The cookie carries no authority whatsoever - its value is the literal
   * string "true", or the id of the sign-in's hand-off flow, which only
   * names where the app's state and challenge wait - so sending it
   * cross-site discloses nothing and grants nothing.
   */
  const isHttps: boolean = HttpProtocol === Protocol.HTTPS;

  CookieUtil.setCookie(
    res,
    getMobileSsoIntentCookieName(providerId),
    flowId || "true",
    {
      maxAge: MOBILE_SSO_INTENT_TTL_SECONDS * 1000,
      httpOnly: true,
      ...(isHttps ? { sameSite: "none" as const, secure: true } : {}),
    },
  );
}

export function clearMobileSsoIntentCookie(
  res: ExpressResponse,
  providerId: ObjectID,
): void {
  CookieUtil.removeCookie(res, getMobileSsoIntentCookieName(providerId));
}

/**
 * True when the current request belongs to a login the mobile app started.
 *
 * Checks every carrier, most explicit first: the `mobile=true` query param
 * (SP-initiated entry point), the SAML RelayState echoed back by the IdP in
 * either the body or the query, and finally the intent cookie set when the
 * flow began.
 */
export function isMobileSsoRequest(data: {
  req: ExpressRequest;
  providerId?: ObjectID | undefined;
}): boolean {
  const { req } = data;

  if (req.query["mobile"] === "true") {
    return true;
  }

  const relayStateFromBody: unknown = (
    req.body as { RelayState?: unknown } | undefined
  )?.RelayState;

  if (
    isMobileRelayState(relayStateFromBody) ||
    isMobileRelayState(req.query["RelayState"])
  ) {
    return true;
  }

  if (!data.providerId) {
    return false;
  }

  const intent: string | undefined = CookieUtil.getCookieFromExpressRequest(
    req,
    getMobileSsoIntentCookieName(data.providerId),
  );

  return intent === "true" || MobileSsoHandOffService.isFlowId(intent);
}

/*
 * What readMobileSsoFlowId answers for a flow RelayState names but this
 * browser did not start: never a flow id, so it is answered as a lost flow.
 */
export const MOBILE_SSO_FLOW_OF_ANOTHER_BROWSER: string = "another-browser";

/*
 * The hand-off flow a mobile sign-in claims, from whichever carrier still
 * holds it: the one the router read itself (OIDC's signed state cookie),
 * SAML's RelayState ("mobile:<flow id>") - on an HTTPS server only when the
 * intent cookie names the same flow - then the intent cookie. Null only for
 * a sign-in that claims none - one an app from before #9989 started,
 * marked "mobile" and "true". A claim is returned as it was carried, well
 * formed or not: respondToMobileSsoSuccess takes it, and a claim that names
 * no flow is answered as a lost one, never with the session.
 */
export function readMobileSsoFlowId(data: {
  req: ExpressRequest;
  providerId?: ObjectID | undefined;
  carried?: unknown;
}): string | null {
  if (typeof data.carried === "string" && data.carried) {
    return data.carried;
  }

  let claimed: string | null = null;

  for (const relayState of [
    (data.req.body as { RelayState?: unknown } | undefined)?.RelayState,
    data.req.query["RelayState"],
  ]) {
    if (
      typeof relayState === "string" &&
      relayState.startsWith(MOBILE_SSO_RELAY_STATE_PREFIX)
    ) {
      claimed = relayState.slice(MOBILE_SSO_RELAY_STATE_PREFIX.length);
      break;
    }
  }

  const intentValue: string | undefined = data.providerId
    ? CookieUtil.getCookieFromExpressRequest(
        data.req,
        getMobileSsoIntentCookieName(data.providerId),
      )
    : undefined;
  const intent: string | null =
    intentValue && intentValue !== "true" ? intentValue : null;

  if (claimed === null) {
    return intent;
  }

  /*
   * A flow RelayState names is taken only from the browser that started it.
   * RelayState is in the address the browser is sent to the provider with,
   * where a page's Referer can carry it off; with another's flow id, a
   * person could finish their own sign-in into it and hand someone's app a
   * code for their own account. On an HTTPS server the intent cookie the
   * start set (SameSite=None) comes back with the provider's answer, so the
   * two must name the same flow, or the claim is answered as a lost one. A
   * server reached over plain HTTP keeps no such cookie across the
   * provider's post, and has RelayState alone.
   */
  if (HttpProtocol === Protocol.HTTPS && intent !== claimed) {
    return MOBILE_SSO_FLOW_OF_ANOTHER_BROWSER;
  }

  return claimed;
}

// What the app is told when a sign-in it started cannot be handed back.
export const MOBILE_SSO_HAND_OFF_FAILED_ERROR: string =
  "sso_mobile_sign_in_failed";

/*
 * Starts a mobile sign-in's hand-off, from the start route's query: keeps
 * the app's state and challenge for the provider's round trip and, with
 * `rememberInCookie`, marks the browser with the flow (the intent cookie -
 * SAML's fallback for an identity provider that drops RelayState). An app
 * from before #9989 names no hand-off: its flow is null, and the cookie
 * says "true", as it always did.
 *
 * Answers `null` when it has already answered the request: a hand-off that
 * is not well formed, or one that cannot be kept (Redis unreachable), is
 * refused on the app's deep link - never started without one, which would
 * end on the deep link that carries the session.
 */
export async function startMobileSsoHandOff(data: {
  req: ExpressRequest;
  res: ExpressResponse;
  providerId: ObjectID;
  rememberInCookie: boolean;
}): Promise<{ flowId: string | null } | null> {
  let flowId: string | null = null;

  try {
    const request: MobileSsoHandOffRequest | null =
      MobileSsoHandOffService.readRequest(data.req.query);

    flowId = request ? await MobileSsoHandOffService.startFlow(request) : null;
  } catch (err: unknown) {
    data.res.redirect(
      buildMobileSsoErrorUrl(
        MOBILE_SSO_HAND_OFF_FAILED_ERROR,
        err instanceof Exception
          ? err.message
          : MOBILE_SSO_HAND_OFF_EXPIRED_MESSAGE,
      ),
    );
    return null;
  }

  if (data.rememberInCookie) {
    setMobileSsoIntentCookie(data.res, data.providerId, flowId);
  }

  return { flowId: flowId };
}

/*
 * Hands a finished mobile sign-in to the app:
 *
 *   - started with a hand-off: its flow is taken - once - and the app is
 *     sent a one-time code and its own state. A flow that has gone (too
 *     slow, or answered already) is a failure on the deep link, never the
 *     session;
 *   - started by an app from before #9989 (no flow): the deep link that
 *     carries the session, as it always did.
 *
 * Never throws: a hand-off that cannot be finished (Redis unreachable) ends
 * on the deep link too, with why - a page the app cannot read would be a
 * dead end in its browser.
 */
export async function respondToMobileSsoSuccess(data: {
  res: ExpressResponse;
  flowId: string | null;
  signIn: MobileSsoSuccessParams;
}): Promise<void> {
  if (!data.flowId) {
    data.res.redirect(buildMobileSsoSuccessUrl(data.signIn));
    return;
  }

  let callbackUrl: string;

  try {
    const request: MobileSsoHandOffRequest | null =
      await MobileSsoHandOffService.takeFlow(data.flowId);

    callbackUrl = request
      ? await MobileSsoHandOffService.createAuthorizationCode({
          request: request,
          signIn: toMobileSsoSignIn(data.signIn),
        })
      : buildMobileSsoErrorUrl(
          MOBILE_SSO_HAND_OFF_EXPIRED_ERROR,
          MOBILE_SSO_HAND_OFF_EXPIRED_MESSAGE,
        );
  } catch (err: unknown) {
    callbackUrl = buildMobileSsoErrorUrl(
      MOBILE_SSO_HAND_OFF_FAILED_ERROR,
      err instanceof Exception
        ? err.message
        : MOBILE_SSO_HAND_OFF_EXPIRED_MESSAGE,
    );
  }

  data.res.redirect(callbackUrl);
}

// A finished sign-in as the exchange answers it: the deep link's own values.
export function toMobileSsoSignIn(
  data: MobileSsoSuccessParams,
): MobileSsoSignIn {
  return {
    accessToken: data.accessToken,
    refreshToken: data.refreshToken,
    refreshTokenExpiresAt: data.refreshTokenExpiresAt.toISOString(),
    userId: data.userId,
    email: data.email,
    name: data.name,
    isMasterAdmin: data.isMasterAdmin,
    ...(data.globalSsoToken ? { globalSsoToken: data.globalSsoToken } : {}),
    ...(data.ssoToken && data.projectId
      ? { ssoToken: data.ssoToken, projectId: data.projectId }
      : {}),
  };
}

/**
 * Builds the deep link that reports a FAILED login back to the app.
 *
 * `error` is a short, stable reason. `errorDescription` is the human sentence
 * shown to the user; it is optional so a caller with nothing useful to add
 * does not have to invent something.
 */
/*
 * Some of what ends up in these two fields comes from the identity provider
 * (an OIDC `error` / `error_description`), so it is neither trusted nor
 * bounded. Percent-encoding keeps it from breaking the query string, and this
 * cap keeps it from producing a deep link too long for the OS to hand back to
 * the app - which would turn a reportable failure into the silent dead end
 * this whole module exists to prevent. Generous enough that no real message
 * from an identity provider is truncated.
 */
const MAX_MOBILE_SSO_ERROR_FIELD_LENGTH: number = 512;

function clampErrorField(value: string): string {
  return value.length > MAX_MOBILE_SSO_ERROR_FIELD_LENGTH
    ? value.slice(0, MAX_MOBILE_SSO_ERROR_FIELD_LENGTH)
    : value;
}

export function buildMobileSsoErrorUrl(
  error: string,
  errorDescription?: string | undefined,
): string {
  const params: URLSearchParams = new URLSearchParams();
  params.set("error", clampErrorField(error));

  if (errorDescription) {
    params.set("errorDescription", clampErrorField(errorDescription));
  }

  return `${MOBILE_SSO_CALLBACK_URL}?${params.toString()}`;
}

/**
 * Sends a failed mobile login back to the app.
 *
 * Returns true when it handled the response, so callers can write
 * `if (respondToMobileSsoFailure(...)) { return; }` and fall through to the
 * existing web rendering otherwise.
 */
export function respondToMobileSsoFailure(data: {
  res: ExpressResponse;
  isMobileRequest: boolean;
  error: string;
  errorDescription?: string | undefined;
}): boolean {
  if (!data.isMobileRequest) {
    return false;
  }

  data.res.redirect(buildMobileSsoErrorUrl(data.error, data.errorDescription));

  return true;
}

export interface MobileSsoSuccessParams {
  accessToken: string;
  refreshToken: string;
  refreshTokenExpiresAt: Date;
  userId: string;
  email: string;
  name: string;
  isMasterAdmin: boolean;
  /*
   * Instance-wide Global SSO/OIDC token. Satisfies SSO enforcement for every
   * project the user belongs to, so it replaces the per-project fan-out.
   */
  globalSsoToken?: string | undefined;
  // Per-project SSO token; requires projectId alongside it.
  ssoToken?: string | undefined;
  projectId?: string | undefined;
}

/**
 * Builds the deep link that hands a completed login to the app.
 *
 * Kept in one place so the SAML and OIDC routers cannot drift apart on the
 * param names the app parses.
 */
export function buildMobileSsoSuccessUrl(data: MobileSsoSuccessParams): string {
  const params: URLSearchParams = new URLSearchParams();

  params.set("accessToken", data.accessToken);
  params.set("refreshToken", data.refreshToken);
  params.set("refreshTokenExpiresAt", data.refreshTokenExpiresAt.toISOString());
  params.set("userId", data.userId);
  params.set("email", data.email);
  params.set("name", data.name);
  params.set("isMasterAdmin", String(data.isMasterAdmin));

  if (data.globalSsoToken) {
    params.set("globalSsoToken", data.globalSsoToken);
  }

  if (data.ssoToken && data.projectId) {
    params.set("ssoToken", data.ssoToken);
    params.set("projectId", data.projectId);
  }

  return `${MOBILE_SSO_CALLBACK_URL}?${params.toString()}`;
}
