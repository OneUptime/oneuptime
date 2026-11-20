import { ExpressRequest, ExpressResponse } from "./Express";
import Dictionary from "../../Types/Dictionary";
import ObjectID from "../../Types/ObjectID";
import { CookieOptions } from "express";
import JSONWebToken from "./JsonWebToken";
import User from "../../Models/DatabaseModels/User";
import StatusPagePrivateUser from "../../Models/DatabaseModels/StatusPagePrivateUser";
import OneUptimeDate from "../../Types/Date";
import PositiveNumber from "../../Types/PositiveNumber";
import CookieName from "../../Types/CookieName";
import JsonWebTokenPurpose from "../../Types/JsonWebTokenPurpose";
import SsoProviderType from "../../Types/SSO/SsoProviderType";
import {
  MASTER_PASSWORD_COOKIE_IDENTIFIER,
  MASTER_PASSWORD_COOKIE_MAX_AGE_IN_DAYS,
} from "../../Types/StatusPage/MasterPassword";
import {
  DASHBOARD_MASTER_PASSWORD_COOKIE_IDENTIFIER,
  DASHBOARD_MASTER_PASSWORD_COOKIE_MAX_AGE_IN_DAYS,
} from "../../Types/Dashboard/MasterPassword";
import CaptureSpan from "./Telemetry/CaptureSpan";
import RequestTransport from "./RequestTransport";
import { IdentityRoute } from "../../ServiceRoute";

// The default life of an SSO sign-in's proof: thirty days.
const SSO_SIGN_IN_LIFETIME_IN_DAYS: number = 30;

/*
 * The cookie that says which session a browser holds, for its sign-out and
 * nothing else (JSONWebToken.signSessionSignOutToken, issue #8638). The
 * server rotates the refresh token at every renewal and keeps only the new
 * one, and the access-token cookie lives fifteen minutes: after a renewal
 * whose answer the browser never got, its sign-out would otherwise carry
 * nothing that names its session, and the session would stay signed in on
 * the server. Set beside the refresh token and for as long, HttpOnly and
 * SameSite=Strict, read only by POST /identity/logout.
 */
export const SESSION_SIGN_OUT_COOKIE_NAME: string = "user-sign-out";

/*
 * Where a browser signs out - POST /identity/logout, the address the
 * dashboards post their sign-out to (UserUtil.logout, IDENTITY_URL) - and
 * the only path the sign-out cookie is sent to. So no other request carries
 * it, and a renewal that is refused, which clears the cookies it was sent,
 * leaves it for the sign-out the dashboard sends next.
 */
export const SESSION_SIGN_OUT_COOKIE_PATH: string = `${IdentityRoute.toString()}/logout`;

/*
 * Where a status page signs its reader out, before the page's id: every
 * host that serves a status page - the installation's own address, a
 * custom domain - passes /status-page-identity-api to the identity
 * service (Nginx/default.conf.template), and the page posts its sign-out
 * there, on its own host. Each page's sign-out cookie is sent only to its
 * own sign-out (getStatusPageSessionSignOutPath), and a refused renewal,
 * which clears the page's cookies, never sees it (issue #8671).
 */
export const STATUS_PAGE_SIGN_OUT_COOKIE_PATH_PREFIX: string =
  "/status-page-identity-api/logout";

/*
 * Where a dashboard's public link calls its server: every host that serves
 * the link - the installation's own address and every custom domain of the
 * dashboard - passes /public-dashboard-api to the app (Nginx/
 * default.conf.template). A dashboard private user's session cookies are
 * sent only there (setDashboardPrivateUserCookie), never to the rest of a
 * host the dashboard shares with OneUptime's own pages.
 */
export const PUBLIC_DASHBOARD_API_COOKIE_PATH: string = "/public-dashboard-api";

/*
 * Where a dashboard's public link signs its private user out, before the
 * dashboard's id (Types/Dashboard/DashboardPrivateUserRoutes): the only path
 * its sign-out cookie is sent to.
 */
export const DASHBOARD_PRIVATE_USER_SIGN_OUT_COOKIE_PATH_PREFIX: string = `${PUBLIC_DASHBOARD_API_COOKIE_PATH}/private-user/logout`;

export default class CookieUtil {
  // set cookie with express response

  private static readonly DEFAULT_ACCESS_TOKEN_EXPIRY_SECONDS: number = 15 * 60;

