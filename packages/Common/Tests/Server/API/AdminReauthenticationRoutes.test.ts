import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { Mock } from "jest-mock";
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
    sendTextResponse: jest.fn(),
    setNoCacheHeaders: jest.fn(),
  };
});

jest.mock("../../../Server/Infrastructure/Redis", () => {
  return {
    __esModule: true,
    default: { getClient: jest.fn(), isConnected: jest.fn() },
  };
});

import GlobalConfigAPI from "../../../Server/API/GlobalConfigAPI";
import UserAPI from "../../../Server/API/UserAPI";
import Redis from "../../../Server/Infrastructure/Redis";
import MasterAdminAuthorization from "../../../Server/Middleware/MasterAdminAuthorization";
import UserMiddleware, {
  RequestSession,
} from "../../../Server/Middleware/UserAuthorization";
import GlobalConfigService from "../../../Server/Services/GlobalConfigService";
import UserService from "../../../Server/Services/UserService";
import { ExpressResponse, NextFunction } from "../../../Server/Utils/Express";
import LocalSignInClearing from "../../../Server/Utils/LocalSignInClearing";
import Reauthentication from "../../../Server/Utils/Reauthentication/Reauthentication";
import Response from "../../../Server/Utils/Response";
import {
  REAUTHENTICATION_NOT_FROM_A_SESSION_MESSAGES,
  REAUTHENTICATION_PURPOSE_FIELD,
  REAUTHENTICATION_REQUIRED_MESSAGES,
  REAUTHENTICATION_WINDOW_IN_MINUTES,
  ReauthenticationPurpose,
} from "../../../Types/Accounts/Reauthentication";
import Email from "../../../Types/Email";
import { getErrorDetails } from "../../../Types/Exception/BadDataExceptionWithDetails";
import BadDataException from "../../../Types/Exception/BadDataException";
import Exception from "../../../Types/Exception/Exception";
import ReauthenticationRequiredException from "../../../Types/Exception/ReauthenticationRequiredException";
import { JSONObject } from "../../../Types/JSON";
import JSONWebTokenData from "../../../Types/JsonWebTokenData";
import { MASTER_API_KEY_ROUTE } from "../../../Types/MasterApiKey/MasterApiKeyAnswer";
import { CLEAR_LOCAL_SIGN_IN_ACTION } from "../../../Types/SSO/LocalSignInClearing";
import ObjectID from "../../../Types/ObjectID";
import {
  MINUTE_IN_MS,
  PASSWORD_ACCOUNT,
  REAUTH_OTHER_USER_ID,
  REAUTH_SESSION_ID,
  REAUTH_USER_ID,
  RIGHT_PASSWORD,
  StandInAccount,
  StandInValkey,
  TWO_FACTOR_ACCOUNT,
  RIGHT_CODE,
  standInAccount,
} from "../TestingUtils/ReauthenticationStandIns";

/*
 * A MASTER ADMIN'S CHANGE TO HOW SOMEONE SIGNS IN WAITS UNTIL THEIR SESSION
 * CONFIRMS IT'S THEM (#10216), at the Admin Dashboard's routes.
 *
 * Whoever held a master admin's session - a laptop left unlocked, a stolen
 * cookie - could take any account on the server over in one request: set
 * its password, copy a link that sets it, take its second step away, or
 * clear its sign-in settings; and walk away with a new master API key. Each
 * route below now asks the master admin's own session first
 * (MasterAdminAuthorization.assertSessionConfirmed), through the real check
 * (Server/Utils/Reauthentication) against Valkey in memory, and:
 *
 *   - refuses while the session has not confirmed, with the code the Admin
 *     Dashboard's prompt acts on and what it is for (AdminChange), before
 *     the service is asked anything;
 *   - goes through once the master admin confirmed with their own password
 *     (and second step), for the window, and is refused again after it;
 *   - refuses a request whose access token names no session.
 *
 * Requiring two-factor authentication of someone only adds a step to their
 * sign-in, and asks nothing. The session is the one the request's access
 * token names (readRequestSession), never anything in the body.
 */

let valkey: StandInValkey;
let account: StandInAccount;
let requestSession: RequestSession;

const OTHER: string = REAUTH_OTHER_USER_ID.toString();

interface Answer {
  error: Exception | null;
  reached: boolean;
}

// The master admin's session, as the access token names it.
function masterAdminToken(withSession: boolean = true): JSONWebTokenData {
  return {
    userId: REAUTH_USER_ID,
    email: new Email("river@example.com"),
    name: "River",
    isMasterAdmin: true,
    isGlobalLogin: true,
    ...(withSession ? { sessionId: REAUTH_SESSION_ID } : {}),
  } as unknown as JSONWebTokenData;
}

async function call(
  route: string,
  body: JSONObject,
  reachedSpy: Mock<(...args: Array<never>) => unknown>,
  params: JSONObject = { userId: OTHER },
): Promise<Answer> {
  const next: Mock<(error?: unknown) => void> = jest.fn();

  await mockRouter
    .match("post", route)
    .handlerFunction(
      {
        params: params,
        query: {},
        body: body,
        headers: { "user-agent": "jest" },
      } as never,
      { setHeader: jest.fn() } as unknown as ExpressResponse,
      next as unknown as NextFunction,
    );

  return {
    error: next.mock.calls[0] ? (next.mock.calls[0][0] as Exception) : null,
    reached: reachedSpy.mock.calls.length > 0,
  };
}

