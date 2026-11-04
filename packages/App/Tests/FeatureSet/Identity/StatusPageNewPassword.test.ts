import {
  buildRequest,
  buildResponse,
  createMockIdentityRouter,
  MockIdentityRouter,
  RouteHandler,
} from "./IdentityRouterTestUtil";
import FakeCounterRedis from "Common/Tests/Server/TestingUtils/Redis/FakeCounterRedis";
import { EncryptionSecret } from "Common/Server/EnvironmentConfig";
import StatusPagePrivateUserService from "Common/Server/Services/StatusPagePrivateUserService";
import StatusPagePrivateUserSessionService from "Common/Server/Services/StatusPagePrivateUserSessionService";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "Common/Server/Utils/Express";
import StatusPagePrivateUser from "Common/Models/DatabaseModels/StatusPagePrivateUser";
import StatusPagePrivateUserSession from "Common/Models/DatabaseModels/StatusPagePrivateUserSession";
import DatabaseCommonInteractionProps from "Common/Types/BaseDatabase/DatabaseCommonInteractionProps";
import Email from "Common/Types/Email";
import EmailTemplateType from "Common/Types/Email/EmailTemplateType";
import Exception from "Common/Types/Exception/Exception";
import HashedString from "Common/Types/HashedString";
import ObjectID from "Common/Types/ObjectID";
import Permission, { UserPermission } from "Common/Types/Permission";
import { STATUS_PAGE_MAGIC_LINK_INVALID_MESSAGE } from "Common/Types/StatusPage/StatusPageMagicLink";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";

/*
 * ---------------------------------------------------------------------------
 * WHAT A PRIVATE USER'S NEW PASSWORD ENDS, THROUGH THE ROUTES THAT USE IT.
 *
 * A reader of a private status page sets a new password because somebody else
 * may have the old one or may be reading their mail. So afterwards, whoever
 * held what came before it gets nothing from it:
 *
 *   - POST /status-page-api/login-with-magic-link/:id refuses a sign-in link
 *     sent before it, and signs nobody in;
 *   - POST /status-page-api/reset-password refuses a reset link sent before it,
 *     and the password stays what its owner set;
 *   - POST /status-page-api/refresh-token/:id refuses a session signed in before
 *     it, and takes the cookies away;
 *   - POST /status-page-api/exchange-login-code/:id refuses an SSO login code
 *     not yet exchanged.
 *
 * Driven here through the real router, the real services and the real update
 * path - the real permission checks, hooks and hash, over rows held in memory.
 * A route that stopped going through the hooks would leave all of it working,
 * and fail here. Cookies, mail, the responses and the status page are stood in.
 *
 * What the writes do to the rows, each way, is Common's
 * StatusPagePrivateUserNewPassword.test.ts, and against Postgres
 * StatusPagePrivateUserMagicLinkPostgres.test.ts.
 * ---------------------------------------------------------------------------
 */

const mockRouter: MockIdentityRouter = createMockIdentityRouter();

const redisClient: FakeCounterRedis = new FakeCounterRedis();

jest.mock("Common/Server/Infrastructure/Redis", () => {
  return {
    __esModule: true,
    default: {
      getClient: (): unknown => {
        return redisClient;
      },
      isConnected: (): boolean => {
        return true;
      },
    },
  };
});

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
      return "203.0.113.7";
    },
    extractDeviceInfo: (): Record<string, unknown> => {
      return {};
    },
    headerValueToString: (): string => {
      return "Mozilla/5.0";
    },
  };
});

const PROJECT_ID: ObjectID = new ObjectID(
  "57000000-0000-4000-8000-000000000001",
);
const PAGE_ID: ObjectID = new ObjectID("57000000-0000-4000-8000-000000000100");
const READER_ID: ObjectID = new ObjectID(
  "57000000-0000-4000-8000-0000000000aa",
);
const OTHER_READER_ID: ObjectID = new ObjectID(
  "57000000-0000-4000-8000-0000000000bb",
);
const TEAMMATE_ID: ObjectID = new ObjectID(
  "57000000-0000-4000-8000-0000000000cc",
);
const SESSION_ID: string = "57000000-0000-4000-8000-0000000001a1";
const OTHER_SESSION_ID: string = "57000000-0000-4000-8000-0000000001b1";
const LOGIN_CODE_SESSION_ID: string = "57000000-0000-4000-8000-0000000001a2";