  @CaptureSpan()
  public static getCookiesFromCookieString(
    cookieString: string,
  ): Dictionary<string> {
    const cookies: Dictionary<string> = {};
    cookieString.split(";").forEach((cookie: string) => {
      const parts: string[] = cookie.split("=");
      const key: string = (parts[0] as string).trim() as string;
      const value: string = parts[1] as string;
      cookies[key] = value;
    });

    return cookies;
  }

  /*
   * Builds a per-project SSO token. The optional `ssoProviderId` /
   * `ssoProviderType` discriminator records WHICH identity provider issued the
   * token, so a project that enforces SSO can require a specific provider
   * (e.g. its own Project SSO, or an instance-wide Global SSO). Used by both
   * the cookie flow (web) and the deep-link flow (mobile) so the token shape
   * stays identical.
   *
   * It is an SSO sign-in (JsonWebTokenPurpose.SsoSignIn) and never a
   * session: a project that requires SSO reads it only next to a session of
   * the same person, which the same sign-in hands out.
   */
  @CaptureSpan()
  public static getSSOToken(data: {
    user: User;
    projectId: ObjectID;
    ssoProviderId?: ObjectID | undefined;
    ssoProviderType?: SsoProviderType | undefined;
    /*
     * How long it lasts (SessionMetadata.ssoSignInExpiresInSeconds): thirty
     * days, or the server's SSO session length when that is shorter.
     */
    expiresInSeconds?: number | undefined;
  }): string {
    const { user, projectId } = data;

    return JSONWebToken.sign({
      data: {
        userId: user.id!,
        projectId: projectId,
        name: user.name!,
        email: user.email,
        isMasterAdmin: false,
        isGeneralLogin: false,
        ssoProviderId: data.ssoProviderId
          ? data.ssoProviderId.toString()
          : undefined,
        ssoProviderType: data.ssoProviderType
          ? data.ssoProviderType.toString()
          : undefined,
      },
      expiresInSeconds: CookieUtil.getSsoSignInLifetimeInSeconds(
        data.expiresInSeconds,
      ),
      purpose: JsonWebTokenPurpose.SsoSignIn,
    });
  }

  /*
   * How long an SSO sign-in's proof lasts, in seconds: as asked, when that
   * is a positive number no longer than thirty days, and thirty days
   * otherwise.
   */
  public static getSsoSignInLifetimeInSeconds(
    expiresInSeconds?: number | undefined,
  ): number {
    const longest: number = OneUptimeDate.getSecondsInDays(
      new PositiveNumber(SSO_SIGN_IN_LIFETIME_IN_DAYS),
    );

    if (
      typeof expiresInSeconds !== "number" ||
      !Number.isFinite(expiresInSeconds) ||
      expiresInSeconds <= 0
    ) {
      return longest;
    }

    return Math.min(longest, Math.floor(expiresInSeconds));
  }

  @CaptureSpan()
  public static setSSOCookie(data: {
    user: User;
    projectId: ObjectID;
    expressResponse: ExpressResponse;
    ssoProviderId?: ObjectID | undefined;
    ssoProviderType?: SsoProviderType | undefined;
    // As getSSOToken's.
    expiresInSeconds?: number | undefined;
  }): void {
    const { projectId, expressResponse: res } = data;

    const ssoToken: string = CookieUtil.getSSOToken({
      user: data.user,
      projectId: projectId,
      ssoProviderId: data.ssoProviderId,
      ssoProviderType: data.ssoProviderType,
      expiresInSeconds: data.expiresInSeconds,
    });

    CookieUtil.setCookie(res, CookieUtil.getUserSSOKey(projectId), ssoToken, {
      maxAge:
        CookieUtil.getSsoSignInLifetimeInSeconds(data.expiresInSeconds) * 1000,
      httpOnly: true,
    });
  }

  /*
   * Builds a Global SSO token. Unlike the per-project token, this is NOT bound
   * to a single project — a Global SSO/OIDC login proves the user authenticated
   * against the instance-wide IdP, so one token satisfies SSO enforcement for
   * every project the user belongs to (including projects created after login).
   * It carries the `ssoProviderId` / `ssoProviderType` discriminator so a
   * project that pins a specific provider can still be enforced.
   *
   * Like the per-project one, it is an SSO sign-in and never a session.
   */
  @CaptureSpan()
  public static getGlobalSSOToken(data: {
    user: User;
    ssoProviderId: ObjectID;
    ssoProviderType: SsoProviderType;
    // As getSSOToken's.
    expiresInSeconds?: number | undefined;
  }): string {
    const { user } = data;

    return JSONWebToken.sign({
      data: {
        userId: user.id!,
        name: user.name!,
        email: user.email,
        isMasterAdmin: false,
        isGeneralLogin: false,
        ssoProviderId: data.ssoProviderId.toString(),
        ssoProviderType: data.ssoProviderType.toString(),
      },
      expiresInSeconds: CookieUtil.getSsoSignInLifetimeInSeconds(
        data.expiresInSeconds,
      ),
      purpose: JsonWebTokenPurpose.SsoSignIn,
    });
  }

