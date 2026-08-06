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
import { beforeEach, describe, expect, it } from "@jest/globals";

const mockRouter: MockIdentityRouter = createMockIdentityRouter();

/*
 * ---------------------------------------------------------------------------------------------
 * Regression tests for the unauthenticated-identity auth bypasses.
 *
 * The bug class, end to end:
 *
 *   1. `BaseModel.fromJSON(undefined, T)` does not throw. It routes into
 *      `JSONFunctions.deserialize(undefined)`, and `for...in` over `undefined` is a spec no-op,
 *      so it returns `{}` -- a bare model with every field `undefined`.
 *   2. `QueryUtil.serializeQuery` has no `undefined` handling. Every branch is guarded by
 *      `query[key] && ...` with no catch-all else, so the `undefined` survives untouched.
 *   3. TypeORM 0.3.30 defaults `invalidWhereValuesBehavior.undefined` to "ignore", which SILENTLY
 *      DROPS the predicate instead of matching nothing.
 *   4. `_findBy` defaults to `createdAt: Descending` with limit 1.
 *
 * Net effect: `findOneBy({ token: undefined })` returns the NEWEST row in the table.
 *
 * These tests deliberately do NOT mock BaseModel, JSONFunctions or CredentialGuard -- the real
 * deserialization path has to run, otherwise the test proves nothing about the real bug.
 *
 * The load-bearing assertion in every attack case is that the *service was never called*. An
 * error response alone is not enough: the fix has to stop the dangerous query from ever running.
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

const findOneByEmailVerificationToken: jest.Mock = jest.fn();
const createEmailVerificationToken: jest.Mock = jest.fn();

jest.mock("Common/Server/Services/EmailVerificationTokenService", () => {
  return {
    __esModule: true,
    default: {
      findOneBy: (...args: Array<unknown>): unknown => {
        return findOneByEmailVerificationToken(...args);
      },
      create: (...args: Array<unknown>): unknown => {
        return createEmailVerificationToken(...args);
      },
    },
  };
});

const userFindOneBy: jest.Mock = jest.fn();
const userUpdateOneBy: jest.Mock = jest.fn();
const userUpdateOneById: jest.Mock = jest.fn();
const userUpdateOneByIdAndFetch: jest.Mock = jest.fn();
const userCreate: jest.Mock = jest.fn();
const userCreateUserOnSignup: jest.Mock = jest.fn();
const userCountBy: jest.Mock = jest.fn();

jest.mock("Common/Server/Services/UserService", () => {
  return {
    __esModule: true,
    default: {
      findOneBy: (...args: Array<unknown>): unknown => {
        return userFindOneBy(...args);
      },
      updateOneBy: (...args: Array<unknown>): unknown => {
        return userUpdateOneBy(...args);
      },
      updateOneById: (...args: Array<unknown>): unknown => {
        return userUpdateOneById(...args);
      },
      updateOneByIdAndFetch: (...args: Array<unknown>): unknown => {
        return userUpdateOneByIdAndFetch(...args);
      },
      create: (...args: Array<unknown>): unknown => {
        return userCreate(...args);
      },
      createUserOnSignup: (...args: Array<unknown>): unknown => {
        return userCreateUserOnSignup(...args);
      },
      countBy: (...args: Array<unknown>): unknown => {
        return userCountBy(...args);
      },
    },
  };
});

jest.mock("Common/Server/Services/TeamMemberService", () => {
  return {
    __esModule: true,
    default: { findOneBy: jest.fn() },
  };
});

jest.mock("Common/Server/Services/AccessTokenService", () => {
  return {
    __esModule: true,
    default: { refreshUserAllPermissions: jest.fn() },
  };
});

jest.mock("Common/Server/Services/UserTotpAuthService", () => {
  return {
    __esModule: true,
    default: {
      findBy: (): Array<unknown> => {
        return [];
      },
      findOneBy: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Services/UserWebAuthnService", () => {
  return {
    __esModule: true,
    default: {
      findBy: (): Array<unknown> => {
        return [];
      },
      verifyAuthentication: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Services/UserSessionService", () => {
  return {
    __esModule: true,
    default: {
      createSession: jest.fn(),
      findActiveSessionByRefreshToken: jest.fn(),
      revokeSessionById: jest.fn(),
      revokeSessionByRefreshToken: jest.fn(),
      renewSessionWithNewRefreshToken: jest.fn(),
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
      shouldDisableSignup: (): Promise<boolean> => {
        return Promise.resolve(false);
      },
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

jest.mock("Common/Server/Utils/Cookie", () => {
  return {
    __esModule: true,
    default: {
      setUserCookie: jest.fn(),
      removeAllCookies: jest.fn(),
      removeCookie: jest.fn(),
      getRefreshTokenFromExpressRequest: jest.fn(),
      getUserTokenKey: jest.fn(),
      getRefreshTokenKey: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Utils/Captcha", () => {
  return {
    __esModule: true,
    default: {
      verifyCaptcha: (): Promise<void> => {
        return Promise.resolve();
      },
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
      signUserLoginToken: (): string => {
        return "signed-user-token";
      },
    },
  };
});

jest.mock("../../../FeatureSet/Identity/Utils/AuthenticationEmail", () => {
  return {
    __esModule: true,
    default: { sendVerificationEmail: jest.fn() },
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
    },
  };
});

// Importing the router registers every handler on the mock router above.
import "../../../FeatureSet/Identity/API/Authentication";

type InvokeResult = {
  nextError: Exception | null;
};

type InvokeFunction = (uri: string, body: unknown) => Promise<InvokeResult>;

const invoke: InvokeFunction = async (
  uri: string,
  body: unknown,
): Promise<InvokeResult> => {
  const handler: RouteHandler = mockRouter.match("post", uri);
  const req: ExpressRequest = buildRequest(body);
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

describe("Identity /verify-email - email verification bypass", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  /*
   * Attack: sign up with an address you do not control, then immediately POST an empty body.
   * The dropped `token` predicate matched the newest EmailVerificationToken in the WHOLE
   * INSTANCE -- in practice your own, since you just created it -- and the handler then marked
   * the address on that token verified.
   */
  it("rejects an empty body without ever querying for a token", async () => {
    const result: InvokeResult = await invoke("/verify-email", {});

    expect(findOneByEmailVerificationToken).not.toHaveBeenCalled();
    expect(userUpdateOneBy).not.toHaveBeenCalled();
    expect(result.nextError).toBeInstanceOf(BadDataException);
    expect((result.nextError as unknown as Exception).message).toBe(
      "Verification token is required.",
    );
  });

  it("rejects a body with no data key at all", async () => {
    const result: InvokeResult = await invoke("/verify-email", {});

    expect(findOneByEmailVerificationToken).not.toHaveBeenCalled();
    expect(result.nextError).toBeInstanceOf(BadDataException);
  });

  it("rejects data: undefined, the case BaseModel.fromJSON silently accepts", async () => {
    const result: InvokeResult = await invoke("/verify-email", {
      data: undefined,
    });

    expect(findOneByEmailVerificationToken).not.toHaveBeenCalled();
    expect(result.nextError).toBeInstanceOf(BadDataException);
  });

  it("rejects data: {} - an explicitly empty payload", async () => {
    const result: InvokeResult = await invoke("/verify-email", { data: {} });

    expect(findOneByEmailVerificationToken).not.toHaveBeenCalled();
    expect(result.nextError).toBeInstanceOf(BadDataException);
  });

  it("rejects a payload carrying only a non-secret field", async () => {
    /*
     * `email` is not a secret and is not the lookup key. Supplying it must not buy the caller a
     * query, because the `token` predicate would still be dropped.
     */
    const result: InvokeResult = await invoke("/verify-email", {
      data: { email: "attacker@example.com" },
    });

    expect(findOneByEmailVerificationToken).not.toHaveBeenCalled();
    expect(result.nextError).toBeInstanceOf(BadDataException);
  });

  it("rejects an explicitly null token", async () => {
    const result: InvokeResult = await invoke("/verify-email", {
      data: { token: null },
    });

    expect(findOneByEmailVerificationToken).not.toHaveBeenCalled();
    expect(result.nextError).toBeInstanceOf(BadDataException);
  });

  it("rejects an empty-string token", async () => {
    const result: InvokeResult = await invoke("/verify-email", {
      data: { token: "" },
    });

    expect(findOneByEmailVerificationToken).not.toHaveBeenCalled();
    expect(result.nextError).toBeInstanceOf(BadDataException);
  });

  it("still queries with the real predicate on the happy path", async () => {
    const token: string = ObjectID.generate().toString();

    findOneByEmailVerificationToken.mockResolvedValue(null);

    await invoke("/verify-email", { data: { token: token } });

    expect(findOneByEmailVerificationToken).toHaveBeenCalledTimes(1);

    const call: Record<string, any> = findOneByEmailVerificationToken.mock
      .calls[0]![0] as Record<string, any>;

    // The predicate must be the caller's token -- present, and not undefined.
    expect(call["query"].token).toBeDefined();
    expect(call["query"].token.toString()).toBe(token);
  });

  it("reports an unknown-but-present token as an invalid link, not a bypass", async () => {
    findOneByEmailVerificationToken.mockResolvedValue(null);

    await invoke("/verify-email", {
      data: { token: ObjectID.generate().toString() },
    });

    expect(findOneByEmailVerificationToken).toHaveBeenCalledTimes(1);
    expect(sendErrorResponse).toHaveBeenCalled();
    expect(userUpdateOneBy).not.toHaveBeenCalled();
  });
});