async function confirm(): Promise<void> {
  await Reauthentication.confirm({
    session: { userId: REAUTH_USER_ID, sessionId: REAUTH_SESSION_ID },
    proof: {
      password: RIGHT_PASSWORD,
      ...(account.isTwoFactorOn ? { code: RIGHT_CODE } : {}),
    },
    clientIp: "203.0.113.9",
  });
}

function minutesPass(minutes: number): void {
  jest.setSystemTime(Date.now() + minutes * MINUTE_IN_MS);
}

function expectAdminRefusal(error: Exception | null): void {
  expect(error).toBeInstanceOf(ReauthenticationRequiredException);
  expect(error!.message).toBe(
    REAUTHENTICATION_REQUIRED_MESSAGES[ReauthenticationPurpose.AdminChange],
  );
  expect(getErrorDetails(error)[REAUTHENTICATION_PURPOSE_FIELD]).toBe(
    ReauthenticationPurpose.AdminChange,
  );
}

let setPassword: Mock<(...args: Array<never>) => unknown>;
let getSetPasswordLink: Mock<(...args: Array<never>) => unknown>;
let setTwoFactorAuthRequired: Mock<(...args: Array<never>) => unknown>;
let resetTwoFactorAuth: Mock<(...args: Array<never>) => unknown>;
let clearForPerson: Mock<(...args: Array<never>) => unknown>;
let createMasterApiKey: Mock<(...args: Array<never>) => unknown>;

beforeEach(() => {
  jest.useFakeTimers({
    doNotFake: [
      "nextTick",
      "setImmediate",
      "setTimeout",
      "setInterval",
      "clearTimeout",
      "clearInterval",
      "queueMicrotask",
    ],
  });

  mockRouter.routes.length = 0;
  new UserAPI();
  new GlobalConfigAPI();

  valkey = new StandInValkey();
  account = { ...PASSWORD_ACCOUNT, isMasterAdmin: true };
  requestSession = { kind: "user", session: masterAdminToken() };

  jest.mocked(Redis.getClient).mockImplementation((() => {
    return valkey.isDown ? null : valkey;
  }) as never);
  jest.mocked(Redis.isConnected).mockImplementation(() => {
    return !valkey.isDown;
  });

  standInAccount(() => {
    return account;
  });

  jest
    .spyOn(UserMiddleware, "readRequestSession")
    .mockImplementation(async () => {
      return requestSession;
    });

  setPassword = jest
    .spyOn(UserService, "setPassword")
    .mockResolvedValue(undefined as never) as unknown as Mock<
    (...args: Array<never>) => unknown
  >;
  getSetPasswordLink = jest
    .spyOn(UserService, "getSetPasswordLink")
    .mockResolvedValue({
      link: "https://oneuptime.example.com/accounts/reset-password/a-token",
      email: new Email("someone@example.com"),
    } as never) as unknown as Mock<(...args: Array<never>) => unknown>;
  setTwoFactorAuthRequired = jest
    .spyOn(UserService, "setTwoFactorAuthRequired")
    .mockResolvedValue(undefined as never) as unknown as Mock<
    (...args: Array<never>) => unknown
  >;
  resetTwoFactorAuth = jest
    .spyOn(UserService, "resetTwoFactorAuth")
    .mockResolvedValue(undefined as never) as unknown as Mock<
    (...args: Array<never>) => unknown
  >;
  clearForPerson = jest
    .spyOn(LocalSignInClearing, "clearForPerson")
    .mockResolvedValue({ cleared: {} } as never) as unknown as Mock<
    (...args: Array<never>) => unknown
  >;
  createMasterApiKey = jest
    .spyOn(GlobalConfigService, "createMasterApiKey")
    .mockResolvedValue("a-new-master-api-key" as never) as unknown as Mock<
    (...args: Array<never>) => unknown
  >;
  jest.spyOn(GlobalConfigService, "getMasterApiKeyState").mockResolvedValue({
    isSet: true,
    isEnabled: true,
    createdAt: null,
    createdByName: null,
    hint: null,
  } as never);
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
  jest.mocked(Response.sendJsonObjectResponse).mockClear();
  jest.mocked(Response.sendEmptySuccessResponse).mockClear();
});

type RouteCase = [
  string,
  string,
  JSONObject,
  () => Mock<(...args: Array<never>) => unknown>,
  JSONObject | undefined,
];