  @CaptureSpan()
  public static setGlobalSSOCookie(data: {
    user: User;
    expressResponse: ExpressResponse;
    ssoProviderId: ObjectID;
    ssoProviderType: SsoProviderType;
    // As getSSOToken's.
    expiresInSeconds?: number | undefined;
  }): void {
    const { expressResponse: res } = data;

    const globalSsoToken: string = CookieUtil.getGlobalSSOToken({
      user: data.user,
      ssoProviderId: data.ssoProviderId,
      ssoProviderType: data.ssoProviderType,
      expiresInSeconds: data.expiresInSeconds,
    });

    CookieUtil.setCookie(res, CookieUtil.getGlobalSSOKey(), globalSsoToken, {
      maxAge:
        CookieUtil.getSsoSignInLifetimeInSeconds(data.expiresInSeconds) * 1000,
      httpOnly: true,
    });
  }

  @CaptureSpan()
  public static setUserCookie(data: {
    expressResponse: ExpressResponse;
    user: User;
    isGlobalLogin: boolean;
    sessionId: ObjectID;
    refreshToken: string;
    refreshTokenExpiresAt: Date;
    accessTokenExpiresInSeconds?: number;
    /*
     * When the session signed in and when its person was last active
     * (Utils/SessionCookieFields): claims of its access token, which the
     * server's session lengths are asked against on every request.
     */
    signedInAt?: Date | undefined;
    lastActiveAt?: Date | undefined;
  }): void {
    const {
      expressResponse: res,
      user,
      isGlobalLogin,
      sessionId,
      refreshToken,
      refreshTokenExpiresAt,
    } = data;

    const accessTokenExpiresInSeconds: number =
      data.accessTokenExpiresInSeconds ||
      CookieUtil.DEFAULT_ACCESS_TOKEN_EXPIRY_SECONDS;

    const token: string = JSONWebToken.signUserLoginToken({
      tokenData: {
        userId: user.id!,
        email: user.email!,
        name: user.name!,
        timezone: user.timezone || null,
        isMasterAdmin: user.isMasterAdmin!,
        isGlobalLogin: isGlobalLogin, // This is a general login without SSO. So, we will set this to true. This will give access to all the projects that dont require SSO.
        sessionId: sessionId,
        signedInAt: data.signedInAt,
        lastActiveAt: data.lastActiveAt,
      },
      expiresInSeconds: accessTokenExpiresInSeconds,
    });

    // Set a cookie with token.
    CookieUtil.setCookie(res, CookieUtil.getUserTokenKey(), token, {
      maxAge: accessTokenExpiresInSeconds * 1000,
      httpOnly: true,
    });

    const refreshTokenTtl: number = Math.max(
      refreshTokenExpiresAt.getTime() - Date.now(),
      0,
    );

    CookieUtil.setCookie(res, CookieUtil.getRefreshTokenKey(), refreshToken, {
      maxAge: refreshTokenTtl,
      httpOnly: true,
    });

    /*
     * Which session this browser holds, for its sign-out only
     * (SESSION_SIGN_OUT_COOKIE_NAME): renewed with the refresh token, for
     * as long, and never sent anywhere but the sign-out.
     */
    CookieUtil.setCookie(
      res,
      CookieUtil.getSessionSignOutKey(),
      JSONWebToken.signSessionSignOutToken({
        userId: user.id!,
        sessionId: sessionId,
        expiresInSeconds: refreshTokenTtl / 1000,
      }),
      {
        maxAge: refreshTokenTtl,
        httpOnly: true,
        sameSite: "strict",
        path: SESSION_SIGN_OUT_COOKIE_PATH,
      },
    );

    if (user.id) {
      // set user id cookie
      CookieUtil.setCookie(res, CookieName.UserID, user.id!.toString(), {
        maxAge: OneUptimeDate.getMillisecondsInDays(new PositiveNumber(30)),
        httpOnly: false,
      });
    }

    if (user.email) {
      // set user email cookie
      CookieUtil.setCookie(
        res,
        CookieName.Email,
        user.email?.toString() || "",
        {
          maxAge: OneUptimeDate.getMillisecondsInDays(new PositiveNumber(30)),
          httpOnly: false,
        },
      );
    }

    if (user.name) {
      // set user name cookie
      CookieUtil.setCookie(res, CookieName.Name, user.name?.toString() || "", {
        maxAge: OneUptimeDate.getMillisecondsInDays(new PositiveNumber(30)),
        httpOnly: false,
      });
    }

    if (user.timezone) {
      // set user timezone cookie
      CookieUtil.setCookie(
        res,
        CookieName.Timezone,
        user.timezone?.toString() || "",
        {
          maxAge: OneUptimeDate.getMillisecondsInDays(new PositiveNumber(30)),
          httpOnly: false,
        },
      );
    }

    /*
     * What the dashboards read to show a master admin's links and settings
     * (UserUtil.isMasterAdmin); the server decides from the account itself.
     * Taken away for everyone else, so a browser that last signed in as a
     * master admin whose access was removed stops showing them at the
     * session's next renewal, as the server already has.
     */
    if (user.isMasterAdmin) {
      CookieUtil.setCookie(
        res,
        CookieName.IsMasterAdmin,
        user.isMasterAdmin?.toString() || "",
        {
          maxAge: OneUptimeDate.getMillisecondsInDays(new PositiveNumber(30)),
          httpOnly: false,
        },
      );
    } else {
      CookieUtil.removeCookie(res, CookieName.IsMasterAdmin);
    }

    if (user.profilePictureId) {
      // set user profile picture id cookie
      CookieUtil.setCookie(
        res,
        CookieName.ProfilePicID,
        user.profilePictureId?.toString() || "",
        {
          maxAge: OneUptimeDate.getMillisecondsInDays(new PositiveNumber(30)),
          httpOnly: false,
        },
      );
    }
  }