const LINK_TOKEN: string = "6f1c7e4a-2b3d-4c5e-8f90-a1b2c3d4e5f6";
const OTHER_LINK_TOKEN: string = "1b2c3d4e-5f6a-4b7c-8d9e-0f1a2b3c4d5e";
const RESET_TOKEN: string = "7a2d8f5b-3c4e-4d6f-9a01-b2c3d4e5f6a7";
const REFRESH_TOKEN: string = "8b3e9a6c-4d5f-4e7a-ab12-c3d4e5f6a7b8";
const OTHER_REFRESH_TOKEN: string = "2c3d4e5f-6a7b-4c8d-9eaf-1a2b3c4d5e6f";
const LOGIN_CODE: string = "9c4fab7d-5e6a-4f8b-bc23-d4e5f6a7b8c9";

const INVALID_RESET_LINK_MESSAGE: string =
  "Invalid link. Please go to forgot password page again and request a new link.";
const SESSION_ENDED_MESSAGE: string = "Session expired. Please login again.";
const LOGIN_CODE_REFUSED_MESSAGE: string = "Login code is invalid or expired.";

jest.mock("Common/Server/Services/StatusPageService", () => {
  return {
    __esModule: true,
    default: {
      findOneById: (data: { id: ObjectID }): Promise<unknown> => {
        return Promise.resolve({
          id: data.id,
          _id: data.id.toString(),
          name: "Acme",
          pageTitle: "Acme Status",
          projectId: PROJECT_ID,
          smtpConfig: { _id: "smtp" },
          isPublicStatusPage: false,
          enableMasterPassword: false,
          masterPassword: undefined,
          requireSsoForLogin: false,
          enableMagicLinkLogin: true,
          isArchived: false,
        });
      },
      getStatusPageURL: (): Promise<string> => {
        return Promise.resolve("https://status.example.com");
      },
    },
  };
});

jest.mock("Common/Server/Services/ProjectSmtpConfigService", () => {
  return {
    __esModule: true,
    default: {
      toEmailServer: (): unknown => {
        return { hostname: "smtp.acme.test" };
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
            return "oneuptime.test";
          },
        });
      },
      getHttpProtocol: (): Promise<unknown> => {
        return Promise.resolve({
          toString: (): string => {
            return "https://";
          },
        });
      },
    },
  };
});

const setStatusPagePrivateUserCookie: jest.Mock = jest.fn();
const removeCookie: jest.Mock = jest.fn();
const refreshTokenInCookie: jest.Mock = jest.fn();