describe("Identity /signup - passwordless-account takeover via dropped email predicate", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  /*
   * With the email predicate dropped, `alreadySavedUser` resolved to the newest user in the
   * instance. A user invited to a team but not yet signed up has no password, which sent the
   * handler down the update branch and then into finalizeUserLogin -- a real session for an
   * account the caller never authenticated as.
   */
  it("rejects an empty body without ever looking a user up", async () => {
    const result: InvokeResult = await invoke("/signup", { data: {} });

    expect(userFindOneBy).not.toHaveBeenCalled();
    expect(userUpdateOneByIdAndFetch).not.toHaveBeenCalled();
    expect(userCreate).not.toHaveBeenCalled();
    expect(userCreateUserOnSignup).not.toHaveBeenCalled();
    expect(result.nextError).toBeInstanceOf(BadDataException);
    expect((result.nextError as unknown as Exception).message).toBe(
      "Email is required.",
    );
  });

  it("rejects a payload carrying only a password", async () => {
    const result: InvokeResult = await invoke("/signup", {
      data: { password: "attacker-chosen" },
    });

    expect(userFindOneBy).not.toHaveBeenCalled();
    expect(userUpdateOneByIdAndFetch).not.toHaveBeenCalled();
    expect(result.nextError).toBeInstanceOf(BadDataException);
  });

  it("rejects an empty-string email", async () => {
    const result: InvokeResult = await invoke("/signup", {
      data: { email: "", password: "attacker-chosen" },
    });

    expect(userFindOneBy).not.toHaveBeenCalled();
    expect(result.nextError).toBeInstanceOf(BadDataException);
  });

  it("still looks the user up by the supplied email on the happy path", async () => {
    userFindOneBy.mockResolvedValue(null);
    /*
     * The first-Master-Admin election (and the create that goes with it) now
     * happens inside UserService, under an advisory lock -- see
     * SignupMasterAdminElection.test.ts and GHSA-3qqq-hprx-g2jw.
     */
    userCreateUserOnSignup.mockResolvedValue(null);

    await invoke("/signup", {
      data: { email: "new-user@example.com", password: "hunter2" },
    });

    expect(userFindOneBy).toHaveBeenCalledTimes(1);

    const call: Record<string, any> = userFindOneBy.mock.calls[0]![0] as Record<
      string,
      any
    >;

    expect(call["query"].email).toBeDefined();
    expect(call["query"].email.toString()).toBe("new-user@example.com");
  });
});

