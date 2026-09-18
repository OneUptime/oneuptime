import {
  buildRequest,
  buildResponse,
  MockIdentityRouter,
  RouteHandler,
} from "./IdentityRouterTestUtil";
import Express, {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "Common/Server/Utils/Express";
import User from "Common/Models/DatabaseModels/User";
import UserSession from "Common/Models/DatabaseModels/UserSession";
import ObjectID from "Common/Types/ObjectID";
import Email from "Common/Types/Email";
import Name from "Common/Types/Name";
import BadDataException from "Common/Types/Exception/BadDataException";
import UserService from "Common/Server/Services/UserService";
import UserWebAuthnService from "Common/Server/Services/UserWebAuthnService";
import UserSessionService from "Common/Server/Services/UserSessionService";
import MobilePasskeyLoginService, {
  MobilePasskeyContext,
} from "Common/Server/Services/MobilePasskeyLoginService";
import AccessTokenService from "Common/Server/Services/AccessTokenService";
import CookieUtil from "Common/Server/Utils/Cookie";
import Response from "Common/Server/Utils/Response";
import IdentityRateLimit, {
  IdentityRateLimitBucket,
} from "Common/Server/Middleware/IdentityRateLimit";
import logger from "Common/Server/Utils/Logger";
import { HttpProtocol } from "Common/Server/EnvironmentConfig";
import "../../../FeatureSet/Identity/API/Authentication";

jest.mock("Common/Server/EnvironmentConfig", () => {
  return {
    ...jest.requireActual("Common/Server/EnvironmentConfig"),
    Host: "EXAMPLE.COM:443",
    HttpProtocol: "https://",
  };
});

jest.mock("Common/Server/Utils/Express", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "Common/Server/Utils/Express",
  );
  const { createMockIdentityRouter } = jest.requireActual(
    "./IdentityRouterTestUtil",
  );
  const router: MockIdentityRouter = createMockIdentityRouter();
  return {
    ...actual,
    __esModule: true,
    default: {
      getRouter: () => {
        return router;
      },
    },
    getClientIp: () => {
      return "127.0.0.1";
    },
    extractDeviceInfo: () => {
      return { deviceBrowser: "Chrome" };
    },
    headerValueToString: () => {
      return "test-browser";
    },
  };
});
jest.mock("Common/Server/Middleware/IdentityRateLimit", () => {
  const middleware: jest.Mock = jest.fn();
  return {
    __esModule: true,
    IdentityRateLimitBucket: {
      Login: "login",
      TwoFactor: "two-factor",
      BackupCode: "backup-code",
      Passkey: "passkey",
    },
    default: {
      getMiddleware: jest.fn(() => {
        return middleware;
      }),
    },
  };
});
jest.mock("Common/Server/Services/UserWebAuthnService", () => {
  return {
    __esModule: true,
    default: {
      generatePasskeyAuthenticationOptions: jest.fn(),
      verifyPasskeyAuthentication: jest.fn(),
    },
  };
});
jest.mock("Common/Server/Services/MobilePasskeyLoginService", () => {
  return {
    __esModule: true,
    default: {
      validateRequest: jest.fn(),
      storeChallengeContext: jest.fn(),
      consumeChallengeContext: jest.fn(),
      createAuthorizationCode: jest.fn(),
      exchangeAuthorizationCode: jest.fn(),
    },
  };
});
jest.mock("Common/Server/Services/UserService", () => {
  return {
    __esModule: true,
    default: { findOneById: jest.fn(), verifyHashedColumnValue: jest.fn() },
  };
});
jest.mock("Common/Server/Services/UserSessionService", () => {
  return {
    __esModule: true,
    default: { createSession: jest.fn() },
  };
});
jest.mock("Common/Server/Services/AccessTokenService", () => {
  return {
    __esModule: true,
    default: { refreshUserAllPermissions: jest.fn() },
  };
});
jest.mock("Common/Server/Services/UserTotpAuthService", () => {
  return { __esModule: true, default: {} };
});
jest.mock("Common/Server/Services/UserTwoFactorBackupCodeService", () => {
  return { __esModule: true, default: {} };
});
jest.mock("Common/Server/Services/TeamMemberService", () => {
  return { __esModule: true, default: {} };
});
jest.mock("Common/Server/Services/EmailVerificationTokenService", () => {
  return { __esModule: true, default: {} };
});
jest.mock("Common/Server/Services/MailService", () => {
  return { __esModule: true, default: {} };
});
jest.mock("Common/Server/DatabaseConfig", () => {
  return { __esModule: true, default: {} };
});
jest.mock("Common/Server/Utils/TwoFactorBackupCodeNotification", () => {
  return { __esModule: true, default: {} };
});
jest.mock("../../../FeatureSet/Identity/Utils/AuthenticationEmail", () => {
  return { __esModule: true, default: {} };
});
jest.mock("Common/Server/Utils/Cookie", () => {
  return {
    __esModule: true,
    default: { setUserCookie: jest.fn() },
  };
});
jest.mock("Common/Server/Utils/JsonWebToken", () => {
  return {
    __esModule: true,
    default: {
      signUserLoginToken: jest.fn(() => {
        return "access-token";
      }),
    },
  };
});
jest.mock("Common/Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      info: jest.fn(),
      debug: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    },
    getLogAttributesFromRequest: () => {
      return {};
    },
  };
});
jest.mock("Common/Server/Utils/Response", () => {
  return {
    __esModule: true,
    default: {
      sendJsonObjectResponse: jest.fn(),
      sendEntityResponse: jest.fn(),
      setNoCacheHeaders: jest.fn(),
    },
  };
});