  @CaptureSpan()
  public static setStatusPagePrivateUserCookie(data: {
    expressResponse: ExpressResponse;
    user: StatusPagePrivateUser;
    statusPageId: ObjectID;
    sessionId: ObjectID;
    refreshToken: string;
    refreshTokenExpiresAt: Date;
    accessTokenExpiresInSeconds?: number;
  }): string {
    const {
      expressResponse: res,
      user,
      statusPageId,
      sessionId,
      refreshToken,
      refreshTokenExpiresAt,
    } = data;

    const accessTokenExpiresInSeconds: number =
      data.accessTokenExpiresInSeconds ||
      CookieUtil.DEFAULT_ACCESS_TOKEN_EXPIRY_SECONDS;

    const token: string = JSONWebToken.sign({
      data: {
        userId: user.id!,
        email: user.email!,
        statusPageId: statusPageId,
        sessionId: sessionId,
      },
      expiresInSeconds: accessTokenExpiresInSeconds,
      purpose: JsonWebTokenPurpose.StatusPageSession,
    });

    CookieUtil.setCookie(res, CookieUtil.getUserTokenKey(statusPageId), token, {
      maxAge: accessTokenExpiresInSeconds * 1000,
      httpOnly: true,
    });

    const refreshTokenTtl: number = Math.max(
      refreshTokenExpiresAt.getTime() - Date.now(),
      0,
    );

    CookieUtil.setCookie(
      res,
      CookieUtil.getRefreshTokenKey(statusPageId),
      refreshToken,
      {
        maxAge: refreshTokenTtl,
        httpOnly: true,
      },
    );

    /*
     * Which session this browser holds on this page, for its sign-out on
     * this page only (issue #8671): renewed with the refresh token, for as
     * long, and sent to nothing but the page's sign-out.
     */
    CookieUtil.setCookie(
      res,
      CookieUtil.getStatusPageSessionSignOutKey(statusPageId),
      JSONWebToken.signStatusPageSessionSignOutToken({
        statusPageId: statusPageId,
        userId: user.id!,
        sessionId: sessionId,
        expiresInSeconds: refreshTokenTtl / 1000,
      }),
      {
        maxAge: refreshTokenTtl,
        httpOnly: true,
        sameSite: "strict",
        path: CookieUtil.getStatusPageSessionSignOutPath(statusPageId),
      },
    );

    return token;
  }

