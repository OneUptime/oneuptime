import CookieUtil from "../../../Server/Utils/Cookie";
import { ExpressResponse } from "../../../Server/Utils/Express";
import JSONWebToken, {
  EARLIER_RELEASE_ACCESS_TOKEN_LIFETIME_IN_SECONDS,
  PURPOSE_CLAIM,
  UNSAID_PURPOSE_MESSAGE,
} from "../../../Server/Utils/JsonWebToken";
import OnCallPageLinkToken from "../../../Server/Utils/OnCall/OnCallPageLinkToken";
import TokenSigningKey from "../../../Server/Utils/TokenSigningKey";
import StatusPagePrivateUser from "../../../Models/DatabaseModels/StatusPagePrivateUser";
import User from "../../../Models/DatabaseModels/User";
import OneUptimeDate from "../../../Types/Date";
import BadDataException from "../../../Types/Exception/BadDataException";
import Email from "../../../Types/Email";
import { JSONObject } from "../../../Types/JSON";
import JSONWebTokenData from "../../../Types/JsonWebTokenData";
import JsonWebTokenPurpose from "../../../Types/JsonWebTokenPurpose";
import Name from "../../../Types/Name";
import ObjectID from "../../../Types/ObjectID";
import SsoProviderType from "../../../Types/SSO/SsoProviderType";
import Timezone from "../../../Types/Timezone";
import jwt from "jsonwebtoken";
import { generateKeyPairSync } from "crypto";

jest.mock("../../../Server/Utils/Logger");

const ALL_PURPOSES: Array<JsonWebTokenPurpose> = Object.values(
  JsonWebTokenPurpose,
) as Array<JsonWebTokenPurpose>;

// Whether `token` is read as `purpose` by the product's own reader of that kind (userReadAs).
function isReadAs(token: string, purpose: JsonWebTokenPurpose): boolean {
  try {
    userReadAs(token, purpose);

    return true;
  } catch {
    return false;
  }
}

/*
 * The user a token is read as belonging to, by its kind's own reader:
 * JSONWebToken.decode, or for a browser's sign-out cookies, which name no
 * one's identity and which decode never reads, decodeSessionToSignOut (a
 * dashboard's) and decodeStatusPageSessionToSignOut (a status page's). A
 * dashboard's or a form's private user (#10250, #10249) is read only by
 * that kind's own readers, which decode never stands in for.
 */
function userReadAs(token: string, purpose: JsonWebTokenPurpose): string {
  if (purpose === JsonWebTokenPurpose.DashboardPrivateUserSession) {
    return JSONWebToken.decodeDashboardPrivateUserSession(
      token,
    ).userId.toString();
  }

  if (purpose === JsonWebTokenPurpose.DashboardPrivateUserSessionSignOut) {
    return JSONWebToken.decodeDashboardPrivateUserSessionToSignOut(
      token,
    ).userId.toString();
  }

  if (purpose === JsonWebTokenPurpose.FormPrivateUserSession) {
    return JSONWebToken.decodeFormPrivateUserSession(token).userId.toString();
  }

  if (purpose === JsonWebTokenPurpose.FormPrivateUserSessionSignOut) {
    return JSONWebToken.decodeFormPrivateUserSessionToSignOut(
      token,
    ).userId.toString();
  }

  if (purpose === JsonWebTokenPurpose.UserSessionSignOut) {
    return JSONWebToken.decodeSessionToSignOut(token).userId.toString();
  }

  if (purpose === JsonWebTokenPurpose.StatusPageSessionSignOut) {
    return JSONWebToken.decodeStatusPageSessionToSignOut(
      token,
    ).userId.toString();
  }

  return JSONWebToken.decode(token, purpose).userId.toString();
}

