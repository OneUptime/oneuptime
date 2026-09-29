import {
  buildRequest,
  buildResponse,
  createMockIdentityRouter,
  MockIdentityRouter,
  RouteHandler,
} from "./IdentityRouterTestUtil";
import { EncryptionSecret } from "Common/Server/EnvironmentConfig";
import BadDataException from "Common/Types/Exception/BadDataException";
import Exception from "Common/Types/Exception/Exception";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "Common/Server/Utils/Express";
import HashedString from "Common/Types/HashedString";
import ObjectID from "Common/Types/ObjectID";
import { JSONObject } from "Common/Types/JSON";
import { beforeEach, describe, expect, it } from "@jest/globals";

const mockRouter: MockIdentityRouter = createMockIdentityRouter();

/*
 * ---------------------------------------------------------------------------------------------
 * THE ENDPOINT HALF OF "Broken Authentication Leads To Account Takeover".
 *
 * `POST /reset-password` identifies the account to re-password by ONE thing: the SHA-256 of the
 * token in the link. It does not look at the email address on the row, and it cannot -- the reset
 * page has no address to offer it, and asking for one would turn a reset link into a link plus a
 * guess. That design is fine, but it has a consequence: the token column IS the authorization,
 * so anything that should invalidate a link has to remove the token, at the moment it happens.
 *
 * That is why the fix for the reported takeover lives in `UserService.onBeforeUpdate` (covered by
 * Common/Tests/Server/Services/UserEmailChangePasswordResetExpiry.test.ts) rather than here. This
 * file pins down the endpoint behaviour that the fix depends on, and would otherwise be free to
 * drift:
 *
 *  - the row is found by token hash ALONE, so a token left on a row after the account moved to a
 *    new address is a complete, working credential for the account at its new address;
 *  - the raw token is never what is stored, so the fix cannot be "compare the link to the column";
 *  - once the token column is cleared, the very same link is refused and NO password is written.
 *
 * The user store below is a single in-memory row rather than a bag of `mockResolvedValue`s, so
 * the hash comparison in the "the link still works" and "the link no longer works" cases is a
 * real one, computed by the same `HashedString.hashValue` the route uses.
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

/*
 * The single row every mocked UserService method reads and writes. `resetPasswordToken` holds the
 * HASH, exactly as the column does.
 */
type UserRow = {
  id: ObjectID;
  email: string;
  password: string;
  resetPasswordToken: string | null;
  resetPasswordExpires: Date | null;
};

const VICTIM_ID: ObjectID = new ObjectID(
  "99999999-9999-4999-8999-999999999999",
);

const COMPROMISED_EMAIL: string = "victim@compromised-mailbox.example.com";
const RESCUED_EMAIL: string = "victim@rescued-mailbox.example.com";

let row: UserRow;

type RowAsUserFunction = () => Record<string, unknown>;

/* The row in the shape `findOneBy` hands back: a model-ish object with an id. */
const rowAsUser: RowAsUserFunction = (): Record<string, unknown> => {
  return {
    id: row.id,
    _id: row.id.toString(),
    email: {
      toString: (): string => {
        return row.email;
      },
    },
    password: row.password,
    name: undefined,
    isMasterAdmin: false,
    resetPasswordExpires: row.resetPasswordExpires,
    resetPasswordToken: row.resetPasswordToken,
  };
};

const userFindOneBy: jest.Mock = jest.fn();
const userUpdateOneBy: jest.Mock = jest.fn();
const userUpdateOneById: jest.Mock = jest.fn();

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
      updateOneByIdAndFetch: jest.fn(),
      create: jest.fn(),
      createUserOnSignup: jest.fn(),
      countBy: jest.fn(),
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

const revokeAllSessionsByUserId: jest.Mock = jest.fn();

