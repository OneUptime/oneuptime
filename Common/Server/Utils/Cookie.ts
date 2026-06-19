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
   */
  @CaptureSpan()
  public static getSSOToken(data: {
    user: User;
    projectId: ObjectID;
    ssoProviderId?: ObjectID | undefined;
    ssoProviderType?: SsoProviderType | undefined;
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
      expiresInSeconds: OneUptimeDate.getSecondsInDays(new PositiveNumber(30)),
    });
  }

  @CaptureSpan()
  public static setSSOCookie(data: {
    user: User;
    projectId: ObjectID;
    expressResponse: ExpressResponse;
    ssoProviderId?: ObjectID | undefined;
    ssoProviderType?: SsoProviderType | undefined;
  }): void {
    const { projectId, expressResponse: res } = data;

    const ssoToken: string = CookieUtil.getSSOToken({
      user: data.user,
      projectId: projectId,
      ssoProviderId: data.ssoProviderId,
      ssoProviderType: data.ssoProviderType,
    });

    CookieUtil.setCookie(res, CookieUtil.getUserSSOKey(projectId), ssoToken, {
      maxAge: OneUptimeDate.getMillisecondsInDays(new PositiveNumber(30)),
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
   */
  @CaptureSpan()
  public static getGlobalSSOToken(data: {
    user: User;
    ssoProviderId: ObjectID;
    ssoProviderType: SsoProviderType;
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
      expiresInSeconds: OneUptimeDate.getSecondsInDays(new PositiveNumber(30)),
    });
  }

  @CaptureSpan()
  public static setGlobalSSOCookie(data: {
    user: User;
    expressResponse: ExpressResponse;
    ssoProviderId: ObjectID;
    ssoProviderType: SsoProviderType;
  }): void {
    const { expressResponse: res } = data;

    const globalSsoToken: string = CookieUtil.getGlobalSSOToken({
      user: data.user,
      ssoProviderId: data.ssoProviderId,
      ssoProviderType: data.ssoProviderType,
    });

    CookieUtil.setCookie(res, CookieUtil.getGlobalSSOKey(), globalSsoToken, {
      maxAge: OneUptimeDate.getMillisecondsInDays(new PositiveNumber(30)),
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

    if (user.isMasterAdmin) {
      // set user isMasterAdmin cookie
      CookieUtil.setCookie(
        res,
        CookieName.IsMasterAdmin,
        user.isMasterAdmin?.toString() || "",
        {
          maxAge: OneUptimeDate.getMillisecondsInDays(new PositiveNumber(30)),
          httpOnly: false,
        },
      );
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

    res.cookie(name, value, cookieOptions);
  }

  // get cookie with express request

  @CaptureSpan()
  public static getCookieFromExpressRequest(
    req: ExpressRequest,
    name: string,
  ): string | undefined {
    // req.cookies is only populated when the cookie-parser middleware has run.
    // Guard against requests where it is absent (mirrors getAllCookies above).
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

  @CaptureSpan()
  public static removeCookie(res: ExpressResponse, name: string): void {
    res.clearCookie(name, {
      path: "/",
      sameSite: "lax",
    });
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

  // delete all cookies.
  @CaptureSpan()
  public static removeAllCookies(
    req: ExpressRequest,
    res: ExpressResponse,
  ): void {
    const cookies: Dictionary<string> = this.getAllCookies(req);
    for (const key in cookies) {
      this.removeCookie(res, key);
    }

    // Always attempt to remove refresh token cookie even if not parsed.
    this.removeCookie(res, this.getRefreshTokenKey());
  }
}
