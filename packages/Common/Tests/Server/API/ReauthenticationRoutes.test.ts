import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { Mock, SpyInstance } from "jest-mock";
import { mockRouter } from "./Helpers";

jest.mock("../../../Server/Utils/Express", () => {
  return {
    getRouter: () => {
      return mockRouter;
    },
  };
});

jest.mock("../../../Server/Utils/Response", () => {
  return {
    sendEmptySuccessResponse: jest.fn(),
    sendErrorResponse: jest.fn(),
    sendJsonObjectResponse: jest.fn(),
    sendEntityResponse: jest.fn(),
    sendEntityArrayResponse: jest.fn(),
    sendJsonArrayResponse: jest.fn(),
    setNoCacheHeaders: jest.fn(),
  };
});

jest.mock("../../../Server/Infrastructure/Redis", () => {
  return {
    __esModule: true,
    default: { getClient: jest.fn(), isConnected: jest.fn() },
  };
});

import UserAPI from "../../../Server/API/UserAPI";
import TeamMemberService from "../../../Server/Services/TeamMemberService";
import UserService from "../../../Server/Services/UserService";
import DeleteBy from "../../../Server/Types/Database/DeleteBy";
import DeleteById from "../../../Server/Types/Database/DeleteById";
import User from "../../../Models/DatabaseModels/User";
import { getErrorDetails } from "../../../Types/Exception/BadDataExceptionWithDetails";
import UserTotpAuthAPI from "../../../Server/API/UserTotpAuthAPI";
import UserTwoFactorBackupCodeAPI from "../../../Server/API/UserTwoFactorBackupCodeAPI";
import Redis from "../../../Server/Infrastructure/Redis";
import { IdentityRateLimitOutcome } from "../../../Server/Middleware/IdentityRateLimit";
import UserMiddleware from "../../../Server/Middleware/UserAuthorization";
import MailService from "../../../Server/Services/MailService";
import UserTotpAuthService from "../../../Server/Services/UserTotpAuthService";
import UserTwoFactorBackupCodeService from "../../../Server/Services/UserTwoFactorBackupCodeService";
import UserWebAuthnService from "../../../Server/Services/UserWebAuthnService";
import { ExpressResponse, NextFunction } from "../../../Server/Utils/Express";
import Response from "../../../Server/Utils/Response";
import SsoManagedSignIn from "../../../Server/Utils/SsoManagedSignIn";
import UserTotpAuth from "../../../Models/DatabaseModels/UserTotpAuth";
import {
  REAUTHENTICATION_FAILURES_BEFORE_SIGN_OUT,
  REAUTHENTICATION_FIELDS,
  REAUTHENTICATION_MESSAGES,
  REAUTHENTICATION_NOT_FROM_A_SESSION_MESSAGES,
  REAUTHENTICATION_PURPOSE_FIELD,
  REAUTHENTICATION_REQUIRED_MESSAGES,
  ReauthenticationPurpose,
  REAUTHENTICATION_WINDOW_IN_MINUTES,
  ReauthenticationWebAuthnKind,
  SignInAgainProvider,
  SignInAgainRefusal,
} from "../../../Types/Accounts/Reauthentication";
import BadDataException from "../../../Types/Exception/BadDataException";
import Exception from "../../../Types/Exception/Exception";
import NotAuthenticatedException from "../../../Types/Exception/NotAuthenticatedException";
import ReauthenticationRequiredException from "../../../Types/Exception/ReauthenticationRequiredException";
import TooManyRequestsException from "../../../Types/Exception/TooManyRequestsException";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import UserType from "../../../Types/UserType";
import { SessionEndCause } from "../../../Types/UserSession/SessionEndCause";
import {
  PASSKEY_ONLY_ACCOUNT,
  PASSWORD_ACCOUNT,
  REAUTH_PROJECT_ID,
  REAUTH_SESSION_ID,
  REAUTH_SSO_PROVIDER_ID,
  REAUTH_USER_ID,
  RIGHT_CODE,
  RIGHT_PASSWORD,
  SSO_ONLY_ACCOUNT,
  StandInAccount,
  StandInAccountSpies,
  StandInValkey,
  TWO_FACTOR_ACCOUNT,
  standInAccount,
} from "../TestingUtils/ReauthenticationStandIns";

