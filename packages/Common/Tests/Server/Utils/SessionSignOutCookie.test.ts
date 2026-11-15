import CookieUtil, {
  SESSION_SIGN_OUT_COOKIE_NAME,
  SESSION_SIGN_OUT_COOKIE_PATH,
} from "../../../Server/Utils/Cookie";
import { ExpressRequest, ExpressResponse } from "../../../Server/Utils/Express";
import JSONWebToken, {
  SessionToSignOut,
} from "../../../Server/Utils/JsonWebToken";
import User from "../../../Models/DatabaseModels/User";
import { IdentityRoute } from "../../../ServiceRoute";
import CookieName from "../../../Types/CookieName";
import OneUptimeDate from "../../../Types/Date";
import Email from "../../../Types/Email";
import { JSONObject } from "../../../Types/JSON";
import JsonWebTokenPurpose from "../../../Types/JsonWebTokenPurpose";
import Name from "../../../Types/Name";
import ObjectID from "../../../Types/ObjectID";
import { describe, expect, jest, test } from "@jest/globals";

jest.mock("../../../Server/Utils/Logger");

/*
 * A BROWSER KEEPS WHICH SESSION IT HOLDS, FOR ITS SIGN-OUT ONLY (issue #8638).
 *
 * The server rotates the refresh token at every renewal and keeps only the
 * new one. When a renewal's answer never reaches the browser, the browser's
 * refresh token matches no session, and its access-token cookie is gone
 * fifteen minutes later; a sign-out after that carried nothing that named
 * its session, and the session stayed signed in on the server.
 *
 * Every sign-in and every renewal hands a browser its cookies through
 * CookieUtil.setUserCookie, which now sets one more: a token that names the
 * session and its user, and nothing else (JSONWebToken.
 * signSessionSignOutToken), beside the refresh token and for as long. These
 * hold it to what keeps it safe:
 *
 *   - HttpOnly, SameSite=Strict, Secure by the rule every cookie follows,
 *     and sent only to POST /identity/logout - at least as strict as the
 *     refresh token's own cookie, which already ends the session;
 *   - read from that cookie only, never from a body or a header;
 *   - cleared by the sign-out, on its own path, and left by a renewal that
 *     is refused, so the sign-out the dashboard sends next still carries it.
 */

const USER_ID: ObjectID = new ObjectID("8c8c8c8c-8c8c-4c8c-8c8c-8c8c8c8c8c8c");
const SESSION_ID: ObjectID = new ObjectID(
  "8d8d8d8d-8d8d-4d8d-8d8d-8d8d8d8d8d8d",
);

// SameSite from least to most strict.
const SAME_SITE_STRICTNESS: Array<string> = ["none", "lax", "strict"];

function person(): User {
  const user: User = new User();
  user.id = USER_ID;
  user.email = new Email("person@example.com");
  user.name = new Name("A Person");
  user.isMasterAdmin = false;
  return user;
}

interface WrittenCookie {
  value: string;
  options: JSONObject;
}

interface Written {
  set: Record<string, WrittenCookie>;
  cleared: Array<{ name: string; options: JSONObject }>;
}

function response(
  written: Written,
  req?: Partial<ExpressRequest>,
): ExpressResponse {
  return {
    req: req,
    cookie: jest.fn((name: string, value: string, options: JSONObject) => {
      written.set[name] = { value, options };
    }),
    clearCookie: jest.fn((name: string, options: JSONObject) => {
      written.cleared.push({ name, options });
    }),
  } as unknown as ExpressResponse;
}

function signIn(
  data: {
    refreshTokenExpiresAt?: Date;
    sessionId?: ObjectID;
    req?: Partial<ExpressRequest>;
  } = {},
): Written {
  const written: Written = { set: {}, cleared: [] };

  CookieUtil.setUserCookie({
    expressResponse: response(written, data.req),
    user: person(),
    isGlobalLogin: true,
    sessionId: data.sessionId || SESSION_ID,
    refreshToken: "refresh-token",
    refreshTokenExpiresAt:
      data.refreshTokenExpiresAt || OneUptimeDate.getSomeDaysAfter(30),
  });

  return written;
}

function signOutCookie(written: Written): WrittenCookie {
  const cookie: WrittenCookie | undefined =
    written.set[SESSION_SIGN_OUT_COOKIE_NAME];

  if (!cookie) {
    throw new Error(
      `No sign-out cookie; set ${Object.keys(written.set).join(", ")}`,
    );
  }

  return cookie;
}

function refreshCookie(written: Written): WrittenCookie {
  return written.set[CookieUtil.getRefreshTokenKey()]!;
}

function requestWith(data: {
  cookies?: Record<string, string>;
  body?: JSONObject;
  headers?: Record<string, string>;
}): ExpressRequest {
  return {
    cookies: data.cookies || {},
    body: data.body || {},
    headers: data.headers || {},
  } as unknown as ExpressRequest;
}