  @CaptureSpan()
  public static setStatusPageMasterPasswordCookie(data: {
    expressResponse: ExpressResponse;
    statusPageId: ObjectID;
  }): void {
    const expiresInDays: PositiveNumber = new PositiveNumber(
      MASTER_PASSWORD_COOKIE_MAX_AGE_IN_DAYS,
    );

    const token: string = JSONWebToken.signJsonPayload(
      {
        statusPageId: data.statusPageId.toString(),
        type: MASTER_PASSWORD_COOKIE_IDENTIFIER,
      },
      OneUptimeDate.getSecondsInDays(expiresInDays),
    );

    CookieUtil.setCookie(
      data.expressResponse,
      CookieUtil.getStatusPageMasterPasswordKey(data.statusPageId),
      token,
      {
        maxAge: OneUptimeDate.getMillisecondsInDays(expiresInDays),
        httpOnly: true,
      },
    );
  }

  /*
   * Every cookie the server sets goes through here (a guard test holds the
   * rest of the code to it), so one rule decides what keeps a cookie on
   * HTTPS: it is Secure whenever the browser is talking to OneUptime over
   * HTTPS (RequestTransport.isHttps), and a browser never sends a Secure
   * cookie over plain HTTP. A caller cannot turn that off; over plain HTTP,
   * where the browser would drop a Secure cookie, the cookie is left as it
   * was so a plain-HTTP installation still signs people in.
   */
  @CaptureSpan()
  public static setCookie(
    res: ExpressResponse,
    name: string | CookieName,
    value: string,
    options: CookieOptions,
  ): void {
    const cookieOptions: CookieOptions = {
      path: "/",
      sameSite: "lax",
      ...options,
    };

    if (RequestTransport.isHttps(res.req)) {
      cookieOptions.secure = true;
    }

    res.cookie(name, value, cookieOptions);
  }

  // get cookie with express request

  @CaptureSpan()
  public static getCookieFromExpressRequest(
    req: ExpressRequest,
    name: string,
  ): string | undefined {
    /*
     * req.cookies is only populated when the cookie-parser middleware has run.
     * Guard against requests where it is absent (mirrors getAllCookies above).
     */
    return req.cookies?.[name];
  }

  @CaptureSpan()
  public static getRefreshTokenFromExpressRequest(
    req: ExpressRequest,
    id?: ObjectID,
  ): string | undefined {
    return CookieUtil.getCookieFromExpressRequest(
      req,
      CookieUtil.getRefreshTokenKey(id),
    );
  }

  // delete cookie with express response

  /*
   * Clears a cookie with the attributes it was set with: the path (a cookie
   * set on another path is a different cookie, and survives a clear on "/"),
   * the SameSite setting, and Secure by the same rule as setCookie.
   */
  @CaptureSpan()
  public static removeCookie(
    res: ExpressResponse,
    name: string,
    options?: {
      path?: string | undefined;
      sameSite?: CookieOptions["sameSite"] | undefined;
      httpOnly?: boolean | undefined;
    },
  ): void {
    const cookieOptions: CookieOptions = {
      path: options?.path || "/",
      sameSite: options?.sameSite || "lax",
    };

    if (options?.httpOnly !== undefined) {
      cookieOptions.httpOnly = options.httpOnly;
    }

    if (RequestTransport.isHttps(res.req)) {
      cookieOptions.secure = true;
    }

    res.clearCookie(name, cookieOptions);
  }

  @CaptureSpan()
  public static removeStatusPageMasterPasswordCookie(
    res: ExpressResponse,
    statusPageId: ObjectID,
  ): void {
    CookieUtil.removeCookie(
      res,
      CookieUtil.getStatusPageMasterPasswordKey(statusPageId),
    );
  }

  @CaptureSpan()
  public static setDashboardMasterPasswordCookie(data: {
    expressResponse: ExpressResponse;
    dashboardId: ObjectID;
  }): void {
    const expiresInDays: PositiveNumber = new PositiveNumber(
      DASHBOARD_MASTER_PASSWORD_COOKIE_MAX_AGE_IN_DAYS,
    );

    const token: string = JSONWebToken.signJsonPayload(
      {
        dashboardId: data.dashboardId.toString(),
        type: DASHBOARD_MASTER_PASSWORD_COOKIE_IDENTIFIER,
      },
      OneUptimeDate.getSecondsInDays(expiresInDays),
    );

    CookieUtil.setCookie(
      data.expressResponse,
      CookieUtil.getDashboardMasterPasswordKey(data.dashboardId),
      token,
      {
        maxAge: OneUptimeDate.getMillisecondsInDays(expiresInDays),
        httpOnly: true,
      },
    );
  }

  @CaptureSpan()
  public static removeDashboardMasterPasswordCookie(
    res: ExpressResponse,
    dashboardId: ObjectID,
  ): void {
    CookieUtil.removeCookie(
      res,
      CookieUtil.getDashboardMasterPasswordKey(dashboardId),
    );
  }