describe("JSONWebToken", () => {
  const userId: ObjectID = ObjectID.generate();
  const sessionId: ObjectID = ObjectID.generate();
  const email: Email = new Email("jwt-test@oneuptime.com");

  function sessionToken(expiresInSeconds: number = 300): string {
    return JSONWebToken.signUserLoginToken({
      tokenData: {
        userId: userId,
        email: email,
        name: new Name("Test User"),
        timezone: Timezone.AsiaKolkata,
        isMasterAdmin: true,
        isGlobalLogin: true,
        sessionId: sessionId,
      },
      expiresInSeconds: expiresInSeconds,
    });
  }

  describe("signJsonPayload / decodeJsonPayload", () => {
    test("should round trip a json payload", () => {
      const token: string = JSONWebToken.signJsonPayload(
        { hello: "world" },
        300,
      );

      const decoded: JSONObject = JSONWebToken.decodeJsonPayload(token);

      expect(decoded["hello"]).toEqual("world");
    });

    test("should set an expiry claim on the token", () => {
      const token: string = JSONWebToken.signJsonPayload(
        { hello: "world" },
        300,
      );

      const decoded: JSONObject = JSONWebToken.decodeJsonPayload(token);

      expect(decoded["exp"]).toBeDefined();
      expect(decoded["iat"]).toBeDefined();
      expect((decoded["exp"] as number) - (decoded["iat"] as number)).toEqual(
        300,
      );
    });

    test("should throw when the token was signed with a different secret", () => {
      const token: string = jwt.sign({ hello: "world" }, "some-other-secret", {
        expiresIn: 300,
      });

      expect(() => {
        return JSONWebToken.decodeJsonPayload(token);
      }).toThrow();
    });

    /*
     * jwt.sign accepts a bare string as a payload, and such a token verifies
     * perfectly well - it is simply not a claims object. decodeJsonPayload
     * used to hand that string back typed as a JSONObject, and every caller
     * of decode() then read undefined out of userId, email and name and built
     * a session object out of nothing. Refuse the shape where it is parsed,
     * so the caller sees a decode failure rather than an empty identity.
     */
    test("should refuse a token whose payload is a bare string, not claims", () => {
      const token: string = jwt.sign("just-a-string", TokenSigningKey.get());

      expect(() => {
        return JSONWebToken.decodeJsonPayload(token);
      }).toThrow("Expected JSONObject");
    });

    test("should refuse a bare-string payload through decode() too, whatever it is asked for", () => {
      const token: string = jwt.sign("just-a-string", TokenSigningKey.get());

      for (const purpose of ALL_PURPOSES) {
        expect(() => {
          return JSONWebToken.decode(token, purpose);
        }).toThrow(BadDataException);
      }
    });
  });

  describe("signUserLoginToken / decode", () => {
    test("should round trip user login token data", () => {
      const decoded: JSONWebTokenData = JSONWebToken.decode(
        sessionToken(),
        JsonWebTokenPurpose.UserSession,
      );

      expect(decoded.userId.toString()).toEqual(userId.toString());
      expect(decoded.email.toString()).toEqual(email.toString());
      expect(decoded.name?.toString()).toEqual("Test User");
      expect(decoded.isMasterAdmin).toBe(true);
      expect(decoded.isGlobalLogin).toBe(true);
      expect(decoded.sessionId?.toString()).toEqual(sessionId.toString());
    });

    test("should say it is a session, in the purpose claim", () => {
      expect(JSONWebToken.decodeJsonPayload(sessionToken())).toEqual(
        expect.objectContaining({
          [PURPOSE_CLAIM]: JsonWebTokenPurpose.UserSession,
          sessionId: sessionId.toString(),
        }),
      );
    });

    test("a token that names no session is no session, though it says it is one", () => {
      const token: string = JSONWebToken.sign({
        data: {
          userId: userId,
          email: email,
          name: new Name("Test User"),
          isMasterAdmin: false,
          isGlobalLogin: false,
        } as JSONWebTokenData,
        expiresInSeconds: 300,
        purpose: JsonWebTokenPurpose.UserSession,
      });

      expect(() => {
        return JSONWebToken.decode(token, JsonWebTokenPurpose.UserSession);
      }).toThrow(BadDataException);
    });

    test("should decode a status page private user token as a status page session", () => {
      const statusPageId: ObjectID = ObjectID.generate();

      const token: string = JSONWebToken.signJsonPayload(
        {
          userId: userId.toString(),
          email: email.toString(),
          statusPageId: statusPageId.toString(),
          sessionId: sessionId.toString(),
          [PURPOSE_CLAIM]: JsonWebTokenPurpose.StatusPageSession,
        },
        300,
      );

      const decoded: JSONWebTokenData = JSONWebToken.decode(
        token,
        JsonWebTokenPurpose.StatusPageSession,
      );

      expect(decoded.statusPageId?.toString()).toEqual(statusPageId.toString());
      // Status page users are never master admins.
      expect(decoded.isMasterAdmin).toBe(false);
      expect(decoded.name?.toString()).toEqual("User");
      expect(decoded.sessionId?.toString()).toEqual(sessionId.toString());
    });

    test("should throw BadDataException for a malformed token", () => {
      for (const purpose of ALL_PURPOSES) {
        expect(() => {
          return JSONWebToken.decode("not-a-token", purpose);
        }).toThrow(BadDataException);
      }
    });

    test("should throw BadDataException for an expired token", () => {
      for (const purpose of ALL_PURPOSES) {
        expect(() => {
          return JSONWebToken.decode(sessionToken(-10), purpose);
        }).toThrow(BadDataException);
      }
    });

    test("every refusal reads the same, whatever the reason", () => {
      for (const token of [
        "not-a-token",
        sessionToken(-10),
        CookieUtil.getSSOToken({
          user: buildUser(),
          projectId: ObjectID.generate(),
          ssoProviderId: ObjectID.generate(),
          ssoProviderType: SsoProviderType.ProjectSSO,
        }),
      ]) {
        expect(() => {
          return JSONWebToken.decode(token, JsonWebTokenPurpose.UserSession);
        }).toThrow("AccessToken is invalid or expired");
      }
    });
  });

  /*
   * A sign-out ends the session its own access token names, expired or not,
   * when the refresh token it sent matches none: a renewal whose answer was
   * lost rotated it (POST /identity/logout, issue #8592). acceptExpired
   * takes the expiry away, and only the expiry: the signature and what the
   * token is for are checked as ever.
   */
  describe("decode with acceptExpired", () => {
    test("takes a session's token that has expired, with its user and session", () => {
      const decoded: JSONWebTokenData = JSONWebToken.decode(
        sessionToken(-60 * 60),
        JsonWebTokenPurpose.UserSession,
        { acceptExpired: true },
      );

      expect(decoded.userId.toString()).toBe(userId.toString());
      expect(decoded.sessionId?.toString()).toBe(sessionId.toString());
    });

    test("takes one that has not expired the same way", () => {
      const decoded: JSONWebTokenData = JSONWebToken.decode(
        sessionToken(300),
        JsonWebTokenPurpose.UserSession,
        { acceptExpired: true },
      );

      expect(decoded.sessionId?.toString()).toBe(sessionId.toString());
    });

    test("without it, or with it false, an expired token is refused as before", () => {
      for (const options of [undefined, {}, { acceptExpired: false }]) {
        expect(() => {
          return JSONWebToken.decode(
            sessionToken(-10),
            JsonWebTokenPurpose.UserSession,
            options,
          );
        }).toThrow(BadDataException);
      }
    });

    test("still refuses a token signed with another key, expired or not", () => {
      for (const expiresIn of [-60, 300]) {
        const forged: string = jwt.sign(
          {
            userId: userId.toString(),
            sessionId: sessionId.toString(),
            [PURPOSE_CLAIM]: JsonWebTokenPurpose.UserSession,
          },
          "some-other-secret",
          { expiresIn },
        );

        expect(() => {
          return JSONWebToken.decode(forged, JsonWebTokenPurpose.UserSession, {
            acceptExpired: true,
          });
        }).toThrow(BadDataException);
      }
    });

    test("still refuses what is not a session's token: an SSO sign-in, a status page's session, garbage", () => {
      const statusPageSession: string = JSONWebToken.signJsonPayload(
        {
          userId: userId.toString(),
          email: email.toString(),
          statusPageId: ObjectID.generate().toString(),
          sessionId: sessionId.toString(),
          [PURPOSE_CLAIM]: JsonWebTokenPurpose.StatusPageSession,
        },
        -60,
      );

      for (const token of [
        CookieUtil.getSSOToken({
          user: buildUser(),
          projectId: ObjectID.generate(),
          ssoProviderId: ObjectID.generate(),
          ssoProviderType: SsoProviderType.ProjectSSO,
        }),
        statusPageSession,
        "not-a-token",
        "",
      ]) {
        expect(() => {
          return JSONWebToken.decode(token, JsonWebTokenPurpose.UserSession, {
            acceptExpired: true,
          });
        }).toThrow(BadDataException);
      }
    });

    test("still refuses a session's token that names no session", () => {
      const token: string = JSONWebToken.sign({
        data: {
          userId: userId,
          email: email,
          name: new Name("Test User"),
          isMasterAdmin: false,
          isGlobalLogin: false,
        } as JSONWebTokenData,
        expiresInSeconds: -60,
        purpose: JsonWebTokenPurpose.UserSession,
      });

      expect(() => {
        return JSONWebToken.decode(token, JsonWebTokenPurpose.UserSession, {
          acceptExpired: true,
        });
      }).toThrow(BadDataException);
    });

    test("checks the signature once, as every decode does", () => {
      const verify: jest.SpyInstance = jest.spyOn(jwt, "verify");

      JSONWebToken.decode(sessionToken(-60), JsonWebTokenPurpose.UserSession, {
        acceptExpired: true,
      });

      expect(verify).toHaveBeenCalledTimes(1);
      expect(verify.mock.calls[0]![2]).toEqual({ ignoreExpiration: true });

      verify.mockRestore();
    });
  });

  /*
   * A browser's sign-out cookie (issue #8638): which session the browser
   * holds, kept beside its refresh token and for as long, so a sign-out
   * can name its session after a renewal whose answer was lost, once the
   * fifteen-minute access-token cookie has gone. It is read only to end
   * that session, and it is no one's identity.
   */
  describe("a browser's sign-out cookie: signSessionSignOutToken and decodeSessionToSignOut", () => {
    function signOutToken(expiresInSeconds: number = 300): string {
      return JSONWebToken.signSessionSignOutToken({
        userId: userId,
        sessionId: sessionId,
        expiresInSeconds: expiresInSeconds,
      });
    }

    test("names the user and the session, and is read back as them", () => {
      const read: { userId: ObjectID; sessionId: ObjectID } =
        JSONWebToken.decodeSessionToSignOut(signOutToken());

      expect(read.userId.toString()).toBe(userId.toString());
      expect(read.sessionId.toString()).toBe(sessionId.toString());
      expect(Object.keys(read).sort()).toEqual(["sessionId", "userId"]);
    });

    /*
     * Every reader of a person's token makes an address of the token's
     * own - this release's decode, and the one before tokens said what they
     * were for, which read any token this key signed as a session (commit
     * a4613e2e80b): new Email(claims.email). A token that holds no address
     * is refused by all of them, however long it lives.
     */
    test("says what it is for, and holds no address and nothing of a session's access token", () => {
      const claims: JSONObject = JSONWebToken.decodeJsonPayload(signOutToken());

      expect(Object.keys(claims).sort()).toEqual(
        [
          "exp",
          "iat",
          // JSONWebToken.sign writes these two, empty, into every token of claims.
          "name",
          "projectId",
          PURPOSE_CLAIM,
          "sessionId",
          "userId",
        ].sort(),
      );
      expect(claims[PURPOSE_CLAIM]).toBe(
        JsonWebTokenPurpose.UserSessionSignOut,
      );
      expect(claims["name"]).toBe("");
      expect(claims["projectId"]).toBe("");
      expect(claims["email"]).toBeUndefined();

      expect(() => {
        return new Email(claims["email"] as string);
      }).toThrow(BadDataException);
    });

    test("lives as long as it is asked to, in whole seconds, and not at all when asked for none", () => {
      for (const [asked, lives] of [
        [30 * 24 * 60 * 60, 30 * 24 * 60 * 60],
        [60, 60],
        [59.2, 60],
        [0.4, 1],
      ] as Array<[number, number]>) {
        const claims: JSONObject = JSONWebToken.decodeJsonPayload(
          signOutToken(asked),
        );

        expect({
          asked,
          lives: (claims["exp"] as number) - (claims["iat"] as number),
        }).toEqual({ asked, lives });
      }

      for (const asked of [0, -60, Number.NaN, Number.POSITIVE_INFINITY]) {
        expect(() => {
          return JSONWebToken.decodeSessionToSignOut(signOutToken(asked));
        }).toThrow("AccessToken is invalid or expired");
      }
    });

    test("is refused once it has expired: nothing reads it past its end", () => {
      const issuedAt: number = Math.floor(Date.now() / 1000);

      // Signed here thirty days and a minute ago, for thirty days.
      const ranOut: string = jwt.sign(
        {
          ...JSONWebToken.decodeJsonPayload(signOutToken()),
          iat: issuedAt - 30 * 24 * 60 * 60 - 60,
          exp: issuedAt - 60,
        },
        TokenSigningKey.get(),
      );

      expect(() => {
        return JSONWebToken.decodeSessionToSignOut(ranOut);
      }).toThrow("AccessToken is invalid or expired");

      // The same claims, still within their time, are read.
      expect(
        JSONWebToken.decodeSessionToSignOut(
          jwt.sign(
            {
              ...JSONWebToken.decodeJsonPayload(signOutToken()),
              iat: issuedAt - 60,
              exp: issuedAt + 60,
            },
            TokenSigningKey.get(),
          ),
        ).sessionId.toString(),
      ).toBe(sessionId.toString());

      const verify: jest.SpyInstance = jest.spyOn(jwt, "verify");

      JSONWebToken.decodeSessionToSignOut(signOutToken());

      // The signature is checked once, and the expiry with it.
      expect(verify).toHaveBeenCalledTimes(1);
      expect(verify.mock.calls[0]![2]).toBeUndefined();

      verify.mockRestore();
    });

    test("is refused when another key signed it, nobody signed it, or its claims were swapped", () => {
      const claims: JSONObject = {
        userId: userId.toString(),
        sessionId: sessionId.toString(),
        [PURPOSE_CLAIM]: JsonWebTokenPurpose.UserSessionSignOut,
      };
      const segment: (value: JSONObject) => string = (
        value: JSONObject,
      ): string => {
        return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
      };
      const [header, , signature] = signOutToken().split(".");
      const issuedAt: number = Math.floor(Date.now() / 1000);

      for (const forged of [
        jwt.sign(claims, "another installation's key", { expiresIn: 300 }),
        `${segment({ alg: "none", typ: "JWT" })}.${segment({ ...claims, iat: issuedAt, exp: issuedAt + 300 })}.`,
        // Another session's id under this token's signature.
        `${header}.${segment({
          ...claims,
          sessionId: ObjectID.generate().toString(),
          iat: issuedAt,
          exp: issuedAt + 300,
        })}.${signature}`,
        // Another person's id under this token's signature.
        `${header}.${segment({
          ...claims,
          userId: ObjectID.generate().toString(),
          iat: issuedAt,
          exp: issuedAt + 300,
        })}.${signature}`,
      ]) {
        expect(() => {
          return JSONWebToken.decodeSessionToSignOut(forged);
        }).toThrow("AccessToken is invalid or expired");
      }
    });

    test("takes no other token: a session's access token, expired or not, an SSO sign-in, a status page's session, an earlier release's access token, or garbage", () => {
      const privateUser: StatusPagePrivateUser = new StatusPagePrivateUser();
      privateUser.id = ObjectID.generate();
      privateUser.email = new Email("reader@example.com");

      for (const token of [
        sessionToken(),
        sessionToken(-60),
        CookieUtil.getSSOToken({
          user: buildUser(),
          projectId: ObjectID.generate(),
          ssoProviderId: ObjectID.generate(),
          ssoProviderType: SsoProviderType.ProjectSSO,
        }),
        CookieUtil.getGlobalSSOToken({
          user: buildUser(),
          ssoProviderId: ObjectID.generate(),
          ssoProviderType: SsoProviderType.GlobalOIDC,
        }),
        CookieUtil.setStatusPagePrivateUserCookie({
          expressResponse: noCookies(),
          user: privateUser,
          statusPageId: ObjectID.generate(),
          sessionId: sessionId,
          refreshToken: "refresh-token",
          refreshTokenExpiresAt: OneUptimeDate.getSomeDaysAfter(1),
        }),
        JSONWebToken.signJsonPayload(
          {
            userId: userId.toString(),
            email: email.toString(),
            name: "Test User",
            isMasterAdmin: true,
            isGlobalLogin: true,
            sessionId: sessionId.toString(),
          },
          EARLIER_RELEASE_ACCESS_TOKEN_LIFETIME_IN_SECONDS,
        ),
        "not-a-token",
        "",
      ]) {
        expect(() => {
          return JSONWebToken.decodeSessionToSignOut(token);
        }).toThrow("AccessToken is invalid or expired");
      }
    });

    test("is never read by decode, whatever it is asked for, expired or not", () => {
      for (const purpose of ALL_PURPOSES) {
        for (const options of [undefined, { acceptExpired: true }]) {
          expect(() => {
            return JSONWebToken.decode(signOutToken(), purpose, options);
          }).toThrow("AccessToken is invalid or expired");
        }
      }
    });

    /*
     * decode refuses the kind itself, not only a token without an address:
     * one that says it is a sign-out cookie and holds everything a session's
     * access token does is read as nothing by decode either.
     */
    test("decode refuses the kind, even a token of it that holds an address and a whole session's claims", () => {
      const withAnAddress: string = JSONWebToken.signJsonPayload(
        {
          userId: userId.toString(),
          email: email.toString(),
          name: "Test User",
          isMasterAdmin: true,
          isGlobalLogin: true,
          sessionId: sessionId.toString(),
          [PURPOSE_CLAIM]: JsonWebTokenPurpose.UserSessionSignOut,
        },
        300,
      );

      // It is a sign-out cookie, and read as one where one is read.
      expect(
        JSONWebToken.decodeSessionToSignOut(withAnAddress).sessionId.toString(),
      ).toBe(sessionId.toString());

      for (const purpose of ALL_PURPOSES) {
        for (const options of [undefined, { acceptExpired: true }]) {
          expect(() => {
            return JSONWebToken.decode(withAnAddress, purpose, options);
          }).toThrow("AccessToken is invalid or expired");
        }
      }
    });
  });

  /*
   * A status page's sign-out cookie (issue #8671): which session a browser
   * holds on one status page, kept beside its refresh token and for as
   * long, so the page's sign-out can name it after a renewal whose answer
   * was lost. Read only to end that session of that reader on that page.
   */
  describe("a status page's sign-out cookie: signStatusPageSessionSignOutToken and decodeStatusPageSessionToSignOut", () => {
    const statusPageId: ObjectID = ObjectID.generate();

    function statusPageSignOutToken(expiresInSeconds: number = 300): string {
      return JSONWebToken.signStatusPageSessionSignOutToken({
        statusPageId: statusPageId,
        userId: userId,
        sessionId: sessionId,
        expiresInSeconds: expiresInSeconds,
      });
    }

    test("names the page, the reader and the session, and is read back as them", () => {
      const read: {
        statusPageId: ObjectID;
        userId: ObjectID;
        sessionId: ObjectID;
      } = JSONWebToken.decodeStatusPageSessionToSignOut(
        statusPageSignOutToken(),
      );

      expect(read.statusPageId.toString()).toBe(statusPageId.toString());
      expect(read.userId.toString()).toBe(userId.toString());
      expect(read.sessionId.toString()).toBe(sessionId.toString());
      expect(Object.keys(read).sort()).toEqual([
        "sessionId",
        "statusPageId",
        "userId",
      ]);
    });

    test("says what it is for, and holds no address and nothing of a status page's access token", () => {
      const claims: JSONObject = JSONWebToken.decodeJsonPayload(
        statusPageSignOutToken(),
      );

      expect(Object.keys(claims).sort()).toEqual(
        [
          "exp",
          "iat",
          // JSONWebToken.sign writes these two, empty, into every token of claims.
          "name",
          "projectId",
          PURPOSE_CLAIM,
          "sessionId",
          "statusPageId",
          "userId",
        ].sort(),
      );
      expect(claims[PURPOSE_CLAIM]).toBe(
        JsonWebTokenPurpose.StatusPageSessionSignOut,
      );
      // A plain id: what isFor asks of it.
      expect(claims["statusPageId"]).toBe(statusPageId.toString());
      expect(claims["email"]).toBeUndefined();
    });

    test("lives as long as it is asked to, in whole seconds, and not at all when asked for none", () => {
      for (const [asked, lives] of [
        [30 * 24 * 60 * 60, 30 * 24 * 60 * 60],
        [59.2, 60],
      ] as Array<[number, number]>) {
        const claims: JSONObject = JSONWebToken.decodeJsonPayload(
          statusPageSignOutToken(asked),
        );

        expect({
          asked,
          lives: (claims["exp"] as number) - (claims["iat"] as number),
        }).toEqual({ asked, lives });
      }

      for (const asked of [0, -60, Number.NaN]) {
        expect(() => {
          return JSONWebToken.decodeStatusPageSessionToSignOut(
            statusPageSignOutToken(asked),
          );
        }).toThrow("AccessToken is invalid or expired");
      }
    });

    test("is refused once it has expired, signed with another key, or with its claims swapped", () => {
      const issuedAt: number = Math.floor(Date.now() / 1000);
      const claims: JSONObject = JSONWebToken.decodeJsonPayload(
        statusPageSignOutToken(),
      );
      const segment: (value: JSONObject) => string = (
        value: JSONObject,
      ): string => {
        return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
      };
      const [header, , signature] = statusPageSignOutToken().split(".");

      for (const refused of [
        jwt.sign(
          { ...claims, iat: issuedAt - 120, exp: issuedAt - 60 },
          TokenSigningKey.get(),
        ),
        jwt.sign(
          { ...claims, iat: issuedAt, exp: issuedAt + 300 },
          "another installation's key",
        ),
        // Another page's id under this token's signature.
        `${header}.${segment({
          ...claims,
          statusPageId: ObjectID.generate().toString(),
        })}.${signature}`,
        // Another session's.
        `${header}.${segment({
          ...claims,
          sessionId: ObjectID.generate().toString(),
        })}.${signature}`,
      ]) {
        expect(() => {
          return JSONWebToken.decodeStatusPageSessionToSignOut(refused);
        }).toThrow("AccessToken is invalid or expired");
      }
    });

    test("takes no other token: a status page's access token, a dashboard's sign-out cookie or session, or garbage", () => {
      const privateUser: StatusPagePrivateUser = new StatusPagePrivateUser();
      privateUser.id = userId;
      privateUser.email = new Email("reader@example.com");

      for (const token of [
        CookieUtil.setStatusPagePrivateUserCookie({
          expressResponse: {
            cookie: (): void => {
              // Only the access token it answers with is read here.
            },
          } as unknown as ExpressResponse,
          user: privateUser,
          statusPageId: statusPageId,
          sessionId: sessionId,
          refreshToken: "refresh-token",
          refreshTokenExpiresAt: OneUptimeDate.getSomeDaysAfter(1),
        }),
        JSONWebToken.signSessionSignOutToken({
          userId: userId,
          sessionId: sessionId,
          expiresInSeconds: 300,
        }),
        sessionToken(),
        "not-a-token",
        "",
      ]) {
        expect(() => {
          return JSONWebToken.decodeStatusPageSessionToSignOut(token);
        }).toThrow("AccessToken is invalid or expired");
      }

      // And the other way round: the dashboard's reader takes none of this kind.
      expect(() => {
        return JSONWebToken.decodeSessionToSignOut(statusPageSignOutToken());
      }).toThrow("AccessToken is invalid or expired");
    });

    test("is never read by decode, whatever it is asked for, expired or not", () => {
      for (const purpose of ALL_PURPOSES) {
        for (const options of [undefined, { acceptExpired: true }]) {
          expect(() => {
            return JSONWebToken.decode(
              statusPageSignOutToken(),
              purpose,
              options,
            );
          }).toThrow("AccessToken is invalid or expired");
        }
      }
    });

    // decode refuses the kind itself, not only a token of it without an address.
    test("decode refuses the kind, even a token of it that holds an address and a whole status page session's claims", () => {
      const withAnAddress: string = JSONWebToken.signJsonPayload(
        {
          userId: userId.toString(),
          email: email.toString(),
          statusPageId: statusPageId.toString(),
          sessionId: sessionId.toString(),
          [PURPOSE_CLAIM]: JsonWebTokenPurpose.StatusPageSessionSignOut,
        },
        300,
      );

      // It is a status page's sign-out cookie, and read as one where one is read.
      expect(
        JSONWebToken.decodeStatusPageSessionToSignOut(
          withAnAddress,
        ).statusPageId.toString(),
      ).toBe(statusPageId.toString());

      for (const purpose of ALL_PURPOSES) {
        for (const options of [undefined, { acceptExpired: true }]) {
          expect(() => {
            return JSONWebToken.decode(withAnAddress, purpose, options);
          }).toThrow("AccessToken is invalid or expired");
        }
      }
    });
  });

  describe("sign", () => {
    test("should wrap a plain string payload under a data claim", () => {
      const token: string = JSONWebToken.sign({
        data: "just-a-string",
        expiresInSeconds: 300,
      });

      expect(JSONWebToken.decodeJsonPayload(token)["data"]).toEqual(
        "just-a-string",
      );
    });

    test("writes the purpose it is given, and none when it is given none", () => {
      for (const purpose of ALL_PURPOSES) {
        const token: string = JSONWebToken.sign({
          data: { userId: userId, email: email } as JSONWebTokenData,
          expiresInSeconds: 300,
          purpose: purpose,
        });

        expect(JSONWebToken.decodeJsonPayload(token)[PURPOSE_CLAIM]).toBe(
          purpose,
        );
      }

      const withoutPurpose: string = JSONWebToken.sign({
        data: { userId: userId, email: email } as JSONWebTokenData,
        expiresInSeconds: 300,
      });

      expect(
        Object.prototype.hasOwnProperty.call(
          JSONWebToken.decodeJsonPayload(withoutPurpose),
          PURPOSE_CLAIM,
        ),
      ).toBe(false);
    });

    /*
     * What a token is for is said by whoever signs it. A purpose that came
     * in with the data - copied from a decoded token, or from anything that
     * came from elsewhere - is never signed into the new token.
     */
    test("never carries a purpose over from the data", () => {
      // Claims that name a person but no session or SSO provider.
      const smuggled: JSONObject = {
        userId: userId.toString(),
        email: email.toString(),
        [PURPOSE_CLAIM]: JsonWebTokenPurpose.UserSession,
      };

      const unsaid: string = JSONWebToken.sign({
        data: smuggled,
        expiresInSeconds: 300,
      });

      expect(
        Object.prototype.hasOwnProperty.call(
          JSONWebToken.decodeJsonPayload(unsaid),
          PURPOSE_CLAIM,
        ),
      ).toBe(false);

      for (const purpose of ALL_PURPOSES) {
        expect(() => {
          return JSONWebToken.decode(unsaid, purpose);
        }).toThrow(BadDataException);
      }

      const saidOtherwise: string = JSONWebToken.sign({
        data: { ...smuggled, sessionId: sessionId.toString() },
        expiresInSeconds: 300,
        purpose: JsonWebTokenPurpose.StatusPageSession,
      });

      expect(JSONWebToken.decodeJsonPayload(saidOtherwise)[PURPOSE_CLAIM]).toBe(
        JsonWebTokenPurpose.StatusPageSession,
      );
      expect(() => {
        return JSONWebToken.decode(
          saidOtherwise,
          JsonWebTokenPurpose.UserSession,
        );
      }).toThrow(BadDataException);
    });

    /*
     * The readers still take a token that says nothing and names a session
     * or an SSO provider as one an earlier release signed. So nothing signs
     * one now: data copied from a decoded token, or from anywhere else,
     * becomes a token that names a session or an SSO provider only through
     * a caller that says what it is for.
     */
    test("refuses to sign, without a purpose, anything that names a session or an SSO provider", () => {
      const decodedSession: JSONWebTokenData = JSONWebToken.decode(
        sessionToken(),
        JsonWebTokenPurpose.UserSession,
      );
      const decodedSsoSignIn: JSONWebTokenData = JSONWebToken.decode(
        CookieUtil.getSSOToken({
          user: buildUser(),
          projectId: ObjectID.generate(),
          ssoProviderId: ObjectID.generate(),
          ssoProviderType: SsoProviderType.ProjectSSO,
        }),
        JsonWebTokenPurpose.SsoSignIn,
      );

      const unsaid: Array<{ name: string; data: JSONObject }> = [
        { name: "a decoded session", data: decodedSession },
        { name: "a decoded SSO sign-in", data: decodedSsoSignIn },
        {
          name: "a session's claims, with a purpose smuggled in",
          data: {
            userId: userId.toString(),
            email: email.toString(),
            sessionId: sessionId.toString(),
            [PURPOSE_CLAIM]: JsonWebTokenPurpose.UserSession,
          },
        },
        {
          name: "a status page's session",
          data: {
            userId: userId.toString(),
            email: email.toString(),
            statusPageId: ObjectID.generate().toString(),
            sessionId: sessionId.toString(),
          },
        },
        {
          name: "an SSO provider's kind alone",
          data: {
            userId: userId.toString(),
            email: email.toString(),
            ssoProviderType: SsoProviderType.GlobalSSO,
          },
        },
        {
          name: "an SSO provider's id alone",
          data: {
            userId: userId.toString(),
            email: email.toString(),
            ssoProviderId: ObjectID.generate().toString(),
          },
        },
      ];

      for (const { name, data } of unsaid) {
        expect({
          name,
          signed: ((): string => {
            try {
              JSONWebToken.sign({ data: data, expiresInSeconds: 300 });
              return "signed";
            } catch (error) {
              return (error as Error).message;
            }
          })(),
        }).toEqual({ name, signed: UNSAID_PURPOSE_MESSAGE });
      }

      // What names no session and no SSO provider still signs without one.
      expect(
        JSONWebToken.decodeJsonPayload(
          JSONWebToken.sign({
            data: { resellerId: "reseller" },
            expiresInSeconds: 300,
          }),
        )["resellerId"],
      ).toBe("reseller");
      expect(
        JSONWebToken.decodeJsonPayload(
          JSONWebToken.sign({ data: buildUser(), expiresInSeconds: 300 }),
        )["userId"],
      ).toBe(buildUser().id!.toString());
    });

    test("signs a decoded session again only as what it says it is", () => {
      const decoded: JSONWebTokenData = JSONWebToken.decode(
        sessionToken(),
        JsonWebTokenPurpose.UserSession,
      );

      const resigned: string = JSONWebToken.sign({
        data: decoded,
        expiresInSeconds: 300,
        purpose: JsonWebTokenPurpose.UserSession,
      });

      expect(
        JSONWebToken.decode(resigned, JsonWebTokenPurpose.UserSession).userId,
      ).toEqual(userId);
    });
  });

  /*
   * decode reads when a token was issued (`iat`) from the claims whose
   * signature it checks, so nothing has to read the token again - unchecked -
   * to learn it.
   */
  describe("decode: when the token was issued", () => {
    test("should carry the issue time, in milliseconds", () => {
      const token: string = sessionToken();

      const issuedAtInSeconds: number = JSONWebToken.decodeJsonPayload(token)[
        "iat"
      ] as number;

      expect(
        JSONWebToken.decode(token, JsonWebTokenPurpose.UserSession).issuedAtMs,
      ).toBe(issuedAtInSeconds * 1000);
    });

    test("should carry it for a status page user's token too", () => {
      const token: string = JSONWebToken.signJsonPayload(
        {
          userId: userId.toString(),
          email: email.toString(),
          statusPageId: ObjectID.generate().toString(),
          sessionId: sessionId.toString(),
          [PURPOSE_CLAIM]: JsonWebTokenPurpose.StatusPageSession,
        },
        300,
      );

      expect(
        JSONWebToken.decode(token, JsonWebTokenPurpose.StatusPageSession)
          .issuedAtMs,
      ).toBe((JSONWebToken.decodeJsonPayload(token)["iat"] as number) * 1000);
    });

    test("should leave it undefined for a token that does not say", () => {
      const token: string = jwt.sign(
        {
          userId: userId.toString(),
          email: email.toString(),
          sessionId: sessionId.toString(),
          [PURPOSE_CLAIM]: JsonWebTokenPurpose.UserSession,
        },
        TokenSigningKey.get(),
        { noTimestamp: true },
      );

      expect(
        JSONWebToken.decode(token, JsonWebTokenPurpose.UserSession).issuedAtMs,
      ).toBeUndefined();
    });

    test("should check the signature once, and never read a token unchecked", () => {
      const token: string = sessionToken();
      const verify: jest.SpyInstance = jest.spyOn(jwt, "verify");
      const unchecked: jest.SpyInstance = jest.spyOn(jwt, "decode");

      JSONWebToken.decode(token, JsonWebTokenPurpose.UserSession);

      expect(verify).toHaveBeenCalledTimes(1);
      expect(unchecked).not.toHaveBeenCalled();
      verify.mockRestore();
      unchecked.mockRestore();
    });

    test("should not sign a decoded token's issue time into a new token", () => {
      const second: string = JSONWebToken.sign({
        data: JSONWebToken.decode(
          sessionToken(),
          JsonWebTokenPurpose.UserSession,
        ),
        expiresInSeconds: 300,
        purpose: JsonWebTokenPurpose.UserSession,
      });

      expect(
        Object.prototype.hasOwnProperty.call(
          JSONWebToken.decodeJsonPayload(second),
          "issuedAtMs",
        ),
      ).toBe(false);
    });
  });

  describe("signWithPrivateKey", () => {
    test("should sign with RS256 and be verifiable with the public key", () => {
      const { privateKey, publicKey } = generateKeyPairSync("rsa", {
        modulusLength: 2048,
        publicKeyEncoding: { type: "spki", format: "pem" },
        privateKeyEncoding: { type: "pkcs8", format: "pem" },
      });

      const token: string = JSONWebToken.signWithPrivateKey(
        { sub: "oauth-subject" },
        privateKey,
      );

      const header: JSONObject = JSON.parse(
        Buffer.from(token.split(".")[0]!, "base64").toString("utf8"),
      );
      expect(header["alg"]).toEqual("RS256");

      const verified: JSONObject = jwt.verify(token, publicKey, {
        algorithms: ["RS256"],
      }) as JSONObject;
      expect(verified["sub"]).toEqual("oauth-subject");
    });
  });
});

