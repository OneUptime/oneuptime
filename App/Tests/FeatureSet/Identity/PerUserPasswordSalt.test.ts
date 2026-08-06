import {
  buildRequest,
  buildResponse,
  createMockIdentityRouter,
  MockIdentityRouter,
  RouteHandler,
} from "./IdentityRouterTestUtil";
import UserService from "Common/Server/Services/UserService";
import PasswordHash from "Common/Server/Utils/PasswordHash";
import { EncryptionSecret } from "Common/Server/EnvironmentConfig";
import User from "Common/Models/DatabaseModels/User";
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
 * Per-user password salts, exercised through the real /login and
 * /reset-password handlers.
 *
 * What changed and why these tests exist:
 *
 * Login used to hash the submitted password with the one global
 * EncryptionSecret and string-compare the result against the stored column.
 * That made the stored hash a pure function of the password, so two accounts
 * with the same password had identical rows and one rainbow table covered the
 * whole user table.
 *
 * Now the hash depends on a salt that belongs to the row, which means the
 * expected value cannot be computed until the row has been read. Every
 * assertion below is about that inversion holding end to end:
 *
 *   - the right password still logs in, and the wrong one still does not;
 *   - one user's password never opens another user's account, even when both
 *     chose the same password;
 *   - accounts whose hash predates salts still log in, and get upgraded in
 *     place without being logged out or emailed;
 *   - a password set through reset-password reaches the write path unhashed,
 *     so the write path is what salts it.
 *
 * UserService is deliberately NOT mocked wholesale — only the two methods that
 * would touch Postgres are stubbed, so the real verification and upgrade code
 * runs. Everything else the route reaches (mail, sessions, cookies, tokens) is
 * mocked, because none of it is what is under test.
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

jest.mock("Common/Server/Services/EmailVerificationTokenService", () => {
  return {
    __esModule: true,
    default: { findOneBy: jest.fn(), create: jest.fn() },
  };
});

