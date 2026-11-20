import UserAPI from "../../../Server/API/UserAPI";
import MasterAdminAuthorization from "../../../Server/Middleware/MasterAdminAuthorization";
import UserMiddleware, {
  RequestSession,
} from "../../../Server/Middleware/UserAuthorization";
import JSONWebTokenData from "../../../Types/JsonWebTokenData";
import {
  ExpressResponse,
  NextFunction,
  OneUptimeRequest,
} from "../../../Server/Utils/Express";
import LocalSignInClearing from "../../../Server/Utils/LocalSignInClearing";
import Response from "../../../Server/Utils/Response";
import { mockRouter } from "./Helpers";
import Dictionary from "../../../Types/Dictionary";
import BadDataException from "../../../Types/Exception/BadDataException";
import NotAuthenticatedException from "../../../Types/Exception/NotAuthenticatedException";
import NotFoundException from "../../../Types/Exception/NotFoundException";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import {
  CLEAR_LOCAL_SIGN_IN_ACTION,
  CLEAR_OWN_SIGN_IN_MESSAGE,
  ClearLocalSignInAnswer,
  readClearLocalSignInAnswer,
} from "../../../Types/SSO/LocalSignInClearing";
// The global jest, as the other master-admin route suites use it.
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "@jest/globals";
import { confirmEverySession } from "../TestingUtils/ReauthenticationConfirmed";

/*
 * A master admin's change to how someone signs in waits until the session confirms it's its
 * person's (Confirm It's You, #10216): every session here has confirmed.
 * The check itself, through the same hooks and routes, is pinned by
 * Tests/Server/Services/AdminReauthenticationGates.test.ts and
 * Tests/Server/API/AdminReauthenticationRoutes.test.ts.
 */
beforeEach(() => {
  confirmEverySession();
});

/*
 * POST /user/:userId/clear-local-sign-in (issue #9762): a master admin
 * clearing one person's password, passkeys, security keys, authenticator
 * apps, backup codes and two-factor authentication.
 *
 * What this route itself is responsible for - LocalSignInClearing, pinned
 * in Tests/Server/Utils/LocalSignInClearing, does the clearing:
 *
 *   - the SESSION-only master-admin middleware, never the master API key:
 *     a leaked static key that could strip people's sign-in would lock out
 *     everyone on the server;
 *   - the master admin is the session's own person, never one named in the
 *     body, so the "never your own account" rule cannot be stepped around;
 *   - `isMasterAdminConfirmed` is true only when the body says exactly
 *     true: a string "true", a 1 or an object confirms nothing, and is
 *     refused before anything is cleared;
 *   - a person id that is not an id is refused before anything is cleared;
 *   - the answer is what was removed, and how many sessions ended.
 */

jest.mock("../../../Server/Utils/Express", () => {
  return {
    getRouter: () => {
      return mockRouter;
    },
  };
});

jest.mock("../../../Server/Utils/Response", () => {
  return {
    sendEntityArrayResponse: jest.fn(),
    sendJsonArrayResponse: jest.fn(),
    sendJsonObjectResponse: jest.fn(),
    sendEmptySuccessResponse: jest.fn(),
    sendEntityResponse: jest.fn(),
    sendErrorResponse: jest.fn(),
    sendFileResponse: jest.fn(),
    sendFileByPath: jest.fn(),
    setNoCacheHeaders: jest.fn(),
  };
});

const ROUTE: string = `/user/:userId/${CLEAR_LOCAL_SIGN_IN_ACTION}`;

const PERSON_ID: string = "00000000-0000-4000-8000-000000000001";
const ADMIN_ID: ObjectID = new ObjectID("00000000-0000-4000-8000-0000000000aa");
const SOMEBODY_ELSE: string = "00000000-0000-4000-8000-0000000000bb";

const ANSWER: ClearLocalSignInAnswer = {
  cleared: {
    hasPassword: true,
    isTwoFactorAuthEnabled: true,
    authenticatorAppCount: 1,
    passkeyAndSecurityKeyCount: 2,
    backupCodeCount: 10,
  },
  sessionsEnded: 3,
};

type Call = { thrown: unknown; nextCallCount: number };

const callRoute: (data?: {
  params?: Dictionary<string> | undefined;
  body?: Dictionary<unknown> | undefined;
  signedIn?: boolean | undefined;
}) => Promise<Call> = async (
  data: {
    params?: Dictionary<string> | undefined;
    body?: Dictionary<unknown> | undefined;
    signedIn?: boolean | undefined;
  } = {},
): Promise<Call> => {
  const req: OneUptimeRequest = {
    params: data.params || { userId: PERSON_ID },
    query: {},
    body: data.body || {},
    headers: {},
    ...(data.signedIn === false
      ? {}
      : { userAuthorization: { userId: ADMIN_ID, isMasterAdmin: true } }),
  } as unknown as OneUptimeRequest;

  const res: ExpressResponse = {
    setHeader: jest.fn(),
    status: jest.fn().mockReturnThis(),
  } as unknown as ExpressResponse;

  const next: jest.Mock = jest.fn();

  await mockRouter
    .match("POST", ROUTE)
    .handlerFunction(req, res, next as unknown as NextFunction);

  return {
    thrown: next.mock.calls[0] ? next.mock.calls[0][0] : undefined,
    nextCallCount: next.mock.calls.length,
  };
};

type ClearArgument = {
  userId: ObjectID;
  clearedByUserId: ObjectID;
  isMasterAdminConfirmed: boolean;
};

let clearForPerson: jest.SpyInstance;

const firstArgument: () => ClearArgument = (): ClearArgument => {
  return clearForPerson.mock.calls[0]![0] as ClearArgument;
};

