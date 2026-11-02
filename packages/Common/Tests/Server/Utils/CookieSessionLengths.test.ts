import User from "../../../Models/DatabaseModels/User";
import type { SessionMetadata } from "../../../Server/Services/UserSessionService";
import CookieUtil from "../../../Server/Utils/Cookie";
import { ExpressResponse } from "../../../Server/Utils/Express";
import JSONWebToken from "../../../Server/Utils/JsonWebToken";
import {
  getSessionCookieFields,
  SessionCookieFields,
} from "../../../Server/Utils/SessionCookieFields";
import Email from "../../../Types/Email";
import { JSONObject } from "../../../Types/JSON";
import Name from "../../../Types/Name";
import ObjectID from "../../../Types/ObjectID";
import SsoProviderType from "../../../Types/SSO/SsoProviderType";
import { describe, expect, test } from "@jest/globals";

/*
 * HOW LONG THE COOKIES OF A SIGN-IN LIVE, UNDER THE SESSION LENGTHS A MASTER
 * ADMIN SETS (Common/Types/UserSession/SessionLength.ts).
 *
 *   - a session's access token says when the session signed in and when
 *     its person was last active (the signedInAt and lastActiveAt claims),
 *     which every request asks the lengths against, and lives as long as the
 *     session service says - 15 minutes, or less when the session ends
 *     sooner - and its cookie with it;
 *   - an SSO sign-in's proof (the sso-<project> cookie and the Global SSO
 *     token) lives 30 days, or the SSO session length when that is shorter -
 *     never longer than 30 days, whatever it is handed;
 *   - getSessionCookieFields hands setUserCookie exactly what the session
 *     service made, so every sign-in route signs the same token.
 *
 * Real JWT signing, no mocks.
 */

const SIGNED_IN_AT: Date = new Date("2026-11-01T08:00:00.000Z");
const LAST_ACTIVE_AT: Date = new Date("2026-11-02T08:55:00.000Z");
const THIRTY_DAYS_IN_SECONDS: number = 30 * 24 * 60 * 60;

interface SetCookie {
  name: string;
  value: string;
  options: Record<string, unknown>;
}

const buildUser: () => User = (): User => {
  const user: User = new User();
  user.id = ObjectID.generate();
  user.name = new Name("Test User");
  user.email = new Email("session-length@oneuptime.com");
  user.isMasterAdmin = false;
  return user;
};

const recordingResponse: () => {
  res: ExpressResponse;
  cookies: Array<SetCookie>;
} = (): { res: ExpressResponse; cookies: Array<SetCookie> } => {
  const cookies: Array<SetCookie> = [];

  const res: ExpressResponse = {
    cookie: (
      name: string,
      value: string,
      options: Record<string, unknown>,
    ): ExpressResponse => {
      cookies.push({ name, value, options });
      return res;
    },
    // setUserCookie takes away the master admin flag of a member's session.
    clearCookie: (): ExpressResponse => {
      return res;
    },
  } as unknown as ExpressResponse;

  return { res, cookies };
};

const cookieNamed: (cookies: Array<SetCookie>, name: string) => SetCookie = (
  cookies: Array<SetCookie>,
  name: string,
): SetCookie => {
  const cookie: SetCookie | undefined = cookies.find((item: SetCookie) => {
    return item.name === name;
  });

  if (!cookie) {
    throw new Error(`no ${name} cookie was set`);
  }

  return cookie;
};

const lifetimeOf: (token: string) => number = (token: string): number => {
  const payload: JSONObject = JSONWebToken.decodeJsonPayload(token);

  return (payload["exp"] as number) - (payload["iat"] as number);
};

