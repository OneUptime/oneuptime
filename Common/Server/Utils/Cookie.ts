import { ExpressRequest, ExpressResponse } from "./Express";
import Dictionary from "../../Types/Dictionary";
import ObjectID from "../../Types/ObjectID";
import { CookieOptions } from "express";
import JSONWebToken from "./JsonWebToken";
import StatusPagePrivateUser from "../../Models/DatabaseModels/StatusPagePrivateUser";
import User from "../../Models/DatabaseModels/User";
import OneUptimeDate from "../../Types/Date";
import PositiveNumber from "../../Types/PositiveNumber";
import CookieName from "../../Types/CookieName";
import CaptureSpan from "./Telemetry/CaptureSpan";

export default class CookieUtil {
  // set cookie with express response

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

  @CaptureSpan()
  public static setSSOCookie(data: {
    user: User;
    projectId: ObjectID;
    expressResponse: ExpressResponse;
  }): void {
    const { user, projectId, expressResponse: res } = data;

    const ssoToken: string = JSONWebToken.sign({
      data: {
        userId: user.id!,
        projectId: projectId,
        name: user.name!,
        email: user.email,
        isMasterAdmin: false,
        isGeneralLogin: false,
      },
      expiresInSeconds: OneUptimeDate.getSecondsInDays(new PositiveNumber(30)),
    });

    CookieUtil.setCookie(res, CookieUtil.getUserSSOKey(projectId), ssoToken, {
      maxAge: OneUptimeDate.getMillisecondsInDays(new PositiveNumber(30)),
      httpOnly: true,
    });
  }

  @CaptureSpan()
  public static setUserCookie(data: {
    expressResponse: ExpressResponse;
    user: User;
    accessToken: string;
    refreshToken: string;
    accessTokenExpiresInSeconds: number;
    refreshTokenExpiresInSeconds: number;
  }): void {
    const {
      expressResponse: res,
      user,
      accessToken,
      refreshToken,
      accessTokenExpiresInSeconds,
      refreshTokenExpiresInSeconds,
    } = data;

    const accessTokenMaxAge: number = Math.max(
      0,
      Math.round(accessTokenExpiresInSeconds * 1000),
    );
    const refreshTokenMaxAge: number = Math.max(
      0,
      Math.round(refreshTokenExpiresInSeconds * 1000),
    );

    CookieUtil.setCookie(res, CookieUtil.getUserTokenKey(), accessToken, {
      maxAge: accessTokenMaxAge,
      httpOnly: true,
      sameSite: "lax",
      path: "/",
    });

    CookieUtil.setCookie(
      res,
      CookieUtil.getUserRefreshTokenKey(),
      refreshToken,
      {
        maxAge: refreshTokenMaxAge,
        httpOnly: true,
        sameSite: "lax",
        path: "/",
      },
    );

    if (user.id) {
      CookieUtil.setCookie(res, CookieName.UserID, user.id!.toString(), {
        maxAge: refreshTokenMaxAge,
        httpOnly: false,
        sameSite: "lax",
        path: "/",
      });
    }

    if (user.email) {
      CookieUtil.setCookie(
        res,
        CookieName.Email,
        user.email?.toString() || "",
        {
          maxAge: refreshTokenMaxAge,
          httpOnly: false,
          sameSite: "lax",
          path: "/",
        },
      );
    }

    if (user.name) {
      CookieUtil.setCookie(res, CookieName.Name, user.name?.toString() || "", {
        maxAge: refreshTokenMaxAge,
        httpOnly: false,
        sameSite: "lax",
        path: "/",
      });
    }

    if (user.timezone) {
      CookieUtil.setCookie(
        res,
        CookieName.Timezone,
        user.timezone?.toString() || "",
        {
          maxAge: refreshTokenMaxAge,
          httpOnly: false,
          sameSite: "lax",
          path: "/",
        },
      );
    }

    if (user.isMasterAdmin) {
      CookieUtil.setCookie(
        res,
        CookieName.IsMasterAdmin,
        user.isMasterAdmin?.toString() || "",
        {
          maxAge: refreshTokenMaxAge,
          httpOnly: false,
          sameSite: "lax",
          path: "/",
        },
      );
    }

    if (user.profilePictureId) {
      CookieUtil.setCookie(
        res,
        CookieName.ProfilePicID,
        user.profilePictureId?.toString() || "",
        {
          maxAge: refreshTokenMaxAge,
          httpOnly: false,
          sameSite: "lax",
          path: "/",
        },
      );
    }
  }