jest.mock("Common/Server/Services/TeamMemberService", () => {
  return { __esModule: true, default: { findOneBy: jest.fn() } };
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

const createSession: jest.Mock = jest.fn();
const revokeAllSessionsByUserId: jest.Mock = jest.fn();

jest.mock("Common/Server/Services/UserSessionService", () => {
  return {
    __esModule: true,
    default: {
      createSession: (...args: Array<unknown>): unknown => {
        return createSession(...args);
      },
      revokeAllSessionsByUserId: (...args: Array<unknown>): unknown => {
        revokeAllSessionsByUserId(...args);
        return Promise.resolve();
      },
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

const sendVerificationEmail: jest.Mock = jest.fn();

jest.mock("../../../FeatureSet/Identity/Utils/AuthenticationEmail", () => {
  return {
    __esModule: true,
    default: {
      sendVerificationEmail: (...args: Array<unknown>): unknown => {
        return sendVerificationEmail(...args);
      },
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
    },
  };
});

// Importing the router registers every handler on the mock router above.
import "../../../FeatureSet/Identity/API/Authentication";

type UpgradeWrite = {
  id: ObjectID;
  data: JSONObject;
  skipUpdateDateColumn?: boolean;
};

let upgradeWrites: Array<UpgradeWrite> = [];
let updateOneByIdCalls: Array<JSONObject> = [];
let findOneByCalls: Array<{ query: JSONObject; select: JSONObject }> = [];

type MockFindOneByFunction = (user: User | null) => void;

const mockFindOneBy: MockFindOneByFunction = (user: User | null): void => {
  jest.spyOn(UserService, "findOneBy").mockImplementation(((input: {
    query: JSONObject;
    select: JSONObject;
  }): Promise<User | null> => {
    findOneByCalls.push(input);
    return Promise.resolve(user);
  }) as never);
};

type InvokeResult = { nextError: Exception | null };

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

type StoredUserFunction = (data: {
  password: string;
  salt: string | null;
  email?: string;
  scheme?: "scrypt" | "salted" | "legacy";
}) => Promise<User>;

type StoredHashFunction = (data: {
  password: string;
  salt: string | null;
  scheme?: "scrypt" | "salted" | "legacy";
}) => Promise<string>;

const storedHash: StoredHashFunction = async (data: {
  password: string;
  salt: string | null;
  scheme?: "scrypt" | "salted" | "legacy";
}): Promise<string> => {
  const scheme: string = data.scheme || (data.salt ? "scrypt" : "legacy");

  if (scheme === "scrypt") {
    return await PasswordHash.hash({
      plainValue: data.password,
      salt: data.salt as string,
    });
  }

  return await HashedString.hashValue(
    data.password,
    EncryptionSecret,
    scheme === "salted" ? data.salt : null,
  );
};

/*
 * A user row as it would come back from Postgres.
 *
 * Three schemes are in circulation and all three have to log in:
 *
 *   scheme "scrypt"  what the write path produces today.
 *   scheme "salted"  the interim `SHA256("v2:" + salt + ...)`, from the
 *                    commit that added per-user salts but before scrypt.
 *   scheme "legacy"  bare `SHA256(secret + password)`, from before salts.
 *
 * Defaults to scrypt when a salt is supplied and legacy when it is not.
 */
const storedUser: StoredUserFunction = async (data: {
  password: string;
  salt: string | null;
  email?: string;
  scheme?: "scrypt" | "salted" | "legacy";
}): Promise<User> => {
  const user: User = new User();
  user._id = ObjectID.generate().toString();
  user.email = new Email(data.email || "user@example.com");
  user.isEmailVerified = true;
  user.isMasterAdmin = false;
  user.enableTwoFactorAuth = false;
  user.password = new HashedString(
    await storedHash({
      password: data.password,
      salt: data.salt,
      ...(data.scheme ? { scheme: data.scheme } : {}),
    }),
    true,
  );

  if (data.salt) {
    user.passwordSalt = data.salt;
  }

  return user;
};

type LoginFunction = (data: {
  email: string;
  password: string;
}) => Promise<InvokeResult>;

const login: LoginFunction = (data: {
  email: string;
  password: string;
}): Promise<InvokeResult> => {
  return invoke("/login", {
    data: {
      email: data.email,
      password: { _type: "HashedString", value: data.password },
    },
  });
};

type LoginSucceededFunction = () => boolean;

const loginSucceeded: LoginSucceededFunction = (): boolean => {
  return (
    sendEntityResponse.mock.calls.length > 0 &&
    sendErrorResponse.mock.calls.length === 0
  );
};

beforeEach(() => {
  jest.clearAllMocks();
  upgradeWrites = [];
  updateOneByIdCalls = [];
  findOneByCalls = [];

  createSession.mockResolvedValue({
    session: { id: ObjectID.generate() },
    refreshToken: "refresh-token",
    refreshTokenExpiresAt: new Date(),
  } as never);

  jest
    .spyOn(
      UserService as unknown as {
        updateColumnsByIdWithoutHooks: (input: UpgradeWrite) => Promise<void>;
      },
      "updateColumnsByIdWithoutHooks",
    )
    .mockImplementation(((input: UpgradeWrite): Promise<void> => {
      upgradeWrites.push(input);
      return Promise.resolve();
    }) as never);

  jest.spyOn(UserService, "updateOneById").mockImplementation(((input: {
    data: JSONObject;
  }): Promise<number> => {
    updateOneByIdCalls.push(input.data);
    return Promise.resolve(1);
  }) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("POST /login — verifying against a per-user salt", () => {
  it("logs in with the correct password", async () => {
    const salt: string = PasswordHash.generateSalt();
    const user: User = await storedUser({ password: "correct", salt });

    mockFindOneBy(user);

    await login({ email: "user@example.com", password: "correct" });

    expect(loginSucceeded()).toBe(true);
  });

  it("rejects the wrong password", async () => {
    const salt: string = PasswordHash.generateSalt();
    const user: User = await storedUser({ password: "correct", salt });

    mockFindOneBy(user);

    await login({ email: "user@example.com", password: "wrong" });

    expect(sendEntityResponse).not.toHaveBeenCalled();
    expect(sendErrorResponse).toHaveBeenCalled();
    expect((sendErrorResponse.mock.calls[0]![2] as Exception).message).toBe(
      "Invalid login: Email or password does not match.",
    );
  });

  it("selects the salt column — without it the salted hash cannot be recomputed", async () => {
    const salt: string = PasswordHash.generateSalt();
    const user: User = await storedUser({ password: "correct", salt });

    mockFindOneBy(user);

    await login({ email: "user@example.com", password: "correct" });

    const select: JSONObject = findOneByCalls[0]!.select;

    expect(select["password"]).toBe(true);
    expect(select["passwordSalt"]).toBe(true);
  });

  it("no longer sends the password as a query predicate", async () => {
    const salt: string = PasswordHash.generateSalt();
    const user: User = await storedUser({ password: "correct", salt });

    mockFindOneBy(user);

    await login({ email: "user@example.com", password: "correct" });

    const query: JSONObject = findOneByCalls[0]!.query;

    expect(Object.keys(query)).toEqual(["email"]);
  });

  it("does not echo the password hash or the salt back in the response", async () => {
    const salt: string = PasswordHash.generateSalt();
    const user: User = await storedUser({ password: "correct", salt });

    mockFindOneBy(user);

    await login({ email: "user@example.com", password: "correct" });

    const returned: User = sendEntityResponse.mock.calls[0]![2] as User;

    expect(returned.password).toBeUndefined();
    expect(returned.passwordSalt).toBeUndefined();
  });

  it("does not accept another user's password even when both users chose the same one", async () => {
    /*
     * The headline property. Alice and Bob both use "shared-password". Under
     * the old scheme their stored hashes were byte-identical. Bob's salt must
     * make Alice's stored hash meaningless against his row.
     */
    const alice: User = await storedUser({
      password: "shared-password",
      salt: PasswordHash.generateSalt(),
      email: "alice@example.com",
    });
    const bob: User = await storedUser({
      password: "shared-password",
      salt: PasswordHash.generateSalt(),
      email: "bob@example.com",
    });

    expect(alice.password!.toString()).not.toBe(bob.password!.toString());

    // Bob logs in with the shared password — his own salt, so it works.
    mockFindOneBy(bob);
    await login({ email: "bob@example.com", password: "shared-password" });
    expect(loginSucceeded()).toBe(true);

    // Alice's stored digest, replayed as a password, is not her password.
    jest.clearAllMocks();
    findOneByCalls = [];
    mockFindOneBy(alice);
    await login({
      email: "alice@example.com",
      password: alice.password!.toString(),
    });
    expect(sendEntityResponse).not.toHaveBeenCalled();
    expect(sendErrorResponse).toHaveBeenCalled();
  });

  it("rejects a login for a user who has no password set", async () => {
    const user: User = new User();
    user._id = ObjectID.generate().toString();
    user.email = new Email("invited@example.com");
    user.isEmailVerified = true;

    mockFindOneBy(user);

    await login({ email: "invited@example.com", password: "anything" });

    expect(sendEntityResponse).not.toHaveBeenCalled();
    expect(sendErrorResponse).toHaveBeenCalled();
  });

  it("rejects an unknown email without inventing a session", async () => {
    mockFindOneBy(null);

    await login({ email: "nobody@example.com", password: "anything" });

    expect(sendEntityResponse).not.toHaveBeenCalled();
    expect(createSession).not.toHaveBeenCalled();
  });

  it("still refuses an unverified email before looking at the password", async () => {
    const salt: string = PasswordHash.generateSalt();
    const user: User = await storedUser({ password: "correct", salt });
    user.isEmailVerified = false;

    mockFindOneBy(user);

    await login({ email: "user@example.com", password: "correct" });

    expect(sendVerificationEmail).toHaveBeenCalled();
    expect(createSession).not.toHaveBeenCalled();
  });
});

describe("POST /login — accounts whose hash predates per-user salts", () => {
  it("still logs in", async () => {
    const user: User = await storedUser({
      password: "old-password",
      salt: null,
    });

    mockFindOneBy(user);

    await login({ email: "user@example.com", password: "old-password" });

    expect(loginSucceeded()).toBe(true);
  });

  it("is re-hashed with a fresh salt on the way through", async () => {
    const user: User = await storedUser({
      password: "old-password",
      salt: null,
    });

    mockFindOneBy(user);

    await login({ email: "user@example.com", password: "old-password" });

    expect(upgradeWrites).toHaveLength(1);

    const write: UpgradeWrite = upgradeWrites[0]!;

    expect(write.data["passwordSalt"]).toMatch(/^[0-9a-f]{64}$/);

    await expect(
      PasswordHash.verify({
        plainValue: "old-password",
        storedValue: write.data["password"] as string,
        salt: write.data["passwordSalt"] as string,
      }),
    ).resolves.toBe(true);
  });

  it("is not logged out and not emailed about a change they did not make", async () => {
    const user: User = await storedUser({
      password: "old-password",
      salt: null,
    });

    mockFindOneBy(user);

    await login({ email: "user@example.com", password: "old-password" });

    expect(revokeAllSessionsByUserId).not.toHaveBeenCalled();
    expect(sendMail).not.toHaveBeenCalled();
    expect(updateOneByIdCalls).toHaveLength(0);
  });

  it("upgrades at most once per login, not once per comparison", async () => {
    /*
     * The handler checks the password twice (an early gate and a final gate).
     * Verifying twice would issue the upgrade write twice.
     */
    const user: User = await storedUser({
      password: "old-password",
      salt: null,
    });

    mockFindOneBy(user);

    await login({ email: "user@example.com", password: "old-password" });

    expect(upgradeWrites).toHaveLength(1);
  });

  it("does not upgrade anything when the password is wrong", async () => {
    const user: User = await storedUser({
      password: "old-password",
      salt: null,
    });

    mockFindOneBy(user);

    await login({ email: "user@example.com", password: "guessed" });

    expect(upgradeWrites).toHaveLength(0);
    expect(sendErrorResponse).toHaveBeenCalled();
  });

  it("logs the user in even if the upgrade write fails", async () => {
    jest
      .spyOn(
        UserService as unknown as {
          updateColumnsByIdWithoutHooks: () => Promise<void>;
        },
        "updateColumnsByIdWithoutHooks",
      )
      .mockImplementation((): Promise<void> => {
        return Promise.reject(new Error("write failed"));
      });

    const user: User = await storedUser({
      password: "old-password",
      salt: null,
    });

    mockFindOneBy(user);

    await login({ email: "user@example.com", password: "old-password" });

    expect(loginSucceeded()).toBe(true);
  });

  it("what the upgrade writes is a scrypt hash, not another fast digest", async () => {
    const user: User = await storedUser({
      password: "old-password",
      salt: null,
    });

    mockFindOneBy(user);

    await login({ email: "user@example.com", password: "old-password" });

    expect(upgradeWrites[0]!.data["password"]).toMatch(/^scrypt\$/);
    expect(
      PasswordHash.needsUpgrade(upgradeWrites[0]!.data["password"] as string),
    ).toBe(false);
  });

  it("an account on the interim salted-SHA scheme logs in and is upgraded to scrypt", async () => {
    /*
     * These rows HAVE a salt, so an upgrade rule keyed on "no salt" would
     * skip them and leave them on a fast hash forever.
     */
    const salt: string = PasswordHash.generateSalt();
    const user: User = await storedUser({
      password: "interim-password",
      salt: salt,
      scheme: "salted",
    });

    mockFindOneBy(user);

    await login({ email: "user@example.com", password: "interim-password" });

    expect(loginSucceeded()).toBe(true);
    expect(upgradeWrites).toHaveLength(1);
    expect(upgradeWrites[0]!.data["password"]).toMatch(/^scrypt\$/);
    expect(upgradeWrites[0]!.data["passwordSalt"]).not.toBe(salt);
  });

  it("a wrong password against an interim salted-SHA row is rejected and upgrades nothing", async () => {
    const user: User = await storedUser({
      password: "interim-password",
      salt: PasswordHash.generateSalt(),
      scheme: "salted",
    });

    mockFindOneBy(user);

    await login({ email: "user@example.com", password: "guess" });

    expect(sendErrorResponse).toHaveBeenCalled();
    expect(upgradeWrites).toHaveLength(0);
  });

  it("an already-salted account is never re-salted on login", async () => {
    const salt: string = PasswordHash.generateSalt();
    const user: User = await storedUser({ password: "correct", salt });

    mockFindOneBy(user);

    await login({ email: "user@example.com", password: "correct" });

    expect(loginSucceeded()).toBe(true);
    expect(upgradeWrites).toHaveLength(0);
    expect(updateOneByIdCalls).toHaveLength(0);
  });
});

describe("POST /reset-password — the new password reaches the write path unhashed", () => {
  type ResetFunction = (password: string) => Promise<InvokeResult>;

  const reset: ResetFunction = (password: string): Promise<InvokeResult> => {
    return invoke("/reset-password", {
      data: {
        resetPasswordToken: "a-reset-token",
        password: { _type: "HashedString", value: password },
      },
    });
  };

  it("hands the update a HashedString that has not been hashed yet", async () => {
    /*
     * This is what makes the reset salted: the handler must NOT pre-hash. The
     * write path is the only thing that mints a salt, and it only does so for
     * a value it hashes itself.
     */
    const user: User = await storedUser({
      password: "old-password",
      salt: PasswordHash.generateSalt(),
    });
    user.resetPasswordExpires = new Date(Date.now() + 60 * 60 * 1000);

    mockFindOneBy(user);

    await reset("brand-new-password");

    expect(updateOneByIdCalls).toHaveLength(1);

    const written: unknown = updateOneByIdCalls[0]!["password"];

    expect(written).toBeInstanceOf(HashedString);
    expect((written as HashedString).isValueHashed()).toBe(false);
    expect((written as HashedString).toString()).toBe("brand-new-password");
  });

  it("clears the reset token in the same write", async () => {
    const user: User = await storedUser({
      password: "old-password",
      salt: PasswordHash.generateSalt(),
    });
    user.resetPasswordExpires = new Date(Date.now() + 60 * 60 * 1000);

    mockFindOneBy(user);

    await reset("brand-new-password");

    expect(updateOneByIdCalls[0]!["resetPasswordToken"]).toBeNull();
  });

  it("still looks the user up by the hashed reset token, which stays unsalted", async () => {
    /*
     * A reset token IS searchable by hash: it is a high-entropy server-issued
     * value, so it has nothing to gain from a salt and everything to lose
     * (it would no longer be a lookup key).
     */
    const user: User = await storedUser({
      password: "old-password",
      salt: PasswordHash.generateSalt(),
    });
    user.resetPasswordExpires = new Date(Date.now() + 60 * 60 * 1000);

    mockFindOneBy(user);

    await reset("brand-new-password");

    const query: JSONObject = findOneByCalls[0]!.query;

    expect(query["resetPasswordToken"]).toBe(
      await HashedString.hashValue("a-reset-token", EncryptionSecret),
    );
  });

  it("revokes sessions and mails the user, because this one IS a real change", async () => {
    const user: User = await storedUser({
      password: "old-password",
      salt: PasswordHash.generateSalt(),
    });
    user.resetPasswordExpires = new Date(Date.now() + 60 * 60 * 1000);

    mockFindOneBy(user);

    await reset("brand-new-password");

    expect(revokeAllSessionsByUserId).toHaveBeenCalled();
    expect(sendMail).toHaveBeenCalled();
  });

  it("writes nothing when the reset link has expired", async () => {
    const user: User = await storedUser({
      password: "old-password",
      salt: PasswordHash.generateSalt(),
    });
    user.resetPasswordExpires = new Date(Date.now() - 60 * 60 * 1000);

    mockFindOneBy(user);

    await reset("brand-new-password");

    expect(updateOneByIdCalls).toHaveLength(0);
    expect(sendErrorResponse).toHaveBeenCalled();
  });
});