/*
 * CONFIRM IT'S YOU (#10155), at the routes a session reaches.
 *
 *   - GET /user/reauthentication: where the session stands, for the
 *     Dashboard's prompt;
 *   - POST /user/reauthentication: a confirmation, rate limited and counted
 *     for the session - five wrong ones sign it out, and nobody else;
 *   - POST /user/reauthentication/webauthn-options: a key's options;
 *   - and two routes in front of a change to how one signs in, which ask
 *     the check before they check, write or spend anything: an
 *     authenticator app's /validate and /user-two-factor-backup-code/generate.
 *
 * The check and the confirmation run for real (Server/Utils/
 * Reauthentication), against Valkey in memory and an account at the
 * services' edges (TestingUtils/ReauthenticationStandIns). The session is
 * the one the request's access token names, as UserAuthorization leaves it
 * on the request - never anything in the body.
 */

const STATUS_ROUTE: string = "/user/reauthentication";
const OPTIONS_ROUTE: string = "/user/reauthentication/webauthn-options";

let valkey: StandInValkey;
let account: StandInAccount;
let spies: StandInAccountSpies;

function requestFor(
  data: {
    body?: JSONObject;
    sessionId?: ObjectID | null;
  } = {},
): JSONObject {
  return {
    params: {},
    query: {},
    headers: { "user-agent": "jest" },
    body: data.body || {},
    userType: UserType.User,
    userAuthorization: {
      userId: REAUTH_USER_ID,
      ...(data.sessionId === null
        ? {}
        : { sessionId: data.sessionId || REAUTH_SESSION_ID }),
    },
    userGlobalAccessPermission: {
      globalPermissions: [Permission.CurrentUser],
      projectIds: [],
      _type: "UserGlobalAccessPermission",
    },
  } as unknown as JSONObject;
}

interface Answer {
  body: JSONObject | null;
  error: Exception | null;
}

async function call(
  method: string,
  uri: string,
  request: JSONObject,
): Promise<Answer> {
  jest.mocked(Response.sendJsonObjectResponse).mockClear();
  const next: Mock<(error?: unknown) => void> = jest.fn();

  await mockRouter
    .match(method, uri)
    .handlerFunction(
      request as never,
      {} as ExpressResponse,
      next as unknown as NextFunction,
    );

  const sent: Array<unknown> | undefined = jest.mocked(
    Response.sendJsonObjectResponse,
  ).mock.calls[0];

  return {
    body: sent ? (sent[2] as JSONObject) : null,
    error: next.mock.calls[0] ? (next.mock.calls[0][0] as Exception) : null,
  };
}

async function confirmWith(body: JSONObject): Promise<Answer> {
  return await call("post", STATUS_ROUTE, requestFor({ body: body }));
}

