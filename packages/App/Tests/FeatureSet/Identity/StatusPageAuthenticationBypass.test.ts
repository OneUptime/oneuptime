import {
  buildRequest,
  buildResponse,
  createMockIdentityRouter,
  MockIdentityRouter,
  RouteHandler,
} from "./IdentityRouterTestUtil";
import BadDataException from "Common/Types/Exception/BadDataException";
import Exception from "Common/Types/Exception/Exception";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "Common/Server/Utils/Express";
import ObjectID from "Common/Types/ObjectID";
import HashedString from "Common/Types/HashedString";
import PasswordHash from "Common/Server/Utils/PasswordHash";
import { beforeEach, describe, expect, it } from "@jest/globals";

const mockRouter: MockIdentityRouter = createMockIdentityRouter();

/*
 * ---------------------------------------------------------------------------------------------
 * Regression tests for the status page private-user login bypass.
 *
 * This was the more severe of the two originally-reported bypasses, because it minted a REAL
 * session rather than just flipping a verification flag.
 *
 * The `if (!user.statusPageId)` guard caught a fully empty body, so it looked defended. It was
 * not: statusPageId is NOT a secret -- it is public in status page URLs and page config. A body
 * of `{"data": {"statusPageId": "<any valid status page id>"}}` sailed past that guard, and then
 *
 *   - `await user.password?.hashValue(...)` was a silent no-op on `undefined`, and
 *   - the lookup became `{ email: undefined, password: undefined, statusPageId: <id> }`.
 *
 * TypeORM dropped both credential predicates, leaving `WHERE statusPageId = <id>` sorted newest
 * first -- so the query returned the most recently created private user of that status page, and
 * finalizeStatusPageLogin handed the caller their session and access-token cookie.
 *
 * Only `requireSsoForLogin` mitigated it, and only where enabled.
 * ---------------------------------------------------------------------------------------------
 */

jest.mock("Common/Server/Utils/Express", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "Common/Server/Utils/Express",
  ) as Record<string, unknown>;

  return {
    ...actual,
    __esModule: true,
    default: {
      getRouter: (): MockIdentityRouter => {
        return mockRouter;
      },
    },
    getClientIp: (): string => {
      return "127.0.0.1";
    },
    extractDeviceInfo: (): Record<string, unknown> => {
      return {};
    },
    headerValueToString: (): string => {
      return "";
    },
  };
});

const privateUserFindOneBy: jest.Mock = jest.fn();
const privateUserFindOneById: jest.Mock = jest.fn();
const privateUserUpdateOneBy: jest.Mock = jest.fn();
const privateUserUpdateOneById: jest.Mock = jest.fn();

/*
 * Since per-user salts the password is checked here rather than in the query, so the stub has
 * to actually verify -- otherwise the positive control below would pass on any password and
 * stop being a control.
 */
type VerifyInput = {
  item: { password?: { toString: () => string }; passwordSalt?: string };
  columnName: string;
  plainValue: string;
};

const privateUserVerifyHashedColumnValue: jest.Mock = jest.fn(
  async (...args: Array<unknown>): Promise<boolean> => {
    const input: VerifyInput = args[0] as VerifyInput;

    return await PasswordHash.verify({
      plainValue: input.plainValue,
      storedValue: input.item.password?.toString() || "",
      salt: input.item.passwordSalt || null,
    });
  },
);

jest.mock("Common/Server/Services/StatusPagePrivateUserService", () => {
  return {
    __esModule: true,
    default: {
      findOneBy: (...args: Array<unknown>): unknown => {
        return privateUserFindOneBy(...args);
      },
      findOneById: (...args: Array<unknown>): unknown => {
        return privateUserFindOneById(...args);
      },
      updateOneBy: (...args: Array<unknown>): unknown => {
        return privateUserUpdateOneBy(...args);
      },
      updateOneById: (...args: Array<unknown>): unknown => {
        return privateUserUpdateOneById(...args);
      },
      verifyHashedColumnValue: (...args: Array<unknown>): unknown => {
        return privateUserVerifyHashedColumnValue(...args);
      },
    },
  };
});

const statusPageFindOneById: jest.Mock = jest.fn();