const router: MockIdentityRouter =
  Express.getRouter() as unknown as MockIdentityRouter;
const challengeId: string = "a".repeat(43);
const cookieName: string = "oneuptime-passkey-login";
const origin: string = "https://example.com";
const userId: ObjectID = new ObjectID("11111111-1111-4111-8111-111111111111");
const credential: { id: string; response: { signature: string } } = {
  id: "credential-sentinel",
  response: { signature: "signature-sentinel" },
};
let user: User;

type InvokeResult = {
  req: ExpressRequest;
  res: ExpressResponse;
  next: jest.Mock;
};
type InvokeOptions = {
  body?: unknown;
  cookies?: Record<string, unknown>;
  origin?: string | null;
};
type Invoke = (uri: string, options?: InvokeOptions) => Promise<InvokeResult>;

const invoke: Invoke = async (
  uri: string,
  options: InvokeOptions = {},
): Promise<InvokeResult> => {
  const req: ExpressRequest = buildRequest(options.body ?? { credential }, {
    headers:
      options.origin === null ? {} : { origin: options.origin ?? origin },
  });
  req.cookies = options.cookies ?? { [cookieName]: challengeId };
  const res: ExpressResponse = buildResponse();
  const next: jest.Mock = jest.fn();
  await router.match("post", uri)(req, res, next as NextFunction);
  return { req, res, next };
};

beforeEach(() => {
  jest.clearAllMocks();
  jest
    .mocked(MobilePasskeyLoginService.consumeChallengeContext)
    .mockResolvedValue(null);
  user = new User();
  user.id = userId;
  user.email = new Email("passkey@example.com");
  user.name = new Name("Passkey Tester");
  user.isEmailVerified = true;
  const session: UserSession = new UserSession();
  session.id = new ObjectID("22222222-2222-4222-8222-222222222222");
  jest.mocked(UserService.findOneById).mockResolvedValue(user);
  jest
    .mocked(UserWebAuthnService.verifyPasskeyAuthentication)
    .mockResolvedValue(user);
  jest
    .mocked(UserWebAuthnService.generatePasskeyAuthenticationOptions)
    .mockResolvedValue({
      challengeId,
      options: {
        challenge: "server-challenge",
        allowCredentials: [],
        userVerification: "required",
      },
    });
  jest.mocked(UserSessionService.createSession).mockResolvedValue({
    session,
    refreshToken: "refresh-token",
    refreshTokenExpiresAt: new Date("2030-01-01T00:00:00.000Z"),
  });
});

