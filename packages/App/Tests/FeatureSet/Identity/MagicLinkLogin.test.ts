import {
  buildRequest,
  buildResponse,
  createMockIdentityRouter,
  expectNoUserSecrets,
  MockIdentityRouter,
  RouteHandler,
  sentEntityBody,
  withSecretColumns,
} from "./IdentityRouterTestUtil";
import {
  buildOtpauthUri,
  conformingAppCode,
} from "Common/Tests/Server/TestingUtils/AuthenticatorApp";
import FakeCounterRedis from "Common/Tests/Server/TestingUtils/Redis/FakeCounterRedis";
import { EncryptionSecret } from "Common/Server/EnvironmentConfig";
import UserService from "Common/Server/Services/UserService";
import PasswordHash from "Common/Server/Utils/PasswordHash";
import TotpAuth from "Common/Server/Utils/TotpAuth";
import TwoFactorWrongCodes from "Common/Server/Utils/TwoFactorWrongCodes";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "Common/Server/Utils/Express";
import User from "Common/Models/DatabaseModels/User";
import UserTotpAuth from "Common/Models/DatabaseModels/UserTotpAuth";
import {
  MAGIC_LINK_EXPIRY_MINUTES,
  MAGIC_LINK_INVALID_MESSAGE,
  MAGIC_LINK_TURNED_OFF_MESSAGE,
} from "Common/Types/Accounts/MagicLink";
import Email from "Common/Types/Email";
import EmailTemplateType from "Common/Types/Email/EmailTemplateType";
import Exception from "Common/Types/Exception/Exception";
import ExceptionMessages from "Common/Types/Exception/ExceptionMessages";
import HashedString from "Common/Types/HashedString";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import { SSO_REQUIRED_SIGN_IN_MESSAGE } from "Common/Types/SSO/SignInMethods";
import Timezone from "Common/Types/Timezone";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";
import {
  SecondFactor,
  SignInMethod,
} from "Common/Types/UserSession/SessionSignIn";

/*
 * ---------------------------------------------------------------------------
 * SIGNING IN TO ONEUPTIME WITH A LINK EMAILED TO THE ACCOUNT
 * (Common/Types/Accounts/MagicLink).
 *
 * POST /send-magic-link emails an account a link that signs it in without
 * its password; POST /login-with-magic-link takes the link's token in place
 * of the email and password, and every second step that finishes such a
 * sign-in carries the token again. Driven here through the real router and
 * the real login() - the real token hashing, the real UserService lookups
 * and the conditional write that spends a link (over one account row held
 * in memory), the real SSO rule and the real rate limiter (over a counter
 * store that counts the way Redis does). Sessions, cookies, mail and the
 * server's settings are stood in.
 *
 *  - the email: to the account's own address, a link to
 *    /accounts/magic-link-login/<token> that works for fifteen minutes, the
 *    token stored only as its hash, each new link replacing the last;
 *  - asking says nothing about who has an account: an address with none, an
 *    invitation nobody claimed, a blocked account, an account the server's
 *    SSO requirement keeps out - all get the same answer and are counted
 *    the same, and nothing is sent or written for any of them;
 *  - a link stands in for the PASSWORD only: blocked accounts are refused,
 *    the SSO requirement applies, and an account with two factor
 *    authentication must give its second factor - a code, a security key, a
 *    backup code, or a first enrolment - before the link is spent and a
 *    session made;
 *  - a link works once, for fifteen minutes, only until a newer one is
 *    sent, and only while a master admin has not turned links off; of two
 *    requests carrying one link exactly one signs in;
 *  - a new password ends it, however the password is set - and with it a
 *    sign-in begun with the link, which even the right code cannot finish -
 *    and ends a password reset link sent before it, the same way;
 *  - following a link verifies the address, and asks for no captcha;
 *  - neither the token nor any other secret reaches a response or a log.
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
 * The server's settings: whether it requires SSO (read by the real
 * SsoRequiredSignIn), and whether a master admin turned sign-in links off.
 */
const getRequireSsoForLogin: jest.Mock = jest.fn();
const getMagicLinkLoginTurnedOff: jest.Mock = jest.fn();

jest.mock("Common/Server/Services/GlobalConfigService", () => {
  return {
    __esModule: true,
    default: {
      getRequireSsoForLogin: (...args: Array<unknown>): unknown => {
        return getRequireSsoForLogin(...args);
      },
      getMagicLinkLoginTurnedOff: (...args: Array<unknown>): unknown => {
        return getMagicLinkLoginTurnedOff(...args);
      },
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
    default: {
      findOneBy: jest.fn(),
      // What a reset's real write reads for the address it verifies: no teams.
      findBy: (): Promise<Array<unknown>> => {
        return Promise.resolve([]);
      },
    },
  };
});

const refreshUserAllPermissions: jest.Mock = jest.fn();

jest.mock("Common/Server/Services/AccessTokenService", () => {
  return {
    __esModule: true,
    default: {
      refreshUserAllPermissions: (...args: Array<unknown>): unknown => {
        return refreshUserAllPermissions(...args);
      },
    },
  };
});

const totpFindBy: jest.Mock = jest.fn();
const totpFindOneBy: jest.Mock = jest.fn();
const totpCreate: jest.Mock = jest.fn();
const totpUpdateOneById: jest.Mock = jest.fn();
const totpDeleteBy: jest.Mock = jest.fn();

jest.mock("Common/Server/Services/UserTotpAuthService", () => {
  return {
    __esModule: true,
    default: {
      findBy: (...args: Array<unknown>): unknown => {
        return totpFindBy(...args);
      },
      findOneBy: (...args: Array<unknown>): unknown => {
        return totpFindOneBy(...args);
      },
      create: (...args: Array<unknown>): unknown => {
        return totpCreate(...args);
      },
      updateOneById: (...args: Array<unknown>): unknown => {
        return totpUpdateOneById(...args);
      },
      deleteBy: (...args: Array<unknown>): unknown => {
        return totpDeleteBy(...args);
      },
    },
  };
});

const webAuthnFindBy: jest.Mock = jest.fn();
const webAuthnVerifyAuthentication: jest.Mock = jest.fn();

jest.mock("Common/Server/Services/UserWebAuthnService", () => {
  return {
    __esModule: true,
    default: {
      findBy: (...args: Array<unknown>): unknown => {
        return webAuthnFindBy(...args);
      },
      verifyAuthentication: (...args: Array<unknown>): unknown => {
        return webAuthnVerifyAuthentication(...args);
      },
    },
  };
});

const countUnusedForUser: jest.Mock = jest.fn();
const consumeCode: jest.Mock = jest.fn();
const generateForUserIfNone: jest.Mock = jest.fn();

jest.mock("Common/Server/Services/UserTwoFactorBackupCodeService", () => {
  return {
    __esModule: true,
    default: {
      countUnusedForUser: (...args: Array<unknown>): unknown => {
        return countUnusedForUser(...args);
      },
      consumeCode: (...args: Array<unknown>): unknown => {
        return consumeCode(...args);
      },
      generateForUserIfNone: (...args: Array<unknown>): unknown => {
        return generateForUserIfNone(...args);
      },
    },
  };
});

jest.mock("Common/Server/Utils/TwoFactorBackupCodeNotification", () => {
  return {
    __esModule: true,
    default: { notifyCodesCreated: jest.fn() },
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
        return revokeAllSessionsByUserId(...args);
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
        return Promise.resolve(sendMail(...args) as undefined);
      },
    },
  };
});

// This installation's address, as the real types hold it, for the links mailed.
jest.mock("Common/Server/DatabaseConfig", () => {
  const HostnameType: typeof import("Common/Types/API/Hostname").default = (
    jest.requireActual("Common/Types/API/Hostname") as {
      default: typeof import("Common/Types/API/Hostname").default;
    }
  ).default;

  return {
    __esModule: true,
    default: {
      shouldDisableSignup: (): Promise<boolean> => {
        return Promise.resolve(false);
      },
      getHost: (): Promise<unknown> => {
        return Promise.resolve(new HostnameType("oneuptime.acme.test"));
      },
      getHttpProtocol: (): Promise<unknown> => {
        return Promise.resolve("https://");
      },
    },
  };
});

const setUserCookie: jest.Mock = jest.fn();

jest.mock("Common/Server/Utils/Cookie", () => {
  return {
    __esModule: true,
    default: {
      setUserCookie: (...args: Array<unknown>): unknown => {
        return setUserCookie(...args);
      },
      removeAllCookies: jest.fn(),
      removeCookie: jest.fn(),
      setCookie: jest.fn(),
      getRefreshTokenFromExpressRequest: jest.fn(),
      getUserTokenKey: jest.fn(),
      getRefreshTokenKey: jest.fn(),
    },
  };
});

const verifyCaptcha: jest.Mock = jest.fn();