jest.mock("Common/Server/Services/StatusPageService", () => {
  return {
    __esModule: true,
    default: {
      findOneById: (...args: Array<unknown>): unknown => {
        return statusPageFindOneById(...args);
      },
      getStatusPageURL: (): Promise<string> => {
        return Promise.resolve("https://status.example.com");
      },
    },
  };
});

const createSession: jest.Mock = jest.fn();
const exchangeLoginCode: jest.Mock = jest.fn();
const findActiveSessionByRefreshToken: jest.Mock = jest.fn();
const isLoginCodeSession: jest.Mock = jest.fn();
const revokeSessionById: jest.Mock = jest.fn();
const renewSessionWithNewRefreshToken: jest.Mock = jest.fn();

jest.mock("Common/Server/Services/StatusPagePrivateUserSessionService", () => {
  return {
    __esModule: true,
    default: {
      createSession: (...args: Array<unknown>): unknown => {
        createSession(...args);
        return Promise.resolve({
          session: { id: new ObjectID("session-id") },
          refreshToken: "refresh-token",
          refreshTokenExpiresAt: new Date(),
        });
      },
      findActiveSessionByRefreshToken: (...args: Array<unknown>): unknown => {
        return findActiveSessionByRefreshToken(...args);
      },
      isLoginCodeSession: (...args: Array<unknown>): unknown => {
        return isLoginCodeSession(...args);
      },
      exchangeLoginCode: (...args: Array<unknown>): unknown => {
        return exchangeLoginCode(...args);
      },
      revokeSessionById: (...args: Array<unknown>): unknown => {
        return revokeSessionById(...args);
      },
      revokeSessionByRefreshToken: jest.fn(),
      renewSessionWithNewRefreshToken: (...args: Array<unknown>): unknown => {
        return renewSessionWithNewRefreshToken(...args);
      },
    },
  };
});

jest.mock("Common/Server/Services/ProjectSmtpConfigService", () => {
  return {
    __esModule: true,
    default: {
      toEmailServer: (): undefined => {
        return undefined;
      },
    },
  };
});

const sendMail: jest.Mock = jest.fn();

jest.mock("Common/Server/Services/MailService", () => {
  return {
    __esModule: true,
    default: {
      sendMail: (...args: Array<unknown>): Promise<void> => {
        sendMail(...args);
        return Promise.resolve();
      },
    },
  };
});

jest.mock("Common/Server/DatabaseConfig", () => {
  return {
    __esModule: true,
    default: {
      getHost: (): Promise<unknown> => {
        return Promise.resolve({
          toString: (): string => {
            return "localhost";
          },
        });
      },
      getHttpProtocol: (): Promise<unknown> => {
        return Promise.resolve({
          toString: (): string => {
            return "http://";
          },
        });
      },
    },
  };
});

const setStatusPagePrivateUserCookie: jest.Mock = jest.fn();
const getRefreshTokenFromExpressRequest: jest.Mock = jest.fn();
const removeCookie: jest.Mock = jest.fn();