describe("Identity /forgot-password - reset token written to an arbitrary account", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  /*
   * A dropped email predicate selected the newest user in the instance and wrote a fresh
   * resetPasswordToken onto that account, invalidating any legitimate one in flight. The mail
   * itself went to the attacker-supplied `user.email`, so this was account disruption rather
   * than takeover -- but the account picked was still not the caller's to touch.
   */
  it("rejects an empty body without ever querying or writing a reset token", async () => {
    const result: InvokeResult = await invoke("/forgot-password", { data: {} });

    expect(userFindOneBy).not.toHaveBeenCalled();
    expect(userUpdateOneBy).not.toHaveBeenCalled();
    expect(result.nextError).toBeInstanceOf(BadDataException);
    expect((result.nextError as unknown as Exception).message).toBe(
      "Email is required.",
    );
  });

  it("rejects a null email", async () => {
    const result: InvokeResult = await invoke("/forgot-password", {
      data: { email: null },
    });

    expect(userFindOneBy).not.toHaveBeenCalled();
    expect(userUpdateOneBy).not.toHaveBeenCalled();
    expect(result.nextError).toBeInstanceOf(BadDataException);
  });

  it("still queries by the supplied email on the happy path", async () => {
    userFindOneBy.mockResolvedValue(null);

    await invoke("/forgot-password", {
      data: { email: "known-user@example.com" },
    });

    expect(userFindOneBy).toHaveBeenCalledTimes(1);

    const call: Record<string, any> = userFindOneBy.mock.calls[0]![0] as Record<
      string,
      any
    >;

    expect(call["query"].email.toString()).toBe("known-user@example.com");
  });
});