describe("every sign-in and renewal sets the sign-out cookie, beside the refresh token", () => {
  test("it names this session of this person, and is read back as them", () => {
    const read: SessionToSignOut = JSONWebToken.decodeSessionToSignOut(
      signOutCookie(signIn()).value,
    );

    expect(read.userId.toString()).toBe(USER_ID.toString());
    expect(read.sessionId.toString()).toBe(SESSION_ID.toString());
  });

  test("it lives exactly as long as the refresh token's cookie, and its token no longer", () => {
    const refreshTokenExpiresAt: Date = OneUptimeDate.getSomeDaysAfter(30);
    const written: Written = signIn({ refreshTokenExpiresAt });

    const signOut: WrittenCookie = signOutCookie(written);
    const maxAge: number = signOut.options["maxAge"] as number;

    expect(maxAge).toBe(refreshCookie(written).options["maxAge"]);
    expect(maxAge).toBeGreaterThan(29 * 24 * 60 * 60 * 1000);

    const claims: JSONObject = JSONWebToken.decodeJsonPayload(signOut.value);
    const expiresAtMs: number = (claims["exp"] as number) * 1000;

    // Whole seconds, rounded up: within a second of the refresh token's end.
    expect(expiresAtMs).toBeGreaterThanOrEqual(
      refreshTokenExpiresAt.getTime() - 1000,
    );
    expect(expiresAtMs).toBeLessThanOrEqual(
      refreshTokenExpiresAt.getTime() + 1000,
    );
  });

  test("it is HttpOnly, SameSite=Strict and sent only to the sign-out", () => {
    expect(signOutCookie(signIn()).options).toEqual({
      path: "/identity/logout",
      sameSite: "strict",
      httpOnly: true,
      maxAge: expect.any(Number),
    });
  });

  test("it is at least as strict as the refresh token's own cookie, in every attribute", () => {
    for (const req of [
      undefined,
      { secure: true, headers: { host: "oneuptime.example.com" } },
      { secure: false, headers: { host: "oneuptime.example.com" } },
    ] as Array<Partial<ExpressRequest> | undefined>) {
      const written: Written = signIn(req ? { req } : {});
      const signOut: JSONObject = signOutCookie(written).options;
      const refresh: JSONObject = refreshCookie(written).options;

      // Out of a page's reach, as the refresh token is.
      expect(refresh["httpOnly"]).toBe(true);
      expect(signOut["httpOnly"]).toBe(true);

      // Never sent on a request another site starts, where the refresh token is not either.
      expect(
        SAME_SITE_STRICTNESS.indexOf(signOut["sameSite"] as string),
      ).toBeGreaterThanOrEqual(
        SAME_SITE_STRICTNESS.indexOf(refresh["sameSite"] as string),
      );

      // Secure by the one rule every cookie follows (RequestTransport.isHttps).
      expect(Boolean(signOut["secure"])).toBe(Boolean(refresh["secure"]));

      // Sent to one route, where the refresh token goes with every request.
      expect(refresh["path"]).toBe("/");
      expect(signOut["path"]).toBe(SESSION_SIGN_OUT_COOKIE_PATH);
      expect(signOut["path"]).not.toBe("/");
    }
  });

  test("over HTTPS it is Secure, as every cookie of the session is", () => {
    const written: Written = signIn({
      req: { secure: true, headers: { host: "oneuptime.example.com" } },
    });

    expect(signOutCookie(written).options["secure"]).toBe(true);
    expect(refreshCookie(written).options["secure"]).toBe(true);
  });

  test("a renewal sets it again, for the session it renewed and for the renewed refresh token's life", () => {
    const first: Written = signIn({
      refreshTokenExpiresAt: OneUptimeDate.getSomeDaysAfter(10),
    });
    const renewed: Written = signIn({
      refreshTokenExpiresAt: OneUptimeDate.getSomeDaysAfter(30),
    });

    const firstClaims: JSONObject = JSONWebToken.decodeJsonPayload(
      signOutCookie(first).value,
    );
    const renewedClaims: JSONObject = JSONWebToken.decodeJsonPayload(
      signOutCookie(renewed).value,
    );

    expect(renewedClaims["sessionId"]).toBe(firstClaims["sessionId"]);
    expect(renewedClaims["exp"] as number).toBeGreaterThan(
      (firstClaims["exp"] as number) + 19 * 24 * 60 * 60,
    );
  });

  test("another session in the same browser replaces it: it names the newer one", () => {
    const later: ObjectID = new ObjectID(
      "8e8e8e8e-8e8e-4e8e-8e8e-8e8e8e8e8e8e",
    );

    expect(
      JSONWebToken.decodeSessionToSignOut(
        signOutCookie(signIn({ sessionId: later })).value,
      ).sessionId.toString(),
    ).toBe(later.toString());
  });

  test("a refresh token that has run out: the cookie goes at once, and the token it held is refused", () => {
    const written: Written = signIn({
      refreshTokenExpiresAt: OneUptimeDate.getSomeDaysAgo(1),
    });

    expect(signOutCookie(written).options["maxAge"]).toBe(0);
    expect(() => {
      return JSONWebToken.decodeSessionToSignOut(signOutCookie(written).value);
    }).toThrow("AccessToken is invalid or expired");
  });

  test("it holds no address, and is no session: neither the API nor an SSO check reads it", () => {
    const value: string = signOutCookie(signIn()).value;

    expect(
      Buffer.from(value.split(".")[1]!, "base64url").toString("utf8"),
    ).not.toContain("person@example.com");

    for (const purpose of Object.values(
      JsonWebTokenPurpose,
    ) as Array<JsonWebTokenPurpose>) {
      expect(() => {
        return JSONWebToken.decode(value, purpose);
      }).toThrow("AccessToken is invalid or expired");
    }
  });

  test("it is not one of the cookies the browser's own code clears or reads", () => {
    // HttpOnly: no page sees it, so none of CookieName's names, which pages read and clear.
    expect(Object.values(CookieName) as Array<string>).not.toContain(
      SESSION_SIGN_OUT_COOKIE_NAME,
    );
    expect(CookieUtil.getSessionSignOutKey()).toBe(
      SESSION_SIGN_OUT_COOKIE_NAME,
    );
  });
});