  @CaptureSpan()
  public static setStatusPagePrivateUserCookie(data: {
    expressResponse: ExpressResponse;
    user: StatusPagePrivateUser;
    statusPageId: ObjectID;
    accessToken: string;
    refreshToken: string;
    accessTokenExpiresInSeconds: number;
    refreshTokenExpiresInSeconds: number;
  }): void {
    const {
      expressResponse: res,
      user,
      statusPageId,
      accessToken,
      refreshToken,
      accessTokenExpiresInSeconds,
      refreshTokenExpiresInSeconds,
    } = data;

    const accessTokenMaxAge: number = Math.max(
      0,
      Math.round(accessTokenExpiresInSeconds * 1000),
    );
    const refreshTokenMaxAge: number = Math.max(
      0,
      Math.round(refreshTokenExpiresInSeconds * 1000),
    );

    CookieUtil.setCookie(
      res,
      CookieUtil.getUserTokenKey(statusPageId),
      accessToken,
      {
        maxAge: accessTokenMaxAge,
        httpOnly: true,
        sameSite: "lax",
        path: "/",
      },
    );

    CookieUtil.setCookie(
      res,
      CookieUtil.getUserRefreshTokenKey(statusPageId),
      refreshToken,
      {
        maxAge: refreshTokenMaxAge,
        httpOnly: true,
        sameSite: "lax",
        path: "/",
      },
    );

    if (user.email) {
      CookieUtil.setCookie(
        res,
        `${CookieName.Email}-${statusPageId.toString()}`,
        user.email?.toString() || "",
        {
          maxAge: refreshTokenMaxAge,
          httpOnly: false,
          sameSite: "lax",
          path: "/",
        },
      );
    }
  }

  @CaptureSpan()
  public static setCookie(
    res: ExpressResponse,
    name: string | CookieName,
    value: string,
    options: CookieOptions,
  ): void {
    res.cookie(name, value, options);
  }

  // get cookie with express request

  @CaptureSpan()
  public static getCookieFromExpressRequest(
    req: ExpressRequest,
    name: string,
  ): string | undefined {
    return req.cookies[name];
  }

  // delete cookie with express response

  @CaptureSpan()
  public static removeCookie(res: ExpressResponse, name: string): void {
    res.clearCookie(name);
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
  public static getUserRefreshTokenKey(id?: ObjectID): string {
    if (!id) {
      return CookieName.RefreshToken;
    }

    return `${CookieName.RefreshToken}-${id.toString()}`;
  }

  @CaptureSpan()
  public static getUserSSOKey(id: ObjectID): string {
    return `${this.getSSOKey()}${id.toString()}`;
  }

  @CaptureSpan()
  public static getSSOKey(): string {
    return `sso-`;
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
  }

  @CaptureSpan()
  public static getUserRefreshTokenFromExpressRequest(
    req: ExpressRequest,
  ): string | undefined {
    return this.getCookieFromExpressRequest(req, this.getUserRefreshTokenKey());
  }

  @CaptureSpan()
  public static getStatusPageRefreshTokenFromExpressRequest(
    req: ExpressRequest,
    statusPageId: ObjectID,
  ): string | undefined {
    return this.getCookieFromExpressRequest(
      req,
      this.getUserRefreshTokenKey(statusPageId),
    );
  }

  @CaptureSpan()
  public static removeUserAuthCookies(res: ExpressResponse): void {
    this.removeCookie(res, this.getUserTokenKey());
    this.removeCookie(res, this.getUserRefreshTokenKey());
    this.removeCookie(res, CookieName.UserID);
    this.removeCookie(res, CookieName.Email);
    this.removeCookie(res, CookieName.Name);
    this.removeCookie(res, CookieName.Timezone);
    this.removeCookie(res, CookieName.IsMasterAdmin);
    this.removeCookie(res, CookieName.ProfilePicID);
  }

  @CaptureSpan()
  public static removeStatusPageAuthCookies(
    res: ExpressResponse,
    statusPageId: ObjectID,
  ): void {
    this.removeCookie(res, this.getUserTokenKey(statusPageId));
    this.removeCookie(res, this.getUserRefreshTokenKey(statusPageId));
    this.removeCookie(res, `${CookieName.Email}-${statusPageId.toString()}`);
  }
}
