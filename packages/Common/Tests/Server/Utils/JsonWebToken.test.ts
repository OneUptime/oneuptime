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
      const reads: boolean = ((): boolean => {
        try {
          JSONWebToken.decode(value, purpose);
          return true;
        } catch {
          return false;
        }
      })();

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