function buildUser(): User {
  const user: User = new User();
  user.id = new ObjectID("7a7a7a7a-7a7a-4a7a-8a7a-7a7a7a7a7a7a");
  user.email = new Email("member@example.com");
  user.name = new Name("Member");
  return user;
}

function noCookies(): ExpressResponse {
  return {
    cookie: (): void => {
      // The token is what is read here, not the cookie.
    },
  } as unknown as ExpressResponse;
}

const THIRTY_DAYS_IN_SECONDS: number = 30 * 24 * 60 * 60;

/*
 * A browser's sign-out cookie, as a sign-in or a renewal hands it out
 * (CookieUtil.setUserCookie), for a session of buildUser().
 */
function signOutCookieOf(sessionId: ObjectID = ObjectID.generate()): string {
  let value: string = "";

  CookieUtil.setUserCookie({
    expressResponse: {
      cookie: (name: string, cookieValue: string): void => {
        if (name === CookieUtil.getSessionSignOutKey()) {
          value = cookieValue;
        }
      },
      clearCookie: (): void => {
        // The master-admin flag of a member; not read here.
      },
    } as unknown as ExpressResponse,
    user: buildUser(),
    isGlobalLogin: true,
    sessionId: sessionId,
    refreshToken: "refresh-token",
    refreshTokenExpiresAt: OneUptimeDate.getSomeDaysAfter(30),
  });

  if (!value) {
    throw new Error("setUserCookie set no sign-out cookie");
  }

  return value;
}