jest.mock("Common/Server/Utils/Cookie", () => {
  return {
    __esModule: true,
    default: {
      setStatusPagePrivateUserCookie: (...args: Array<unknown>): string => {
        setStatusPagePrivateUserCookie(...args);
        return "status-page-access-token";
      },
      setUserCookie: jest.fn(),
      removeAllCookies: jest.fn(),
      removeCookie: (...args: Array<unknown>): unknown => {
        return removeCookie(...args);
      },
      removeStatusPageMasterPasswordCookie: jest.fn(),
      getCookieFromExpressRequest: jest.fn(),
      getRefreshTokenFromExpressRequest: (...args: Array<unknown>): unknown => {
        return getRefreshTokenFromExpressRequest(...args);
      },
      getUserTokenKey: jest.fn(),
      getRefreshTokenKey: jest.fn(),
      getStatusPageMasterPasswordKey: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Utils/JsonWebToken", () => {
  return {
    __esModule: true,
    default: {
      sign: (): string => {
        return "signed-token";
      },
      signStatusPageLoginToken: (): string => {
        return "signed-status-page-token";
      },
      decode: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
    },
    getLogAttributesFromRequest: (): Record<string, unknown> => {
      return {};
    },
  };
});

const sendErrorResponse: jest.Mock = jest.fn();
const sendEmptySuccessResponse: jest.Mock = jest.fn();
const sendEntityResponse: jest.Mock = jest.fn();

jest.mock("Common/Server/Utils/Response", () => {
  return {
    __esModule: true,
    default: {
      sendErrorResponse: (...args: Array<unknown>): unknown => {
        return sendErrorResponse(...args);
      },
      sendEmptySuccessResponse: (...args: Array<unknown>): unknown => {
        return sendEmptySuccessResponse(...args);
      },
      sendEntityResponse: (...args: Array<unknown>): unknown => {
        return sendEntityResponse(...args);
      },
      sendJsonObjectResponse: jest.fn(),
      setNoCacheHeaders: jest.fn(),
    },
  };
});

// Importing the router registers every handler on the mock router above.
import "../../../FeatureSet/Identity/API/StatusPageAuthentication";

// A status page id is public information -- it appears in status page URLs.
const PUBLIC_STATUS_PAGE_ID: string = "e7f4d2a0-1b3c-4d5e-8f90-a1b2c3d4e5f6";

type InvokeResult = {
  nextError: Exception | null;
};

type InvokeFunction = (
  uri: string,
  body: unknown,
  params?: Record<string, string>,
) => Promise<InvokeResult>;

const invoke: InvokeFunction = async (
  uri: string,
  body: unknown,
  params?: Record<string, string>,
): Promise<InvokeResult> => {
  const handler: RouteHandler = mockRouter.match("post", uri);
  const req: ExpressRequest = buildRequest(body);
  req.params = params || {};
  const res: ExpressResponse = buildResponse();

  let nextError: Exception | null = null;

  const next: NextFunction = ((err?: Exception): void => {
    if (err) {
      nextError = err;
    }
  }) as unknown as NextFunction;

  await handler(req, res, next);

  return { nextError };
};

type ExpectNoSessionFunction = () => void;

/*
 * The whole point of this endpoint's bug was that it minted a session. Asserting only on the
 * error response would miss a regression that errors AFTER issuing the cookie.
 */
const expectNoSessionIssued: ExpectNoSessionFunction = (): void => {
  expect(privateUserFindOneBy).not.toHaveBeenCalled();
  expect(createSession).not.toHaveBeenCalled();
  expect(setStatusPagePrivateUserCookie).not.toHaveBeenCalled();
  expect(sendEntityResponse).not.toHaveBeenCalled();
};

describe("Status page /login - private user login bypass", () => {
  beforeEach(() => {
    jest.clearAllMocks();

    statusPageFindOneById.mockResolvedValue({
      id: new ObjectID(PUBLIC_STATUS_PAGE_ID),
      requireSsoForLogin: false,
    });
  });

  it("rejects an empty body", async () => {
    const result: InvokeResult = await invoke("/login", { data: {} });

    expectNoSessionIssued();
    expect(result.nextError).toBeInstanceOf(BadDataException);
  });

  /*
   * THE ORIGINAL EXPLOIT. statusPageId alone used to be enough to reach the query.
   */
  it("rejects a body carrying only the (public) statusPageId", async () => {
    const result: InvokeResult = await invoke("/login", {
      data: { statusPageId: PUBLIC_STATUS_PAGE_ID },
    });

    expectNoSessionIssued();
    expect(result.nextError).toBeInstanceOf(BadDataException);
    expect((result.nextError as unknown as Exception).message).toBe(
      "Email is required.",
    );
  });

  it("rejects statusPageId plus an email but no password", async () => {
    const result: InvokeResult = await invoke("/login", {
      data: {
        statusPageId: PUBLIC_STATUS_PAGE_ID,
        email: "victim@example.com",
      },
    });

    expectNoSessionIssued();
    expect(result.nextError).toBeInstanceOf(BadDataException);
    expect((result.nextError as unknown as Exception).message).toBe(
      "Password is required.",
    );
  });

  it("rejects statusPageId plus a password but no email", async () => {
    const result: InvokeResult = await invoke("/login", {
      data: {
        statusPageId: PUBLIC_STATUS_PAGE_ID,
        password: { _type: "HashedString", value: "guess" },
      },
    });

    expectNoSessionIssued();
    expect(result.nextError).toBeInstanceOf(BadDataException);
    expect((result.nextError as unknown as Exception).message).toBe(
      "Email is required.",
    );
  });

  it("rejects explicitly null credentials", async () => {
    const result: InvokeResult = await invoke("/login", {
      data: {
        statusPageId: PUBLIC_STATUS_PAGE_ID,
        email: null,
        password: null,
      },
    });

    expectNoSessionIssued();
    expect(result.nextError).toBeInstanceOf(BadDataException);
  });

  it("rejects empty-string credentials", async () => {
    const result: InvokeResult = await invoke("/login", {
      data: {
        statusPageId: PUBLIC_STATUS_PAGE_ID,
        email: "",
        password: "",
      },
    });

    expectNoSessionIssued();
    expect(result.nextError).toBeInstanceOf(BadDataException);
  });

  it("rejects a typed-but-empty HashedString password", async () => {
    /*
     * hashValue() returns "" without hashing when the value is empty, so this payload would
     * reach the query as a literal empty password rather than a hash.
     */
    const result: InvokeResult = await invoke("/login", {
      data: {
        statusPageId: PUBLIC_STATUS_PAGE_ID,
        email: "victim@example.com",
        password: { _type: "HashedString", value: "" },
      },
    });

    expectNoSessionIssued();
    expect(result.nextError).toBeInstanceOf(BadDataException);
    expect((result.nextError as unknown as Exception).message).toBe(
      "Password is required.",
    );
  });

  it("still rejects credential-less payloads on an SSO-only status page", async () => {
    /*
     * requireSsoForLogin was the only thing standing between this endpoint and a bypass. The
     * credential guard must not depend on it -- and must fire before the status page lookup.
     */
    statusPageFindOneById.mockResolvedValue({
      id: new ObjectID(PUBLIC_STATUS_PAGE_ID),
      requireSsoForLogin: true,
    });

    const result: InvokeResult = await invoke("/login", {
      data: { statusPageId: PUBLIC_STATUS_PAGE_ID },
    });

    expectNoSessionIssued();
    expect(result.nextError).toBeInstanceOf(BadDataException);
  });

  it("queries with both identity predicates present on the happy path", async () => {
    privateUserFindOneBy.mockResolvedValue(null);

    await invoke("/login", {
      data: {
        statusPageId: PUBLIC_STATUS_PAGE_ID,
        email: "real-user@example.com",
        password: { _type: "HashedString", value: "correct-password" },
      },
    });

    expect(privateUserFindOneBy).toHaveBeenCalledTimes(1);

    const query: Record<string, any> = (
      privateUserFindOneBy.mock.calls[0]![0] as Record<string, any>
    )["query"] as Record<string, any>;

    /*
     * Neither may be undefined -- an undefined one is silently dropped by TypeORM, and dropping
     * `email` here would degrade the query to "newest private user of this status page".
     */
    expect(query["email"]).toBeDefined();
    expect(query["statusPageId"]).toBeDefined();

    expect(query["email"].toString()).toBe("real-user@example.com");
    expect(query["statusPageId"].toString()).toBe(PUBLIC_STATUS_PAGE_ID);

    /*
     * The password is deliberately NOT a predicate any more. Since per-user salts, the expected
     * hash cannot be computed before the row (and its salt) has been read, so the account is
     * located by identity and the password is verified afterwards -- see
     * StatusPagePerUserPasswordSalt.test.ts, which covers that check. The credential guard above
     * still runs first, so an absent password never reaches this query either way.
     */
    expect(query["password"]).toBeUndefined();
  });

  /*
   * Positive control. Every other case in this block asserts a session was NOT issued; without
   * this one, a typo in the mocked cookie/session names would make those assertions pass
   * vacuously. This proves the same probes do fire when a login genuinely succeeds.
   */
  it("issues a session when the credentials match a real user", async () => {
    const salt: string = PasswordHash.generateSalt();

    privateUserFindOneBy.mockResolvedValue({
      id: new ObjectID("private-user-id"),
      _id: "private-user-id",
      email: "real-user@example.com",
      statusPageId: new ObjectID(PUBLIC_STATUS_PAGE_ID),
      projectId: new ObjectID("project-id"),
      /*
       * The password now has to actually match: the handler verifies it in code rather than
       * leaning on the query to have matched it.
       */
      password: new HashedString(
        await PasswordHash.hash({
          plainValue: "correct-password",
          salt: salt,
        }),
        true,
      ),
      passwordSalt: salt,
    });
    privateUserFindOneById.mockResolvedValue(null);

    await invoke("/login", {
      data: {
        statusPageId: PUBLIC_STATUS_PAGE_ID,
        email: "real-user@example.com",
        password: { _type: "HashedString", value: "correct-password" },
      },
    });

    expect(createSession).toHaveBeenCalledTimes(1);
    expect(setStatusPagePrivateUserCookie).toHaveBeenCalledTimes(1);
    expect(sendEntityResponse).toHaveBeenCalledTimes(1);
  });

  it("issues no session when credentials are present but wrong", async () => {
    privateUserFindOneBy.mockResolvedValue(null);

    await invoke("/login", {
      data: {
        statusPageId: PUBLIC_STATUS_PAGE_ID,
        email: "real-user@example.com",
        password: { _type: "HashedString", value: "wrong-password" },
      },
    });

    expect(privateUserFindOneBy).toHaveBeenCalledTimes(1);
    expect(createSession).not.toHaveBeenCalled();
    expect(setStatusPagePrivateUserCookie).not.toHaveBeenCalled();
  });
});

describe("Status page login-code exchange", () => {
  const statusPageId: ObjectID = new ObjectID(PUBLIC_STATUS_PAGE_ID);
  const projectId: ObjectID = new ObjectID(
    "11111111-1111-4111-8111-111111111111",
  );
  const privateUserId: ObjectID = new ObjectID(
    "22222222-2222-4222-8222-222222222222",
  );
  const sessionId: ObjectID = new ObjectID(
    "33333333-3333-4333-8333-333333333333",
  );
  const validLoginCode: string = "55555555-5555-4555-8555-555555555555";

  const successfulExchange: () => Record<string, unknown> = () => {
    return {
      session: {
        id: sessionId,
        _id: sessionId.toString(),
        projectId,
        statusPageId,
        statusPagePrivateUserId: privateUserId,
      },
      refreshToken: "rotated-refresh-token",
      refreshTokenExpiresAt: new Date("2030-01-01T00:00:00.000Z"),
    };
  };

  const matchingUser: () => Record<string, unknown> = () => {
    return {
      id: privateUserId,
      _id: privateUserId.toString(),
      email: "status-page-user@example.com",
      statusPageId,
      projectId,
    };
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("rejects a missing status page id before looking up the code", async () => {
    const result: InvokeResult = await invoke(
      "/exchange-login-code/:statuspageid",
      { loginCode: validLoginCode },
    );

    expect(result.nextError).toBeInstanceOf(BadDataException);
    expect(exchangeLoginCode).not.toHaveBeenCalled();
    expect(setStatusPagePrivateUserCookie).not.toHaveBeenCalled();
  });

  it.each(["not-a-uuid", "a".repeat(100)])(
    "rejects a malformed status page id: %p",
    async (statusPageIdParam: string) => {
      const result: InvokeResult = await invoke(
        "/exchange-login-code/:statuspageid",
        { loginCode: validLoginCode },
        { statuspageid: statusPageIdParam },
      );

      expect(result.nextError).toBeInstanceOf(BadDataException);
      expect(exchangeLoginCode).not.toHaveBeenCalled();
      expect(setStatusPagePrivateUserCookie).not.toHaveBeenCalled();
    },
  );

  it.each([undefined, null, "", "   ", 123, "not-a-uuid", "a".repeat(100)])(
    "rejects a missing or malformed login code: %p",
    async (loginCode: unknown) => {
      const result: InvokeResult = await invoke(
        "/exchange-login-code/:statuspageid",
        { loginCode },
        { statuspageid: PUBLIC_STATUS_PAGE_ID },
      );

      expect(result.nextError).toBeInstanceOf(BadDataException);
      expect(exchangeLoginCode).not.toHaveBeenCalled();
      expect(setStatusPagePrivateUserCookie).not.toHaveBeenCalled();
    },
  );

  it("rejects an unknown, expired, or already-consumed code", async () => {
    exchangeLoginCode.mockResolvedValue(null);

    await invoke(
      "/exchange-login-code/:statuspageid",
      { loginCode: validLoginCode },
      { statuspageid: PUBLIC_STATUS_PAGE_ID },
    );

    expect(exchangeLoginCode).toHaveBeenCalledWith(
      validLoginCode,
      expect.objectContaining({ statusPageId }),
    );
    expect(sendErrorResponse).toHaveBeenCalledTimes(1);
    expect(privateUserFindOneById).not.toHaveBeenCalled();
    expect(setStatusPagePrivateUserCookie).not.toHaveBeenCalled();
    expect(sendEntityResponse).not.toHaveBeenCalled();
  });

  it("rejects a consumed code whose user no longer matches its session", async () => {
    exchangeLoginCode.mockResolvedValue(successfulExchange());
    privateUserFindOneById.mockResolvedValue({
      ...matchingUser(),
      statusPageId: new ObjectID("44444444-4444-4444-8444-444444444444"),
    });

    await invoke(
      "/exchange-login-code/:statuspageid",
      { loginCode: validLoginCode },
      { statuspageid: PUBLIC_STATUS_PAGE_ID },
    );

    expect(revokeSessionById).toHaveBeenCalledWith(sessionId, {
      reason: "Login code user no longer matches the session",
    });
    expect(sendErrorResponse).toHaveBeenCalledTimes(1);
    expect(setStatusPagePrivateUserCookie).not.toHaveBeenCalled();
    expect(sendEntityResponse).not.toHaveBeenCalled();
  });

  it("sets rotated HttpOnly credentials and returns only the verified user", async () => {
    const exchange: Record<string, unknown> = successfulExchange();
    const user: Record<string, unknown> = matchingUser();
    exchangeLoginCode.mockResolvedValue(exchange);
    privateUserFindOneById.mockResolvedValue(user);

    await invoke(
      "/exchange-login-code/:statuspageid",
      { loginCode: validLoginCode },
      { statuspageid: PUBLIC_STATUS_PAGE_ID },
    );

    expect(setStatusPagePrivateUserCookie).toHaveBeenCalledTimes(1);
    expect(setStatusPagePrivateUserCookie).toHaveBeenCalledWith(
      expect.objectContaining({
        statusPageId,
        sessionId,
        refreshToken: "rotated-refresh-token",
        user,
      }),
    );
    expect(setStatusPagePrivateUserCookie.mock.calls[0]![0]).not.toHaveProperty(
      "loginCode",
    );
    expect(sendEntityResponse).toHaveBeenCalledTimes(1);
    expect(sendEntityResponse.mock.calls[0]).toHaveLength(4);
    expect(sendErrorResponse).not.toHaveBeenCalled();
  });

  it("allows a login code to produce credentials only once", async () => {
    exchangeLoginCode
      .mockResolvedValueOnce(successfulExchange())
      .mockResolvedValueOnce(null);
    privateUserFindOneById.mockResolvedValue(matchingUser());

    await invoke(
      "/exchange-login-code/:statuspageid",
      { loginCode: validLoginCode },
      { statuspageid: PUBLIC_STATUS_PAGE_ID },
    );
    await invoke(
      "/exchange-login-code/:statuspageid",
      { loginCode: validLoginCode },
      { statuspageid: PUBLIC_STATUS_PAGE_ID },
    );

    expect(exchangeLoginCode).toHaveBeenCalledTimes(2);
    expect(setStatusPagePrivateUserCookie).toHaveBeenCalledTimes(1);
    expect(sendEntityResponse).toHaveBeenCalledTimes(1);
    expect(sendErrorResponse).toHaveBeenCalledTimes(1);
  });

  it("cannot redeem a login code through the ordinary refresh endpoint", async () => {
    const codeSession: Record<string, unknown> = {
      id: sessionId,
      _id: sessionId.toString(),
      statusPageId,
      statusPagePrivateUserId: privateUserId,
    };

    getRefreshTokenFromExpressRequest.mockReturnValue(validLoginCode);
    findActiveSessionByRefreshToken.mockResolvedValue(codeSession);
    isLoginCodeSession.mockReturnValue(true);

    await invoke(
      "/refresh-token/:statuspageid",
      {},
      { statuspageid: PUBLIC_STATUS_PAGE_ID },
    );

    expect(isLoginCodeSession).toHaveBeenCalledWith(codeSession);
    expect(renewSessionWithNewRefreshToken).not.toHaveBeenCalled();
    expect(setStatusPagePrivateUserCookie).not.toHaveBeenCalled();
    expect(removeCookie).toHaveBeenCalledTimes(2);
    expect(sendErrorResponse).toHaveBeenCalledTimes(1);
  });
});

describe("Status page /forgot-password - email must survive deserialization", () => {
  beforeEach(() => {
    jest.clearAllMocks();

    statusPageFindOneById.mockResolvedValue({
      id: new ObjectID(PUBLIC_STATUS_PAGE_ID),
      requireSsoForLogin: false,
      projectId: new ObjectID("project-id"),
    });
  });

  it("rejects a payload with only the public statusPageId", async () => {
    const result: InvokeResult = await invoke("/forgot-password", {
      data: { statusPageId: PUBLIC_STATUS_PAGE_ID },
    });

    expect(privateUserFindOneBy).not.toHaveBeenCalled();
    expect(privateUserUpdateOneBy).not.toHaveBeenCalled();
    expect(result.nextError).toBeInstanceOf(BadDataException);
  });

  it("rejects an empty-string email", async () => {
    const result: InvokeResult = await invoke("/forgot-password", {
      data: { statusPageId: PUBLIC_STATUS_PAGE_ID, email: "" },
    });

    expect(privateUserFindOneBy).not.toHaveBeenCalled();
    expect(privateUserUpdateOneBy).not.toHaveBeenCalled();
    expect(result.nextError).toBeInstanceOf(BadDataException);
  });

  it("queries by both email and statusPageId on the happy path", async () => {
    privateUserFindOneBy.mockResolvedValue(null);

    await invoke("/forgot-password", {
      data: {
        statusPageId: PUBLIC_STATUS_PAGE_ID,
        email: "subscriber@example.com",
      },
    });

    expect(privateUserFindOneBy).toHaveBeenCalledTimes(1);

    const query: Record<string, any> = (
      privateUserFindOneBy.mock.calls[0]![0] as Record<string, any>
    )["query"] as Record<string, any>;

    expect(query["email"].toString()).toBe("subscriber@example.com");
    expect(query["statusPageId"].toString()).toBe(PUBLIC_STATUS_PAGE_ID);
  });
});

describe("Status page /reset-password - token and password must be present", () => {
  beforeEach(() => {
    jest.clearAllMocks();

    statusPageFindOneById.mockResolvedValue({
      id: new ObjectID(PUBLIC_STATUS_PAGE_ID),
      requireSsoForLogin: false,
      projectId: new ObjectID("project-id"),
    });
  });

  it("rejects a payload with only the public statusPageId", async () => {
    const result: InvokeResult = await invoke("/reset-password", {
      data: { statusPageId: PUBLIC_STATUS_PAGE_ID },
    });

    expect(privateUserFindOneBy).not.toHaveBeenCalled();
    expect(privateUserUpdateOneById).not.toHaveBeenCalled();
    expect(result.nextError).toBeInstanceOf(BadDataException);
    expect((result.nextError as unknown as Exception).message).toBe(
      "Reset password token is required.",
    );
  });

  it("rejects a token with no accompanying password", async () => {
    const result: InvokeResult = await invoke("/reset-password", {
      data: {
        statusPageId: PUBLIC_STATUS_PAGE_ID,
        resetPasswordToken: "some-token",
      },
    });

    expect(privateUserFindOneBy).not.toHaveBeenCalled();
    expect(privateUserUpdateOneById).not.toHaveBeenCalled();
    expect(result.nextError).toBeInstanceOf(BadDataException);
    expect((result.nextError as unknown as Exception).message).toBe(
      "Password is required.",
    );
  });

  it("queries by the hashed token scoped to the status page on the happy path", async () => {
    privateUserFindOneBy.mockResolvedValue(null);

    await invoke("/reset-password", {
      data: {
        statusPageId: PUBLIC_STATUS_PAGE_ID,
        resetPasswordToken: "a-real-token",
        password: { _type: "HashedString", value: "new-password" },
      },
    });

    expect(privateUserFindOneBy).toHaveBeenCalledTimes(1);

    const query: Record<string, any> = (
      privateUserFindOneBy.mock.calls[0]![0] as Record<string, any>
    )["query"] as Record<string, any>;

    expect(query["statusPageId"].toString()).toBe(PUBLIC_STATUS_PAGE_ID);
    expect(typeof query["resetPasswordToken"]).toBe("string");
    expect(query["resetPasswordToken"]).not.toBe("a-real-token");
    expect(query["resetPasswordToken"].length).toBeGreaterThan(0);
  });
});