const sentJson: () => JSONObject = (): JSONObject => {
  const sent: Array<unknown> | undefined = (
    Response.sendJsonObjectResponse as unknown as jest.Mock
  ).mock.calls[0];

  return (sent?.[2] as JSONObject) || {};
};

beforeAll(() => {
  mockRouter.routes.length = 0;
  new UserAPI();
});

beforeEach(() => {
  jest.clearAllMocks();

  clearForPerson = jest
    .spyOn(LocalSignInClearing, "clearForPerson")
    .mockResolvedValue(ANSWER);

  /*
   * The session, as the route may read it for itself: the master admin on
   * the access token (UserMiddleware.readRequestSession). The request below
   * carries it as UserMiddleware.getUserMiddleware leaves it too.
   */
  jest
    .spyOn(UserMiddleware, "readRequestSession")
    .mockImplementation(async (req: unknown): Promise<RequestSession> => {
      const userId: ObjectID | undefined = (req as OneUptimeRequest)
        .userAuthorization?.userId;

      return userId
        ? {
            kind: "user",
            session: {
              userId: userId,
              isMasterAdmin: true,
            } as unknown as JSONWebTokenData,
          }
        : { kind: "none" };
    });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the route", () => {
  test("is registered where the Admin Dashboard posts", () => {
    expect(() => {
      return mockRouter.match("POST", ROUTE);
    }).not.toThrow();
  });

  test("is a master admin's only, by session, never by the master API key", () => {
    const route: ReturnType<typeof mockRouter.match> = mockRouter.match(
      "POST",
      ROUTE,
    );

    expect(route.middlewares).toContain(
      MasterAdminAuthorization.isAuthorizedMasterAdminMiddleware,
    );
    expect(route.middlewares).not.toContain(
      MasterAdminAuthorization.isAuthorizedMasterAdminOrMasterApiKeyMiddleware,
    );
  });
});

describe("clearing one person", () => {
  test("clears the person in the path, for the master admin on the session", async () => {
    const result: Call = await callRoute();

    expect(result.nextCallCount).toBe(0);
    expect(clearForPerson).toHaveBeenCalledTimes(1);
    expect(firstArgument().userId.toString()).toBe(PERSON_ID);
    expect(firstArgument().clearedByUserId.toString()).toBe(
      ADMIN_ID.toString(),
    );
    expect(firstArgument().isMasterAdminConfirmed).toBe(false);
  });

  test("answers what was removed and how many sessions ended, as the page reads it", async () => {
    await callRoute();

    expect(readClearLocalSignInAnswer(sentJson())).toEqual(ANSWER);
  });

  test("never takes the master admin, or the person, from the body", async () => {
    await callRoute({
      body: {
        clearedByUserId: SOMEBODY_ELSE,
        userId: SOMEBODY_ELSE,
        isRoot: true,
      },
    });

    expect(firstArgument().userId.toString()).toBe(PERSON_ID);
    expect(firstArgument().clearedByUserId.toString()).toBe(
      ADMIN_ID.toString(),
    );
    expect(Object.keys(firstArgument()).sort()).toEqual([
      "clearedByUserId",
      "isMasterAdminConfirmed",
      "userId",
    ]);
  });

  test("a master admin's is asked for with an exact true", async () => {
    await callRoute({ body: { isMasterAdminConfirmed: true } });

    expect(firstArgument().isMasterAdminConfirmed).toBe(true);
  });

  test("false confirms nothing", async () => {
    await callRoute({ body: { isMasterAdminConfirmed: false } });

    expect(firstArgument().isMasterAdminConfirmed).toBe(false);
  });

  test.each([
    ["the string true", "true"],
    ["a 1", 1],
    ["null", null],
    ["an object", { value: true }],
    ["a list", [true]],
  ])(
    "%s is refused before anything is cleared",
    async (_label: string, value: unknown) => {
      const result: Call = await callRoute({
        body: { isMasterAdminConfirmed: value },
      });

      expect(result.thrown).toBeInstanceOf(BadDataException);
      // A sentence that names the field, as every refusal is.
      expect((result.thrown as Error).message).toMatch(/^[A-Z].*\.$/);
      expect((result.thrown as Error).message).toContain(
        "isMasterAdminConfirmed",
      );
      expect(clearForPerson).not.toHaveBeenCalled();
      expect(Response.sendJsonObjectResponse).not.toHaveBeenCalled();
    },
  );

  test.each([
    "not-a-uuid",
    "1; DROP TABLE users",
    "00000000-0000-4000-8000-00000000000",
  ])(
    "a person id that is not an id (%s) is refused before anything is cleared",
    async (userId: string) => {
      const result: Call = await callRoute({ params: { userId: userId } });

      expect(result.thrown).toBeInstanceOf(BadDataException);
      expect(clearForPerson).not.toHaveBeenCalled();
    },
  );

  test("a request with no session is not authenticated, and nothing is cleared", async () => {
    const result: Call = await callRoute({ signedIn: false });

    expect(result.thrown).toBeInstanceOf(NotAuthenticatedException);
    expect(clearForPerson).not.toHaveBeenCalled();
  });

  test("a refusal - their own account - is passed on, never answered as cleared", async () => {
    clearForPerson.mockRejectedValue(
      new BadDataException(CLEAR_OWN_SIGN_IN_MESSAGE),
    );

    const result: Call = await callRoute({
      params: { userId: ADMIN_ID.toString() },
    });

    expect((result.thrown as Error).message).toBe(CLEAR_OWN_SIGN_IN_MESSAGE);
    expect(Response.sendJsonObjectResponse).not.toHaveBeenCalled();
  });

  test("a person who does not exist is not found", async () => {
    clearForPerson.mockRejectedValue(new NotFoundException("User not found."));

    const result: Call = await callRoute();

    expect(result.thrown).toBeInstanceOf(NotFoundException);
  });
});
