import ObjectID from "Common/Types/ObjectID";
import Protocol from "Common/Types/API/Protocol";
import CookieUtil from "Common/Server/Utils/Cookie";
import { HttpProtocol } from "Common/Server/EnvironmentConfig";
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
 */

export const MOBILE_SSO_CALLBACK_URL: string = "oneuptime://sso-callback";

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
   * string "true" - so sending it cross-site discloses nothing and grants
   * nothing.
   */
  const isHttps: boolean = HttpProtocol === Protocol.HTTPS;

  CookieUtil.setCookie(res, getMobileSsoIntentCookieName(providerId), "true", {
    maxAge: MOBILE_SSO_INTENT_TTL_SECONDS * 1000,
    httpOnly: true,
    ...(isHttps ? { sameSite: "none" as const, secure: true } : {}),
  });
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

  if (relayStateFromBody === "mobile" || req.query["RelayState"] === "mobile") {
    return true;
  }

  if (!data.providerId) {
    return false;
  }

  return (
    CookieUtil.getCookieFromExpressRequest(
      req,
      getMobileSsoIntentCookieName(data.providerId),
    ) === "true"
  );
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