const ROUTES: Array<RouteCase> = [
  [
    "Set Password",
    "/user/:userId/set-password",
    { password: "a much newer password, 2026" },
    () => {
      return setPassword;
    },
    undefined,
  ],
  [
    "a link to set a first password",
    "/user/:userId/set-password-link",
    {},
    () => {
      return getSetPasswordLink;
    },
    undefined,
  ],
  [
    "no longer requiring two-factor authentication",
    "/user/:userId/set-two-factor-auth-required",
    { isRequired: false },
    () => {
      return setTwoFactorAuthRequired;
    },
    undefined,
  ],
  [
    "resetting two-factor authentication",
    "/user/:userId/reset-two-factor-auth",
    {},
    () => {
      return resetTwoFactorAuth;
    },
    undefined,
  ],
  [
    "clearing someone's sign-in settings",
    `/user/:userId/${CLEAR_LOCAL_SIGN_IN_ACTION}`,
    {},
    () => {
      return clearForPerson;
    },
    undefined,
  ],
  [
    "a new master API key",
    MASTER_API_KEY_ROUTE,
    {},
    () => {
      return createMasterApiKey;
    },
    {},
  ],
];

describe.each(ROUTES)(
  "%s",
  (
    _name: string,
    route: string,
    body: JSONObject,
    reached: () => Mock<(...args: Array<never>) => unknown>,
    params: JSONObject | undefined,
  ) => {
    test("behind the master-admin session gate, never the master API key", () => {
      expect(mockRouter.match("post", route).middlewares).toContain(
        MasterAdminAuthorization.isAuthorizedMasterAdminMiddleware,
      );
    });

    test("refused until the master admin's session confirms, before the service is asked anything", async () => {
      const answer: Answer = await call(route, body, reached(), params);

      expectAdminRefusal(answer.error);
      expect(answer.reached).toBe(false);
    });

    test("through once they confirmed with their own password, for the window, refused after it", async () => {
      await confirm();

      const through: Answer = await call(route, body, reached(), params);

      expect(through.error).toBeNull();
      expect(through.reached).toBe(true);

      reached().mockClear();
      minutesPass(REAUTHENTICATION_WINDOW_IN_MINUTES + 1);

      const stale: Answer = await call(route, body, reached(), params);

      expectAdminRefusal(stale.error);
      expect(stale.reached).toBe(false);
    });

    test("a master admin with two-factor authentication confirms with their second step too", async () => {
      account = { ...TWO_FACTOR_ACCOUNT, isMasterAdmin: true };

      await refusalOfConfirmation({ password: RIGHT_PASSWORD });

      expectAdminRefusal((await call(route, body, reached(), params)).error);

      await confirm();

      expect((await call(route, body, reached(), params)).reached).toBe(true);
    });

    test("another master admin's confirmation does not count: only this session's", async () => {
      await Reauthentication.confirm({
        session: { userId: REAUTH_USER_ID, sessionId: ObjectID.generate() },
        proof: { password: RIGHT_PASSWORD },
        clientIp: "203.0.113.9",
      });

      expectAdminRefusal((await call(route, body, reached(), params)).error);
    });

    test("an access token that names no session is refused, with what to do", async () => {
      requestSession = { kind: "user", session: masterAdminToken(false) };

      const answer: Answer = await call(route, body, reached(), params);

      expect(answer.error).toBeInstanceOf(BadDataException);
      expect(answer.error).not.toBeInstanceOf(
        ReauthenticationRequiredException,
      );
      expect(answer.error!.message).toBe(
        REAUTHENTICATION_NOT_FROM_A_SESSION_MESSAGES[
          ReauthenticationPurpose.AdminChange
        ],
      );
      expect(answer.reached).toBe(false);
    });
  },
);

describe("requiring two-factor authentication of someone", () => {
  test("only adds a step to their sign-in, and asks nothing", async () => {
    const answer: Answer = await call(
      "/user/:userId/set-two-factor-auth-required",
      { isRequired: true },
      setTwoFactorAuthRequired,
    );

    expect(answer.error).toBeNull();
    expect(answer.reached).toBe(true);
  });

  test("a malformed answer is refused for what it is, before anything is asked", async () => {
    const answer: Answer = await call(
      "/user/:userId/set-two-factor-auth-required",
      { isRequired: "false" },
      setTwoFactorAuthRequired,
    );

    expect(answer.error).toBeInstanceOf(BadDataException);
    expect(answer.error).not.toBeInstanceOf(ReauthenticationRequiredException);
    expect(answer.reached).toBe(false);
  });
});

describe("sending someone a reset link, to their own address", () => {
  test("asks nothing: the link goes to the person, never to whoever asked", async () => {
    const sendPasswordResetLink: Mock<(...args: Array<never>) => unknown> =
      jest
        .spyOn(UserService, "sendPasswordResetLink")
        .mockResolvedValue(
          new Email("someone@example.com") as never,
        ) as unknown as Mock<(...args: Array<never>) => unknown>;

    const answer: Answer = await call(
      "/user/:userId/send-password-reset-link",
      {},
      sendPasswordResetLink,
    );

    expect(answer.error).toBeNull();
    expect(answer.reached).toBe(true);
  });
});

async function refusalOfConfirmation(proof: JSONObject): Promise<void> {
  try {
    await Reauthentication.confirm({
      session: { userId: REAUTH_USER_ID, sessionId: REAUTH_SESSION_ID },
      proof: proof,
      clientIp: "203.0.113.9",
    });
  } catch {
    return;
  }

  throw new Error("Expected the confirmation to be refused.");
}