describe("passkey login options", () => {
  it("accepts the browser's normalized origin for an uppercase host and default HTTPS port", async () => {
    const { next } = await invoke("/passkey-login-options", { origin });
    expect(next).not.toHaveBeenCalled();
    expect(
      UserWebAuthnService.generatePasskeyAuthenticationOptions,
    ).toHaveBeenCalled();
  });

  it("sets a short-lived HttpOnly browser cookie and only returns public options", async () => {
    const { req, res, next } = await invoke("/passkey-login-options", {
      body: {},
    });
    expect(next).not.toHaveBeenCalled();
    expect(res.cookie).toHaveBeenCalledWith(cookieName, challengeId, {
      httpOnly: true,
      secure: HttpProtocol.toString() === "https://",
      sameSite: "strict",
      path: "/",
      maxAge: 300000,
    });
    expect(Response.sendJsonObjectResponse).toHaveBeenCalledWith(req, res, {
      options: {
        challenge: "server-challenge",
        allowCredentials: [],
        userVerification: "required",
      },
    });
    expect(UserService.findOneById).not.toHaveBeenCalled();
    expect(UserSessionService.createSession).not.toHaveBeenCalled();
  });

  it("fails closed when challenge storage is unavailable", async () => {
    jest
      .mocked(UserWebAuthnService.generatePasskeyAuthenticationOptions)
      .mockRejectedValueOnce(new Error("Redis unavailable"));
    const { res, next } = await invoke("/passkey-login-options");
    expect(next).toHaveBeenCalledWith(expect.any(Error));
    expect(res.cookie).not.toHaveBeenCalled();
    expect(Response.sendJsonObjectResponse).not.toHaveBeenCalled();
  });
});

describe.each(["/passkey-login-options", "/passkey-login"])(
  "%s request protection",
  (uri: string) => {
    it.each([null, "https://attacker.example", "null"])(
      "rejects foreign or absent origin %s before credential work",
      async (requestOrigin: string | null) => {
        const { next } = await invoke(uri, { origin: requestOrigin });
        expect(next).toHaveBeenCalledWith(expect.any(BadDataException));
        expect(
          UserWebAuthnService.generatePasskeyAuthenticationOptions,
        ).not.toHaveBeenCalled();
        expect(
          UserWebAuthnService.verifyPasskeyAuthentication,
        ).not.toHaveBeenCalled();
        expect(UserSessionService.createSession).not.toHaveBeenCalled();
      },
    );

    it("registers the passkey limiter before the route handler", () => {
      const handlers: Array<RouteHandler> = router.matchAll("post", uri);
      expect(handlers).toHaveLength(2);
      expect(handlers[0]).toBe(
        IdentityRateLimit.getMiddleware(IdentityRateLimitBucket.Passkey),
      );
    });
  },
);