jest.mock("Common/Server/Services/UserSessionService", () => {
  return {
    __esModule: true,
    default: {
      createSession: jest.fn(),
      findActiveSessionByRefreshToken: jest.fn(),
      revokeSessionById: jest.fn(),
      revokeSessionByRefreshToken: jest.fn(),
      renewSessionWithNewRefreshToken: jest.fn(),
      revokeAllSessionsByUserId: (...args: Array<unknown>): unknown => {
        return revokeAllSessionsByUserId(...args);
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
      sendEntityResponse: jest.fn(),
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

type RequestResetLinkFunction = () => Promise<string>;

/*
 * Drive the real `/forgot-password` handler and pull the raw token back out of the link it
 * mailed -- which is all an attacker with access to the mailbox has.
 */
const requestResetLink: RequestResetLinkFunction =
  async (): Promise<string> => {
    sendMail.mockClear();

    await invoke("/forgot-password", { data: { email: row.email } });

    /*
     * `/forgot-password` answers with an empty success of its own, so the
     * response spies are reset here. Every assertion about `sendErrorResponse` /
     * `sendEmptySuccessResponse` in a test below is therefore about the
     * `/reset-password` call it is actually testing.
     */
    sendErrorResponse.mockClear();
    sendEmptySuccessResponse.mockClear();

    const vars: JSONObject = (
      sendMail.mock.calls[0]![0] as unknown as { vars: JSONObject }
    ).vars;

    const tokenVerifyUrl: string = vars["tokenVerifyUrl"] as string;

    return tokenVerifyUrl.split("/reset-password/")[1] as string;
  };

type ErrorMessageFunction = () => string;

const lastErrorMessage: ErrorMessageFunction = (): string => {
  const err: Exception = sendErrorResponse.mock.calls[
    sendErrorResponse.mock.calls.length - 1
  ]![2] as Exception;

  return err.message;
};

describe("Identity password reset — a link must not outlive the address it was mailed to", () => {
  beforeEach(() => {
    jest.clearAllMocks();

    row = {
      id: VICTIM_ID,
      email: COMPROMISED_EMAIL,
      password: "the-old-hashed-password",
      resetPasswordToken: null,
      resetPasswordExpires: null,
    };

    /*
     * A store, not a canned answer: `/forgot-password` looks a user up by email and
     * `/reset-password` looks one up by token hash, and the difference between those two
     * lookups is the whole subject of this file.
     */
    userFindOneBy.mockImplementation(
      (findBy: { query: Record<string, unknown> }): Promise<unknown> => {
        const query: Record<string, unknown> = findBy.query;

        if (query["resetPasswordToken"] !== undefined) {
          if (
            row.resetPasswordToken !== null &&
            row.resetPasswordToken === String(query["resetPasswordToken"])
          ) {
            return Promise.resolve(rowAsUser());
          }

          return Promise.resolve(null);
        }

        if (query["email"] !== undefined) {
          if (String(query["email"]) === row.email) {
            return Promise.resolve(rowAsUser());
          }

          return Promise.resolve(null);
        }

        return Promise.resolve(null);
      },
    );

    const applyPatch: (data: Record<string, unknown>) => Promise<number> = (
      data: Record<string, unknown>,
    ): Promise<number> => {
      if ("resetPasswordToken" in data) {
        row.resetPasswordToken = data["resetPasswordToken"] as string | null;
      }

      if ("resetPasswordExpires" in data) {
        row.resetPasswordExpires = data["resetPasswordExpires"] as Date | null;
      }

      if ("password" in data) {
        row.password = String(data["password"]);
      }

      if ("email" in data) {
        row.email = String(data["email"]);
      }

      return Promise.resolve(1);
    };

    userUpdateOneBy.mockImplementation(
      (updateBy: { data: Record<string, unknown> }): Promise<number> => {
        return applyPatch(updateBy.data);
      },
    );

    userUpdateOneById.mockImplementation(
      (updateBy: { data: Record<string, unknown> }): Promise<number> => {
        return applyPatch(updateBy.data);
      },
    );
  });

  describe("what the token column is worth", () => {
    it("stores only a hash of the token, never the link's own token", async () => {
      /*
       * Load-bearing for the fix's shape. Because the column is a digest, "does this link belong
       * to this address?" cannot be answered at redemption time by comparing strings -- the only
       * way to retire a link is to remove the digest when the thing that invalidated it happens.
       */
      const token: string = await requestResetLink();

      expect(row.resetPasswordToken).not.toBe(token);
      expect(row.resetPasswordToken).toBe(
        await HashedString.hashValue(token, EncryptionSecret),
      );
    });

    it("redeems a link by token hash alone, never by the address it was mailed to", async () => {
      /*
       * The reason a stale token is a complete credential: no part of this query, and no check
       * after it, mentions the account's email. Add one and this test should be revisited --
       * deliberately -- rather than silently made to pass.
       */
      const token: string = await requestResetLink();

      userFindOneBy.mockClear();

      await invoke("/reset-password", {
        data: { resetPasswordToken: token, password: "aVeryG00dPassword!" },
      });

      const query: Record<string, unknown> = (
        userFindOneBy.mock.calls[0]![0] as unknown as {
          query: Record<string, unknown>;
        }
      ).query;

      expect(Object.keys(query)).toEqual(["resetPasswordToken"]);
    });
  });

  describe("the control: an untouched account", () => {
    it("accepts the mailed link and sets the new password", async () => {
      const token: string = await requestResetLink();

      const result: InvokeResult = await invoke("/reset-password", {
        data: { resetPasswordToken: token, password: "aVeryG00dPassword!" },
      });

      expect(result.nextError).toBeNull();
      expect(sendErrorResponse).not.toHaveBeenCalled();
      expect(sendEmptySuccessResponse).toHaveBeenCalledTimes(1);
      expect(row.password).toBe("aVeryG00dPassword!");
    });

    it("spends the link, so it cannot be replayed", async () => {
      const token: string = await requestResetLink();

      await invoke("/reset-password", {
        data: { resetPasswordToken: token, password: "aVeryG00dPassword!" },
      });

      expect(row.resetPasswordToken).toBeNull();

      const replay: InvokeResult = await invoke("/reset-password", {
        data: { resetPasswordToken: token, password: "attackerPassword1!" },
      });

      expect(replay.nextError).toBeNull();
      expect(lastErrorMessage()).toContain("Invalid link");
      expect(row.password).toBe("aVeryG00dPassword!");
    });
  });

  describe("the reported attack, once the account has moved address", () => {
    it("refuses a link minted before the address change", async () => {
      /*
       * The full scenario. The attacker requests the link while they can still read the mailbox
       * and does not spend it; the victim moves the account to an address the attacker cannot
       * read, which -- with the fix in UserService.onBeforeUpdate -- clears the token column;
       * the attacker then spends the link.
       *
       * `resetPasswordToken: null` here is exactly what that hook writes, and
       * Common/Tests/Server/Services/UserEmailChangePasswordResetExpiry.test.ts is what proves
       * the hook writes it. This test is the other half: that a cleared column actually stops
       * the endpoint.
       */
      const attackerToken: string = await requestResetLink();

      row.email = RESCUED_EMAIL;
      row.resetPasswordToken = null;
      row.resetPasswordExpires = null;

      const result: InvokeResult = await invoke("/reset-password", {
        data: {
          resetPasswordToken: attackerToken,
          password: "attackerPassword1!",
        },
      });

      expect(result.nextError).toBeNull();
      expect(lastErrorMessage()).toContain("Invalid link");
    });

    it("writes no password and revokes no sessions when it refuses", async () => {
      /*
       * "Answered with an error" is not enough on its own. The account must come out of the
       * attempt exactly as it went in -- same password, no sessions torn out from under the
       * victim, who is by this point the only person who should be signed in.
       */
      const attackerToken: string = await requestResetLink();

      row.email = RESCUED_EMAIL;
      row.resetPasswordToken = null;
      row.resetPasswordExpires = null;

      userUpdateOneById.mockClear();

      await invoke("/reset-password", {
        data: {
          resetPasswordToken: attackerToken,
          password: "attackerPassword1!",
        },
      });

      expect(userUpdateOneById).not.toHaveBeenCalled();
      expect(revokeAllSessionsByUserId).not.toHaveBeenCalled();
      expect(row.password).toBe("the-old-hashed-password");
    });

    it("the victim can still reset their own password at the new address", async () => {
      /*
       * The fix must not cost the victim the recovery route they were using. A fresh request
       * from the new address mints a new token and that link works.
       */
      await requestResetLink();

      row.email = RESCUED_EMAIL;
      row.resetPasswordToken = null;
      row.resetPasswordExpires = null;

      const freshToken: string = await requestResetLink();

      const result: InvokeResult = await invoke("/reset-password", {
        data: {
          resetPasswordToken: freshToken,
          password: "aVeryG00dPassword!",
        },
      });

      expect(result.nextError).toBeNull();
      expect(sendErrorResponse).not.toHaveBeenCalled();
      expect(row.password).toBe("aVeryG00dPassword!");
    });
  });

  describe("the neighbouring guard", () => {
    it("still refuses a token that is present but expired", async () => {
      const token: string = await requestResetLink();

      row.resetPasswordExpires = new Date(Date.now() - 60 * 1000);

      const result: InvokeResult = await invoke("/reset-password", {
        data: { resetPasswordToken: token, password: "aVeryG00dPassword!" },
      });

      expect(result.nextError).toBeNull();
      expect(lastErrorMessage()).toContain("Expired link");
      expect(row.password).toBe("the-old-hashed-password");
    });

    it("still refuses a reset with no token at all", async () => {
      const result: InvokeResult = await invoke("/reset-password", {
        data: { password: "aVeryG00dPassword!" },
      });

      expect(userFindOneBy).not.toHaveBeenCalled();
      expect(result.nextError).toBeInstanceOf(BadDataException);
    });
  });
});