  @CaptureSpan()
  public static getDashboardMasterPasswordKey(id: ObjectID): string {
    return `${CookieName.DashboardMasterPassword}-${id.toString()}`;
  }

  /*
   * A dashboard private user's session on one dashboard's public link
   * (#10250), in three cookies named after the dashboard, so a browser holds
   * one session per dashboard and per host - a cookie is its host's alone,
   * so a custom domain and OneUptime's own address each sign in on their
   * own:
   *
   *   - the access token (JsonWebTokenPurpose.DashboardPrivateUserSession),
   *     for fifteen minutes;
   *   - the refresh token, which renews it, for as long as the session;
   *   - the sign-out cookie (DashboardPrivateUserSessionSignOut), for as
   *     long, sent only to the dashboard's own sign-out.
   *
   * Every one is HttpOnly, SameSite=Strict - a page of another site never
   * has a browser send them, so no other site can read the dashboard or
   * sign its reader out - and Secure whenever the browser reached OneUptime
   * over HTTPS (setCookie). The access and refresh tokens are sent only to
   * the public link's API (PUBLIC_DASHBOARD_API_COOKIE_PATH), never to the
   * rest of the host. Returns the access token.
   */
  @CaptureSpan()
  public static setDashboardPrivateUserCookie(data: {
    expressResponse: ExpressResponse;
    dashboardId: ObjectID;
    // The DashboardPrivateUser whose session it is.
    privateUserId: ObjectID;
    sessionId: ObjectID;
    refreshToken: string;
    refreshTokenExpiresAt: Date;
    accessTokenExpiresInSeconds?: number | undefined;
  }): string {
    const accessTokenExpiresInSeconds: number =
      data.accessTokenExpiresInSeconds ||
      CookieUtil.DEFAULT_ACCESS_TOKEN_EXPIRY_SECONDS;

    const token: string = JSONWebToken.signDashboardPrivateUserSessionToken({
      dashboardId: data.dashboardId,
      userId: data.privateUserId,
      sessionId: data.sessionId,
      expiresInSeconds: accessTokenExpiresInSeconds,
    });

    CookieUtil.setCookie(
      data.expressResponse,
      CookieUtil.getDashboardPrivateUserTokenKey(data.dashboardId),
      token,
      {
        maxAge: accessTokenExpiresInSeconds * 1000,
        httpOnly: true,
        sameSite: "strict",
        path: PUBLIC_DASHBOARD_API_COOKIE_PATH,
      },
    );

    const refreshTokenTtl: number = Math.max(
      data.refreshTokenExpiresAt.getTime() - Date.now(),
      0,
    );

    CookieUtil.setCookie(
      data.expressResponse,
      CookieUtil.getDashboardPrivateUserRefreshTokenKey(data.dashboardId),
      data.refreshToken,
      {
        maxAge: refreshTokenTtl,
        httpOnly: true,
        sameSite: "strict",
        path: PUBLIC_DASHBOARD_API_COOKIE_PATH,
      },
    );

    CookieUtil.setCookie(
      data.expressResponse,
      CookieUtil.getDashboardPrivateUserSignOutKey(data.dashboardId),
      JSONWebToken.signDashboardPrivateUserSessionSignOutToken({
        dashboardId: data.dashboardId,
        userId: data.privateUserId,
        sessionId: data.sessionId,
        expiresInSeconds: refreshTokenTtl / 1000,
      }),
      {
        maxAge: refreshTokenTtl,
        httpOnly: true,
        sameSite: "strict",
        path: CookieUtil.getDashboardPrivateUserSignOutPath(data.dashboardId),
      },
    );

    return token;
  }

  @CaptureSpan()
  public static getDashboardPrivateUserTokenKey(dashboardId: ObjectID): string {
    return `${CookieName.DashboardPrivateUserToken}-${dashboardId.toString()}`;
  }

  @CaptureSpan()
  public static getDashboardPrivateUserRefreshTokenKey(
    dashboardId: ObjectID,
  ): string {
    return `${CookieName.DashboardPrivateUserRefreshToken}-${dashboardId.toString()}`;
  }

  @CaptureSpan()
  public static getDashboardPrivateUserSignOutKey(
    dashboardId: ObjectID,
  ): string {
    return `${CookieName.DashboardPrivateUserSignOut}-${dashboardId.toString()}`;
  }