describe("passkey login", () => {
  it("creates the ordinary session and permissions without a password or extra TOTP", async () => {
    user.enableTwoFactorAuth = true;
    const { req, res, next } = await invoke("/passkey-login");
    expect(next).not.toHaveBeenCalled();
    expect(
      UserWebAuthnService.verifyPasskeyAuthentication,
    ).toHaveBeenCalledWith({ challengeId, credential });
    expect(UserService.verifyHashedColumnValue).not.toHaveBeenCalled();
    expect(AccessTokenService.refreshUserAllPermissions).toHaveBeenCalledWith(
      userId,
    );
    expect(UserSessionService.createSession).toHaveBeenCalledWith(
      expect.objectContaining({
        userId,
        isGlobalLogin: true,
        ipAddress: "127.0.0.1",
      }),
    );
    expect(CookieUtil.setUserCookie).toHaveBeenCalledWith(
      expect.objectContaining({
        user,
        isGlobalLogin: true,
        refreshToken: "refresh-token",
      }),
    );
    expect(Response.sendEntityResponse).toHaveBeenCalledWith(
      req,
      res,
      user,
      User,
      {
        miscData: {
          accessToken: "access-token",
          refreshToken: "refresh-token",
          refreshTokenExpiresAt: "2030-01-01T00:00:00.000Z",
        },
      },
    );
    expect(res.clearCookie).toHaveBeenCalledWith(
      cookieName,
      expect.objectContaining({
        httpOnly: true,
        path: "/",
        sameSite: "strict",
      }),
    );
  });

  it("uses the verified credential's owner and fetches only public account fields", async () => {
    await invoke("/passkey-login", {
      body: {
        credential,
        email: "attacker@example.com",
        userId: "attacker",
        challengeId: "attacker",
      },
    });
    expect(UserService.findOneById).toHaveBeenCalledWith({
      id: userId,
      select: {
        _id: true,
        name: true,
        email: true,
        isMasterAdmin: true,
        isEmailVerified: true,
        isBlocked: true,
        profilePictureId: true,
        timezone: true,
      },
      props: { isRoot: true },
    });
    expect(
      UserWebAuthnService.verifyPasskeyAuthentication,
    ).toHaveBeenCalledWith({ challengeId, credential });
  });

  it.each([undefined, null, "", "short", {}, "a".repeat(129)])(
    "rejects an invalid cookie %p even with a valid body challenge ID",
    async (cookie: unknown) => {
      const { next } = await invoke("/passkey-login", {
        cookies: { [cookieName]: cookie },
        body: { credential, challengeId },
      });
      expect(next).toHaveBeenCalledWith(expect.any(BadDataException));
      expect(
        UserWebAuthnService.verifyPasskeyAuthentication,
      ).not.toHaveBeenCalled();
      expect(UserSessionService.createSession).not.toHaveBeenCalled();
    },
  );

  it.each([
    "unknown credential",
    "expired challenge",
    "invalid signature",
    "user verification required",
    "replayed challenge",
  ])(
    "returns the same safe error for %s and never issues a session",
    async (reason: string) => {
      jest
        .mocked(UserWebAuthnService.verifyPasskeyAuthentication)
        .mockRejectedValueOnce(new Error(reason));
      const { next, res } = await invoke("/passkey-login");
      expect(next).toHaveBeenCalledWith(
        expect.objectContaining({
          message:
            "Unable to sign in with this passkey. Please try again or use your password.",
        }),
      );
      expect(res.clearCookie).toHaveBeenCalled();
      expect(UserService.findOneById).not.toHaveBeenCalled();
      expect(UserSessionService.createSession).not.toHaveBeenCalled();
      expect(CookieUtil.setUserCookie).not.toHaveBeenCalled();
      expect(Response.sendEntityResponse).not.toHaveBeenCalled();
    },
  );

  it.each(["missing", "unverified email", "missing email", "blocked"])(
    "refuses an account with %s",
    async (condition: string) => {
      if (condition === "missing") {
        jest.mocked(UserService.findOneById).mockResolvedValueOnce(null);
      } else if (condition === "unverified email") {
        user.isEmailVerified = false;
      } else if (condition === "blocked") {
        user.isBlocked = true;
      } else {
        delete user.email;
      }
      const { next } = await invoke("/passkey-login");
      expect(next).toHaveBeenCalledWith(expect.any(BadDataException));
      expect(UserSessionService.createSession).not.toHaveBeenCalled();
    },
  );

  it("fails before querying when verification returns no user ID", async () => {
    jest
      .mocked(UserWebAuthnService.verifyPasskeyAuthentication)
      .mockResolvedValueOnce(new User());
    const { next } = await invoke("/passkey-login");
    expect(next).toHaveBeenCalledWith(expect.any(BadDataException));
    expect(UserService.findOneById).not.toHaveBeenCalled();
  });

  it("never logs assertions, challenges, or session tokens", async () => {
    await invoke("/passkey-login");
    const logOutput: string = JSON.stringify([
      jest.mocked(logger.info).mock.calls,
      jest.mocked(logger.debug).mock.calls,
      jest.mocked(logger.error).mock.calls,
    ]);
    for (const secret of [
      credential.id,
      credential.response.signature,
      challengeId,
      "access-token",
      "refresh-token",
    ]) {
      expect(logOutput).not.toContain(secret);
    }
  });
});