describe("Identity /reset-password - password must be present", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("rejects an empty body without querying", async () => {
    const result: InvokeResult = await invoke("/reset-password", { data: {} });

    expect(userFindOneBy).not.toHaveBeenCalled();
    expect(userUpdateOneById).not.toHaveBeenCalled();
    expect(result.nextError).toBeInstanceOf(BadDataException);
    expect((result.nextError as unknown as Exception).message).toBe(
      "Reset password token is required.",
    );
  });

  it("rejects a token with no accompanying password, which would blank the password", async () => {
    const result: InvokeResult = await invoke("/reset-password", {
      data: { resetPasswordToken: "some-token" },
    });

    expect(userFindOneBy).not.toHaveBeenCalled();
    expect(userUpdateOneById).not.toHaveBeenCalled();
    expect(result.nextError).toBeInstanceOf(BadDataException);
    expect((result.nextError as unknown as Exception).message).toBe(
      "Password is required.",
    );
  });

  it("rejects an empty-string password", async () => {
    const result: InvokeResult = await invoke("/reset-password", {
      data: { resetPasswordToken: "some-token", password: "" },
    });

    expect(userFindOneBy).not.toHaveBeenCalled();
    expect(result.nextError).toBeInstanceOf(BadDataException);
  });

  it("rejects a typed-but-empty HashedString password", async () => {
    /*
     * HashedString.hashValue() short-circuits on an empty value and returns "" WITHOUT hashing,
     * so this payload would otherwise reach the update as a literal empty password.
     */
    const result: InvokeResult = await invoke("/reset-password", {
      data: {
        resetPasswordToken: "some-token",
        password: { _type: "HashedString", value: "" },
      },
    });

    expect(userFindOneBy).not.toHaveBeenCalled();
    expect(userUpdateOneById).not.toHaveBeenCalled();
    expect(result.nextError).toBeInstanceOf(BadDataException);
  });

  it("still queries by the hashed token on the happy path", async () => {
    userFindOneBy.mockResolvedValue(null);

    /*
     * A real client serializes a password as a typed HashedString -- that is the form
     * JSONFunctions.deserialize revives into an instance with hashValue() on it.
     */
    await invoke("/reset-password", {
      data: {
        resetPasswordToken: "a-real-token",
        password: { _type: "HashedString", value: "new-password" },
      },
    });

    expect(userFindOneBy).toHaveBeenCalledTimes(1);

    const call: Record<string, any> = userFindOneBy.mock.calls[0]![0] as Record<
      string,
      any
    >;

    // The stored token is a hash, so the predicate must be a non-empty hash of the input.
    expect(typeof call["query"].resetPasswordToken).toBe("string");
    expect(call["query"].resetPasswordToken.length).toBeGreaterThan(0);
    expect(call["query"].resetPasswordToken).not.toBe("a-real-token");
  });
});