  // The only path a dashboard's sign-out cookie is sent to: its own sign-out.
  @CaptureSpan()
  public static getDashboardPrivateUserSignOutPath(
    dashboardId: ObjectID,
  ): string {
    return `${DASHBOARD_PRIVATE_USER_SIGN_OUT_COOKIE_PATH_PREFIX}/${dashboardId.toString()}`;
  }

  // The access token a browser sent for this dashboard's public link, if any.
  @CaptureSpan()
  public static getDashboardPrivateUserTokenFromExpressRequest(
    req: ExpressRequest,
    dashboardId: ObjectID,
  ): string | undefined {
    return CookieUtil.getCookieFromExpressRequest(
      req,
      CookieUtil.getDashboardPrivateUserTokenKey(dashboardId),
    );
  }

  @CaptureSpan()
  public static getDashboardPrivateUserRefreshTokenFromExpressRequest(
    req: ExpressRequest,
    dashboardId: ObjectID,
  ): string | undefined {
    return CookieUtil.getCookieFromExpressRequest(
      req,
      CookieUtil.getDashboardPrivateUserRefreshTokenKey(dashboardId),
    );
  }

  /*
   * The sign-out cookie for this dashboard a browser sent, which it sends
   * only to the dashboard's sign-out. Read from the cookie only: never from
   * a body or a header.
   */
  @CaptureSpan()
  public static getDashboardPrivateUserSignOutTokenFromExpressRequest(
    req: ExpressRequest,
    dashboardId: ObjectID,
  ): string | undefined {
    return CookieUtil.getCookieFromExpressRequest(
      req,
      CookieUtil.getDashboardPrivateUserSignOutKey(dashboardId),
    );
  }

  /*
   * Clears every cookie a private user's sign-in to one dashboard left in
   * the browser, each on the path and with the attributes it was set with,
   * so the browser removes it. Another dashboard's, a status page's and
   * OneUptime's own are left as they are; so is the dashboard's master
   * password cookie, which is no one's session.
   */
  @CaptureSpan()
  public static removeDashboardPrivateUserCookies(
    res: ExpressResponse,
    dashboardId: ObjectID,
  ): void {
    CookieUtil.removeCookie(
      res,
      CookieUtil.getDashboardPrivateUserTokenKey(dashboardId),
      {
        path: PUBLIC_DASHBOARD_API_COOKIE_PATH,
        sameSite: "strict",
        httpOnly: true,
      },
    );
    CookieUtil.removeCookie(
      res,
      CookieUtil.getDashboardPrivateUserRefreshTokenKey(dashboardId),
      {
        path: PUBLIC_DASHBOARD_API_COOKIE_PATH,
        sameSite: "strict",
        httpOnly: true,
      },
    );
    CookieUtil.removeCookie(
      res,
      CookieUtil.getDashboardPrivateUserSignOutKey(dashboardId),
      {
        path: CookieUtil.getDashboardPrivateUserSignOutPath(dashboardId),
        sameSite: "strict",
        httpOnly: true,
      },
    );
  }

  // get all cookies with express request
  @CaptureSpan()
  public static getAllCookies(req: ExpressRequest): Dictionary<string> {
    return req.cookies || {};
  }

  @CaptureSpan()
  public static getUserTokenKey(id?: ObjectID): string {
    if (!id) {
      return CookieName.Token;
    }

    return `${CookieName.Token}-${id.toString()}`;
  }

  @CaptureSpan()
  public static getRefreshTokenKey(id?: ObjectID): string {
    if (!id) {
      return CookieName.RefreshToken;
    }

    return `${CookieName.RefreshToken}-${id.toString()}`;
  }

  // The cookie that says which session a browser holds, for its sign-out.
  @CaptureSpan()
  public static getSessionSignOutKey(): string {
    return SESSION_SIGN_OUT_COOKIE_NAME;
  }

  /*
   * The sign-out cookie a browser sent, which it sends only to
   * POST /identity/logout (SESSION_SIGN_OUT_COOKIE_PATH). Read from the
   * cookie only: never from a body or a header.
   */
  @CaptureSpan()
  public static getSessionSignOutTokenFromExpressRequest(
    req: ExpressRequest,
  ): string | undefined {
    return CookieUtil.getCookieFromExpressRequest(
      req,
      CookieUtil.getSessionSignOutKey(),
    );
  }

  // Clears the sign-out cookie on the path, and with the attributes, it was set with.
  @CaptureSpan()
  public static removeSessionSignOutCookie(res: ExpressResponse): void {
    CookieUtil.removeCookie(res, CookieUtil.getSessionSignOutKey(), {
      path: SESSION_SIGN_OUT_COOKIE_PATH,
      sameSite: "strict",
      httpOnly: true,
    });
  }