const mobileContext: MobilePasskeyContext = {
  codeChallenge: "c".repeat(43),
  codeChallengeMethod: "S256",
  state: "s".repeat(64),
  serverOrigin: origin,
};
const mobileCallback: string = `oneuptime://passkey?code=${"c".repeat(43)}&state=${mobileContext.state}&serverOrigin=${encodeURIComponent(origin)}`;

describe("mobile passkey browser handoff", () => {
  beforeEach(() => {
    jest
      .mocked(MobilePasskeyLoginService.validateRequest)
      .mockReturnValue(mobileContext);
    jest
      .mocked(MobilePasskeyLoginService.createAuthorizationCode)
      .mockResolvedValue(mobileCallback);
  });

  it("binds mobile metadata to the browser challenge before setting the cookie", async () => {
    const { res, next } = await invoke("/passkey-login-options", {
      body: { mobileAuth: mobileContext },
    });
    expect(next).not.toHaveBeenCalled();
    expect(MobilePasskeyLoginService.validateRequest).toHaveBeenCalledWith(
      mobileContext,
    );
    expect(
      MobilePasskeyLoginService.storeChallengeContext,
    ).toHaveBeenCalledWith(challengeId, mobileContext);
    expect(res.cookie).toHaveBeenCalledWith(
      cookieName,
      `mobile.${challengeId}`,
      expect.objectContaining({
        httpOnly: true,
        sameSite: "strict",
        secure: true,
      }),
    );
    expect(UserSessionService.createSession).not.toHaveBeenCalled();
  });

  it("rejects invalid mobile parameters before generating a passkey challenge", async () => {
    jest
      .mocked(MobilePasskeyLoginService.validateRequest)
      .mockImplementationOnce(() => {
        throw new BadDataException("Invalid mobile request");
      });
    const { next, res } = await invoke("/passkey-login-options", {
      body: { mobileAuth: {} },
    });
    expect(next).toHaveBeenCalledWith(expect.any(BadDataException));
    expect(
      UserWebAuthnService.generatePasskeyAuthenticationOptions,
    ).not.toHaveBeenCalled();
    expect(res.cookie).not.toHaveBeenCalled();
  });

  it("does not issue a cookie when binding storage fails", async () => {
    jest
      .mocked(MobilePasskeyLoginService.storeChallengeContext)
      .mockRejectedValueOnce(new Error("Redis unavailable"));
    const { next, res } = await invoke("/passkey-login-options", {
      body: { mobileAuth: mobileContext },
    });
    expect(next).toHaveBeenCalledWith(expect.any(Error));
    expect(res.cookie).not.toHaveBeenCalled();
  });

  it("returns only the fixed callback after a fresh verified assertion, without a web session", async () => {
    jest
      .mocked(MobilePasskeyLoginService.consumeChallengeContext)
      .mockResolvedValueOnce(mobileContext);
    const { req, res, next } = await invoke("/passkey-login", {
      cookies: { [cookieName]: `mobile.${challengeId}` },
      body: {
        credential,
        mobileAuth: { state: "attacker" },
        userId: "attacker",
      },
    });
    expect(next).not.toHaveBeenCalled();
    expect(
      UserWebAuthnService.verifyPasskeyAuthentication,
    ).toHaveBeenCalledWith({ challengeId, credential });
    expect(
      MobilePasskeyLoginService.consumeChallengeContext,
    ).toHaveBeenCalledWith(challengeId);
    expect(
      MobilePasskeyLoginService.createAuthorizationCode,
    ).toHaveBeenCalledWith({ userId, context: mobileContext });
    expect(Response.sendJsonObjectResponse).toHaveBeenCalledWith(req, res, {
      mobileAuth: { callbackUrl: mobileCallback },
    });
    expect(Response.setNoCacheHeaders).toHaveBeenCalledWith(res);
    expect(UserSessionService.createSession).not.toHaveBeenCalled();
    expect(CookieUtil.setUserCookie).not.toHaveBeenCalled();
    expect(AccessTokenService.refreshUserAllPermissions).not.toHaveBeenCalled();
    expect(Response.sendEntityResponse).not.toHaveBeenCalled();
  });

  it.each(["missing metadata", "mobile marker removed", "web cookie promoted"])(
    "rejects mismatched ceremony purposes: %s",
    async (condition: string) => {
      const marked: boolean = condition !== "mobile marker removed";
      jest
        .mocked(MobilePasskeyLoginService.consumeChallengeContext)
        .mockResolvedValueOnce(
          condition === "mobile marker removed" ? mobileContext : null,
        );
      const { next } = await invoke("/passkey-login", {
        cookies: {
          [cookieName]: marked ? `mobile.${challengeId}` : challengeId,
        },
      });
      expect(next).toHaveBeenCalledWith(expect.any(BadDataException));
      expect(
        MobilePasskeyLoginService.createAuthorizationCode,
      ).not.toHaveBeenCalled();
      expect(UserSessionService.createSession).not.toHaveBeenCalled();
    },
  );

  it("fails closed when mobile metadata cannot be read", async () => {
    jest
      .mocked(MobilePasskeyLoginService.consumeChallengeContext)
      .mockRejectedValueOnce(new Error("Redis unavailable"));
    const { next } = await invoke("/passkey-login", {
      cookies: { [cookieName]: `mobile.${challengeId}` },
    });
    expect(next).toHaveBeenCalledWith(expect.any(Error));
    expect(
      MobilePasskeyLoginService.createAuthorizationCode,
    ).not.toHaveBeenCalled();
    expect(UserSessionService.createSession).not.toHaveBeenCalled();
  });

  it("does not create a session if the authorization code cannot be stored", async () => {
    jest
      .mocked(MobilePasskeyLoginService.consumeChallengeContext)
      .mockResolvedValueOnce(mobileContext);
    jest
      .mocked(MobilePasskeyLoginService.createAuthorizationCode)
      .mockRejectedValueOnce(new Error("Redis unavailable"));
    const { next } = await invoke("/passkey-login", {
      cookies: { [cookieName]: `mobile.${challengeId}` },
    });
    expect(next).toHaveBeenCalledWith(expect.any(Error));
    expect(UserSessionService.createSession).not.toHaveBeenCalled();
    expect(Response.sendJsonObjectResponse).not.toHaveBeenCalled();
  });

  it("cannot reuse an existing browser session without a fresh assertion", async () => {
    jest
      .mocked(UserWebAuthnService.verifyPasskeyAuthentication)
      .mockRejectedValueOnce(new Error("Fresh verification required"));
    const { next } = await invoke("/passkey-login", {
      cookies: {
        [cookieName]: `mobile.${challengeId}`,
        "user-token": "existing-session",
      },
    });
    expect(next).toHaveBeenCalledWith(expect.any(BadDataException));
    expect(
      MobilePasskeyLoginService.createAuthorizationCode,
    ).not.toHaveBeenCalled();
    expect(
      MobilePasskeyLoginService.consumeChallengeContext,
    ).not.toHaveBeenCalled();
  });

  it("never logs the callback or PKCE metadata", async () => {
    jest
      .mocked(MobilePasskeyLoginService.consumeChallengeContext)
      .mockResolvedValueOnce(mobileContext);
    await invoke("/passkey-login", {
      cookies: { [cookieName]: `mobile.${challengeId}` },
    });
    const output: string = JSON.stringify([
      jest.mocked(logger.info).mock.calls,
      jest.mocked(logger.debug).mock.calls,
      jest.mocked(logger.error).mock.calls,
    ]);
    expect(output).not.toContain(mobileCallback);
    expect(output).not.toContain(mobileContext.state);
    expect(output).not.toContain(mobileContext.codeChallenge);
  });
});