/*
 * A browser's sign-out cookie for a status page, as a status page sign-in
 * or renewal hands it out (CookieUtil.setStatusPagePrivateUserCookie).
 */
function statusPageSignOutCookieOf(
  statusPageId: ObjectID = ObjectID.generate(),
): string {
  let value: string = "";
  const privateUser: StatusPagePrivateUser = new StatusPagePrivateUser();
  privateUser.id = ObjectID.generate();
  privateUser.email = new Email("reader@example.com");

  CookieUtil.setStatusPagePrivateUserCookie({
    expressResponse: {
      cookie: (name: string, cookieValue: string): void => {
        if (name === CookieUtil.getStatusPageSessionSignOutKey(statusPageId)) {
          value = cookieValue;
        }
      },
    } as unknown as ExpressResponse,
    user: privateUser,
    statusPageId: statusPageId,
    sessionId: ObjectID.generate(),
    refreshToken: "refresh-token",
    refreshTokenExpiresAt: OneUptimeDate.getSomeDaysAfter(30),
  });

  if (!value) {
    throw new Error("setStatusPagePrivateUserCookie set no sign-out cookie");
  }

  return value;
}

interface TokenKind {
  name: string;
  token: () => string;
  // The one purpose it is read as, or none.
  readAs: JsonWebTokenPurpose | null;
}

