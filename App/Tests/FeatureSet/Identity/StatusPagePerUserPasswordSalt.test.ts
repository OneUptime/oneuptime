import {
  buildRequest,
  buildResponse,
  createMockIdentityRouter,
  MockIdentityRouter,
  RouteHandler,
} from "./IdentityRouterTestUtil";
import StatusPagePrivateUserService from "Common/Server/Services/StatusPagePrivateUserService";
import PasswordHash from "Common/Server/Utils/PasswordHash";
import { EncryptionSecret } from "Common/Server/EnvironmentConfig";
import StatusPagePrivateUser from "Common/Models/DatabaseModels/StatusPagePrivateUser";
import Email from "Common/Types/Email";
import HashedString from "Common/Types/HashedString";
import ObjectID from "Common/Types/ObjectID";
import Exception from "Common/Types/Exception/Exception";
import { JSONObject } from "Common/Types/JSON";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "Common/Server/Utils/Express";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";

const mockRouter: MockIdentityRouter = createMockIdentityRouter();

/*
 * ---------------------------------------------------------------------------
 * Per-user password salts on the status page login.
 *
 * This route changed shape, not just implementation. It used to authenticate
 * by putting the password in the WHERE clause:
 *
 *   findOneBy({ query: { email, password: <hash>, statusPageId } })
 *
 * With a per-user salt there is no hash to put there — it cannot be computed
 * until the row (and therefore the row's salt) has been read. So the account
 * is now located by identity alone and the password is checked afterwards.
 *
 * That rewrite is the risk these tests cover: an authentication check that
 * moves out of the query and into code is exactly the kind of change that
 * accidentally stops happening. The load-bearing assertions are that a wrong
 * password still produces no session, and that the query no longer carries a
 * password predicate.
 * ---------------------------------------------------------------------------
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
      findActiveSessionByRefreshToken: jest.fn(),
      revokeSessionById: jest.fn(),
      revokeSessionByRefreshToken: jest.fn(),
      renewSessionWithNewRefreshToken: jest.fn(),
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

jest.mock("Common/Server/Services/MailService", () => {
  return {
    __esModule: true,
    default: {
      sendMail: (): Promise<void> => {
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

jest.mock("Common/Server/Utils/Cookie", () => {
  return {
    __esModule: true,
    default: {
      setStatusPagePrivateUserCookie: (): string => {
        return "status-page-access-token";
      },
      setUserCookie: jest.fn(),
      removeAllCookies: jest.fn(),
      removeCookie: jest.fn(),
      removeStatusPageMasterPasswordCookie: jest.fn(),
      getCookieFromExpressRequest: jest.fn(),
      getRefreshTokenFromExpressRequest: jest.fn(),
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
const sendEntityResponse: jest.Mock = jest.fn();

jest.mock("Common/Server/Utils/Response", () => {
  return {
    __esModule: true,
    default: {
      sendErrorResponse: (...args: Array<unknown>): unknown => {
        return sendErrorResponse(...args);
      },
      sendEmptySuccessResponse: jest.fn(),
      sendEntityResponse: (...args: Array<unknown>): unknown => {
        return sendEntityResponse(...args);
      },
      sendJsonObjectResponse: jest.fn(),
    },
  };
});

// Importing the router registers every handler on the mock router above.
import "../../../FeatureSet/Identity/API/StatusPageAuthentication";

const STATUS_PAGE_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);

type UpgradeWrite = { id: ObjectID; data: JSONObject };

let upgradeWrites: Array<UpgradeWrite> = [];
let findOneByCalls: Array<{ query: JSONObject; select: JSONObject }> = [];

type MockLookupFunction = (user: StatusPagePrivateUser | null) => void;

const mockLookup: MockLookupFunction = (
  user: StatusPagePrivateUser | null,
): void => {
  jest
    .spyOn(StatusPagePrivateUserService, "findOneBy")
    .mockImplementation(((input: {
      query: JSONObject;
      select: JSONObject;
    }): Promise<StatusPagePrivateUser | null> => {
      findOneByCalls.push(input);
      return Promise.resolve(user);
    }) as never);

  jest
    .spyOn(StatusPagePrivateUserService, "findOneById")
    .mockImplementation(((): Promise<StatusPagePrivateUser | null> => {
      return Promise.resolve(null);
    }) as never);
};

type StoredPrivateUserFunction = (data: {
  password: string;
  salt: string | null;
}) => Promise<StatusPagePrivateUser>;

const storedPrivateUser: StoredPrivateUserFunction = async (data: {
  password: string;
  salt: string | null;
}): Promise<StatusPagePrivateUser> => {
  const user: StatusPagePrivateUser = new StatusPagePrivateUser();
  user._id = ObjectID.generate().toString();
  user.email = new Email("subscriber@example.com");
  user.statusPageId = STATUS_PAGE_ID;
  user.projectId = ObjectID.generate();
  user.password = new HashedString(
    data.salt
      ? await PasswordHash.hash({ plainValue: data.password, salt: data.salt })
      : await HashedString.hashValue(data.password, EncryptionSecret),
    true,
  );

  if (data.salt) {
    user.passwordSalt = data.salt;
  }

  return user;
};

type InvokeResult = { nextError: Exception | null };

type LoginFunction = (password: string) => Promise<InvokeResult>;

const login: LoginFunction = async (
  password: string,
): Promise<InvokeResult> => {
  const handler: RouteHandler = mockRouter.match("post", "/login");
  const req: ExpressRequest = buildRequest({
    data: {
      email: "subscriber@example.com",
      password: { _type: "HashedString", value: password },
      statusPageId: STATUS_PAGE_ID.toString(),
    },
  });
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

beforeEach(() => {
  jest.clearAllMocks();
  upgradeWrites = [];
  findOneByCalls = [];

  statusPageFindOneById.mockResolvedValue({
    id: STATUS_PAGE_ID,
    _id: STATUS_PAGE_ID.toString(),
    requireSsoForLogin: false,
  });

  jest
    .spyOn(
      StatusPagePrivateUserService as unknown as {
        updateColumnsByIdWithoutHooks: (input: UpgradeWrite) => Promise<void>;
      },
      "updateColumnsByIdWithoutHooks",
    )
    .mockImplementation(((input: UpgradeWrite): Promise<void> => {
      upgradeWrites.push(input);
      return Promise.resolve();
    }) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("Status page POST /login — per-user salt", () => {
  it("logs in with the correct password", async () => {
    mockLookup(
      await storedPrivateUser({
        password: "correct",
        salt: PasswordHash.generateSalt(),
      }),
    );

    await login("correct");

    expect(createSession).toHaveBeenCalledTimes(1);
    expect(sendEntityResponse).toHaveBeenCalledTimes(1);
  });

  it("rejects the wrong password without creating a session", async () => {
    mockLookup(
      await storedPrivateUser({
        password: "correct",
        salt: PasswordHash.generateSalt(),
      }),
    );

    const result: InvokeResult = await login("wrong");

    expect(createSession).not.toHaveBeenCalled();
    expect(sendEntityResponse).not.toHaveBeenCalled();
    expect((result.nextError as unknown as Exception).message).toBe(
      "Invalid login: Email or password does not match.",
    );
  });

  it("locates the account by identity only — no password predicate", async () => {
    /*
     * If a password predicate ever comes back, it means someone reintroduced
     * a globally computable hash, which is the thing this change removed.
     */
    mockLookup(
      await storedPrivateUser({
        password: "correct",
        salt: PasswordHash.generateSalt(),
      }),
    );

    await login("correct");

    const query: JSONObject = findOneByCalls[0]!.query;

    expect(Object.keys(query).sort()).toEqual(["email", "statusPageId"]);
    expect(query["password"]).toBeUndefined();
  });

  it("selects the salt alongside the hash", async () => {
    mockLookup(
      await storedPrivateUser({
        password: "correct",
        salt: PasswordHash.generateSalt(),
      }),
    );

    await login("correct");

    const select: JSONObject = findOneByCalls[0]!.select;

    expect(select["password"]).toBe(true);
    expect(select["passwordSalt"]).toBe(true);
  });

  it("reports an unknown account and a wrong password identically", async () => {
    /*
     * Before, both cases were a query that matched nothing. Now they are two
     * different code paths, so they have to be checked to still say the same
     * thing — otherwise the route becomes an account-enumeration oracle.
     */
    mockLookup(null);
    const unknownAccount: InvokeResult = await login("anything");

    jest.clearAllMocks();
    findOneByCalls = [];
    mockLookup(
      await storedPrivateUser({
        password: "correct",
        salt: PasswordHash.generateSalt(),
      }),
    );
    const wrongPassword: InvokeResult = await login("wrong");

    expect((unknownAccount.nextError as unknown as Exception).message).toBe(
      (wrongPassword.nextError as unknown as Exception).message,
    );
  });

  it("does not echo the hash or the salt back in the response", async () => {
    const user: StatusPagePrivateUser = await storedPrivateUser({
      password: "correct",
      salt: PasswordHash.generateSalt(),
    });

    mockLookup(user);

    await login("correct");

    const returned: StatusPagePrivateUser = sendEntityResponse.mock
      .calls[0]![2] as StatusPagePrivateUser;

    expect(returned.password).toBeUndefined();
    expect(returned.passwordSalt).toBeUndefined();
  });

  it("still logs in an account whose hash predates salts, and upgrades it", async () => {
    mockLookup(await storedPrivateUser({ password: "old", salt: null }));

    await login("old");

    expect(createSession).toHaveBeenCalledTimes(1);
    expect(upgradeWrites).toHaveLength(1);

    const write: UpgradeWrite = upgradeWrites[0]!;

    expect(write.data["passwordSalt"]).toMatch(/^[0-9a-f]{64}$/);

    await expect(
      PasswordHash.verify({
        plainValue: "old",
        storedValue: write.data["password"] as string,
        salt: write.data["passwordSalt"] as string,
      }),
    ).resolves.toBe(true);
  });

  it("does not upgrade a legacy account on a failed login", async () => {
    mockLookup(await storedPrivateUser({ password: "old", salt: null }));

    await login("guess");

    expect(upgradeWrites).toHaveLength(0);
    expect(createSession).not.toHaveBeenCalled();
  });

  it("does not re-salt an account that already has a salt", async () => {
    mockLookup(
      await storedPrivateUser({
        password: "correct",
        salt: PasswordHash.generateSalt(),
      }),
    );

    await login("correct");

    expect(upgradeWrites).toHaveLength(0);
  });

  it("still refuses password login on an SSO-only status page", async () => {
    statusPageFindOneById.mockResolvedValue({
      id: STATUS_PAGE_ID,
      _id: STATUS_PAGE_ID.toString(),
      requireSsoForLogin: true,
    });

    mockLookup(
      await storedPrivateUser({
        password: "correct",
        salt: PasswordHash.generateSalt(),
      }),
    );

    const result: InvokeResult = await login("correct");

    expect(createSession).not.toHaveBeenCalled();
    expect(findOneByCalls).toHaveLength(0);
    expect((result.nextError as unknown as Exception).message).toContain(
      "authentication by SSO",
    );
  });
});