describe("native mobile passkey code exchange", () => {
  const body: { code: string; codeVerifier: string; state: string } = {
    code: "c".repeat(43),
    codeVerifier: "v".repeat(64),
    state: mobileContext.state,
  };

  beforeEach(() => {
    jest
      .mocked(MobilePasskeyLoginService.exchangeAuthorizationCode)
      .mockResolvedValue(userId);
  });

  it("uses the passkey rate limiter before the anonymous exchange handler", () => {
    const handlers: Array<RouteHandler> = router.matchAll(
      "post",
      "/mobile-passkey-exchange",
    );
    expect(handlers).toHaveLength(2);
    expect(handlers[0]).toBe(
      IdentityRateLimit.getMiddleware(IdentityRateLimitBucket.Passkey),
    );
  });

  it("creates the ordinary app session only after exchange and account revalidation", async () => {
    const { req, res, next } = await invoke("/mobile-passkey-exchange", {
      body,
      origin: null,
      cookies: {},
    });
    expect(next).not.toHaveBeenCalled();
    expect(
      MobilePasskeyLoginService.exchangeAuthorizationCode,
    ).toHaveBeenCalledWith(body);
    expect(UserService.findOneById).toHaveBeenCalledWith(
      expect.objectContaining({
        id: userId,
        select: expect.objectContaining({ isEmailVerified: true }),
      }),
    );
    expect(AccessTokenService.refreshUserAllPermissions).toHaveBeenCalledWith(
      userId,
    );
    expect(UserSessionService.createSession).toHaveBeenCalledWith(
      expect.objectContaining({
        userId,
        isGlobalLogin: true,
        ipAddress: "127.0.0.1",
      }),
    );
    expect(CookieUtil.setUserCookie).not.toHaveBeenCalled();
    expect(Response.setNoCacheHeaders).toHaveBeenCalledWith(res);
    expect(Response.sendEntityResponse).toHaveBeenCalledWith(
      req,
      res,
      user,
      User,
      {
        miscData: {
          accessToken: "access-token",
          refreshToken: "refresh-token",
          refreshTokenExpiresAt: "2030-01-01T00:00:00.000Z",
        },
      },
    );
  });

  it.each(["https://attacker.example", "null"])(
    "rejects browser requests from %s",
    async (requestOrigin: string) => {
      const { next } = await invoke("/mobile-passkey-exchange", {
        body,
        origin: requestOrigin,
      });
      expect(next).toHaveBeenCalledWith(expect.any(BadDataException));
      expect(
        MobilePasskeyLoginService.exchangeAuthorizationCode,
      ).not.toHaveBeenCalled();
      expect(UserSessionService.createSession).not.toHaveBeenCalled();
    },
  );

  it("refuses invalid, expired or replayed codes before any account/session work", async () => {
    jest
      .mocked(MobilePasskeyLoginService.exchangeAuthorizationCode)
      .mockRejectedValueOnce(new BadDataException("Invalid code"));
    const { next } = await invoke("/mobile-passkey-exchange", {
      body,
      origin: null,
    });
    expect(next).toHaveBeenCalledWith(expect.any(BadDataException));
    expect(UserService.findOneById).not.toHaveBeenCalled();
    expect(UserSessionService.createSession).not.toHaveBeenCalled();
  });

  it.each(["removed", "unverified", "missing email", "blocked"])(
    "rechecks account eligibility: %s",
    async (condition: string) => {
      if (condition === "removed") {
        jest.mocked(UserService.findOneById).mockResolvedValueOnce(null);
      } else if (condition === "unverified") {
        user.isEmailVerified = false;
      } else if (condition === "blocked") {
        user.isBlocked = true;
      } else {
        delete user.email;
      }
      const { next } = await invoke("/mobile-passkey-exchange", {
        body,
        origin: null,
      });
      expect(next).toHaveBeenCalledWith(expect.any(BadDataException));
      expect(UserSessionService.createSession).not.toHaveBeenCalled();
      expect(Response.sendEntityResponse).not.toHaveBeenCalled();
    },
  );

  it("never logs authorization codes, verifiers or session tokens", async () => {
    await invoke("/mobile-passkey-exchange", { body, origin: null });
    const output: string = JSON.stringify([
      jest.mocked(logger.info).mock.calls,
      jest.mocked(logger.debug).mock.calls,
      jest.mocked(logger.error).mock.calls,
    ]);
    for (const value of [
      body.code,
      body.codeVerifier,
      "access-token",
      "refresh-token",
    ]) {
      expect(output).not.toContain(value);
    }
  });
});