describe("a session's access token cookie", () => {
  test("says when the session signed in and was last active, and lives as long as the session service said", () => {
    const { res, cookies } = recordingResponse();

    CookieUtil.setUserCookie({
      expressResponse: res,
      user: buildUser(),
      isGlobalLogin: true,
      sessionId: ObjectID.generate(),
      refreshToken: "refresh-token",
      refreshTokenExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
      accessTokenExpiresInSeconds: 300,
      signedInAt: SIGNED_IN_AT,
      lastActiveAt: LAST_ACTIVE_AT,
    });

    const access: SetCookie = cookieNamed(
      cookies,
      CookieUtil.getUserTokenKey(),
    );
    const payload: JSONObject = JSONWebToken.decodeJsonPayload(access.value);

    expect(payload["signedInAt"]).toBe(SIGNED_IN_AT.getTime());
    expect(payload["lastActiveAt"]).toBe(LAST_ACTIVE_AT.getTime());
    expect(lifetimeOf(access.value)).toBe(300);
    expect(access.options["maxAge"]).toBe(300 * 1000);
    expect(access.options["httpOnly"]).toBe(true);
  });

  test("a token that says neither time is the shape an earlier release signed: it ends with its own expiry", () => {
    const { res, cookies } = recordingResponse();

    CookieUtil.setUserCookie({
      expressResponse: res,
      user: buildUser(),
      isGlobalLogin: true,
      sessionId: ObjectID.generate(),
      refreshToken: "refresh-token",
      refreshTokenExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
    });

    const access: SetCookie = cookieNamed(
      cookies,
      CookieUtil.getUserTokenKey(),
    );
    const payload: JSONObject = JSONWebToken.decodeJsonPayload(access.value);

    expect(payload["signedInAt"]).toBeUndefined();
    expect(payload["lastActiveAt"]).toBeUndefined();
    // 15 minutes, as before.
    expect(lifetimeOf(access.value)).toBe(15 * 60);
    expect(access.options["maxAge"]).toBe(15 * 60 * 1000);
  });

  test("getSessionCookieFields hands over exactly what the session service made", () => {
    const sessionId: ObjectID = ObjectID.generate();
    const refreshTokenExpiresAt: Date = new Date("2026-12-01T00:00:00.000Z");

    const fields: SessionCookieFields = getSessionCookieFields({
      session: { id: sessionId },
      refreshToken: "rotated-refresh-token",
      refreshTokenExpiresAt,
      signedInAt: SIGNED_IN_AT,
      lastActiveAt: LAST_ACTIVE_AT,
      accessTokenExpiresInSeconds: 420,
      ssoSignInExpiresInSeconds: 3600,
    } as unknown as SessionMetadata);

    expect(fields).toEqual({
      sessionId,
      refreshToken: "rotated-refresh-token",
      refreshTokenExpiresAt,
      accessTokenExpiresInSeconds: 420,
      signedInAt: SIGNED_IN_AT,
      lastActiveAt: LAST_ACTIVE_AT,
    });
  });
});

describe("an SSO sign-in's proof", () => {
  test.each([
    [undefined, THIRTY_DAYS_IN_SECONDS],
    [3600, 3600],
    [3600.9, 3600],
    [THIRTY_DAYS_IN_SECONDS * 2, THIRTY_DAYS_IN_SECONDS],
    [0, THIRTY_DAYS_IN_SECONDS],
    [-60, THIRTY_DAYS_IN_SECONDS],
    [Number.NaN, THIRTY_DAYS_IN_SECONDS],
  ])(
    "handed %p seconds, lives %p: 30 days at most",
    (handed: number | undefined, lives: number) => {
      expect(CookieUtil.getSsoSignInLifetimeInSeconds(handed)).toBe(lives);
    },
  );

  test("a project's SSO token and its cookie live as long as the SSO session length allows", () => {
    const { res, cookies } = recordingResponse();
    const projectId: ObjectID = ObjectID.generate();

    CookieUtil.setSSOCookie({
      user: buildUser(),
      projectId,
      expressResponse: res,
      expiresInSeconds: 2 * 60 * 60,
    });

    const sso: SetCookie = cookieNamed(
      cookies,
      CookieUtil.getUserSSOKey(projectId),
    );

    expect(lifetimeOf(sso.value)).toBe(2 * 60 * 60);
    expect(sso.options["maxAge"]).toBe(2 * 60 * 60 * 1000);
  });

  test("without an SSO session length, 30 days, as before", () => {
    const projectId: ObjectID = ObjectID.generate();

    expect(
      lifetimeOf(CookieUtil.getSSOToken({ user: buildUser(), projectId })),
    ).toBe(THIRTY_DAYS_IN_SECONDS);
  });

  test("the server's own SSO sign-in (Global SSO) is held to the same", () => {
    const { res, cookies } = recordingResponse();

    CookieUtil.setGlobalSSOCookie({
      user: buildUser(),
      expressResponse: res,
      ssoProviderId: ObjectID.generate(),
      ssoProviderType: SsoProviderType.GlobalSSO,
      expiresInSeconds: 90 * 60,
    });

    const sso: SetCookie = cookieNamed(cookies, CookieUtil.getGlobalSSOKey());

    expect(lifetimeOf(sso.value)).toBe(90 * 60);
    expect(sso.options["maxAge"]).toBe(90 * 60 * 1000);
  });
});