beforeEach(() => {
  mockRouter.routes.length = 0;
  new UserAPI();
  new UserTotpAuthAPI();
  new UserTwoFactorBackupCodeAPI();

  valkey = new StandInValkey();
  account = PASSWORD_ACCOUNT;

  jest.mocked(Redis.getClient).mockImplementation((() => {
    return valkey.isDown ? null : valkey;
  }) as never);
  jest.mocked(Redis.isConnected).mockImplementation(() => {
    return !valkey.isDown;
  });

  spies = standInAccount(() => {
    return account;
  });

  jest
    .spyOn(SsoManagedSignIn, "assertMayChangeLocalSignIn")
    .mockResolvedValue(undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
  jest.mocked(Response.sendJsonObjectResponse).mockClear();
});

describe("the routes", () => {
  test.each([
    ["get", STATUS_ROUTE],
    ["post", STATUS_ROUTE],
    ["post", OPTIONS_ROUTE],
  ])("%s %s answers a signed-in person only", (method: string, uri: string) => {
    expect(mockRouter.match(method, uri).middlewares).toStrictEqual([
      UserMiddleware.getUserMiddleware,
      UserMiddleware.requireUserAuthentication,
    ]);
  });
});

describe("GET /user/reauthentication: where the session stands", () => {
  test("not confirmed: what the account confirms with, never cached", async () => {
    account = TWO_FACTOR_ACCOUNT;

    const answer: Answer = await call("get", STATUS_ROUTE, requestFor());

    expect(answer.error).toBeNull();
    expect(answer.body).toEqual({
      isConfirmed: false,
      confirmedUntil: null,
      windowInMinutes: REAUTHENTICATION_WINDOW_IN_MINUTES,
      methods: {
        password: true,
        secondStep: {
          authenticatorApp: true,
          securityKey: true,
          backupCode: true,
        },
        passkey: false,
        signInAgain: false,
      },
      signInAgain: null,
    });
    expect(Response.setNoCacheHeaders).toHaveBeenCalled();
  });

  test("an account that signs in with single sign-on only is offered Sign In Again, through its own provider (#10217)", async () => {
    account = SSO_ONLY_ACCOUNT;

    const answer: Answer = await call("get", STATUS_ROUTE, requestFor());

    expect((answer.body!["methods"] as JSONObject)["signInAgain"]).toBe(true);
    expect(answer.body!["isConfirmed"]).toBe(false);
    expect(answer.body!["signInAgain"]).toEqual({
      route: `/sso/${REAUTH_PROJECT_ID.toString()}/${REAUTH_SSO_PROVIDER_ID.toString()}`,
      provider: SignInAgainProvider.SingleSignOn,
      providerName: "Okta",
      refusal: null,
      canUseSignInLink: true,
    });
  });

  test("a Sign In Again its provider answered with a session it had is said, and confirms nothing (#10217)", async () => {
    account = {
      ...SSO_ONLY_ACCOUNT,
      signedInWith: "ReusedSession",
      signedInMinutesAgo: 1,
    };

    const answer: Answer = await call("get", STATUS_ROUTE, requestFor());

    expect(answer.body!["isConfirmed"]).toBe(false);
    expect((answer.body!["signInAgain"] as JSONObject)["refusal"]).toBe(
      SignInAgainRefusal.ReusedSession,
    );
  });

  test("a Sign In Again its provider confirmed a minute ago confirms the session (#10217)", async () => {
    account = { ...SSO_ONLY_ACCOUNT, signedInMinutesAgo: 1 };

    const answer: Answer = await call("get", STATUS_ROUTE, requestFor());

    expect(answer.body!["isConfirmed"]).toBe(true);
    expect((answer.body!["signInAgain"] as JSONObject)["refusal"]).toBeNull();
  });

  test("a request with no session - an MCP client - is refused", async () => {
    const answer: Answer = await call(
      "get",
      STATUS_ROUTE,
      requestFor({ sessionId: null }),
    );

    expect(answer.error).toBeInstanceOf(BadDataException);
    expect(answer.error!.message).toBe(
      REAUTHENTICATION_MESSAGES.notFromASession,
    );
  });
});

describe("POST /user/reauthentication: a confirmation", () => {
  test("the right password confirms this session: the next status says until when", async () => {
    const answer: Answer = await confirmWith({
      [REAUTHENTICATION_FIELDS.password]: RIGHT_PASSWORD,
    });

    expect(answer.error).toBeNull();
    expect(typeof answer.body!["confirmedUntil"]).toBe("string");

    const status: Answer = await call("get", STATUS_ROUTE, requestFor());

    expect(status.body!["isConfirmed"]).toBe(true);
    expect(status.body!["confirmedUntil"]).toBe(answer.body!["confirmedUntil"]);
  });

  test("two-factor authentication on: the password and a code", async () => {
    account = TWO_FACTOR_ACCOUNT;

    expect(
      (
        await confirmWith({
          [REAUTHENTICATION_FIELDS.password]: RIGHT_PASSWORD,
        })
      ).error!.message,
    ).toBe(REAUTHENTICATION_MESSAGES.secondStepRequired);

    expect(
      (
        await confirmWith({
          [REAUTHENTICATION_FIELDS.password]: RIGHT_PASSWORD,
          [REAUTHENTICATION_FIELDS.code]: RIGHT_CODE,
        })
      ).error,
    ).toBeNull();
  });

  test("a passkey on its own, its answer checked for the request's session", async () => {
    account = PASSKEY_ONLY_ACCOUNT;
    const credential: JSONObject = { id: "passkey-credential" };

    expect(
      (
        await confirmWith({
          [REAUTHENTICATION_FIELDS.passkeyCredential]: credential,
        })
      ).error,
    ).toBeNull();

    expect(spies.verifyKey).toHaveBeenCalledWith({
      userId: REAUTH_USER_ID,
      sessionId: REAUTH_SESSION_ID,
      kind: ReauthenticationWebAuthnKind.Passkey,
      credential: credential,
    });
  });

  test("a password that is not text is no password", async () => {
    expect(
      (
        await confirmWith({
          [REAUTHENTICATION_FIELDS.password]: 12345 as unknown as string,
        })
      ).error!.message,
    ).toBe(REAUTHENTICATION_MESSAGES.passwordRequired);
    expect(spies.verifyPassword).not.toHaveBeenCalled();
  });

  test("a session named in the body is ignored: the request's own session is confirmed", async () => {
    await confirmWith({
      [REAUTHENTICATION_FIELDS.password]: RIGHT_PASSWORD,
      sessionId: "eeeeeeee-5555-4555-8555-eeeeeeeeeeee",
      userId: "ffffffff-6666-4666-8666-ffffffffffff",
    });

    const status: Answer = await call("get", STATUS_ROUTE, requestFor());

    expect(status.body!["isConfirmed"]).toBe(true);
  });

  test(`a wrong password is said; the ${REAUTHENTICATION_FAILURES_BEFORE_SIGN_OUT}th signs the session out with a 401`, async () => {
    for (
      let i: number = 1;
      i < REAUTHENTICATION_FAILURES_BEFORE_SIGN_OUT;
      i++
    ) {
      const answer: Answer = await confirmWith({
        [REAUTHENTICATION_FIELDS.password]: `wrong ${i}`,
      });

      expect(answer.error).toBeInstanceOf(BadDataException);
      expect(answer.error!.message).toBe(
        REAUTHENTICATION_MESSAGES.wrongPassword,
      );
    }

    const last: Answer = await confirmWith({
      [REAUTHENTICATION_FIELDS.password]: "wrong again",
    });

    expect(last.error).toBeInstanceOf(NotAuthenticatedException);
    expect(last.error!.message).toBe(REAUTHENTICATION_MESSAGES.signedOut);
    expect(spies.revokeSession).toHaveBeenCalledWith(
      { userId: REAUTH_USER_ID, sessionId: REAUTH_SESSION_ID },
      expect.objectContaining({
        cause: SessionEndCause.ReauthenticationFailed,
      }),
    );
  });

  test("over the rate limit: refused with its own words, nothing checked", async () => {
    spies.rateLimit.mockResolvedValue({
      outcome: IdentityRateLimitOutcome.RateLimited,
    });

    const answer: Answer = await confirmWith({
      [REAUTHENTICATION_FIELDS.password]: RIGHT_PASSWORD,
    });

    expect(answer.error).toBeInstanceOf(TooManyRequestsException);
    expect(answer.error!.message).toBe(
      REAUTHENTICATION_MESSAGES.tooManyAttempts,
    );
    expect(spies.verifyPassword).not.toHaveBeenCalled();
  });
});

describe("POST /user/reauthentication/webauthn-options", () => {
  test("a passkey's options, for the request's session", async () => {
    account = PASSKEY_ONLY_ACCOUNT;
    const generate: SpyInstance<
      typeof UserWebAuthnService.generateReauthenticationOptions
    > = jest
      .spyOn(UserWebAuthnService, "generateReauthenticationOptions")
      .mockResolvedValue({ options: { challenge: "c" } } as never);

    const answer: Answer = await call(
      "post",
      OPTIONS_ROUTE,
      requestFor({
        body: {
          [REAUTHENTICATION_FIELDS.webAuthnKind]:
            ReauthenticationWebAuthnKind.Passkey,
        },
      }),
    );

    expect(answer.body).toEqual({ options: { challenge: "c" } });
    expect(generate).toHaveBeenCalledWith({
      userId: REAUTH_USER_ID,
      sessionId: REAUTH_SESSION_ID,
      kind: ReauthenticationWebAuthnKind.Passkey,
    });
  });

  test("no kind: refused", async () => {
    const answer: Answer = await call("post", OPTIONS_ROUTE, requestFor());

    expect(answer.error).toBeInstanceOf(BadDataException);
  });
});

describe("POST /user-totp-auth/validate waits for the session to confirm", () => {
  const validate: () => Promise<Answer> = async (): Promise<Answer> => {
    const app: UserTotpAuth = new UserTotpAuth();
    app._id = "aaaa0000-1111-4111-8111-aaaaaaaa0000";
    app.userId = REAUTH_USER_ID;
    app.twoFactorSecret = "secret";

    jest.spyOn(UserTotpAuthService, "findOneById").mockResolvedValue(app);
    jest
      .spyOn(UserTotpAuthService, "updateOneById")
      .mockResolvedValue(undefined as never);
    jest
      .spyOn(UserTwoFactorBackupCodeService, "generateForUserIfNone")
      .mockResolvedValue(null);

    return await call(
      "post",
      "/user-totp-auth/validate",
      requestFor({ body: { id: app._id, code: RIGHT_CODE } }),
    );
  };

  test("missing: refused before the code is checked or the app finished", async () => {
    const answer: Answer = await validate();

    expect(answer.error).toBeInstanceOf(ReauthenticationRequiredException);
    expect(UserTotpAuthService.updateOneById).not.toHaveBeenCalled();
  });

  test("confirmed: the app is finished", async () => {
    await confirmWith({ [REAUTHENTICATION_FIELDS.password]: RIGHT_PASSWORD });

    const answer: Answer = await validate();

    expect(answer.error).toBeNull();
    expect(UserTotpAuthService.updateOneById).toHaveBeenCalledWith(
      expect.objectContaining({ data: { isVerified: true } }),
    );
  });
});

describe("POST /user-two-factor-backup-code/generate", () => {
  const generate: (unused: number) => Promise<Answer> = async (
    unused: number,
  ): Promise<Answer> => {
    jest
      .spyOn(UserTwoFactorBackupCodeService, "getStatusForUser")
      .mockResolvedValue({
        total: unused,
        unused: unused,
        generatedAt: unused > 0 ? new Date() : null,
      } as never);
    jest
      .spyOn(UserTwoFactorBackupCodeService, "regenerateForUser")
      .mockResolvedValue(["AAAAABBBBB"]);
    // The email that tells the owner their codes were replaced.
    jest.spyOn(MailService, "sendMail").mockResolvedValue(undefined as never);

    return await call(
      "post",
      "/user-two-factor-backup-code/generate",
      requestFor(),
    );
  };

  test("in place of codes still unused: refused until the session confirms, and nothing is voided", async () => {
    const answer: Answer = await generate(6);

    expect(answer.error).toBeInstanceOf(ReauthenticationRequiredException);
    expect(
      UserTwoFactorBackupCodeService.regenerateForUser,
    ).not.toHaveBeenCalled();
  });

  test("in place of codes still unused, once confirmed: a new set", async () => {
    await confirmWith({ [REAUTHENTICATION_FIELDS.password]: RIGHT_PASSWORD });

    const answer: Answer = await generate(6);

    expect(answer.error).toBeNull();
    expect(UserTwoFactorBackupCodeService.regenerateForUser).toHaveBeenCalled();
  });

  test("a first set - what the sign-in page and the mobile app offer right after a sign-in - asks nothing", async () => {
    const answer: Answer = await generate(0);

    expect(answer.error).toBeNull();
    expect(UserTwoFactorBackupCodeService.regenerateForUser).toHaveBeenCalled();
  });
});

/*
 * Danger Zone > Delete Account sends DELETE /api/user/:id (#10220): the
 * route hands the request's session to UserService, whose hook refuses the
 * delete of the caller's own account until that session has confirmed it's
 * theirs - here through the real route and the real hook, with only the
 * database stood in.
 */
describe("DELETE /user/:id: deleting your own account waits for the session to confirm", () => {
  let deleted: Array<string>;

  beforeEach(() => {
    deleted = [];

    // The row the delete removes: the caller's own account.
    jest
      .spyOn(
        UserService as unknown as {
          findRowsAndHoldDeleteToThem: () => Promise<Array<User>>;
        },
        "findRowsAndHoldDeleteToThem",
      )
      .mockImplementation((async () => {
        const row: User = new User();
        row._id = REAUTH_USER_ID.toString();
        return [row];
      }) as never);

    // In no project, so nothing else stops the delete.
    jest.spyOn(TeamMemberService, "findBy").mockResolvedValue([] as never);

    // The service's delete: its real hook, then the row is gone.
    jest.spyOn(UserService, "deleteOneById").mockImplementation((async (
      deleteById: DeleteById,
    ) => {
      await (
        UserService as unknown as {
          onBeforeDelete: (deleteBy: DeleteBy<User>) => Promise<unknown>;
        }
      ).onBeforeDelete({
        query: {
          _id: deleteById.id.toString(),
        } as unknown as DeleteBy<User>["query"],
        props: deleteById.props,
        limit: 1,
        skip: 0,
      } as DeleteBy<User>);

      deleted.push(deleteById.id.toString());
      return 1;
    }) as never);
  });

  const deleteOwnAccount: (
    sessionId?: ObjectID | null,
  ) => Promise<Answer> = async (
    sessionId?: ObjectID | null,
  ): Promise<Answer> => {
    return await call("delete", "/user/:id", {
      ...requestFor(sessionId === undefined ? {} : { sessionId: sessionId }),
      params: { id: REAUTH_USER_ID.toString() },
    } as unknown as JSONObject);
  };

  test("refused until the session confirms, saying what for, and nothing is deleted", async () => {
    const answer: Answer = await deleteOwnAccount();

    expect(answer.error).toBeInstanceOf(ReauthenticationRequiredException);
    expect(answer.error!.message).toBe(
      REAUTHENTICATION_REQUIRED_MESSAGES[ReauthenticationPurpose.DeleteAccount],
    );
    expect(getErrorDetails(answer.error)[REAUTHENTICATION_PURPOSE_FIELD]).toBe(
      ReauthenticationPurpose.DeleteAccount,
    );
    expect(deleted).toEqual([]);
  });

  test("once the session confirmed with the password, the same delete goes through", async () => {
    expect(
      (
        await confirmWith({
          [REAUTHENTICATION_FIELDS.password]: RIGHT_PASSWORD,
        })
      ).error,
    ).toBeNull();

    const answer: Answer = await deleteOwnAccount();

    expect(answer.error).toBeNull();
    expect(deleted).toEqual([REAUTH_USER_ID.toString()]);
  });

  test("another session's confirmation does not count", async () => {
    await confirmWith({ [REAUTHENTICATION_FIELDS.password]: RIGHT_PASSWORD });

    const answer: Answer = await deleteOwnAccount(ObjectID.generate());

    expect(answer.error).toBeInstanceOf(ReauthenticationRequiredException);
    expect(deleted).toEqual([]);
  });

  test("a request with no session - an API key, an MCP client - cannot delete its account", async () => {
    const answer: Answer = await deleteOwnAccount(null);

    expect(answer.error?.message).toBe(
      REAUTHENTICATION_NOT_FROM_A_SESSION_MESSAGES[
        ReauthenticationPurpose.DeleteAccount
      ],
    );
    expect(deleted).toEqual([]);
  });
});