jest.mock("Common/Server/Utils/Captcha", () => {
  return {
    __esModule: true,
    default: {
      verifyCaptcha: (...args: Array<unknown>): unknown => {
        return verifyCaptcha(...args);
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
const sendTwoFactorWrongCodesEmail: jest.Mock = jest.fn();

jest.mock("../../../FeatureSet/Identity/Utils/AuthenticationEmail", () => {
  return {
    __esModule: true,
    default: {
      sendVerificationEmail: (...args: Array<unknown>): unknown => {
        return sendVerificationEmail(...args);
      },
      sendTwoFactorBackupCodeUsedEmail: jest.fn(),
      sendTwoFactorWrongCodesEmail: (...args: Array<unknown>): unknown => {
        return sendTwoFactorWrongCodesEmail(...args);
      },
      sendCompleteRegistrationEmail: jest.fn(),
    },
  };
});

// Every line the handlers log, at every level, to check what they carry.
const logged: Array<string> = [];

jest.mock("Common/Server/Utils/Logger", () => {
  const record: (...args: Array<unknown>) => void = (
    ...args: Array<unknown>
  ): void => {
    logged.push(
      args
        .map((arg: unknown): string => {
          return typeof arg === "string" ? arg : JSON.stringify(arg) || "";
        })
        .join(" "),
    );
  };

  return {
    __esModule: true,
    default: {
      info: record,
      error: record,
      warn: record,
      debug: record,
      getLogLevel: (): string => {
        return "INFO";
      },
    },
    getLogAttributesFromRequest: (): Record<string, unknown> => {
      return {};
    },
  };
});

const sendErrorResponse: jest.Mock = jest.fn();
const sendEntityResponse: jest.Mock = jest.fn();
const sendEmptySuccessResponse: jest.Mock = jest.fn();
const setNoCacheHeaders: jest.Mock = jest.fn();

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
      setNoCacheHeaders: (...args: Array<unknown>): unknown => {
        return setNoCacheHeaders(...args);
      },
    },
  };
});

// Every code is checked here: the count of wrong codes is its own suite's.
const forgetWrongCodes: jest.Mock = jest.fn();

jest.mock("Common/Server/Utils/TwoFactorWrongCodes", () => {
  const standIn: Record<string, unknown> & {
    default: Record<string, unknown>;
  } = (
    jest.requireActual("./TwoFactorWrongCodesStandIn") as {
      letEveryCodeBeChecked: () => Record<string, unknown> & {
        default: Record<string, unknown>;
      };
    }
  ).letEveryCodeBeChecked();

  return {
    ...standIn,
    default: {
      ...standIn.default,
      forget: (...args: Array<unknown>): Promise<void> => {
        forgetWrongCodes(...args);
        return Promise.resolve();
      },
    },
  };
});

// Importing the router registers every handler on the mock router above.
import "../../../FeatureSet/Identity/API/Authentication";

const PASSWORD: string = "correct horse battery staple";
const USER_ID: string = "55555555-5555-4555-8555-555555555555";
const USER_EMAIL: string = "ada@acme.test";
const TOTP_ID: ObjectID = new ObjectID("66666666-6666-4666-8666-666666666666");
const ENROLMENT_ID: ObjectID = new ObjectID(
  "77777777-7777-4777-8777-777777777777",
);
const CALLER: string = "203.0.113.50";

/*
 * The one account row, as Postgres would hold it. `findOneBy` answers from
 * it with only the columns asked for; `updateOneBy` / `updateOneById` write
 * to it; and the repository's `update` - the conditional write that spends a
 * link - checks its whole predicate against it.
 */
type AccountRow = Record<string, unknown>;

let row: AccountRow | null = null;

// Calls in the order they happened, across the stand-ins that matter for order.
const sequence: Array<string> = [];

// Hashed once: the password hash is deliberately slow.
let storedPassword: { hash: string; salt: string } | null = null;

async function accountRow(overrides: AccountRow = {}): Promise<AccountRow> {
  if (!storedPassword) {
    const salt: string = PasswordHash.generateSalt();

    storedPassword = {
      hash: await PasswordHash.hash({ plainValue: PASSWORD, salt: salt }),
      salt: salt,
    };
  }

  return {
    _id: USER_ID,
    email: new Email(USER_EMAIL),
    name: "Ada Lovelace",
    password: new HashedString(storedPassword.hash, true),
    passwordSalt: storedPassword.salt,
    isMasterAdmin: false,
    isEmailVerified: true,
    isBlocked: false,
    enableTwoFactorAuth: false,
    timezone: null,
    profilePictureId: null,
    magicLinkToken: null,
    magicLinkExpires: null,
    resetPasswordToken: null,
    resetPasswordExpires: null,
    deletedAt: null,
    ...overrides,
  };
}

function valueOf(value: unknown): string {
  return value === null || value === undefined ? "" : String(value);
}

function rowMatches(query: Record<string, unknown>): boolean {
  if (!row) {
    return false;
  }

  return Object.keys(query).every((column: string): boolean => {
    const wanted: unknown = query[column];

    if (column === "email") {
      return (
        valueOf(wanted).toLowerCase() === valueOf(row![column]).toLowerCase()
      );
    }

    return valueOf(wanted) === valueOf(row![column]) && valueOf(wanted) !== "";
  });
}

function projectRow(select: Record<string, unknown>): User {
  const user: User = new User();

  for (const column of Object.keys(select)) {
    if (select[column] && row && row[column] !== undefined) {
      (user as unknown as Record<string, unknown>)[column] = row[column];
    }
  }

  return user;
}

/*
 * Whether a term of the spending write's predicate holds for a value: a
 * plain value, or a TypeORM FindOperator - recognised by the mark TypeORM
 * gives every one, since Common and this suite may load typeorm from
 * different copies, and `instanceof` would tell them apart.
 */
function operatorHolds(term: unknown, value: unknown): boolean {
  const operator: { type?: string; value?: unknown } | null =
    term !== null &&
    typeof term === "object" &&
    (term as Record<string, unknown>)["@instanceof"] ===
      Symbol.for("FindOperator")
      ? (term as { type?: string; value?: unknown })
      : null;

  if (!operator) {
    return valueOf(term) === valueOf(value);
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

  throw new Error(`Unexpected operator ${operator.type}`);
}

// What the spending write is told: a race lost, as Postgres would answer it.
let spendingWriteLosesTheRace: boolean = false;

function installAccountStore(): void {
  jest
    .spyOn(UserService, "findOneBy")
    .mockImplementation(async (findBy: unknown): Promise<User | null> => {
      const options: {
        query: Record<string, unknown>;
        select: Record<string, unknown>;
      } = findBy as {
        query: Record<string, unknown>;
        select: Record<string, unknown>;
      };

      sequence.push("UserService.findOneBy");

      return rowMatches(options.query) ? projectRow(options.select) : null;
    });

  jest
    .spyOn(UserService, "updateOneBy")
    .mockImplementation(async (updateBy: unknown): Promise<number> => {
      const options: {
        query: Record<string, unknown>;
        data: Record<string, unknown>;
      } = updateBy as {
        query: Record<string, unknown>;
        data: Record<string, unknown>;
      };

      sequence.push("UserService.updateOneBy");

      if (!rowMatches(options.query)) {
        return 0;
      }

      Object.assign(row!, options.data);
      return 1;
    });

  jest
    .spyOn(UserService, "updateOneById")
    .mockImplementation(async (updateById: unknown): Promise<number> => {
      const options: { id: ObjectID; data: Record<string, unknown> } =
        updateById as { id: ObjectID; data: Record<string, unknown> };

      sequence.push(
        `UserService.updateOneById(${Object.keys(options.data).join(",")})`,
      );

      if (!row || valueOf(options.id) !== valueOf(row["_id"])) {
        return 0;
      }

      Object.assign(row, options.data);
      return 1;
    });

  jest.spyOn(UserService, "getRepository").mockReturnValue({
    update: async (
      criteria: Record<string, unknown>,
      values: Record<string, unknown>,
    ): Promise<{ affected: number }> => {
      sequence.push("spend the link");

      if (
        spendingWriteLosesTheRace ||
        !row ||
        !Object.keys(criteria).every((column: string): boolean => {
          return operatorHolds(criteria[column], row![column]);
        })
      ) {
        return { affected: 0 };
      }

      Object.assign(row, values);
      return { affected: 1 };
    },
  } as never);
}

/*
 * What a new password does to the row is the write's own hooks' to do
 * (UserService.onUpdatePermitted, onUpdateSuccess). So a test of it runs the
 * real write - the real update path and permission checks, over the one row -
 * in place of the store's stand-ins for it: a route that stopped going through
 * the hooks would leave the link working, and fail here.
 */
function letWritesRunForReal(): void {
  (UserService.updateOneBy as unknown as jest.SpyInstance).mockRestore();
  (UserService.updateOneById as unknown as jest.SpyInstance).mockRestore();

  jest
    .spyOn(UserService as unknown as { _findBy: () => unknown }, "_findBy")
    .mockImplementation((async (findBy: unknown): Promise<Array<User>> => {
      const options: {
        query: Record<string, unknown>;
        select: Record<string, unknown>;
      } = findBy as {
        query: Record<string, unknown>;
        select: Record<string, unknown>;
      };

      const { _id: namedId, ...otherTerms } = options.query;

      /*
       * The permission check hands a person's query on with its _id as an
       * operator holding the id (QueryUtil.serializeQuery).
       */
      const operatorParameters: Record<string, unknown> | undefined = (
        namedId as { objectLiteralParameters?: Record<string, unknown> } | null
      )?.objectLiteralParameters;

      const namedIds: Array<string> = (
        operatorParameters
          ? Object.values(operatorParameters).flat()
          : [namedId]
      ).map(valueOf);

      return namedIds.includes(valueOf(row?.["_id"])) && rowMatches(otherTerms)
        ? [projectRow(options.select)]
        : [];
    }) as never);
}

/*
 * The write the profile page's Update Password makes, as the signed-in owner.
 * One that found no row would leave every link as it was, so it is held to
 * having written the row.
 */
async function changePasswordOnProfilePage(): Promise<void> {
  expect(
    await UserService.updateOneById({
      id: new ObjectID(USER_ID),
      data: { password: new HashedString("a brand new passphrase") } as never,
      props: { userId: new ObjectID(USER_ID) },
    }),
  ).toBe(1);
}

interface Answer {
  error: Exception | null;
  headers: Record<string, string>;
  res: ExpressResponse;
}

async function post(
  uri: string,
  body: unknown,
  options: { from?: string | undefined; userAgent?: string | undefined } = {},
): Promise<Answer> {
  const handler: RouteHandler = mockRouter.match("post", uri);
  const req: ExpressRequest = buildRequest(body, {
    headers: {
      "x-forwarded-for": options.from || CALLER,
      ...(options.userAgent ? { "user-agent": options.userAgent } : {}),
    },
    socketAddress: "10.0.0.2",
  });
  const headers: Record<string, string> = {};
  const res: ExpressResponse = buildResponse();

  (res as unknown as { setHeader: unknown }).setHeader = (
    name: string,
    value: string,
  ): void => {
    headers[name] = value;
  };

  let error: Exception | null = null;

  await handler(req, res, ((err?: Exception): void => {
    if (err) {
      error = err;
    }
  }) as unknown as NextFunction);

  return { error: error, headers: headers, res: res };
}

async function askForLink(
  email: unknown = USER_EMAIL,
  options: {
    from?: string | undefined;
    userAgent?: string | undefined;
    captchaToken?: string | undefined;
  } = {},
): Promise<Answer> {
  return await post(
    "/send-magic-link",
    {
      data: { email: email },
      miscDataProps: options.captchaToken
        ? { captchaToken: options.captchaToken }
        : {},
    },
    { from: options.from, userAgent: options.userAgent },
  );
}

async function signInWithLink(token: unknown): Promise<Answer> {
  return await post("/login-with-magic-link", {
    data: { magicLinkToken: token },
  });
}

// The link the latest email carries, and its token.
function sentLink(callIndex: number = sendMail.mock.calls.length - 1): {
  url: string;
  token: string;
} {
  const message: { vars: Record<string, string> } = sendMail.mock.calls[
    callIndex
  ]![0] as { vars: Record<string, string> };
  const url: string = message.vars["tokenVerifyUrl"]!;

  return { url: url, token: url.slice(url.lastIndexOf("/") + 1) };
}

async function hashOf(token: string): Promise<string> {
  return await HashedString.hashValue(token, EncryptionSecret);
}

// A link stored on the row the way /send-magic-link stores one.
async function storeLink(
  token: string,
  minutesLeft: number = MAGIC_LINK_EXPIRY_MINUTES,
): Promise<void> {
  row!["magicLinkToken"] = await hashOf(token);
  row!["magicLinkExpires"] = new Date(Date.now() + minutesLeft * 60 * 1000);
}

function errorMessage(): string | undefined {
  const call: Array<unknown> | undefined = sendErrorResponse.mock.calls[0] as
    | Array<unknown>
    | undefined;

  return (call?.[2] as Exception | undefined)?.message;
}

function signedIn(): boolean {
  return (
    createSession.mock.calls.length === 1 &&
    sendEntityResponse.mock.calls.length === 1 &&
    sendErrorResponse.mock.calls.length === 0
  );
}

function sentMisc(): JSONObject {
  const call: Array<unknown> = sendEntityResponse.mock
    .calls[0] as Array<unknown>;

  return ((call[4] as { miscData?: JSONObject } | undefined)?.miscData ||
    {}) as JSONObject;
}

function isLinkStillStored(): boolean {
  return Boolean(row?.["magicLinkToken"]);
}

const TOKEN: string = "0b1d6a5e-3c2f-4e7a-9b8c-1d2e3f4a5b6c";
const OTHER_TOKEN: string = "1c2e7b6f-4d30-4f8b-8c9d-2e3f4a5b6c7d";

const LINKS_FOR_ADDRESS: string =
  "Too many sign-in links asked for this email address in the last hour. Please use the link in the latest email, or try again later.";
const LINKS_FROM_NETWORK: string =
  "Too many sign-in links asked for from your network. Please wait a few minutes and try again.";

beforeEach(async () => {
  jest.clearAllMocks();
  // An empty counter store for each test, so no count carries over.
  redisClient.reset();
  logged.length = 0;
  sequence.length = 0;
  spendingWriteLosesTheRace = false;

  row = await accountRow();
  installAccountStore();

  getRequireSsoForLogin.mockResolvedValue(false);
  getMagicLinkLoginTurnedOff.mockResolvedValue(false);
  verifyCaptcha.mockResolvedValue(undefined);

  createSession.mockResolvedValue({
    session: { id: ObjectID.generate() },
    refreshToken: "refresh-token",
    refreshTokenExpiresAt: new Date(Date.UTC(2031, 6, 1)),
  });

  totpFindBy.mockResolvedValue([]);
  totpFindOneBy.mockResolvedValue(null);
  webAuthnFindBy.mockResolvedValue([]);
  countUnusedForUser.mockResolvedValue(5);
  consumeCode.mockImplementation(async (): Promise<boolean> => {
    sequence.push("spend the backup code");
    return true;
  });
  generateForUserIfNone.mockResolvedValue(["aaaaabbbbb", "cccccddddd"]);
  totpUpdateOneById.mockImplementation(async (): Promise<void> => {
    sequence.push("save the enrolment");
  });
  totpDeleteBy.mockResolvedValue(0);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("POST /send-magic-link", () => {
  it("emails the account a link to /accounts/magic-link-login/<token>, which works for fifteen minutes", async () => {
    const before: number = Date.now();
    const answer: Answer = await askForLink();
    const after: number = Date.now();

    expect(answer.error).toBeNull();
    expect(sendEmptySuccessResponse).toHaveBeenCalledTimes(1);
    expect(sendMail).toHaveBeenCalledTimes(1);

    const message: {
      toEmail: Email;
      subject: string;
      templateType: EmailTemplateType;
      vars: Record<string, string>;
    } = sendMail.mock.calls[0]![0] as {
      toEmail: Email;
      subject: string;
      templateType: EmailTemplateType;
      vars: Record<string, string>;
    };

    expect(message.toEmail.toString()).toBe(USER_EMAIL);
    expect(message.templateType).toBe(EmailTemplateType.MagicLink);
    expect(message.subject).toMatch(/^Sign in to /);
    expect(message.vars["expiresInMinutes"]).toBe(
      String(MAGIC_LINK_EXPIRY_MINUTES),
    );
    expect(message.vars["homeURL"]).toBe("https://oneuptime.acme.test/");
    expect(sentLink().url).toMatch(
      /^https:\/\/oneuptime\.acme\.test\/accounts\/magic-link-login\/[0-9a-f-]{36}$/,
    );
    expect(ObjectID.isValidUUID(sentLink().token)).toBe(true);

    // Fifteen minutes from now, as the email says.
    const expires: number = (row!["magicLinkExpires"] as Date).getTime();

    expect(expires).toBeGreaterThanOrEqual(
      before + MAGIC_LINK_EXPIRY_MINUTES * 60 * 1000,
    );
    expect(expires).toBeLessThanOrEqual(
      after + MAGIC_LINK_EXPIRY_MINUTES * 60 * 1000,
    );
  });

  /*
   * Anybody who knows an address can ask for its link, so the email says when,
   * from which address and on which device it was asked for
   * (RequestOriginUtil), as the password reset beside it does.
   */
  describe("says where the request came from", () => {
    const FIREFOX_WINDOWS: string =
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:132.0) Gecko/20100101 Firefox/132.0";

    function mailedVars(): Record<string, string> {
      expect(sendMail).toHaveBeenCalledTimes(1);

      return (sendMail.mock.calls[0]![0] as { vars: Record<string, string> })
        .vars;
    }

    it("from which address, and on which device", async () => {
      await askForLink(USER_EMAIL, { userAgent: FIREFOX_WINDOWS });

      expect(mailedVars()["requestIpAddress"]).toBe(CALLER);
      expect(mailedVars()["requestDevice"]).toBe("Firefox 132 on Windows");
    });

    it("the address is the one Nginx appended, not the one the caller wrote first", async () => {
      await askForLink(USER_EMAIL, { from: `198.51.100.66, ${CALLER}` });

      expect(mailedVars()["requestIpAddress"]).toBe(CALLER);
    });

    it("a User-Agent of the caller's own words is an unknown device, never those words", async () => {
      const words: string = "Your account is hacked, call 555-0100";

      await askForLink(USER_EMAIL, { userAgent: words });

      expect(mailedVars()["requestDevice"]).toBe("Unknown device");
      expect(JSON.stringify(mailedVars())).not.toContain("555-0100");
    });

    it("names no place until the operator names the headers that carry it", async () => {
      await askForLink();

      expect(mailedVars()["requestLocation"]).toBe("");
    });

    it("says when, in the owner's own time zone", async () => {
      row = await accountRow({ timezone: Timezone.AsiaKolkata });

      await askForLink();

      expect(mailedVars()["requestedAt"]).toContain("IST");
    });

    it("an owner without a time zone of their own reads the time in UTC", async () => {
      await askForLink();

      expect(mailedVars()["requestedAt"]).toContain("UTC");
    });
  });

  it("stores only the token's hash, never the token", async () => {
    await askForLink();

    const { token } = sentLink();

    expect(row!["magicLinkToken"]).toBe(await hashOf(token));
    expect(row!["magicLinkToken"]).not.toContain(token);
  });

  it("tells the caller nothing but that it is done: no token, no account", async () => {
    await askForLink();

    expect(sendEmptySuccessResponse.mock.calls[0]).toHaveLength(2);
    expect(sendEntityResponse).not.toHaveBeenCalled();
  });

  it("never writes the token to a log line", async () => {
    await askForLink();

    expect(logged.join("\n")).not.toContain(sentLink().token);
  });

  it("answers an address with no account the same, and sends and writes nothing", async () => {
    const answer: Answer = await askForLink("nobody@acme.test");

    expect(answer.error).toBeNull();
    expect(sendEmptySuccessResponse).toHaveBeenCalledTimes(1);
    expect(sendMail).not.toHaveBeenCalled();
    expect(UserService.updateOneBy).not.toHaveBeenCalled();
  });

  it("sends nothing to an invitation nobody has claimed - there is no password for a link to stand in for", async () => {
    row!["password"] = null;

    const answer: Answer = await askForLink();

    expect(answer.error).toBeNull();
    expect(sendEmptySuccessResponse).toHaveBeenCalledTimes(1);
    expect(sendMail).not.toHaveBeenCalled();
    expect(row!["magicLinkToken"]).toBeNull();
  });

  it("sends nothing to a blocked account, and answers the same", async () => {
    row!["isBlocked"] = true;

    const answer: Answer = await askForLink();

    expect(answer.error).toBeNull();
    expect(sendEmptySuccessResponse).toHaveBeenCalledTimes(1);
    expect(sendMail).not.toHaveBeenCalled();
    expect(row!["magicLinkToken"]).toBeNull();
  });

  it("answers the same when the email cannot be sent: a server with no working mail server tells nobody", async () => {
    sendMail.mockRejectedValueOnce(new Error("Global SMTP Config not found"));

    const answer: Answer = await askForLink();

    expect(answer.error).toBeNull();
    expect(sendEmptySuccessResponse).toHaveBeenCalledTimes(1);
    expect(sendMail).toHaveBeenCalledTimes(1);
  });

  it("while the server requires SSO, sends nothing to anyone but a master admin", async () => {
    getRequireSsoForLogin.mockResolvedValue(true);

    const answer: Answer = await askForLink();

    expect(answer.error).toBeNull();
    expect(sendEmptySuccessResponse).toHaveBeenCalledTimes(1);
    expect(sendMail).not.toHaveBeenCalled();

    row!["isMasterAdmin"] = true;
    await askForLink();

    expect(sendMail).toHaveBeenCalledTimes(1);
  });

  it("sends a link to an address nobody has verified: following it is what verifies it", async () => {
    row!["isEmailVerified"] = false;

    await askForLink();

    expect(sendMail).toHaveBeenCalledTimes(1);
    expect(sendVerificationEmail).not.toHaveBeenCalled();
  });

  it("finds the account however the address is cased", async () => {
    await askForLink("ADA@Acme.Test");

    expect(sendMail).toHaveBeenCalledTimes(1);
    expect(
      (sendMail.mock.calls[0]![0] as { toEmail: Email }).toEmail.toString(),
    ).toBe(USER_EMAIL);
  });

  it("each new link replaces the last: only the latest email's link signs in", async () => {
    await askForLink();
    const first: string = sentLink(0).token;

    await askForLink();
    const second: string = sentLink(1).token;

    expect(second).not.toBe(first);

    await signInWithLink(first);
    expect(errorMessage()).toBe(MAGIC_LINK_INVALID_MESSAGE);
    expect(createSession).not.toHaveBeenCalled();

    sendErrorResponse.mockClear();
    await signInWithLink(second);
    expect(signedIn()).toBe(true);
  });

  it("asks the captcha first, and a refused captcha sends, counts and writes nothing", async () => {
    verifyCaptcha.mockRejectedValue(new Error("Captcha verification failed."));

    const answer: Answer = await askForLink(USER_EMAIL, {
      captchaToken: "captcha-answer",
    });

    expect(answer.error?.message).toBe("Captcha verification failed.");
    expect(verifyCaptcha).toHaveBeenCalledWith({
      token: "captcha-answer",
      remoteIp: "127.0.0.1",
    });
    expect(sendMail).not.toHaveBeenCalled();
    expect(UserService.findOneBy).not.toHaveBeenCalled();
    expect(redisClient.counters.size).toBe(0);
  });

  it("refuses a request that names no address, before anything is looked up", async () => {
    const answer: Answer = await post("/send-magic-link", { data: {} });

    expect(answer.error?.message).toContain("Email");
    expect(UserService.findOneBy).not.toHaveBeenCalled();
    expect(sendMail).not.toHaveBeenCalled();
  });

  it("refuses a list of addresses: a contact is one mailbox", async () => {
    const answer: Answer = await askForLink("ada@acme.test,eve@evil.test");

    expect(answer.error).not.toBeNull();
    expect(sendMail).not.toHaveBeenCalled();
  });

  it("says so, to anyone, while a master admin has turned sign-in links off - and counts, looks up and sends nothing", async () => {
    getMagicLinkLoginTurnedOff.mockResolvedValue(true);

    const answer: Answer = await askForLink();

    expect(answer.error?.message).toBe(MAGIC_LINK_TURNED_OFF_MESSAGE);
    expect(UserService.findOneBy).not.toHaveBeenCalled();
    expect(sendMail).not.toHaveBeenCalled();
    expect(redisClient.counters.size).toBe(0);
  });

  it("sends ten links to one address in an hour, then refuses with when to come back", async () => {
    for (let index: number = 0; index < 10; index++) {
      const answer: Answer = await askForLink(USER_EMAIL, {
        from: `198.51.100.${index + 1}`,
      });

      expect(answer.error).toBeNull();
    }

    expect(sendMail).toHaveBeenCalledTimes(10);

    const refused: Answer = await askForLink(USER_EMAIL, {
      from: "198.51.100.99",
    });

    expect(refused.error?.message).toBe(LINKS_FOR_ADDRESS);
    expect(refused.headers["Retry-After"]).toBeDefined();
    expect(sendMail).toHaveBeenCalledTimes(10);
  });

  it("counts an address with no account the same, so a refusal says nothing about who has one", async () => {
    for (let index: number = 0; index < 10; index++) {
      await askForLink("nobody@acme.test", {
        from: `198.51.100.${index + 1}`,
      });
    }

    const refused: Answer = await askForLink("nobody@acme.test", {
      from: "198.51.100.99",
    });

    expect(refused.error?.message).toBe(LINKS_FOR_ADDRESS);
    expect(sendMail).not.toHaveBeenCalled();
  });

  it("lets one caller ask thirty times in a quarter of an hour, then refuses it", async () => {
    for (let index: number = 0; index < 30; index++) {
      const answer: Answer = await askForLink(`reader${index}@acme.test`);

      expect(answer.error).toBeNull();
    }

    const refused: Answer = await askForLink("reader99@acme.test");

    expect(refused.error?.message).toBe(LINKS_FROM_NETWORK);
  });
});

describe("POST /login-with-magic-link - an account without two factor authentication", () => {
  it("signs the account in with the link from the email: a session, the cookies, and the link spent", async () => {
    await askForLink();

    const answer: Answer = await signInWithLink(sentLink().token);

    expect(answer.error).toBeNull();
    expect(signedIn()).toBe(true);
    // The audit log says how they signed in (SessionSignIn, issue #6762).
    expect(createSession).toHaveBeenCalledWith(
      expect.objectContaining({
        signIn: { method: SignInMethod.SignInLink, secondFactor: undefined },
      }),
    );
    expect(setUserCookie).toHaveBeenCalledTimes(1);
    expect(refreshUserAllPermissions).toHaveBeenCalledWith(
      new ObjectID(USER_ID),
    );
    expect(row!["magicLinkToken"]).toBeNull();
    expect(row!["magicLinkExpires"]).toBeNull();
    expect(sentMisc()["accessToken"]).toBe("signed-user-token");
    expect(sentMisc()["refreshToken"]).toBe("refresh-token");
  });

  it("answers with who signed in, and never a credential", async () => {
    row = withSecretColumns(row as unknown as User) as unknown as AccountRow;
    row["deletedAt"] = null;
    await storeLink(TOKEN);

    await signInWithLink(TOKEN);

    expect(signedIn()).toBe(true);

    const body: JSONObject = sentEntityBody(
      sendEntityResponse.mock.calls[0] as Array<unknown>,
    );

    expectNoUserSecrets(body);
    expect(JSON.stringify(body)).not.toContain(TOKEN);
    expect(JSON.stringify(body)).toContain(USER_EMAIL);
  });

  it("works once: the same link again is answered as used", async () => {
    await storeLink(TOKEN);

    await signInWithLink(TOKEN);
    expect(signedIn()).toBe(true);

    jest.clearAllMocks();
    installAccountStore();

    await signInWithLink(TOKEN);

    expect(errorMessage()).toBe(MAGIC_LINK_INVALID_MESSAGE);
    expect(createSession).not.toHaveBeenCalled();
  });

  it("signs nobody in with a link that has expired", async () => {
    await storeLink(TOKEN, -1);

    await signInWithLink(TOKEN);

    expect(errorMessage()).toBe(MAGIC_LINK_INVALID_MESSAGE);
    expect(createSession).not.toHaveBeenCalled();
  });

  it("answers every token that is not a working link alike, and never as a wrong password", async () => {
    await storeLink(TOKEN);

    for (const token of [
      OTHER_TOKEN,
      "not-a-link",
      "",
      42,
      null,
      undefined,
      { value: TOKEN },
    ]) {
      jest.clearAllMocks();
      installAccountStore();

      await signInWithLink(token);

      expect([token, errorMessage()]).toEqual([
        token,
        MAGIC_LINK_INVALID_MESSAGE,
      ]);
      expect(createSession).not.toHaveBeenCalled();
    }

    // The real link was never touched by any of them.
    expect(row!["magicLinkToken"]).toBe(await hashOf(TOKEN));
  });

  it("looks nothing up for a token that is not one", async () => {
    await signInWithLink("not-a-link");

    expect(UserService.findOneBy).not.toHaveBeenCalled();
  });

  it("refuses a body with an email and password instead of a link: it takes links only", async () => {
    await storeLink(TOKEN);

    await post("/login-with-magic-link", {
      data: {
        email: USER_EMAIL,
        password: { _type: "HashedString", value: PASSWORD },
      },
    });

    expect(errorMessage()).toBe(MAGIC_LINK_INVALID_MESSAGE);
    expect(createSession).not.toHaveBeenCalled();
  });

  it("refuses a blocked account once the link has proved it, and leaves the link unspent", async () => {
    await storeLink(TOKEN);
    row!["isBlocked"] = true;

    await signInWithLink(TOKEN);

    expect(errorMessage()).toBe(ExceptionMessages.UserBlocked);
    expect(createSession).not.toHaveBeenCalled();
    expect(isLinkStillStored()).toBe(true);
  });

  it("while the server requires SSO, signs only a master admin in", async () => {
    await storeLink(TOKEN);
    getRequireSsoForLogin.mockResolvedValue(true);

    const refused: Answer = await signInWithLink(TOKEN);

    expect(refused.error?.message).toBe(SSO_REQUIRED_SIGN_IN_MESSAGE);
    expect(createSession).not.toHaveBeenCalled();
    expect(isLinkStillStored()).toBe(true);

    row!["isMasterAdmin"] = true;
    await signInWithLink(TOKEN);

    expect(createSession).toHaveBeenCalledTimes(1);
  });

  it("signs nobody in once a master admin turns sign-in links off - a link sent before included", async () => {
    await storeLink(TOKEN);
    getMagicLinkLoginTurnedOff.mockResolvedValue(true);

    await signInWithLink(TOKEN);

    expect(errorMessage()).toBe(MAGIC_LINK_TURNED_OFF_MESSAGE);
    expect(createSession).not.toHaveBeenCalled();
    expect(isLinkStillStored()).toBe(true);
  });

  it("verifies an address nobody had verified - the link proved the mailbox - and mails no verification link", async () => {
    await storeLink(TOKEN);
    row!["isEmailVerified"] = false;

    await signInWithLink(TOKEN);

    expect(signedIn()).toBe(true);
    expect(row!["isEmailVerified"]).toBe(true);
    expect(sendVerificationEmail).not.toHaveBeenCalled();
    // Through the update with hooks, which sets up what a verified address gets.
    expect(sequence).toContain("UserService.updateOneById(isEmailVerified)");
  });

  it("does not write the address's verification again for an address already verified", async () => {
    await storeLink(TOKEN);

    await signInWithLink(TOKEN);

    expect(sequence).not.toContain(
      "UserService.updateOneById(isEmailVerified)",
    );
  });

  it("asks for no captcha: the request for the link carried one", async () => {
    await storeLink(TOKEN);

    await signInWithLink(TOKEN);

    expect(signedIn()).toBe(true);
    expect(verifyCaptcha).not.toHaveBeenCalled();
  });

  it("is never kept by the browser or a proxy", async () => {
    await storeLink(TOKEN);

    const answer: Answer = await signInWithLink(TOKEN);

    expect(setNoCacheHeaders).toHaveBeenCalledWith(answer.res);
  });

  it("of two requests carrying one link, exactly one signs in", async () => {
    await storeLink(TOKEN);

    await Promise.all([signInWithLink(TOKEN), signInWithLink(TOKEN)]);

    expect(createSession).toHaveBeenCalledTimes(1);
    expect(sendEntityResponse).toHaveBeenCalledTimes(1);
    expect(sendErrorResponse).toHaveBeenCalledTimes(1);
    expect(errorMessage()).toBe(MAGIC_LINK_INVALID_MESSAGE);
  });

  it("signs nobody in when another request spent the link first", async () => {
    await storeLink(TOKEN);
    spendingWriteLosesTheRace = true;

    await signInWithLink(TOKEN);

    expect(errorMessage()).toBe(MAGIC_LINK_INVALID_MESSAGE);
    expect(createSession).not.toHaveBeenCalled();
  });

  it("logs that a link signed the account in, and never the token", async () => {
    await storeLink(TOKEN);

    await signInWithLink(TOKEN);

    expect(logged.join("\n")).toContain("stage: magic-link");
    expect(logged.join("\n")).toContain(
      `User logged in with a sign-in link: ${USER_EMAIL}`,
    );
    expect(logged.join("\n")).not.toContain(TOKEN);
  });
});

describe("POST /login-with-magic-link - an account with two factor authentication", () => {
  // A verified authenticator app on the account, and how to read its code.
  function authenticatorApp(): { row: UserTotpAuth; code: () => string } {
    const secret: string = TotpAuth.generateSecret();
    const otpUrl: string = buildOtpauthUri({
      secret: secret,
      label: USER_EMAIL,
      algorithm: "SHA1",
    });

    const totp: UserTotpAuth = new UserTotpAuth();
    totp.id = TOTP_ID;
    totp.name = "Phone";
    totp.twoFactorSecret = secret;
    totp.twoFactorOtpUrl = otpUrl;
    totp.isVerified = true;

    return {
      row: totp,
      code: (): string => {
        return conformingAppCode(otpUrl);
      },
    };
  }

  function wrongCodeFor(code: string): string {
    return code === "000000" ? "111111" : "000000";
  }

  async function verifyTotp(data: JSONObject): Promise<Answer> {
    return await post("/verify-totp-auth", {
      data: {
        email: USER_EMAIL,
        twoFactorAuthId: TOTP_ID.toString(),
        ...data,
      },
    });
  }

  beforeEach(() => {
    row!["enableTwoFactorAuth"] = true;
  });

  it("sends the account to its second step, and neither spends the link nor makes a session", async () => {
    const app: ReturnType<typeof authenticatorApp> = authenticatorApp();
    totpFindBy.mockResolvedValue([app.row]);
    await storeLink(TOKEN);

    await signInWithLink(TOKEN);

    expect(createSession).not.toHaveBeenCalled();
    expect(setUserCookie).not.toHaveBeenCalled();
    expect(isLinkStillStored()).toBe(true);
    expect(sendEntityResponse).toHaveBeenCalledTimes(1);
    expect(
      (sentMisc()["totpAuthList"] as Array<unknown> | undefined)?.length,
    ).toBe(1);
    expect(sentMisc()["accessToken"]).toBeUndefined();
    expect(sentMisc()["backupCodeCount"]).toBe(5);

    // The address the second step's limits count, and a security key's challenge is asked for.
    const body: JSONObject = sentEntityBody(
      sendEntityResponse.mock.calls[0] as Array<unknown>,
    );

    expect(JSON.stringify(body)).toContain(USER_EMAIL);
    expectNoUserSecrets(body);
  });

  it("finishes with the authenticator code and the link's token in place of the password, spending the link", async () => {
    const app: ReturnType<typeof authenticatorApp> = authenticatorApp();
    totpFindBy.mockResolvedValue([app.row]);
    totpFindOneBy.mockResolvedValue(app.row);
    await storeLink(TOKEN);

    await verifyTotp({ magicLinkToken: TOKEN, code: app.code() });

    expect(signedIn()).toBe(true);
    // A sign-in link, with the authenticator app as its second factor.
    expect(createSession).toHaveBeenCalledWith(
      expect.objectContaining({
        signIn: {
          method: SignInMethod.SignInLink,
          secondFactor: SecondFactor.AuthenticatorApp,
        },
      }),
    );
    expect(row!["magicLinkToken"]).toBeNull();
    expect(forgetWrongCodes).toHaveBeenCalledWith(new ObjectID(USER_ID));
  });

  it("keeps the link through a wrong code, so the right one still finishes the sign-in", async () => {
    const app: ReturnType<typeof authenticatorApp> = authenticatorApp();
    totpFindOneBy.mockResolvedValue(app.row);
    await storeLink(TOKEN);

    await verifyTotp({ magicLinkToken: TOKEN, code: wrongCodeFor(app.code()) });

    expect(errorMessage()).toBe(
      "That code is not right. Enter the 6-digit code your authenticator app shows now.",
    );
    expect(createSession).not.toHaveBeenCalled();
    expect(isLinkStillStored()).toBe(true);

    jest.clearAllMocks();
    installAccountStore();

    await verifyTotp({ magicLinkToken: TOKEN, code: app.code() });

    expect(signedIn()).toBe(true);
    expect(isLinkStillStored()).toBe(false);
  });

  /*
   * Whoever began the sign-in holds the link and has been entering codes; the
   * new password forgets those codes, and must not leave them the link to
   * enter more with, from a count of nothing.
   */
  it("a new password ends a sign-in begun with the link: its wrong codes are forgotten, and even the right code no longer finishes it", async () => {
    letWritesRunForReal();

    const app: ReturnType<typeof authenticatorApp> = authenticatorApp();
    totpFindOneBy.mockResolvedValue(app.row);
    await storeLink(TOKEN);

    await verifyTotp({ magicLinkToken: TOKEN, code: wrongCodeFor(app.code()) });

    expect(errorMessage()).toBe(
      "That code is not right. Enter the 6-digit code your authenticator app shows now.",
    );
    expect(isLinkStillStored()).toBe(true);

    sendErrorResponse.mockClear();

    await changePasswordOnProfilePage();

    expect(forgetWrongCodes).toHaveBeenCalledWith(new ObjectID(USER_ID));
    expect(isLinkStillStored()).toBe(false);

    await verifyTotp({ magicLinkToken: TOKEN, code: app.code() });

    expect(errorMessage()).toBe(MAGIC_LINK_INVALID_MESSAGE);
    expect(createSession).not.toHaveBeenCalled();
  });

  /*
   * The email says something else for each: somebody who opened a link can
   * read the mailbox, and a new password does not secure that
   * (Templates/TwoFactorWrongCodes.hbs). What it says is
   * TwoFactorWrongCodesEmail.test.ts, and when the count tells the owner is
   * TwoFactorWrongCodesSignIn.test.ts.
   */
  describe("once wrong codes have begun the waits, the owner's email says what began the sign-in", () => {
    const PASSWORD_FIELD: JSONObject = {
      password: { _type: "HashedString", value: PASSWORD },
    };

    async function enterBackupCode(data: JSONObject): Promise<Answer> {
      return await post("/verify-backup-code", {
        data: { email: USER_EMAIL, backupCode: "aaaaa-bbbbb", ...data },
      });
    }

    function saidASignInLinkBeganIt(): unknown {
      expect(sendTwoFactorWrongCodesEmail).toHaveBeenCalledTimes(1);

      return (
        sendTwoFactorWrongCodesEmail.mock.calls[0]![0] as {
          isMagicLinkSignIn: unknown;
        }
      ).isMagicLinkSignIn;
    }

    beforeEach(() => {
      jest
        .spyOn(TwoFactorWrongCodes, "shouldTellOwner")
        .mockResolvedValue(true as never);
      sendTwoFactorWrongCodesEmail.mockResolvedValue(undefined);
    });

    it("a wrong authenticator code after a link", async () => {
      const app: ReturnType<typeof authenticatorApp> = authenticatorApp();
      totpFindOneBy.mockResolvedValue(app.row);
      await storeLink(TOKEN);

      await verifyTotp({
        magicLinkToken: TOKEN,
        code: wrongCodeFor(app.code()),
      });

      expect(errorMessage()).toBe(
        "That code is not right. Enter the 6-digit code your authenticator app shows now.",
      );
      expect(saidASignInLinkBeganIt()).toBe(true);
    });

    it("a wrong backup code after a link", async () => {
      totpFindBy.mockResolvedValue([authenticatorApp().row]);
      consumeCode.mockResolvedValue(false);
      await storeLink(TOKEN);

      await enterBackupCode({ magicLinkToken: TOKEN });

      expect(errorMessage()).toBe(
        "That backup code is not right, or it was already used. Each backup code works once.",
      );
      expect(saidASignInLinkBeganIt()).toBe(true);
    });

    it("a wrong authenticator code after the password", async () => {
      const app: ReturnType<typeof authenticatorApp> = authenticatorApp();
      totpFindOneBy.mockResolvedValue(app.row);

      await verifyTotp({ ...PASSWORD_FIELD, code: wrongCodeFor(app.code()) });

      expect(errorMessage()).toBe(
        "That code is not right. Enter the 6-digit code your authenticator app shows now.",
      );
      expect(saidASignInLinkBeganIt()).toBe(false);
    });

    it("a wrong backup code after the password", async () => {
      totpFindBy.mockResolvedValue([authenticatorApp().row]);
      consumeCode.mockResolvedValue(false);

      await enterBackupCode(PASSWORD_FIELD);

      expect(errorMessage()).toBe(
        "That backup code is not right, or it was already used. Each backup code works once.",
      );
      expect(saidASignInLinkBeganIt()).toBe(false);
    });

    it("the password's email, even with a link waiting unused on the account", async () => {
      const app: ReturnType<typeof authenticatorApp> = authenticatorApp();
      totpFindOneBy.mockResolvedValue(app.row);
      await storeLink(TOKEN);

      await verifyTotp({ ...PASSWORD_FIELD, code: wrongCodeFor(app.code()) });

      expect(saidASignInLinkBeganIt()).toBe(false);
    });

    it("no email for a link that does not work: it reaches neither the count nor the owner", async () => {
      const app: ReturnType<typeof authenticatorApp> = authenticatorApp();
      totpFindOneBy.mockResolvedValue(app.row);
      await storeLink(TOKEN, -1);

      await verifyTotp({
        magicLinkToken: TOKEN,
        code: wrongCodeFor(app.code()),
      });

      expect(errorMessage()).toBe(MAGIC_LINK_INVALID_MESSAGE);
      expect(sendTwoFactorWrongCodesEmail).not.toHaveBeenCalled();
    });
  });

  it("refuses the second step once the link is spent, whatever the code", async () => {
    const app: ReturnType<typeof authenticatorApp> = authenticatorApp();
    totpFindOneBy.mockResolvedValue(app.row);
    await storeLink(TOKEN);

    await verifyTotp({ magicLinkToken: TOKEN, code: app.code() });
    expect(signedIn()).toBe(true);

    jest.clearAllMocks();
    installAccountStore();

    await verifyTotp({ magicLinkToken: TOKEN, code: app.code() });

    expect(errorMessage()).toBe(MAGIC_LINK_INVALID_MESSAGE);
    expect(createSession).not.toHaveBeenCalled();
  });

  it("refuses the second step for an expired link before the code is looked at", async () => {
    const app: ReturnType<typeof authenticatorApp> = authenticatorApp();
    totpFindOneBy.mockResolvedValue(app.row);
    await storeLink(TOKEN, -1);

    await verifyTotp({ magicLinkToken: TOKEN, code: app.code() });

    expect(errorMessage()).toBe(MAGIC_LINK_INVALID_MESSAGE);
    expect(totpFindOneBy).not.toHaveBeenCalled();
    expect(createSession).not.toHaveBeenCalled();
  });

  it("takes a second step whose token is not a link for a link that does not work - never for a password sign-in", async () => {
    const app: ReturnType<typeof authenticatorApp> = authenticatorApp();
    totpFindOneBy.mockResolvedValue(app.row);
    await storeLink(TOKEN);

    await verifyTotp({
      magicLinkToken: "not-a-link",
      password: { _type: "HashedString", value: PASSWORD },
      code: app.code(),
    });

    expect(errorMessage()).toBe(MAGIC_LINK_INVALID_MESSAGE);
    expect(createSession).not.toHaveBeenCalled();
  });

  it("still finishes a second step begun with the password, as before", async () => {
    const app: ReturnType<typeof authenticatorApp> = authenticatorApp();
    totpFindOneBy.mockResolvedValue(app.row);
    await storeLink(TOKEN);

    await verifyTotp({
      password: { _type: "HashedString", value: PASSWORD },
      code: app.code(),
    });

    expect(signedIn()).toBe(true);
    // A password sign-in leaves a link it was not given alone.
    expect(isLinkStillStored()).toBe(true);
  });

  it("finishes with a security key and the link's token", async () => {
    webAuthnFindBy.mockResolvedValue([{ id: ObjectID.generate() }]);
    webAuthnVerifyAuthentication.mockResolvedValue(undefined);
    await storeLink(TOKEN);

    await post("/verify-webauthn-auth", {
      data: {
        email: USER_EMAIL,
        magicLinkToken: TOKEN,
        credential: { id: "credential" },
      },
    });

    expect(webAuthnVerifyAuthentication).toHaveBeenCalledWith({
      userId: USER_ID,
      credential: { id: "credential" },
    });
    expect(signedIn()).toBe(true);
    expect(isLinkStillStored()).toBe(false);
  });

  it("leaves the link unspent when the security key is refused", async () => {
    webAuthnVerifyAuthentication.mockRejectedValue(
      new Error("Authentication verification failed."),
    );
    await storeLink(TOKEN);

    const answer: Answer = await post("/verify-webauthn-auth", {
      data: {
        email: USER_EMAIL,
        magicLinkToken: TOKEN,
        credential: { id: "credential" },
      },
    });

    expect(answer.error?.message).toBe("Authentication verification failed.");
    expect(createSession).not.toHaveBeenCalled();
    expect(isLinkStillStored()).toBe(true);
  });

  describe("with a backup code", () => {
    async function verifyBackupCode(token: string = TOKEN): Promise<Answer> {
      return await post("/verify-backup-code", {
        data: {
          email: USER_EMAIL,
          magicLinkToken: token,
          backupCode: "aaaaa-bbbbb",
        },
      });
    }

    beforeEach(() => {
      totpFindBy.mockResolvedValue([authenticatorApp().row]);
    });

    it("spends the link before the code, then signs in", async () => {
      await storeLink(TOKEN);

      await verifyBackupCode();

      expect(signedIn()).toBe(true);
      expect(sequence.indexOf("spend the link")).toBeGreaterThan(-1);
      expect(sequence.indexOf("spend the link")).toBeLessThan(
        sequence.indexOf("spend the backup code"),
      );
      // Spent once, not again where the sign-in is decided.
      expect(
        sequence.filter((step: string): boolean => {
          return step === "spend the link";
        }),
      ).toHaveLength(1);
    });

    it("spends no backup code for a link another request spent first", async () => {
      await storeLink(TOKEN);
      spendingWriteLosesTheRace = true;

      await verifyBackupCode();

      expect(errorMessage()).toBe(MAGIC_LINK_INVALID_MESSAGE);
      expect(consumeCode).not.toHaveBeenCalled();
      expect(createSession).not.toHaveBeenCalled();
    });

    it("spends no backup code for a link that has expired", async () => {
      await storeLink(TOKEN, -1);

      await verifyBackupCode();

      expect(errorMessage()).toBe(MAGIC_LINK_INVALID_MESSAGE);
      expect(consumeCode).not.toHaveBeenCalled();
    });

    it("a wrong code costs the link - a fresh email replaces it - and signs nobody in", async () => {
      await storeLink(TOKEN);
      consumeCode.mockResolvedValue(false);

      await verifyBackupCode();

      expect(errorMessage()).toBe(
        "That backup code is not right, or it was already used. Each backup code works once.",
      );
      expect(createSession).not.toHaveBeenCalled();
      expect(isLinkStillStored()).toBe(false);
    });
  });

  describe("when an admin requires it and the account has nothing set up", () => {
    function pendingEnrolment(): { row: UserTotpAuth; code: () => string } {
      const secret: string = TotpAuth.generateSecret();
      const otpUrl: string = buildOtpauthUri({
        secret: secret,
        label: USER_EMAIL,
        algorithm: "SHA1",
      });

      const enrolment: UserTotpAuth = new UserTotpAuth();
      enrolment.id = ENROLMENT_ID;
      enrolment.twoFactorSecret = secret;
      enrolment.twoFactorOtpUrl = otpUrl;
      enrolment.isVerified = false;

      return {
        row: enrolment,
        code: (): string => {
          return conformingAppCode(otpUrl);
        },
      };
    }

    async function verifyEnrolment(code: string): Promise<Answer> {
      return await post("/verify-totp-enrolment", {
        data: {
          email: USER_EMAIL,
          magicLinkToken: TOKEN,
          twoFactorAuthId: ENROLMENT_ID.toString(),
          code: code,
        },
      });
    }

    it("shows the QR code to enrol, and neither spends the link nor makes a session", async () => {
      const enrolment: ReturnType<typeof pendingEnrolment> = pendingEnrolment();
      totpFindOneBy.mockResolvedValue(enrolment.row);
      await storeLink(TOKEN);

      await signInWithLink(TOKEN);

      expect(sentMisc()["twoFactorEnrolmentRequired"]).toBe(true);
      expect(sentMisc()["twoFactorOtpUrl"]).toBe(enrolment.row.twoFactorOtpUrl);
      expect(createSession).not.toHaveBeenCalled();
      expect(isLinkStillStored()).toBe(true);
    });

    it("enrols with the first code, spending the link before anything is saved, and hands over the recovery codes", async () => {
      const enrolment: ReturnType<typeof pendingEnrolment> = pendingEnrolment();
      totpFindOneBy.mockResolvedValue(enrolment.row);
      await storeLink(TOKEN);

      await verifyEnrolment(enrolment.code());

      expect(signedIn()).toBe(true);
      expect(sequence.indexOf("spend the link")).toBeLessThan(
        sequence.indexOf("save the enrolment"),
      );
      expect(sentMisc()["backupCodes"]).toEqual(["aaaaa-bbbbb", "ccccc-ddddd"]);
    });

    it("keeps the link through a wrong first code", async () => {
      const enrolment: ReturnType<typeof pendingEnrolment> = pendingEnrolment();
      totpFindOneBy.mockResolvedValue(enrolment.row);
      await storeLink(TOKEN);

      await verifyEnrolment(wrongCodeFor(enrolment.code()));

      expect(errorMessage()).toBe(
        "That code is not right. Enter the 6-digit code your authenticator app shows now.",
      );
      expect(isLinkStillStored()).toBe(true);
      expect(totpUpdateOneById).not.toHaveBeenCalled();
    });

    it("saves nothing for a link another request spent first", async () => {
      const enrolment: ReturnType<typeof pendingEnrolment> = pendingEnrolment();
      totpFindOneBy.mockResolvedValue(enrolment.row);
      await storeLink(TOKEN);
      spendingWriteLosesTheRace = true;

      await verifyEnrolment(enrolment.code());

      expect(errorMessage()).toBe(MAGIC_LINK_INVALID_MESSAGE);
      expect(totpUpdateOneById).not.toHaveBeenCalled();
      expect(generateForUserIfNone).not.toHaveBeenCalled();
      expect(createSession).not.toHaveBeenCalled();
    });
  });
});

describe("the limits in front of the sign-in link routes", () => {
  // The limiter registered ahead of the handler, answering for one caller.
  async function throughLimiter(from: string): Promise<boolean> {
    const handlers: Array<RouteHandler> = mockRouter.matchAll(
      "post",
      "/login-with-magic-link",
    );
    const req: ExpressRequest = buildRequest(
      { data: { magicLinkToken: TOKEN } },
      { headers: { "x-forwarded-for": from }, socketAddress: "10.0.0.2" },
    );
    let passed: boolean = false;

    await handlers[0]!(req, buildResponse(), ((): void => {
      passed = true;
    }) as unknown as NextFunction);

    return passed;
  }

  it("POST /login-with-magic-link runs a limiter before its handler", () => {
    expect(mockRouter.matchAll("post", "/login-with-magic-link")).toHaveLength(
      2,
    );
  });

  it("lets one address through a hundred and fifty times a quarter hour, then refuses it", async () => {
    for (let index: number = 0; index < 150; index++) {
      expect(await throughLimiter(CALLER)).toBe(true);
    }

    expect(await throughLimiter(CALLER)).toBe(false);
    expect(errorMessage()).toBe(
      "Too many sign-in attempts. Please try again later.",
    );

    // Another address has an allowance of its own.
    expect(await throughLimiter("198.51.100.77")).toBe(true);
  });

  it("POST /send-magic-link needs no attempt limiter: it takes no credential, and its mail is counted per caller and per address", () => {
    expect(mockRouter.matchAll("post", "/send-magic-link")).toHaveLength(1);
  });
});

describe("POST /login does not take a sign-in link", () => {
  it("asks for the email and password of a body that carries only a link", async () => {
    await storeLink(TOKEN);

    await post("/login", { data: { magicLinkToken: TOKEN } });

    expect(errorMessage()).toBe("Email and password are required.");
    expect(createSession).not.toHaveBeenCalled();
    expect(isLinkStillStored()).toBe(true);
  });

  it("signs in with the password as before, and leaves the link alone", async () => {
    await storeLink(TOKEN);

    await post("/login", {
      data: {
        email: USER_EMAIL,
        password: { _type: "HashedString", value: PASSWORD },
        magicLinkToken: OTHER_TOKEN,
      },
    });

    expect(signedIn()).toBe(true);
    expect(isLinkStillStored()).toBe(true);
    expect(verifyCaptcha).toHaveBeenCalledTimes(1);
  });
});

/*
 * Every way a password changes, through the real write, which is what ends the
 * link (Common's UserServiceNewPasswordEndsLinks.test.ts), and then the
 * sign-in route itself, asked to sign in with it.
 */
describe("a new password ends a sign-in link sent before it", () => {
  beforeEach(() => {
    letWritesRunForReal();
  });

  describe("POST /reset-password", () => {
    it("ends a sign-in link sent before the reset, with the sessions", async () => {
      const resetToken: string = "2d3f8c7a-5e41-4a9c-9dae-3f4a5b6c7d8e";
      row!["resetPasswordToken"] = await hashOf(resetToken);
      row!["resetPasswordExpires"] = new Date(Date.now() + 60 * 60 * 1000);
      await storeLink(TOKEN);

      await post("/reset-password", {
        data: {
          resetPasswordToken: resetToken,
          password: { _type: "HashedString", value: "a brand new passphrase" },
        },
      });

      expect(sendErrorResponse).not.toHaveBeenCalled();
      expect(sendEmptySuccessResponse).toHaveBeenCalledTimes(1);
      expect(revokeAllSessionsByUserId).toHaveBeenCalled();
      expect(row!["magicLinkToken"]).toBeNull();
      expect(row!["magicLinkExpires"]).toBeNull();

      await signInWithLink(TOKEN);

      expect(errorMessage()).toBe(MAGIC_LINK_INVALID_MESSAGE);
      expect(createSession).not.toHaveBeenCalled();
    });
  });

  it.each<[string, () => Promise<void>]>([
    ["the profile page", changePasswordOnProfilePage],
    [
      "a master admin's Set Password",
      async (): Promise<void> => {
        await UserService.setPassword({
          userId: new ObjectID(USER_ID),
          password: "a brand new passphrase",
        });
      },
    ],
  ])(
    "%s: the sessions end, and the link no longer signs in",
    async (_name: string, changePassword: () => Promise<void>) => {
      await storeLink(TOKEN);

      await changePassword();

      expect(revokeAllSessionsByUserId).toHaveBeenCalledTimes(1);
      expect(row!["magicLinkToken"]).toBeNull();
      expect(row!["magicLinkExpires"]).toBeNull();

      await signInWithLink(TOKEN);

      expect(errorMessage()).toBe(MAGIC_LINK_INVALID_MESSAGE);
      expect(createSession).not.toHaveBeenCalled();
    },
  );

  it("a link asked for after the new password works: only the links sent before it end", async () => {
    await storeLink(TOKEN);

    await changePasswordOnProfilePage();

    await storeLink(OTHER_TOKEN);

    await signInWithLink(OTHER_TOKEN);

    expect(signedIn()).toBe(true);
    expect(isLinkStillStored()).toBe(false);
  });

  it("any other change to the account leaves the link working", async () => {
    await storeLink(TOKEN);

    expect(
      await UserService.updateOneById({
        id: new ObjectID(USER_ID),
        data: { timezone: Timezone.EuropeLondon } as never,
        props: { userId: new ObjectID(USER_ID) },
      }),
    ).toBe(1);

    expect(row!["timezone"]).toBe(Timezone.EuropeLondon);
    expect(isLinkStillStored()).toBe(true);

    await signInWithLink(TOKEN);

    expect(signedIn()).toBe(true);
  });
});

/*
 * The same for a password reset link, which a person holding it could otherwise
 * spend to replace the password the owner has just set: every way a password
 * changes, through the real write, and then the reset route itself.
 */
describe("a new password ends a reset link sent before it", () => {
  const RESET_TOKEN: string = "2d3f8c7a-5e41-4a9c-9dae-3f4a5b6c7d8e";
  const INVALID_RESET_LINK_MESSAGE: string =
    "Invalid link. Please go to forgot password page again and request a new link.";

  async function resetWithLink(password: string): Promise<void> {
    await post("/reset-password", {
      data: {
        resetPasswordToken: RESET_TOKEN,
        password: { _type: "HashedString", value: password },
      },
    });
  }

  beforeEach(async () => {
    letWritesRunForReal();
    row!["resetPasswordToken"] = await hashOf(RESET_TOKEN);
    row!["resetPasswordExpires"] = new Date(Date.now() + 24 * 60 * 60 * 1000);
  });

  it("with no new password the link works: this is what the rest of these end", async () => {
    const oldPassword: unknown = row!["password"];

    await resetWithLink("a brand new passphrase");

    expect(sendErrorResponse).not.toHaveBeenCalled();
    expect(sendEmptySuccessResponse).toHaveBeenCalledTimes(1);
    expect(row!["password"]).not.toBe(oldPassword);
  });

  it.each<[string, () => Promise<void>]>([
    ["the profile page", changePasswordOnProfilePage],
    [
      "a master admin's Set Password",
      async (): Promise<void> => {
        await UserService.setPassword({
          userId: new ObjectID(USER_ID),
          password: "a brand new passphrase",
        });
      },
    ],
    [
      "the reset link itself, opened a second time",
      async (): Promise<void> => {
        await resetWithLink("a brand new passphrase");

        expect(sendEmptySuccessResponse).toHaveBeenCalledTimes(1);
        sendEmptySuccessResponse.mockClear();
        revokeAllSessionsByUserId.mockClear();
      },
    ],
  ])(
    "%s: the link no longer resets, and the password stays what the owner set",
    async (_name: string, changePassword: () => Promise<void>) => {
      await changePassword();

      const passwordTheOwnerSet: unknown = row!["password"];

      expect(row!["resetPasswordToken"]).toBeNull();
      expect(row!["resetPasswordExpires"]).toBeNull();

      await resetWithLink("the passphrase of whoever kept the link");

      expect(errorMessage()).toBe(INVALID_RESET_LINK_MESSAGE);
      expect(sendEmptySuccessResponse).not.toHaveBeenCalled();
      expect(row!["password"]).toBe(passwordTheOwnerSet);
    },
  );

  it("any other change to the account leaves the link working", async () => {
    expect(
      await UserService.updateOneById({
        id: new ObjectID(USER_ID),
        data: { timezone: Timezone.EuropeLondon } as never,
        props: { userId: new ObjectID(USER_ID) },
      }),
    ).toBe(1);

    await resetWithLink("a brand new passphrase");

    expect(sendErrorResponse).not.toHaveBeenCalled();
    expect(sendEmptySuccessResponse).toHaveBeenCalledTimes(1);
  });
});