describe("it is sent only to the sign-out", () => {
  test("its path is POST /identity/logout, as the browser addresses it", () => {
    expect(SESSION_SIGN_OUT_COOKIE_PATH).toBe(
      `${IdentityRoute.toString()}/logout`,
    );
    expect(SESSION_SIGN_OUT_COOKIE_PATH).toBe("/identity/logout");
  });

  test("it is read from its own cookie only: never from a body, a header or another cookie", () => {
    const token: string = signOutCookie(signIn()).value;

    expect(
      CookieUtil.getSessionSignOutTokenFromExpressRequest(
        requestWith({ cookies: { [SESSION_SIGN_OUT_COOKIE_NAME]: token } }),
      ),
    ).toBe(token);

    for (const req of [
      requestWith({
        body: {
          refreshToken: token,
          [SESSION_SIGN_OUT_COOKIE_NAME]: token,
          sessionSignOut: token,
        },
      }),
      requestWith({
        headers: {
          authorization: `Bearer ${token}`,
          [SESSION_SIGN_OUT_COOKIE_NAME]: token,
        },
      }),
      requestWith({
        cookies: {
          [CookieUtil.getUserTokenKey()]: token,
          [CookieUtil.getRefreshTokenKey()]: token,
        },
      }),
      // A request cookie-parser never ran on.
      { body: {}, headers: {} } as unknown as ExpressRequest,
    ]) {
      expect(
        CookieUtil.getSessionSignOutTokenFromExpressRequest(req),
      ).toBeUndefined();
    }
  });
});

describe("clearing it", () => {
  test("the sign-out clears it on its own path, with the attributes it was set with", () => {
    for (const secure of [true, false]) {
      const written: Written = { set: {}, cleared: [] };

      CookieUtil.removeSessionSignOutCookie(
        response(written, {
          secure,
          headers: { host: "oneuptime.example.com" },
        }),
      );

      expect(written.cleared).toEqual([
        {
          name: SESSION_SIGN_OUT_COOKIE_NAME,
          options: {
            path: SESSION_SIGN_OUT_COOKIE_PATH,
            sameSite: "strict",
            httpOnly: true,
            ...(secure ? { secure: true } : {}),
          },
        },
      ]);
    }
  });

  test("clearing every cookie a sign-out carries clears it on its own path, and the rest on /", () => {
    const written: Written = { set: {}, cleared: [] };

    CookieUtil.removeAllCookies(
      requestWith({
        cookies: {
          [CookieUtil.getUserTokenKey()]: "access-token",
          [CookieUtil.getRefreshTokenKey()]: "refresh-token",
          [SESSION_SIGN_OUT_COOKIE_NAME]: "sign-out",
        },
      }),
      response(written),
    );

    const clearedOn: Record<string, Array<string>> = {};

    for (const cleared of written.cleared) {
      clearedOn[cleared.name] = [
        ...(clearedOn[cleared.name] || []),
        cleared.options["path"] as string,
      ];
    }

    expect(clearedOn[SESSION_SIGN_OUT_COOKIE_NAME]).toEqual([
      SESSION_SIGN_OUT_COOKIE_PATH,
    ]);
    expect(clearedOn[CookieUtil.getUserTokenKey()]).toEqual(["/"]);
    expect(clearedOn[CookieUtil.getRefreshTokenKey()]).toContain("/");
  });

  test("a refused renewal, which is never sent it, leaves it for the sign-out the dashboard sends next", () => {
    const written: Written = { set: {}, cleared: [] };

    // What a browser sends to /identity/refresh-token: every cookie on "/", and not this one.
    CookieUtil.removeAllCookies(
      requestWith({
        cookies: {
          [CookieUtil.getUserTokenKey()]: "access-token",
          [CookieUtil.getRefreshTokenKey()]: "refresh-token",
          [CookieName.UserID]: USER_ID.toString(),
        },
      }),
      response(written),
    );

    expect(written.cleared.length).toBeGreaterThan(0);
    expect(
      written.cleared.filter((cleared: { name: string }): boolean => {
        return cleared.name === SESSION_SIGN_OUT_COOKIE_NAME;
      }),
    ).toEqual([]);
  });
});