/*
 * Every kind of token OneUptime signs with TokenSigningKey, made where the
 * product makes it, and the one thing each is read as. The releases before
 * tokens said what they were for made the "earlier release" ones.
 */
const TOKEN_KINDS: Array<TokenKind> = [
  {
    name: "a session (sign-in access token)",
    token: (): string => {
      return JSONWebToken.signUserLoginToken({
        tokenData: {
          userId: buildUser().id!,
          email: buildUser().email!,
          name: buildUser().name!,
          timezone: null,
          isMasterAdmin: false,
          isGlobalLogin: true,
          sessionId: ObjectID.generate(),
        },
        expiresInSeconds: 900,
      });
    },
    readAs: JsonWebTokenPurpose.UserSession,
  },
  {
    name: "a project SAML sign-in",
    token: (): string => {
      return CookieUtil.getSSOToken({
        user: buildUser(),
        projectId: ObjectID.generate(),
        ssoProviderId: ObjectID.generate(),
        ssoProviderType: SsoProviderType.ProjectSSO,
      });
    },
    readAs: JsonWebTokenPurpose.SsoSignIn,
  },
  {
    name: "a project OIDC sign-in",
    token: (): string => {
      return CookieUtil.getSSOToken({
        user: buildUser(),
        projectId: ObjectID.generate(),
        ssoProviderId: ObjectID.generate(),
        ssoProviderType: SsoProviderType.ProjectOIDC,
      });
    },
    readAs: JsonWebTokenPurpose.SsoSignIn,
  },
  {
    name: "a Global SAML sign-in",
    token: (): string => {
      return CookieUtil.getGlobalSSOToken({
        user: buildUser(),
        ssoProviderId: ObjectID.generate(),
        ssoProviderType: SsoProviderType.GlobalSSO,
      });
    },
    readAs: JsonWebTokenPurpose.SsoSignIn,
  },
  {
    name: "a Global OIDC sign-in",
    token: (): string => {
      return CookieUtil.getGlobalSSOToken({
        user: buildUser(),
        ssoProviderId: ObjectID.generate(),
        ssoProviderType: SsoProviderType.GlobalOIDC,
      });
    },
    readAs: JsonWebTokenPurpose.SsoSignIn,
  },
  {
    name: "a status page private user's session",
    token: (): string => {
      const privateUser: StatusPagePrivateUser = new StatusPagePrivateUser();
      privateUser.id = ObjectID.generate();
      privateUser.email = new Email("reader@example.com");

      return CookieUtil.setStatusPagePrivateUserCookie({
        expressResponse: noCookies(),
        user: privateUser,
        statusPageId: ObjectID.generate(),
        sessionId: ObjectID.generate(),
        refreshToken: ObjectID.generate().toString(),
        refreshTokenExpiresAt: OneUptimeDate.getSomeDaysAfter(30),
      });
    },
    readAs: JsonWebTokenPurpose.StatusPageSession,
  },
  {
    name: "a session an earlier release signed",
    token: (): string => {
      return JSONWebToken.signJsonPayload(
        {
          userId: buildUser().id!.toString(),
          email: "member@example.com",
          name: "Member",
          timezone: null,
          isMasterAdmin: true,
          isGlobalLogin: true,
          sessionId: ObjectID.generate().toString(),
          projectId: "",
        },
        EARLIER_RELEASE_ACCESS_TOKEN_LIFETIME_IN_SECONDS,
      );
    },
    /*
     * Still a session: a server of the release before signs them until an
     * upgrade has rolled out, and nobody is signed out meanwhile.
     */
    readAs: JsonWebTokenPurpose.UserSession,
  },
  {
    name: "a session's claims that an earlier release would have signed for longer than fifteen minutes",
    token: (): string => {
      return JSONWebToken.signJsonPayload(
        {
          userId: buildUser().id!.toString(),
          email: "member@example.com",
          name: "Member",
          timezone: null,
          isMasterAdmin: true,
          isGlobalLogin: true,
          sessionId: ObjectID.generate().toString(),
          projectId: "",
        },
        EARLIER_RELEASE_ACCESS_TOKEN_LIFETIME_IN_SECONDS + 1,
      );
    },
    readAs: null,
  },
  {
    name: "a project SSO sign-in an earlier release gave",
    token: (): string => {
      return JSONWebToken.signJsonPayload(
        {
          userId: buildUser().id!.toString(),
          projectId: ObjectID.generate().toString(),
          name: "Member",
          email: "member@example.com",
          isMasterAdmin: false,
          isGeneralLogin: false,
          ssoProviderId: ObjectID.generate().toString(),
          ssoProviderType: SsoProviderType.ProjectSSO,
        },
        THIRTY_DAYS_IN_SECONDS,
      );
    },
    readAs: JsonWebTokenPurpose.SsoSignIn,
  },
  {
    name: "a Global SSO sign-in an earlier release gave",
    token: (): string => {
      return JSONWebToken.signJsonPayload(
        {
          userId: buildUser().id!.toString(),
          projectId: "",
          name: "Member",
          email: "member@example.com",
          isMasterAdmin: false,
          isGeneralLogin: false,
          ssoProviderId: ObjectID.generate().toString(),
          ssoProviderType: SsoProviderType.GlobalOIDC,
        },
        THIRTY_DAYS_IN_SECONDS,
      );
    },
    readAs: JsonWebTokenPurpose.SsoSignIn,
  },
  {
    name: "a status page private user's session an earlier release signed",
    token: (): string => {
      return JSONWebToken.signJsonPayload(
        {
          userId: ObjectID.generate().toString(),
          email: "reader@example.com",
          statusPageId: ObjectID.generate().toString(),
          sessionId: ObjectID.generate().toString(),
          name: "",
          projectId: "",
        },
        900,
      );
    },
    readAs: JsonWebTokenPurpose.StatusPageSession,
  },
  {
    name: "a status page's master-password cookie",
    token: (): string => {
      let value: string = "";
      CookieUtil.setStatusPageMasterPasswordCookie({
        expressResponse: {
          cookie: (_name: string, cookieValue: string): void => {
            value = cookieValue;
          },
        } as unknown as ExpressResponse,
        statusPageId: ObjectID.generate(),
      });
      return value;
    },
    readAs: null,
  },
  {
    name: "a dashboard's master-password cookie",
    token: (): string => {
      let value: string = "";
      CookieUtil.setDashboardMasterPasswordCookie({
        expressResponse: {
          cookie: (_name: string, cookieValue: string): void => {
            value = cookieValue;
          },
        } as unknown as ExpressResponse,
        dashboardId: ObjectID.generate(),
      });
      return value;
    },
    readAs: null,
  },
  {
    name: "an on-call page link",
    token: (): string => {
      return OnCallPageLinkToken.sign({
        userOnCallLogTimelineId: ObjectID.generate(),
      });
    },
    readAs: null,
  },
  {
    name: "a sign-in in flight through an identity provider",
    token: (): string => {
      return JSONWebToken.signJsonPayload(
        {
          state: "state",
          nonce: "nonce",
          codeVerifier: "verifier",
          projectId: ObjectID.generate().toString(),
        },
        600,
      );
    },
    readAs: null,
  },
  {
    name: "a reseller's token",
    token: (): string => {
      return JSONWebToken.sign({
        data: { resellerId: "reseller" },
        expiresInSeconds: 60,
      });
    },
    readAs: null,
  },
  {
    name: "a browser's sign-out cookie",
    token: (): string => {
      return signOutCookieOf();
    },
    readAs: JsonWebTokenPurpose.UserSessionSignOut,
  },
  {
    name: "a session's claims put in a token that says it is a sign-out cookie",
    token: (): string => {
      return JSONWebToken.signJsonPayload(
        {
          userId: buildUser().id!.toString(),
          email: "member@example.com",
          name: "Member",
          isMasterAdmin: true,
          isGlobalLogin: true,
          sessionId: ObjectID.generate().toString(),
          [PURPOSE_CLAIM]: JsonWebTokenPurpose.UserSessionSignOut,
        },
        15 * 60,
      );
    },
    /*
     * It says what it is for, and only that is read: it ends the session it
     * names, and is no session itself.
     */
    readAs: JsonWebTokenPurpose.UserSessionSignOut,
  },
  {
    name: "a status page's sign-out cookie",
    token: (): string => {
      return statusPageSignOutCookieOf();
    },
    readAs: JsonWebTokenPurpose.StatusPageSessionSignOut,
  },
  {
    name: "a status page session's claims put in a token that says it is a status page's sign-out cookie",
    token: (): string => {
      return JSONWebToken.signJsonPayload(
        {
          userId: ObjectID.generate().toString(),
          email: "reader@example.com",
          statusPageId: ObjectID.generate().toString(),
          sessionId: ObjectID.generate().toString(),
          [PURPOSE_CLAIM]: JsonWebTokenPurpose.StatusPageSessionSignOut,
        },
        15 * 60,
      );
    },
    // It ends the session it names on its page, and is no status page session itself.
    readAs: JsonWebTokenPurpose.StatusPageSessionSignOut,
  },
];