  // The cookie that says which session a browser holds on one status page, for its sign-out there.
  @CaptureSpan()
  public static getStatusPageSessionSignOutKey(statusPageId: ObjectID): string {
    return `${SESSION_SIGN_OUT_COOKIE_NAME}-${statusPageId.toString()}`;
  }

  /*
   * Where a status page signs its reader out, on whichever host serves the
   * page - POST /status-page-identity-api/logout/<status page>, the address
   * the page posts its sign-out to (UserUtil.logout in the status page,
   * STATUS_PAGE_IDENTITY_API_URL) - and the only path its sign-out cookie
   * is sent to.
   */
  @CaptureSpan()
  public static getStatusPageSessionSignOutPath(
    statusPageId: ObjectID,
  ): string {
    return `${STATUS_PAGE_SIGN_OUT_COOKIE_PATH_PREFIX}/${statusPageId.toString()}`;
  }

  /*
   * The sign-out cookie for this status page a browser sent, which it sends
   * only to the page's sign-out. Read from the cookie only: never from a
   * body or a header.
   */
  @CaptureSpan()
  public static getStatusPageSessionSignOutTokenFromExpressRequest(
    req: ExpressRequest,
    statusPageId: ObjectID,
  ): string | undefined {
    return CookieUtil.getCookieFromExpressRequest(
      req,
      CookieUtil.getStatusPageSessionSignOutKey(statusPageId),
    );
  }

  // Clears a status page's sign-out cookie on the path, and with the attributes, it was set with.
  @CaptureSpan()
  public static removeStatusPageSessionSignOutCookie(
    res: ExpressResponse,
    statusPageId: ObjectID,
  ): void {
    CookieUtil.removeCookie(
      res,
      CookieUtil.getStatusPageSessionSignOutKey(statusPageId),
      {
        path: CookieUtil.getStatusPageSessionSignOutPath(statusPageId),
        sameSite: "strict",
        httpOnly: true,
      },
    );
  }

  /*
   * Clears every cookie a sign-in to one status page left in the browser -
   * its access token, its refresh token, its sign-out cookie and its master
   * password - each on the path, and with the attributes, it was set with,
   * so the browser removes it. Another page's cookies, and the dashboards',
   * are left as they are.
   */
  @CaptureSpan()
  public static removeStatusPageSessionCookies(
    res: ExpressResponse,
    statusPageId: ObjectID,
  ): void {
    CookieUtil.removeCookie(res, CookieUtil.getUserTokenKey(statusPageId));
    CookieUtil.removeCookie(res, CookieUtil.getRefreshTokenKey(statusPageId));
    CookieUtil.removeStatusPageSessionSignOutCookie(res, statusPageId);
    CookieUtil.removeStatusPageMasterPasswordCookie(res, statusPageId);
  }

  @CaptureSpan()
  public static getStatusPageMasterPasswordKey(id: ObjectID): string {
    return `${CookieName.StatusPageMasterPassword}-${id.toString()}`;
  }

  @CaptureSpan()
  public static getUserSSOKey(id: ObjectID): string {
    return `${this.getSSOKey()}${id.toString()}`;
  }

  @CaptureSpan()
  public static getSSOKey(): string {
    return `sso-`;
  }

  /*
   * Fixed cookie name for the single Global SSO token. Deliberately does NOT
   * start with the per-project `sso-` prefix so the project-scoped cookie
   * parser in UserMiddleware.getSsoTokens never mis-keys it.
   */
  @CaptureSpan()
  public static getGlobalSSOKey(): string {
    return CookieName.GlobalSSOToken;
  }

  /*
   * Clears every cookie the request carries, on "/" - and the sign-out
   * cookie on its own path, which only a sign-out carries. So a refused
   * renewal, which is not sent it, leaves it for the sign-out the dashboard
   * sends next (SESSION_SIGN_OUT_COOKIE_PATH).
   */
  @CaptureSpan()
  public static removeAllCookies(
    req: ExpressRequest,
    res: ExpressResponse,
  ): void {
    const cookies: Dictionary<string> = this.getAllCookies(req);
    for (const key in cookies) {
      if (key === this.getSessionSignOutKey()) {
        this.removeSessionSignOutCookie(res);
        continue;
      }

      this.removeCookie(res, key);
    }

    // Always attempt to remove refresh token cookie even if not parsed.
    this.removeCookie(res, this.getRefreshTokenKey());
  }
}