jest.mock("Common/Server/Utils/Cookie", () => {
  return {
    __esModule: true,
    default: {
      setStatusPagePrivateUserCookie: (...args: Array<unknown>): string => {
        setStatusPagePrivateUserCookie(...args);
        return "issued-access-token";
      },
      removeCookie: (...args: Array<unknown>): void => {
        removeCookie(...args);
      },
      removeStatusPageMasterPasswordCookie: jest.fn(),
      getCookieFromExpressRequest: (): undefined => {
        return undefined;
      },
      getRefreshTokenFromExpressRequest: (): unknown => {
        return refreshTokenInCookie();
      },
      getUserTokenKey: (): string => {
        return "user-token";
      },
      getRefreshTokenKey: (): string => {
        return "refresh-token";
      },
      getStatusPageMasterPasswordKey: (): string => {
        return "master-password";
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
      getLogLevel: (): string => {
        return "INFO";
      },
    },
    getLogAttributesFromRequest: (): Record<string, unknown> => {
      return {};
    },
  };
});

const sendEmptySuccessResponse: jest.Mock = jest.fn();
const sendEntityResponse: jest.Mock = jest.fn();
const sendErrorResponse: jest.Mock = jest.fn();

jest.mock("Common/Server/Utils/Response", () => {
  return {
    __esModule: true,
    default: {
      sendErrorResponse: (...args: Array<unknown>): void => {
        sendErrorResponse(...args);
      },
      sendEmptySuccessResponse: (...args: Array<unknown>): void => {
        sendEmptySuccessResponse(...args);
      },
      sendEntityResponse: (...args: Array<unknown>): void => {
        sendEntityResponse(...args);
      },
      sendJsonObjectResponse: jest.fn(),
      setNoCacheHeaders: jest.fn(),
    },
  };
});

// Importing the router registers every handler on the mock router above.
import "../../../FeatureSet/Identity/API/StatusPageAuthentication";

type Row = Record<string, unknown>;

let readers: Array<Row>;
let sessions: Array<Row>;

function hashOf(value: string): Promise<string> {
  return HashedString.hashValue(value, EncryptionSecret);
}

function readerOf(id: ObjectID): Row {
  return readers.find((row: Row): boolean => {
    return row["_id"] === id.toString();
  })!;
}

function sessionOf(id: string): Row {
  return sessions.find((row: Row): boolean => {
    return row["_id"] === id;
  })!;
}

interface Operator {
  type?: string;
  value?: unknown;
  objectLiteralParameters?: Record<string, unknown>;
}

/*
 * Whether a term of a query or a write's predicate holds for a value: a plain
 * value, or a TypeORM FindOperator - recognised by the mark TypeORM gives every
 * one, since Common and this suite may load typeorm from different copies, and
 * `instanceof` would tell them apart.
 */
function holds(term: unknown, value: unknown): boolean {
  const operator: Operator | null =
    term !== null &&
    typeof term === "object" &&
    (term as Record<string, unknown>)["@instanceof"] ===
      Symbol.for("FindOperator")
      ? (term as Operator)
      : null;

  if (!operator) {
    return typeof term === "boolean"
      ? term === value
      : String(term) === String(value);
  }

  if (operator.type === "moreThan") {
    return (
      value instanceof Date &&
      value.getTime() > (operator.value as Date).getTime()
    );
  }

  if (operator.type === "isNull") {
    return value === null || value === undefined;
  }

  if (operator.type === "jsonContains") {
    return Object.entries(operator.value as Row).every(
      ([key, expected]: [string, unknown]): boolean => {
        return (value as Row | null)?.[key] === expected;
      },
    );
  }

  // A person's query, handed on with its _id as an operator holding the ids.
  return Object.values(operator.objectLiteralParameters || {})
    .flat()
    .map(String)
    .includes(String(value));
}

function matches(query: Record<string, unknown>, row: Row): boolean {
  return Object.keys(query).every((column: string): boolean => {
    return holds(query[column], row[column]);
  });
}

function reads<TModel>(
  rows: () => Array<Row>,
  model: new () => TModel,
): (findBy: unknown) => Promise<Array<TModel>> {
  return async (findBy: unknown): Promise<Array<TModel>> => {
    const options: {
      query: Record<string, unknown>;
      select: Record<string, unknown>;
    } = findBy as {
      query: Record<string, unknown>;
      select: Record<string, unknown>;
    };

    return rows()
      .filter((row: Row): boolean => {
        return matches(options.query, row);
      })
      .map((row: Row): TModel => {
        const item: TModel = new model();

        for (const column of Object.keys(options.select)) {
          if (options.select[column] && row[column] !== undefined) {
            (item as unknown as Record<string, unknown>)[column] = row[column];
          }
        }

        return item;
      });
  };
}

function writes(rows: () => Array<Row>): {
  update: (
    criteria: Record<string, unknown>,
    values: Record<string, unknown>,
  ) => Promise<{ affected: number }>;
} {
  return {
    update: async (
      criteria: Record<string, unknown>,
      values: Record<string, unknown>,
    ): Promise<{ affected: number }> => {
      const row: Row | undefined = rows().find((candidate: Row): boolean => {
        return matches(criteria, candidate);
      });

      if (!row) {
        return { affected: 0 };
      }

      Object.assign(row, values);

      return { affected: 1 };
    },
  };
}

async function readerRow(
  id: ObjectID,
  email: string,
  linkToken: string,
): Promise<Row> {
  return {
    _id: id.toString(),
    projectId: PROJECT_ID.toString(),
    statusPageId: PAGE_ID.toString(),
    email: new Email(email),
    password: "the old password's hash",
    passwordSalt: "the old password's salt",
    resetPasswordToken: await hashOf(`${id.toString()}${RESET_TOKEN}`),
    resetPasswordExpires: new Date(Date.now() + 24 * 60 * 60 * 1000),
    magicLinkToken: await hashOf(linkToken),
    magicLinkExpires: new Date(Date.now() + 15 * 60 * 1000),
    deletedAt: null,
  };
}

async function sessionRow(
  id: string,
  readerId: ObjectID,
  refreshToken: string,
  additionalInfo: Row = {},
): Promise<Row> {
  return {
    _id: id,
    projectId: PROJECT_ID.toString(),
    statusPageId: PAGE_ID.toString(),
    statusPagePrivateUserId: readerId.toString(),
    refreshToken: await hashOf(refreshToken),
    refreshTokenExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    lastActiveAt: new Date(),
    isRevoked: false,
    revokedAt: null,
    revokedReason: null,
    additionalInfo: additionalInfo,
    deletedAt: null,
  };
}

interface Answer {
  error: Exception | null;
}

async function post(
  uri: string,
  body: unknown,
  params: Record<string, string> = {},
): Promise<Answer> {
  const handler: RouteHandler = mockRouter.match("post", uri);
  const req: ExpressRequest = buildRequest(body, {
    headers: { "x-forwarded-for": "203.0.113.7" },
    socketAddress: "10.0.0.2",
  });
  (req as unknown as { params: Record<string, string> }).params = params;

  const res: ExpressResponse = buildResponse();
  let error: Exception | null = null;

  await handler(req, res, ((err?: Exception): void => {
    if (err) {
      error = err;
    }
  }) as unknown as NextFunction);

  return { error: error };
}

async function resetPassword(password: string): Promise<Answer> {
  return await post("/reset-password", {
    data: {
      statusPageId: PAGE_ID.toString(),
      resetPasswordToken: `${READER_ID.toString()}${RESET_TOKEN}`,
      password: { _type: "HashedString", value: password },
    },
  });
}

async function signInWithLink(token: string): Promise<Answer> {
  return await post(
    "/login-with-magic-link/:statuspageid",
    { token: token },
    { statuspageid: PAGE_ID.toString() },
  );
}

async function refreshSession(refreshToken: string): Promise<Answer> {
  refreshTokenInCookie.mockReturnValue(refreshToken);

  return await post(
    "/refresh-token/:statuspageid",
    {},
    { statuspageid: PAGE_ID.toString() },
  );
}

async function exchangeLoginCode(code: string): Promise<Answer> {
  return await post(
    "/exchange-login-code/:statuspageid",
    { loginCode: code },
    { statuspageid: PAGE_ID.toString() },
  );
}

function teammateProps(): DatabaseCommonInteractionProps {
  return {
    userId: TEAMMATE_ID,
    tenantId: PROJECT_ID,
    userTenantAccessPermission: {
      [PROJECT_ID.toString()]: {
        _type: "UserTenantAccessPermission",
        projectId: PROJECT_ID,
        permissions: [
          {
            _type: "UserPermission",
            permission: Permission.StatusPageMember,
            labelIds: [],
            isBlockPermission: false,
          } as UserPermission,
        ],
      },
    },
  };
}

async function setPasswordAsTeammate(): Promise<void> {
  expect(
    await StatusPagePrivateUserService.updateOneById({
      id: READER_ID,
      data: { password: new HashedString("set by a teammate") } as never,
      props: teammateProps(),
    }),
  ).toBe(1);
}

async function setPasswordWithResetLink(): Promise<void> {
  const answer: Answer = await resetPassword("a brand new passphrase");

  expect(answer.error).toBeNull();
  expect(sendEmptySuccessResponse).toHaveBeenCalledTimes(1);
  sendEmptySuccessResponse.mockClear();
}

function errorMessage(answer: Answer): string | undefined {
  const sent: Exception | undefined = sendErrorResponse.mock.calls[0]?.[2] as
    | Exception
    | undefined;

  return answer.error?.message || sent?.message;
}

const WAYS_A_PASSWORD_CHANGES: Array<[string, () => Promise<void>]> = [
  ["POST /reset-password, with their reset link", setPasswordWithResetLink],
  ["a teammate through the API", setPasswordAsTeammate],
];

beforeEach(async () => {
  jest.clearAllMocks();
  redisClient.reset();

  readers = [
    await readerRow(READER_ID, "reader@example.com", LINK_TOKEN),
    await readerRow(OTHER_READER_ID, "other@example.com", OTHER_LINK_TOKEN),
  ];

  sessions = [
    await sessionRow(SESSION_ID, READER_ID, REFRESH_TOKEN),
    await sessionRow(LOGIN_CODE_SESSION_ID, READER_ID, LOGIN_CODE, {
      oneuptimeStatusPageSessionPurpose: "login-code",
    }),
    await sessionRow(OTHER_SESSION_ID, OTHER_READER_ID, OTHER_REFRESH_TOKEN),
  ];

  jest
    .spyOn(
      StatusPagePrivateUserService as unknown as { _findBy: () => unknown },
      "_findBy",
    )
    .mockImplementation(
      reads((): Array<Row> => {
        return readers;
      }, StatusPagePrivateUser) as never,
    );

  jest
    .spyOn(
      StatusPagePrivateUserSessionService as unknown as {
        _findBy: () => unknown;
      },
      "_findBy",
    )
    .mockImplementation(
      reads((): Array<Row> => {
        return sessions;
      }, StatusPagePrivateUserSession) as never,
    );

  jest.spyOn(StatusPagePrivateUserService, "getRepository").mockReturnValue(
    writes((): Array<Row> => {
      return readers;
    }) as never,
  );

  jest
    .spyOn(StatusPagePrivateUserSessionService, "getRepository")
    .mockReturnValue(
      writes((): Array<Row> => {
        return sessions;
      }) as never,
    );

  // The rest of a sign-in, and the query the page's sign-in rule makes.
  jest
    .spyOn(StatusPagePrivateUserSessionService, "createSession")
    .mockResolvedValue({
      session: { id: new ObjectID(SESSION_ID) },
      refreshToken: "a new session's refresh token",
      refreshTokenExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
    } as never);

  jest
    .spyOn(StatusPagePrivateUserSessionService, "doesSignInStillCount")
    .mockResolvedValue(true);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("what they hold before a new password", () => {
  it("a sign-in link signs them in", async () => {
    const answer: Answer = await signInWithLink(LINK_TOKEN);

    expect(answer.error).toBeNull();
    expect(setStatusPagePrivateUserCookie).toHaveBeenCalledTimes(1);
  });

  it("a session renews", async () => {
    const answer: Answer = await refreshSession(REFRESH_TOKEN);

    expect(answer.error).toBeNull();
    expect(sendErrorResponse).not.toHaveBeenCalled();
    expect(setStatusPagePrivateUserCookie).toHaveBeenCalledTimes(1);
  });

  it("a login code is exchanged", async () => {
    const answer: Answer = await exchangeLoginCode(LOGIN_CODE);

    expect(answer.error).toBeNull();
    expect(sendErrorResponse).not.toHaveBeenCalled();
    expect(setStatusPagePrivateUserCookie).toHaveBeenCalledTimes(1);
  });
});

describe.each(WAYS_A_PASSWORD_CHANGES)(
  "a new password set by %s",
  (_name: string, changePassword: () => Promise<void>) => {
    it("ends the sign-in link: it signs nobody in", async () => {
      await changePassword();

      const answer: Answer = await signInWithLink(LINK_TOKEN);

      expect(errorMessage(answer)).toBe(STATUS_PAGE_MAGIC_LINK_INVALID_MESSAGE);
      expect(setStatusPagePrivateUserCookie).not.toHaveBeenCalled();
      expect(readerOf(READER_ID)["magicLinkToken"]).toBeNull();
      expect(readerOf(READER_ID)["magicLinkExpires"]).toBeNull();
    });

    it("ends the reset link: the password stays what its owner set", async () => {
      await changePassword();

      const passwordTheOwnerSet: unknown = readerOf(READER_ID)["password"];

      expect(passwordTheOwnerSet).not.toBe("the old password's hash");

      const answer: Answer = await resetPassword(
        "the passphrase of whoever kept the link",
      );

      expect(errorMessage(answer)).toBe(INVALID_RESET_LINK_MESSAGE);
      expect(sendEmptySuccessResponse).not.toHaveBeenCalled();
      expect(readerOf(READER_ID)["password"]).toBe(passwordTheOwnerSet);
    });

    it("ends the session: it does not renew, and the cookies go", async () => {
      await changePassword();

      expect(sessionOf(SESSION_ID)["isRevoked"]).toBe(true);
      expect(sessionOf(SESSION_ID)["revokedReason"]).toBe("Password changed");

      const answer: Answer = await refreshSession(REFRESH_TOKEN);

      expect(errorMessage(answer)).toBe(SESSION_ENDED_MESSAGE);
      expect(setStatusPagePrivateUserCookie).not.toHaveBeenCalled();
      expect(removeCookie).toHaveBeenCalledTimes(2);
    });

    it("ends a login code not yet exchanged", async () => {
      await changePassword();

      const answer: Answer = await exchangeLoginCode(LOGIN_CODE);

      expect(errorMessage(answer)).toBe(LOGIN_CODE_REFUSED_MESSAGE);
      expect(setStatusPagePrivateUserCookie).not.toHaveBeenCalled();
    });

    it("leaves another reader of the page as they were", async () => {
      await changePassword();

      expect(sessionOf(OTHER_SESSION_ID)["isRevoked"]).toBe(false);

      const renewed: Answer = await refreshSession(OTHER_REFRESH_TOKEN);

      expect(renewed.error).toBeNull();
      expect(sendErrorResponse).not.toHaveBeenCalled();

      setStatusPagePrivateUserCookie.mockClear();

      const signedIn: Answer = await signInWithLink(OTHER_LINK_TOKEN);

      expect(signedIn.error).toBeNull();
      expect(setStatusPagePrivateUserCookie).toHaveBeenCalledTimes(1);
    });

    it("leaves them able to ask for a new link, which works", async () => {
      await changePassword();

      readerOf(READER_ID)["magicLinkToken"] = await hashOf(OTHER_LINK_TOKEN);
      readerOf(READER_ID)["magicLinkExpires"] = new Date(
        Date.now() + 15 * 60 * 1000,
      );

      const answer: Answer = await signInWithLink(OTHER_LINK_TOKEN);

      expect(answer.error).toBeNull();
      expect(setStatusPagePrivateUserCookie).toHaveBeenCalledTimes(1);
    });
  },
);

describe("POST /reset-password", () => {
  it("emails the reader once that their password changed", async () => {
    await setPasswordWithResetLink();

    expect(sendMail).toHaveBeenCalledTimes(1);
    expect(
      (
        sendMail.mock.calls[0]![0] as {
          templateType: EmailTemplateType;
          toEmail: Email;
        }
      ).templateType,
    ).toBe(EmailTemplateType.StatusPagePasswordChanged);
  });

  it("a link that is refused ends nothing: no password, no link, no session", async () => {
    readerOf(READER_ID)["resetPasswordToken"] = await hashOf(
      "a different reset token",
    );

    const answer: Answer = await resetPassword("a brand new passphrase");

    expect(errorMessage(answer)).toBe(INVALID_RESET_LINK_MESSAGE);
    expect(readerOf(READER_ID)["password"]).toBe("the old password's hash");
    expect(readerOf(READER_ID)["magicLinkToken"]).toBe(
      await hashOf(LINK_TOKEN),
    );
    expect(sessionOf(SESSION_ID)["isRevoked"]).toBe(false);
    expect(sendMail).not.toHaveBeenCalled();
  });
});