describe("every token that names a person says what it is for, where it is made", () => {
  test.each([
    {
      name: "a session",
      kind: TOKEN_KINDS[0]!,
      purpose: JsonWebTokenPurpose.UserSession,
    },
    {
      name: "a project SSO sign-in",
      kind: TOKEN_KINDS[1]!,
      purpose: JsonWebTokenPurpose.SsoSignIn,
    },
    {
      name: "a Global SSO sign-in",
      kind: TOKEN_KINDS[3]!,
      purpose: JsonWebTokenPurpose.SsoSignIn,
    },
    {
      name: "a status page private user's session",
      kind: TOKEN_KINDS[5]!,
      purpose: JsonWebTokenPurpose.StatusPageSession,
    },
    {
      name: "a browser's sign-out cookie",
      kind: TOKEN_KINDS.find((kind: TokenKind): boolean => {
        return kind.name === "a browser's sign-out cookie";
      })!,
      purpose: JsonWebTokenPurpose.UserSessionSignOut,
    },
    {
      name: "a status page's sign-out cookie",
      kind: TOKEN_KINDS.find((kind: TokenKind): boolean => {
        return kind.name === "a status page's sign-out cookie";
      })!,
      purpose: JsonWebTokenPurpose.StatusPageSessionSignOut,
    },
  ])(
    "$name",
    ({ kind, purpose }: { kind: TokenKind; purpose: JsonWebTokenPurpose }) => {
      expect(kind.readAs).toBe(purpose);
      expect(JSONWebToken.decodeJsonPayload(kind.token())[PURPOSE_CLAIM]).toBe(
        purpose,
      );
    },
  );
});

describe("what a token is for: each kind is read as what it is, and as nothing else", () => {
  test.each(TOKEN_KINDS)("$name", ({ token, readAs }: TokenKind) => {
    const value: string = token();

    for (const purpose of ALL_PURPOSES) {
      const reads: boolean = isReadAs(value, purpose);

      expect({ purpose, reads }).toEqual({
        purpose,
        reads: purpose === readAs,
      });
    }
  });

  test("an SSO sign-in is never read as a session, whichever kind of provider gave it", () => {
    for (const providerType of Object.values(SsoProviderType)) {
      const projectSignIn: string = CookieUtil.getSSOToken({
        user: buildUser(),
        projectId: ObjectID.generate(),
        ssoProviderId: ObjectID.generate(),
        ssoProviderType: providerType,
      });
      const globalSignIn: string = CookieUtil.getGlobalSSOToken({
        user: buildUser(),
        ssoProviderId: ObjectID.generate(),
        ssoProviderType: providerType,
      });

      for (const token of [projectSignIn, globalSignIn]) {
        expect(() => {
          return JSONWebToken.decode(token, JsonWebTokenPurpose.UserSession);
        }).toThrow(BadDataException);
      }
    }
  });
});

/*
 * A purpose is worth something only in a token this server signed. Claims
 * made out to be a session, an SSO sign-in or a status page's session -
 * each with everything its reader asks for - are refused for every purpose
 * when nobody signed them (alg "none"), when another key signed them, or
 * when they were put in place of the claims of a token this server did
 * sign: exactly as a token that does not verify.
 */
describe("a token says what it is for only when this server signed it", () => {
  function claimsFor(purpose: JsonWebTokenPurpose): JSONObject {
    const issuedAt: number = Math.floor(Date.now() / 1000);
    const common: JSONObject = {
      userId: buildUser().id!.toString(),
      email: "member@example.com",
      name: "Member",
      isMasterAdmin: true,
      iat: issuedAt,
      exp: issuedAt + 15 * 60,
      [PURPOSE_CLAIM]: purpose,
    };

    if (purpose === JsonWebTokenPurpose.SsoSignIn) {
      return {
        ...common,
        projectId: ObjectID.generate().toString(),
        ssoProviderId: ObjectID.generate().toString(),
        ssoProviderType: SsoProviderType.ProjectSSO,
      };
    }

    if (
      purpose === JsonWebTokenPurpose.StatusPageSession ||
      purpose === JsonWebTokenPurpose.StatusPageSessionSignOut
    ) {
      return {
        ...common,
        statusPageId: ObjectID.generate().toString(),
        sessionId: ObjectID.generate().toString(),
      };
    }

    // A dashboard's or a form's private user names the resource too.
    if (
      purpose === JsonWebTokenPurpose.DashboardPrivateUserSession ||
      purpose === JsonWebTokenPurpose.DashboardPrivateUserSessionSignOut
    ) {
      return {
        ...common,
        dashboardId: ObjectID.generate().toString(),
        sessionId: ObjectID.generate().toString(),
      };
    }

    if (
      purpose === JsonWebTokenPurpose.FormPrivateUserSession ||
      purpose === JsonWebTokenPurpose.FormPrivateUserSessionSignOut
    ) {
      return {
        ...common,
        formId: ObjectID.generate().toString(),
        sessionId: ObjectID.generate().toString(),
      };
    }

    return { ...common, sessionId: ObjectID.generate().toString() };
  }

  function segment(value: JSONObject): string {
    return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
  }

  // The claims without their times, for jwt.sign to write its own.
  function withoutTimes(claims: JSONObject): JSONObject {
    const copy: JSONObject = { ...claims };
    delete copy["iat"];
    delete copy["exp"];
    return copy;
  }

  const FORGERIES: Array<{
    name: string;
    forge: (claims: JSONObject) => string;
  }> = [
    {
      name: "signed by nobody (alg none)",
      forge: (claims: JSONObject): string => {
        return `${segment({ alg: "none", typ: "JWT" })}.${segment(claims)}.`;
      },
    },
    {
      name: "signed with another key",
      forge: (claims: JSONObject): string => {
        return jwt.sign(withoutTimes(claims), "another installation's key", {
          expiresIn: 15 * 60,
        });
      },
    },
    {
      name: "put in place of the claims of a token this server signed",
      forge: (claims: JSONObject): string => {
        const genuine: string = OnCallPageLinkToken.sign({
          userOnCallLogTimelineId: ObjectID.generate(),
        });
        const [header, , signature] = genuine.split(".");

        return `${header}.${segment(claims)}.${signature}`;
      },
    },
    {
      name: "put in place of an SSO sign-in's own claims",
      forge: (claims: JSONObject): string => {
        const genuine: string = CookieUtil.getSSOToken({
          user: buildUser(),
          projectId: ObjectID.generate(),
          ssoProviderId: ObjectID.generate(),
          ssoProviderType: SsoProviderType.ProjectSSO,
        });
        const [header, , signature] = genuine.split(".");

        return `${header}.${segment(claims)}.${signature}`;
      },
    },
  ];

  test.each(ALL_PURPOSES)(
    "claims made out as %s are read as nothing unless this server signed them",
    (purpose: JsonWebTokenPurpose) => {
      const claims: JSONObject = claimsFor(purpose);

      // The same claims, signed here: read as what they say.
      expect(
        userReadAs(
          jwt.sign(withoutTimes(claims), TokenSigningKey.get(), {
            expiresIn: 15 * 60,
          }),
          purpose,
        ),
      ).toBe(buildUser().id!.toString());

      for (const forgery of FORGERIES) {
        const token: string = forgery.forge(claims);

        for (const asked of ALL_PURPOSES) {
          const reads: boolean = isReadAs(token, asked);

          expect({ forgery: forgery.name, asked, reads }).toEqual({
            forgery: forgery.name,
            asked,
            reads: false,
          });
        }

        expect(() => {
          return JSONWebToken.decodeJsonPayload(token);
        }).toThrow();
      }
    },
  );
});

