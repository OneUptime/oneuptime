import { ExpressRequest, ExpressResponse } from "./Express";
import Dictionary from "../../Types/Dictionary";
import ObjectID from "../../Types/ObjectID";
import { CookieOptions } from "express";
import JSONWebToken from "./JsonWebToken";
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
    isGlobalLogin: boolean;
  }): void {
    const { expressResponse: res, user, isGlobalLogin } = data;

    const token: string = JSONWebToken.signUserLoginToken({
      tokenData: {
        userId: user.id!,
        email: user.email!,
        name: user.name!,
        timezone: user.timezone || null,
        isMasterAdmin: user.isMasterAdmin!,
        isGlobalLogin: isGlobalLogin, // This is a general login without SSO. So, we will set this to true. This will give access to all the projects that dont require SSO.
      },
      expiresInSeconds: OneUptimeDate.getSecondsInDays(new PositiveNumber(30)),
    });

    // Set a cookie with token.
    CookieUtil.setCookie(res, CookieUtil.getUserTokenKey(), token, {
      maxAge: OneUptimeDate.getMillisecondsInDays(new PositiveNumber(30)),
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
}