describe("JSONWebToken.isFor", () => {
  const sessionClaims: JSONObject = {
    userId: ObjectID.generate().toString(),
    email: "member@example.com",
    sessionId: ObjectID.generate().toString(),
    [PURPOSE_CLAIM]: JsonWebTokenPurpose.UserSession,
  };

  const ssoClaims: JSONObject = {
    userId: ObjectID.generate().toString(),
    email: "member@example.com",
    projectId: ObjectID.generate().toString(),
    ssoProviderId: ObjectID.generate().toString(),
    ssoProviderType: SsoProviderType.ProjectSSO,
    [PURPOSE_CLAIM]: JsonWebTokenPurpose.SsoSignIn,
  };

  const statusPageClaims: JSONObject = {
    userId: ObjectID.generate().toString(),
    email: "reader@example.com",
    statusPageId: ObjectID.generate().toString(),
    sessionId: ObjectID.generate().toString(),
    [PURPOSE_CLAIM]: JsonWebTokenPurpose.StatusPageSession,
  };

  function without(claims: JSONObject, name: string): JSONObject {
    const copy: JSONObject = { ...claims };
    delete copy[name];
    return copy;
  }

  test("a session says it is one, and names its user and its session", () => {
    expect(
      JSONWebToken.isFor(sessionClaims, JsonWebTokenPurpose.UserSession),
    ).toBe(true);

    for (const refused of [
      without(sessionClaims, PURPOSE_CLAIM),
      without(sessionClaims, "sessionId"),
      without(sessionClaims, "userId"),
      { ...sessionClaims, sessionId: "not-an-id" },
      { ...sessionClaims, sessionId: 42 },
      { ...sessionClaims, userId: "not-an-id" },
      { ...sessionClaims, statusPageId: ObjectID.generate().toString() },
      { ...sessionClaims, [PURPOSE_CLAIM]: "User-Session" },
      { ...sessionClaims, [PURPOSE_CLAIM]: "user-session " },
      { ...sessionClaims, [PURPOSE_CLAIM]: ["user-session"] },
      { ...sessionClaims, [PURPOSE_CLAIM]: { value: "user-session" } },
      { ...sessionClaims, [PURPOSE_CLAIM]: JsonWebTokenPurpose.SsoSignIn },
      {
        ...sessionClaims,
        [PURPOSE_CLAIM]: JsonWebTokenPurpose.StatusPageSession,
      },
    ]) {
      expect({
        claims: refused,
        isSession: JSONWebToken.isFor(refused, JsonWebTokenPurpose.UserSession),
      }).toEqual({ claims: refused, isSession: false });
    }
  });

  /*
   * An access token an earlier release signed says nothing about what it is
   * for. It is still a session - a server of the release before signs them
   * until an upgrade has rolled out - but only with exactly what one held:
   * a user and a session, no status page and no SSO provider, signed for
   * fifteen minutes at most. An SSO sign-in, which lives thirty days and
   * never names a session, and a status page's session, which names its
   * status page, are never one.
   */
  test("an access token an earlier release signed is a session, and nothing more is", () => {
    const issuedAt: number = Math.floor(Date.now() / 1000);
    const earlier: JSONObject = {
      ...without(sessionClaims, PURPOSE_CLAIM),
      iat: issuedAt,
      exp: issuedAt + EARLIER_RELEASE_ACCESS_TOKEN_LIFETIME_IN_SECONDS,
    };

    expect(JSONWebToken.isFor(earlier, JsonWebTokenPurpose.UserSession)).toBe(
      true,
    );
    expect(
      JSONWebToken.isFor(
        { ...earlier, exp: issuedAt + 60 },
        JsonWebTokenPurpose.UserSession,
      ),
    ).toBe(true);

    for (const refused of [
      // Signed for longer than any access token was.
      {
        ...earlier,
        exp: issuedAt + EARLIER_RELEASE_ACCESS_TOKEN_LIFETIME_IN_SECONDS + 1,
      },
      { ...earlier, exp: issuedAt + 30 * 24 * 60 * 60 },
      // Saying nothing about how long it lives.
      without(earlier, "iat"),
      without(earlier, "exp"),
      { ...earlier, iat: String(issuedAt) },
      // Anything a session never held.
      { ...earlier, ssoProviderType: SsoProviderType.ProjectSSO },
      { ...earlier, ssoProviderType: SsoProviderType.GlobalOIDC },
      { ...earlier, ssoProviderId: ObjectID.generate().toString() },
      { ...earlier, statusPageId: ObjectID.generate().toString() },
      // Or less than it held.
      without(earlier, "sessionId"),
      without(earlier, "userId"),
      { ...earlier, sessionId: "not-an-id" },
      // A purpose, but not this one.
      { ...earlier, [PURPOSE_CLAIM]: JsonWebTokenPurpose.SsoSignIn },
      { ...earlier, [PURPOSE_CLAIM]: "on-call-page" },
      { ...earlier, [PURPOSE_CLAIM]: null },
      { ...earlier, [PURPOSE_CLAIM]: "" },
    ]) {
      expect({
        claims: refused,
        isSession: JSONWebToken.isFor(refused, JsonWebTokenPurpose.UserSession),
      }).toEqual({ claims: refused, isSession: false });
    }

    // It is a session and nothing else.
    expect(JSONWebToken.isFor(earlier, JsonWebTokenPurpose.SsoSignIn)).toBe(
      false,
    );
    expect(
      JSONWebToken.isFor(earlier, JsonWebTokenPurpose.StatusPageSession),
    ).toBe(false);
  });

  test("a session that says it is one names no SSO provider either", () => {
    for (const refused of [
      { ...sessionClaims, ssoProviderType: SsoProviderType.ProjectSSO },
      { ...sessionClaims, ssoProviderId: ObjectID.generate().toString() },
    ]) {
      expect(JSONWebToken.isFor(refused, JsonWebTokenPurpose.UserSession)).toBe(
        false,
      );
    }

    // However long it lives: how long is a question only for one that says nothing.
    const issuedAt: number = Math.floor(Date.now() / 1000);

    expect(
      JSONWebToken.isFor(
        { ...sessionClaims, iat: issuedAt, exp: issuedAt + 24 * 60 * 60 },
        JsonWebTokenPurpose.UserSession,
      ),
    ).toBe(true);
  });

  test("an SSO sign-in says it is one, and names no session or status page", () => {
    expect(JSONWebToken.isFor(ssoClaims, JsonWebTokenPurpose.SsoSignIn)).toBe(
      true,
    );

    for (const refused of [
      { ...ssoClaims, sessionId: ObjectID.generate().toString() },
      { ...ssoClaims, statusPageId: ObjectID.generate().toString() },
      { ...ssoClaims, [PURPOSE_CLAIM]: JsonWebTokenPurpose.UserSession },
      {
        ...ssoClaims,
        [PURPOSE_CLAIM]: JsonWebTokenPurpose.StatusPageSession,
      },
      { ...ssoClaims, [PURPOSE_CLAIM]: "on-call-page" },
    ]) {
      expect({
        claims: refused,
        isSsoSignIn: JSONWebToken.isFor(refused, JsonWebTokenPurpose.SsoSignIn),
      }).toEqual({ claims: refused, isSsoSignIn: false });
    }
  });

  test("an SSO sign-in an earlier release gave is read as one only by the kind of provider that gave it", () => {
    const earlier: JSONObject = without(ssoClaims, PURPOSE_CLAIM);

    for (const providerType of Object.values(SsoProviderType)) {
      expect(
        JSONWebToken.isFor(
          { ...earlier, ssoProviderType: providerType },
          JsonWebTokenPurpose.SsoSignIn,
        ),
      ).toBe(true);
    }

    for (const refused of [
      without(earlier, "ssoProviderType"),
      { ...earlier, ssoProviderType: "SomeOtherProvider" },
      { ...earlier, ssoProviderType: "projectsso" },
      { ...earlier, sessionId: ObjectID.generate().toString() },
      { ...earlier, statusPageId: ObjectID.generate().toString() },
    ]) {
      expect({
        claims: refused,
        isSsoSignIn: JSONWebToken.isFor(refused, JsonWebTokenPurpose.SsoSignIn),
      }).toEqual({ claims: refused, isSsoSignIn: false });
    }

    // Never as a session.
    expect(JSONWebToken.isFor(earlier, JsonWebTokenPurpose.UserSession)).toBe(
      false,
    );
  });

  test("a status page's session says it is one and names its status page", () => {
    expect(
      JSONWebToken.isFor(
        statusPageClaims,
        JsonWebTokenPurpose.StatusPageSession,
      ),
    ).toBe(true);

    for (const refused of [
      without(statusPageClaims, "statusPageId"),
      { ...statusPageClaims, [PURPOSE_CLAIM]: JsonWebTokenPurpose.UserSession },
      { ...statusPageClaims, [PURPOSE_CLAIM]: JsonWebTokenPurpose.SsoSignIn },
      // An earlier release's names its session as well as its status page.
      without(without(statusPageClaims, PURPOSE_CLAIM), "sessionId"),
    ]) {
      expect({
        claims: refused,
        isStatusPageSession: JSONWebToken.isFor(
          refused,
          JsonWebTokenPurpose.StatusPageSession,
        ),
      }).toEqual({ claims: refused, isStatusPageSession: false });
    }

    expect(
      JSONWebToken.isFor(
        without(statusPageClaims, PURPOSE_CLAIM),
        JsonWebTokenPurpose.StatusPageSession,
      ),
    ).toBe(true);
  });

  const signOutClaims: JSONObject = {
    userId: ObjectID.generate().toString(),
    sessionId: ObjectID.generate().toString(),
    [PURPOSE_CLAIM]: JsonWebTokenPurpose.UserSessionSignOut,
  };

  /*
   * A browser's sign-out cookie (issue #8638) says it is one - no release
   * signed one that did not - and names its user and its session, and no
   * status page or SSO provider.
   */
  test("a browser's sign-out cookie says it is one, and names its user and its session", () => {
    expect(
      JSONWebToken.isFor(signOutClaims, JsonWebTokenPurpose.UserSessionSignOut),
    ).toBe(true);

    const issuedAt: number = Math.floor(Date.now() / 1000);

    for (const refused of [
      without(signOutClaims, PURPOSE_CLAIM),
      {
        ...without(signOutClaims, PURPOSE_CLAIM),
        iat: issuedAt,
        exp: issuedAt + 60,
      },
      without(signOutClaims, "sessionId"),
      without(signOutClaims, "userId"),
      { ...signOutClaims, sessionId: "not-an-id" },
      { ...signOutClaims, sessionId: 42 },
      { ...signOutClaims, userId: "not-an-id" },
      { ...signOutClaims, userId: ["5a5a5a5a-5a5a-4a5a-8a5a-5a5a5a5a5a5a"] },
      { ...signOutClaims, statusPageId: ObjectID.generate().toString() },
      { ...signOutClaims, ssoProviderType: SsoProviderType.ProjectSSO },
      { ...signOutClaims, ssoProviderId: ObjectID.generate().toString() },
      { ...signOutClaims, [PURPOSE_CLAIM]: "User-Session-Sign-Out" },
      { ...signOutClaims, [PURPOSE_CLAIM]: "user-session-sign-out " },
      { ...signOutClaims, [PURPOSE_CLAIM]: ["user-session-sign-out"] },
      { ...signOutClaims, [PURPOSE_CLAIM]: JsonWebTokenPurpose.UserSession },
      // A session's access token, of this release or an earlier one.
      sessionClaims,
      {
        ...without(sessionClaims, PURPOSE_CLAIM),
        iat: issuedAt,
        exp: issuedAt + EARLIER_RELEASE_ACCESS_TOKEN_LIFETIME_IN_SECONDS,
      },
      ssoClaims,
      statusPageClaims,
    ]) {
      expect({
        claims: refused,
        isSignOut: JSONWebToken.isFor(
          refused,
          JsonWebTokenPurpose.UserSessionSignOut,
        ),
      }).toEqual({ claims: refused, isSignOut: false });
    }
  });

  test("a browser's sign-out cookie is no session, no SSO sign-in and no status page's session, whatever else it holds", () => {
    for (const claims of [
      signOutClaims,
      // Everything a session's access token holds, and that it is a sign-out cookie.
      {
        ...sessionClaims,
        name: "Member",
        isMasterAdmin: true,
        isGlobalLogin: true,
        [PURPOSE_CLAIM]: JsonWebTokenPurpose.UserSessionSignOut,
      },
    ]) {
      for (const purpose of [
        JsonWebTokenPurpose.UserSession,
        JsonWebTokenPurpose.SsoSignIn,
        JsonWebTokenPurpose.StatusPageSession,
      ]) {
        expect({ purpose, reads: JSONWebToken.isFor(claims, purpose) }).toEqual(
          { purpose, reads: false },
        );
      }
    }
  });

  const statusPageSignOutClaims: JSONObject = {
    userId: ObjectID.generate().toString(),
    statusPageId: ObjectID.generate().toString(),
    sessionId: ObjectID.generate().toString(),
    [PURPOSE_CLAIM]: JsonWebTokenPurpose.StatusPageSessionSignOut,
  };

  /*
   * A status page's sign-out cookie (issue #8671) says it is one, and
   * names its page, its reader and its session, and no SSO provider.
   */
  test("a status page's sign-out cookie says it is one, and names its page, its reader and its session", () => {
    expect(
      JSONWebToken.isFor(
        statusPageSignOutClaims,
        JsonWebTokenPurpose.StatusPageSessionSignOut,
      ),
    ).toBe(true);

    const issuedAt: number = Math.floor(Date.now() / 1000);

    for (const refused of [
      without(statusPageSignOutClaims, PURPOSE_CLAIM),
      {
        ...without(statusPageSignOutClaims, PURPOSE_CLAIM),
        iat: issuedAt,
        exp: issuedAt + 60,
      },
      without(statusPageSignOutClaims, "statusPageId"),
      without(statusPageSignOutClaims, "sessionId"),
      without(statusPageSignOutClaims, "userId"),
      { ...statusPageSignOutClaims, statusPageId: "not-an-id" },
      // As a status page's access token carries it: no plain id.
      {
        ...statusPageSignOutClaims,
        statusPageId: {
          _type: "ObjectID",
          value: ObjectID.generate().toString(),
        },
      },
      { ...statusPageSignOutClaims, sessionId: 42 },
      { ...statusPageSignOutClaims, userId: "not-an-id" },
      {
        ...statusPageSignOutClaims,
        ssoProviderType: SsoProviderType.ProjectSSO,
      },
      {
        ...statusPageSignOutClaims,
        ssoProviderId: ObjectID.generate().toString(),
      },
      {
        ...statusPageSignOutClaims,
        [PURPOSE_CLAIM]: "Status-Page-Session-Sign-Out",
      },
      {
        ...statusPageSignOutClaims,
        [PURPOSE_CLAIM]: JsonWebTokenPurpose.StatusPageSession,
      },
      {
        ...statusPageSignOutClaims,
        [PURPOSE_CLAIM]: JsonWebTokenPurpose.UserSessionSignOut,
      },
      // A status page's session, of this release or an earlier one, and a dashboard's sign-out cookie.
      statusPageClaims,
      without(statusPageClaims, PURPOSE_CLAIM),
      signOutClaims,
      sessionClaims,
    ]) {
      expect({
        claims: refused,
        isStatusPageSignOut: JSONWebToken.isFor(
          refused,
          JsonWebTokenPurpose.StatusPageSessionSignOut,
        ),
      }).toEqual({ claims: refused, isStatusPageSignOut: false });
    }
  });

  test("a status page's sign-out cookie is no session of any kind and no dashboard sign-out cookie, whatever else it holds", () => {
    for (const claims of [
      statusPageSignOutClaims,
      {
        ...statusPageClaims,
        name: "Reader",
        [PURPOSE_CLAIM]: JsonWebTokenPurpose.StatusPageSessionSignOut,
      },
    ]) {
      for (const purpose of ALL_PURPOSES.filter(
        (purpose: JsonWebTokenPurpose): boolean => {
          return purpose !== JsonWebTokenPurpose.StatusPageSessionSignOut;
        },
      )) {
        expect({ purpose, reads: JSONWebToken.isFor(claims, purpose) }).toEqual(
          { purpose, reads: false },
        );
      }
    }
  });

  test("a status page's session is never a dashboard session, nor an SSO sign-in", () => {
    for (const claims of [
      statusPageClaims,
      without(statusPageClaims, PURPOSE_CLAIM),
    ]) {
      expect(JSONWebToken.isFor(claims, JsonWebTokenPurpose.UserSession)).toBe(
        false,
      );
      expect(JSONWebToken.isFor(claims, JsonWebTokenPurpose.SsoSignIn)).toBe(
        false,
      );
    }
  });

  test("a purpose this server does not know is read as nothing", () => {
    for (const purpose of ["admin", "", "user-session-v2", "sso"]) {
      for (const asked of ALL_PURPOSES) {
        expect(
          JSONWebToken.isFor(
            {
              ...sessionClaims,
              ...ssoClaims,
              ...statusPageClaims,
              [PURPOSE_CLAIM]: purpose,
            },
            asked,
          ),
        ).toBe(false);
      }
    }

    expect(
      JSONWebToken.isFor(sessionClaims, "admin" as JsonWebTokenPurpose),
    ).toBe(false);
  });
});
