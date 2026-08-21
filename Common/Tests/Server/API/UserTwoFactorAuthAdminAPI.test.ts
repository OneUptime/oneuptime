import UserAPI from "../../../Server/API/UserAPI";
import MasterAdminAuthorization from "../../../Server/Middleware/MasterAdminAuthorization";
import UserService from "../../../Server/Services/UserService";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import Response from "../../../Server/Utils/Response";
import { mockRouter } from "./Helpers";
import Dictionary from "../../../Types/Dictionary";
import BadDataException from "../../../Types/Exception/BadDataException";
import NotFoundException from "../../../Types/Exception/NotFoundException";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import TwoFactorAuthStatus from "../../../Types/TwoFactorAuthStatus";
import UserAuthenticationStatus from "../../../Types/UserAuthenticationStatus";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "@jest/globals";

/*
 * The two master-admin endpoints that let an operator drive somebody else's
 * two factor auth, plus the status payload the page reads before it draws the
 * buttons.
 *
 * POST /user/:userId/set-two-factor-auth-required turns the REQUIREMENT on or
 * off. It exists as its own route rather than a PUT to /user/:id carrying
 * `enableTwoFactorAuth` because the generic write would succeed -- a master
 * admin bypasses that column's ACL -- while quietly skipping the session
 * revocation that makes the new requirement mean anything for people already
 * signed in. That revocation lives in UserService.setTwoFactorAuthRequired.
 *
 * POST /user/:userId/reset-two-factor-auth is the lost-device escape hatch: it
 * clears every authenticator so the user is sent back through enrolment. It
 * deliberately does NOT clear the requirement, and it deliberately takes no
 * body.
 *
 * Two properties in this file are load-bearing in a way nothing else in the
 * suite would notice going missing:
 *
 *   1. Both routes are gated by the SESSION-only master-admin middleware. The
 *      instance-wide master API key variant must never appear here: a leaked
 *      static key that can read is a disclosure, but one that can switch two
 *      factor auth off across every account on the instance is an account
 *      takeover with the safety catch removed.
 *
 *   2. `isRequired` is checked with `typeof`, not truthiness. A truthiness
 *      check would read a missing field, a null, or the STRING "false" as
 *      "turn the requirement off" -- weakening an account's security in
 *      response to a call that was merely malformed.
 *
 * NotAuthorizedException maps to HTTP 422 in this codebase rather than 401 or
 * 403, which is why these tests assert on the middleware's identity rather
 * than on any status code: the status code is not where the protection lives.
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

const SET_REQUIRED_ROUTE: string = "/user/:userId/set-two-factor-auth-required";
const RESET_ROUTE: string = "/user/:userId/reset-two-factor-auth";
const STATUS_ROUTE: string = "/user/:userId/authentication-status";

const USER_ID: string = "00000000-0000-4000-8000-000000000001";

type RouteCallResult = {
  thrownToNext: unknown;
  nextCallCount: number;
  res: ExpressResponse;
};

async function callRoute(data: {
  method: string;
  route: string;
  params?: Dictionary<string> | undefined;
  query?: Dictionary<string> | undefined;
  body?: Dictionary<unknown> | undefined;
}): Promise<RouteCallResult> {
  const req: ExpressRequest = {
    params: data.params || {},
    query: data.query || {},
    body: data.body || {},
    headers: {},
  } as unknown as ExpressRequest;

  const res: ExpressResponse = {
    send: jest.fn(),
    json: jest.fn(),
    setHeader: jest.fn(),
    status: jest.fn().mockReturnThis(),
  } as unknown as ExpressResponse;

  const next: jest.Mock = jest.fn();

  await mockRouter
    .match(data.method, data.route)
    .handlerFunction(req, res, next as unknown as NextFunction);

  return {
    thrownToNext: next.mock.calls[0] ? next.mock.calls[0][0] : undefined,
    nextCallCount: next.mock.calls.length,
    res: res,
  };
}

function asMock(fn: unknown): jest.Mock {
  return fn as unknown as jest.Mock;
}

function sentJsonObject(): JSONObject {
  const call: Array<unknown> | undefined = asMock(
    Response.sendJsonObjectResponse,
  ).mock.calls[0];

  return (call?.[2] as JSONObject) || {};
}

/*
 * User ids that are syntactically wrong in ways the route must catch before
 * anything downstream sees them. The SQL-shaped entries are not decoration:
 * the id becomes part of a database query once it is past the route, so the
 * assertion below is "rejected BEFORE the service is reached", not "rejected
 * eventually". A route that validated after calling the service would still
 * return an error to the caller and look correct from the outside.
 */
type MalformedUserIdCase = {
  label: string;
  userId: string;
};

const MALFORMED_USER_IDS: Array<MalformedUserIdCase> = [
  { label: "a word that is not a uuid", userId: "not-a-uuid" },
  { label: "a number with sql appended", userId: "1; DROP TABLE users" },
  { label: "sql instead of a uuid", userId: '\'; DROP TABLE "User"; --' },
  { label: "a numeric id", userId: "12345" },
  {
    label: "a uuid missing its last character",
    userId: "00000000-0000-4000-8000-00000000000",
  },
];

describe("POST /user/:userId/set-two-factor-auth-required", () => {
  let setRequiredSpy: jest.SpyInstance;

  beforeAll(() => {
    mockRouter.routes.length = 0;
    new UserAPI();
  });

  beforeEach(() => {
    jest.clearAllMocks();

    setRequiredSpy = jest
      .spyOn(UserService, "setTwoFactorAuthRequired")
      .mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  type FirstArgument = { userId: ObjectID; isRequired: boolean };

  const firstArgument: () => FirstArgument = (): FirstArgument => {
    return setRequiredSpy.mock.calls[0]![0] as FirstArgument;
  };

  test("the route is registered", () => {
    /*
     * A typo in the path is neither a compile error nor a failure anywhere
     * else -- it is a 404 the Admin Dashboard surfaces as an unexplained error
     * the first time an operator tries to mandate two factor auth.
     */
    expect(() => {
      return mockRouter.match("POST", SET_REQUIRED_ROUTE);
    }).not.toThrow();
  });

  test("only a master admin can reach it", () => {
    /*
     * Without this middleware every signed-in user on the instance could turn
     * two factor auth off for every other account, which is the last step
     * before taking one over.
     */
    expect(mockRouter.match("POST", SET_REQUIRED_ROUTE).middleware).toBe(
      MasterAdminAuthorization.isAuthorizedMasterAdminMiddleware,
    );
  });

  test("does not accept the instance-wide master API key", () => {
    /*
     * The master API key is a static, long-lived secret that lives in an
     * instance's environment. It is scoped to reads on purpose: a leaked key
     * that can READ discloses data, but a leaked key that can switch off the
     * two factor auth requirement on every account on the instance is a
     * takeover primitive. Swapping this middleware for the
     * ...OrMasterApiKeyMiddleware variant is a one-word edit that no other
     * assertion in the suite would notice, so it is checked by identity here.
     */
    const violations: Array<string> = [];

    const middleware: unknown = mockRouter.match(
      "POST",
      SET_REQUIRED_ROUTE,
    ).middleware;

    if (
      middleware ===
      MasterAdminAuthorization.isAuthorizedMasterAdminOrMasterApiKeyMiddleware
    ) {
      violations.push(
        "set-two-factor-auth-required accepts the instance-wide master API key",
      );
    }

    if (
      middleware !== MasterAdminAuthorization.isAuthorizedMasterAdminMiddleware
    ) {
      violations.push(
        "set-two-factor-auth-required is not gated by the session-only master admin middleware",
      );
    }

    expect(violations).toEqual([]);
  });

  test("requiring two factor auth reaches the service for the user in the path", async () => {
    await callRoute({
      method: "POST",
      route: SET_REQUIRED_ROUTE,
      params: { userId: USER_ID },
      body: { isRequired: true },
    });

    expect(setRequiredSpy).toHaveBeenCalledTimes(1);
    expect(firstArgument().userId.toString()).toBe(USER_ID);
    expect(firstArgument().isRequired).toBe(true);
  });

  test("no longer requiring it reaches the service as a literal false", async () => {
    /*
     * `false` is the value most likely to be lost on the way through: dropped
     * by a `if (isRequired)` guard, or coerced by a helper that treats it as
     * "not supplied". Either way the service would be called with the
     * requirement still on, or not called at all, and the page would report
     * success over a change that never happened.
     */
    await callRoute({
      method: "POST",
      route: SET_REQUIRED_ROUTE,
      params: { userId: USER_ID },
      body: { isRequired: false },
    });

    expect(setRequiredSpy).toHaveBeenCalledTimes(1);
    expect(firstArgument().userId.toString()).toBe(USER_ID);
    expect(firstArgument().isRequired).toBe(false);
    expect(typeof firstArgument().isRequired).toBe("boolean");
  });

  test("passes exactly userId and isRequired to the service", async () => {
    /*
     * The service decides everything else -- session revocation, whether the
     * write is a no-op. Extra keys forwarded from the request body would be a
     * way for a caller to steer a service that was never written to be
     * steered.
     */
    await callRoute({
      method: "POST",
      route: SET_REQUIRED_ROUTE,
      params: { userId: USER_ID },
      body: { isRequired: true, isRoot: true, userId: "somebody-else" },
    });

    expect(Object.keys(firstArgument()).sort()).toEqual([
      "isRequired",
      "userId",
    ]);
  });

  test("reports success with an empty body", async () => {
    await callRoute({
      method: "POST",
      route: SET_REQUIRED_ROUTE,
      params: { userId: USER_ID },
      body: { isRequired: true },
    });

    expect(Response.sendEmptySuccessResponse).toHaveBeenCalledTimes(1);
    expect(Response.sendJsonObjectResponse).not.toHaveBeenCalled();
  });

  /*
   * THE case this route's `typeof` check exists for.
   *
   * Every value below is something a malformed or hostile client can put in
   * `isRequired`. Under a truthiness check -- `Boolean(req.body["isRequired"])`
   * or `if (req.body["isRequired"])` -- a missing field, a null, a 0 and the
   * STRING "false" all collapse to false, and the route would happily go and
   * turn the two factor auth requirement OFF for the named account. The string
   * "true" and an empty object collapse the other way and would turn it on for
   * an account nobody asked about. Neither direction is acceptable, so the
   * assertion is the same for all of them: BadDataException out, and the
   * service never touched.
   */
  type NonBooleanCase = {
    label: string;
    body: Dictionary<unknown>;
  };

  const NON_BOOLEAN_CASES: Array<NonBooleanCase> = [
    { label: "the field is missing entirely", body: {} },
    { label: "undefined", body: { isRequired: undefined } },
    { label: "null", body: { isRequired: null } },
    { label: 'the string "true"', body: { isRequired: "true" } },
    { label: 'the string "false"', body: { isRequired: "false" } },
    { label: "the number 1", body: { isRequired: 1 } },
    { label: "the number 0", body: { isRequired: 0 } },
    { label: "an empty object", body: { isRequired: {} } },
    { label: "an empty array", body: { isRequired: [] } },
    { label: "an array holding a boolean", body: { isRequired: [false] } },
    {
      label: "an object with a boolean-ish valueOf",
      body: { isRequired: { valueOf: false } },
    },
  ];

  test.each(NON_BOOLEAN_CASES)(
    "refuses to act when isRequired is $label",
    async (testCase: NonBooleanCase): Promise<void> => {
      const result: RouteCallResult = await callRoute({
        method: "POST",
        route: SET_REQUIRED_ROUTE,
        params: { userId: USER_ID },
        body: testCase.body,
      });

      const violations: Array<string> = [];

      if (setRequiredSpy.mock.calls.length > 0) {
        violations.push(
          `the service was called with a non-boolean isRequired (${testCase.label})`,
        );
      }

      if (!(result.thrownToNext instanceof BadDataException)) {
        violations.push(
          `a non-boolean isRequired (${testCase.label}) did not produce a BadDataException`,
        );
      }

      if (result.nextCallCount !== 1) {
        violations.push(
          `next() was called ${result.nextCallCount} times, expected exactly 1`,
        );
      }

      if (asMock(Response.sendEmptySuccessResponse).mock.calls.length > 0) {
        violations.push(
          `a non-boolean isRequired (${testCase.label}) was reported as a success`,
        );
      }

      expect(violations).toEqual([]);
    },
  );

  test("the non-boolean table is not empty", () => {
    /*
     * A `test.each` over an empty table registers no tests and the suite still
     * goes green. This guard makes a table that ever gets emptied -- by a bad
     * merge, or by a refactor that moves the cases elsewhere -- fail loudly
     * instead of silently removing the protection above.
     */
    expect(NON_BOOLEAN_CASES.length).toBeGreaterThan(5);
  });

  test("rejects a missing user id without writing anything", async () => {
    const result: RouteCallResult = await callRoute({
      method: "POST",
      route: SET_REQUIRED_ROUTE,
      params: {},
      body: { isRequired: true },
    });

    expect(setRequiredSpy).not.toHaveBeenCalled();
    expect(result.nextCallCount).toBe(1);
    expect(result.thrownToNext).toBeInstanceOf(BadDataException);
    expect((result.thrownToNext as BadDataException).message).toBe(
      "User ID is required",
    );
    expect(Response.sendEmptySuccessResponse).not.toHaveBeenCalled();
  });

  test("rejects a whitespace-only user id without writing anything", async () => {
    /*
     * "   " is truthy, so a bare `if (!userIdParam)` written against the raw
     * param would let it through and hand the service an ObjectID built from
     * blank space.
     */
    const result: RouteCallResult = await callRoute({
      method: "POST",
      route: SET_REQUIRED_ROUTE,
      params: { userId: "   " },
      body: { isRequired: true },
    });

    expect(setRequiredSpy).not.toHaveBeenCalled();
    expect(result.nextCallCount).toBe(1);
    expect(result.thrownToNext).toBeInstanceOf(BadDataException);
    expect(Response.sendEmptySuccessResponse).not.toHaveBeenCalled();
  });

  test.each(MALFORMED_USER_IDS)(
    "rejects $label before the service is reached",
    async (testCase: MalformedUserIdCase): Promise<void> => {
      const result: RouteCallResult = await callRoute({
        method: "POST",
        route: SET_REQUIRED_ROUTE,
        params: { userId: testCase.userId },
        body: { isRequired: true },
      });

      const violations: Array<string> = [];

      if (setRequiredSpy.mock.calls.length > 0) {
        violations.push(`the service was reached with ${testCase.label}`);
      }

      if (!(result.thrownToNext instanceof BadDataException)) {
        violations.push(`${testCase.label} did not produce a BadDataException`);
      }

      if (asMock(Response.sendEmptySuccessResponse).mock.calls.length > 0) {
        violations.push(`${testCase.label} was reported as a success`);
      }

      expect(violations).toEqual([]);
    },
  );

  test("passes a not-found failure on rather than reporting success", async () => {
    /*
     * "No such user" reported as a 200 would tell an operator that two factor
     * auth is now mandatory for an account that does not exist -- and they
     * would stop looking for the typo in the id they pasted.
     */
    const writeError: NotFoundException = new NotFoundException(
      "User not found.",
    );

    setRequiredSpy.mockRejectedValue(writeError);

    const result: RouteCallResult = await callRoute({
      method: "POST",
      route: SET_REQUIRED_ROUTE,
      params: { userId: USER_ID },
      body: { isRequired: true },
    });

    expect(result.thrownToNext).toBe(writeError);
    expect(result.nextCallCount).toBe(1);
    expect(Response.sendEmptySuccessResponse).not.toHaveBeenCalled();
  });

  test("passes an unexpected failure on rather than reporting success", async () => {
    /*
     * The service revokes sessions as part of this write. A database error
     * midway through must not be swallowed: reported as success, the page
     * would say the requirement is on while the sessions that predate it are
     * still valid.
     */
    const unexpected: Error = new Error("connection terminated unexpectedly");

    setRequiredSpy.mockRejectedValue(unexpected);

    const result: RouteCallResult = await callRoute({
      method: "POST",
      route: SET_REQUIRED_ROUTE,
      params: { userId: USER_ID },
      body: { isRequired: false },
    });

    expect(result.thrownToNext).toBe(unexpected);
    expect(result.nextCallCount).toBe(1);
    expect(Response.sendEmptySuccessResponse).not.toHaveBeenCalled();
  });
});

describe("POST /user/:userId/reset-two-factor-auth", () => {
  let resetSpy: jest.SpyInstance;

  beforeAll(() => {
    mockRouter.routes.length = 0;
    new UserAPI();
  });

  beforeEach(() => {
    jest.clearAllMocks();

    resetSpy = jest
      .spyOn(UserService, "resetTwoFactorAuth")
      .mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("the route is registered", () => {
    expect(() => {
      return mockRouter.match("POST", RESET_ROUTE);
    }).not.toThrow();
  });

  test("only a master admin can reach it", () => {
    /*
     * Reset clears every authenticator the user has. Reachable by any
     * signed-in user, it would be a one-request way to strip the second factor
     * off somebody else's account and leave only their password between an
     * attacker and it.
     */
    expect(mockRouter.match("POST", RESET_ROUTE).middleware).toBe(
      MasterAdminAuthorization.isAuthorizedMasterAdminMiddleware,
    );
  });

  test("does not accept the instance-wide master API key", () => {
    /*
     * Same reasoning as the sibling route, and slightly sharper here: a static
     * environment secret that can wipe every account's authenticators removes
     * two factor auth from the whole instance without anybody signing in.
     */
    const violations: Array<string> = [];

    const middleware: unknown = mockRouter.match(
      "POST",
      RESET_ROUTE,
    ).middleware;

    if (
      middleware ===
      MasterAdminAuthorization.isAuthorizedMasterAdminOrMasterApiKeyMiddleware
    ) {
      violations.push(
        "reset-two-factor-auth accepts the instance-wide master API key",
      );
    }

    if (
      middleware !== MasterAdminAuthorization.isAuthorizedMasterAdminMiddleware
    ) {
      violations.push(
        "reset-two-factor-auth is not gated by the session-only master admin middleware",
      );
    }

    expect(violations).toEqual([]);
  });

  test("resets the user in the path", async () => {
    await callRoute({
      method: "POST",
      route: RESET_ROUTE,
      params: { userId: USER_ID },
    });

    expect(resetSpy).toHaveBeenCalledTimes(1);
    expect(
      (resetSpy.mock.calls[0]![0] as { userId: ObjectID }).userId.toString(),
    ).toBe(USER_ID);
  });

  test("calls the service with exactly a userId and nothing else", async () => {
    /*
     * Reset has no options by design -- "start again from a fresh QR code" is
     * the whole operation. An extra key arriving here would mean the handler
     * had started forwarding request data into a service that has no argument
     * to receive it safely, which is how a flag like "also clear the
     * requirement" gets smuggled in later.
     */
    await callRoute({
      method: "POST",
      route: RESET_ROUTE,
      params: { userId: USER_ID },
    });

    expect(Object.keys(resetSpy.mock.calls[0]![0] as JSONObject)).toEqual([
      "userId",
    ]);
  });

  test("ignores a request body entirely", async () => {
    /*
     * The route takes no body on purpose: a route that ignores its body cannot
     * be steered by one. Posting the sibling route's payload -- including the
     * `isRequired: false` that would DOWNGRADE the account -- must change
     * nothing about the call that goes out.
     */
    await callRoute({
      method: "POST",
      route: RESET_ROUTE,
      params: { userId: USER_ID },
      body: {
        isRequired: false,
        enableTwoFactorAuth: false,
        userId: "00000000-0000-4000-8000-0000000000ff",
      },
    });

    expect(resetSpy).toHaveBeenCalledTimes(1);

    const call: { userId: ObjectID } = resetSpy.mock.calls[0]![0] as {
      userId: ObjectID;
    };

    expect(Object.keys(call)).toEqual(["userId"]);
    expect(call.userId.toString()).toBe(USER_ID);
  });

  test("reports success with an empty body", async () => {
    await callRoute({
      method: "POST",
      route: RESET_ROUTE,
      params: { userId: USER_ID },
    });

    expect(Response.sendEmptySuccessResponse).toHaveBeenCalledTimes(1);
    expect(Response.sendJsonObjectResponse).not.toHaveBeenCalled();
  });

  test("rejects a missing user id without clearing anything", async () => {
    /*
     * A reset aimed at nobody must not become a reset aimed at whoever the
     * service would default to. It has to stop at the route.
     */
    const result: RouteCallResult = await callRoute({
      method: "POST",
      route: RESET_ROUTE,
      params: {},
    });

    expect(resetSpy).not.toHaveBeenCalled();
    expect(result.nextCallCount).toBe(1);
    expect(result.thrownToNext).toBeInstanceOf(BadDataException);
    expect((result.thrownToNext as BadDataException).message).toBe(
      "User ID is required",
    );
    expect(Response.sendEmptySuccessResponse).not.toHaveBeenCalled();
  });

  test("rejects a whitespace-only user id without clearing anything", async () => {
    const result: RouteCallResult = await callRoute({
      method: "POST",
      route: RESET_ROUTE,
      params: { userId: "  \t " },
    });

    expect(resetSpy).not.toHaveBeenCalled();
    expect(result.nextCallCount).toBe(1);
    expect(result.thrownToNext).toBeInstanceOf(BadDataException);
    expect(Response.sendEmptySuccessResponse).not.toHaveBeenCalled();
  });

  test.each(MALFORMED_USER_IDS)(
    "rejects $label before the service is reached",
    async (testCase: MalformedUserIdCase): Promise<void> => {
      const result: RouteCallResult = await callRoute({
        method: "POST",
        route: RESET_ROUTE,
        params: { userId: testCase.userId },
      });

      const violations: Array<string> = [];

      if (resetSpy.mock.calls.length > 0) {
        violations.push(`the service was reached with ${testCase.label}`);
      }

      if (!(result.thrownToNext instanceof BadDataException)) {
        violations.push(`${testCase.label} did not produce a BadDataException`);
      }

      if (asMock(Response.sendEmptySuccessResponse).mock.calls.length > 0) {
        violations.push(`${testCase.label} was reported as a success`);
      }

      expect(violations).toEqual([]);
    },
  );

  test("the malformed user id table is not empty", () => {
    /*
     * Guards both `test.each` tables above: emptied, they would register no
     * tests at all and the file would still pass while asserting nothing about
     * id validation.
     */
    expect(MALFORMED_USER_IDS.length).toBeGreaterThan(2);
  });

  test("passes a not-found failure on rather than reporting success", async () => {
    /*
     * This is the route an operator reaches for while a locked-out colleague
     * is on the phone. Told "done" when nothing was cleared, they would send
     * that colleague back to a sign-in screen still asking for the code from
     * the phone they lost.
     */
    const resetError: NotFoundException = new NotFoundException(
      "User not found.",
    );

    resetSpy.mockRejectedValue(resetError);

    const result: RouteCallResult = await callRoute({
      method: "POST",
      route: RESET_ROUTE,
      params: { userId: USER_ID },
    });

    expect(result.thrownToNext).toBe(resetError);
    expect(result.nextCallCount).toBe(1);
    expect(Response.sendEmptySuccessResponse).not.toHaveBeenCalled();
  });

  test("passes an unexpected failure on rather than reporting success", async () => {
    /*
     * A reset deletes rows from two tables. A failure partway through leaves
     * the account in a state only the operator can see, so the failure has to
     * reach them rather than being reported as a completed reset.
     */
    const unexpected: Error = new Error("deadlock detected");

    resetSpy.mockRejectedValue(unexpected);

    const result: RouteCallResult = await callRoute({
      method: "POST",
      route: RESET_ROUTE,
      params: { userId: USER_ID },
    });

    expect(result.thrownToNext).toBe(unexpected);
    expect(result.nextCallCount).toBe(1);
    expect(Response.sendEmptySuccessResponse).not.toHaveBeenCalled();
  });
});

describe("GET /user/:userId/authentication-status two factor auth fields", () => {
  /*
   * The status payload gained two fields when admin-controlled MFA landed, and
   * the Authentication page draws its buttons from them: `twoFactorAuthStatus`
   * decides which of the three labels an operator reads, and
   * `verifiedTwoFactorAuthMethodCount` is what makes "Enabled - Pending Setup"
   * distinguishable from "Enabled - Configured".
   *
   * A field dropped or renamed on the way out of the route is not a compile
   * error on the wire -- it arrives as `undefined` and the page renders the
   * fallback, which for the pending-setup user is the reassuring "2FA on" for
   * an account that in fact has no authenticator behind the requirement. That
   * is precisely the user who cannot sign in unaided, so it is the one the
   * page must never mislabel.
   */
  let statusSpy: jest.SpyInstance;

  const PENDING_SETUP_STATUS: UserAuthenticationStatus = {
    hasPassword: true,
    isEmailVerified: true,
    isTwoFactorAuthEnabled: true,
    twoFactorAuthStatus: TwoFactorAuthStatus.EnabledPendingSetup,
    verifiedTwoFactorAuthMethodCount: 0,
    hasPendingPasswordResetLink: false,
  };

  beforeAll(() => {
    mockRouter.routes.length = 0;
    new UserAPI();
  });

  beforeEach(() => {
    jest.clearAllMocks();

    statusSpy = jest
      .spyOn(UserService, "getAuthenticationStatus")
      .mockResolvedValue(PENDING_SETUP_STATUS);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("passes the derived status through verbatim", async () => {
    await callRoute({
      method: "GET",
      route: STATUS_ROUTE,
      params: { userId: USER_ID },
    });

    expect(statusSpy).toHaveBeenCalledTimes(1);
    expect(sentJsonObject()).toEqual({
      hasPassword: true,
      isEmailVerified: true,
      isTwoFactorAuthEnabled: true,
      twoFactorAuthStatus: TwoFactorAuthStatus.EnabledPendingSetup,
      verifiedTwoFactorAuthMethodCount: 0,
      hasPendingPasswordResetLink: false,
    });
  });

  test("sends the status as the enum's machine value, not a display string", async () => {
    /*
     * The labels an operator reads are i18n keys resolved in the browser. If
     * the route ever started sending "Enabled - Pending Setup" instead of
     * "EnabledPendingSetup", the page's comparison against the enum would stop
     * matching and every account would fall through to the default label.
     */
    await callRoute({
      method: "GET",
      route: STATUS_ROUTE,
      params: { userId: USER_ID },
    });

    expect(sentJsonObject()["twoFactorAuthStatus"]).toBe("EnabledPendingSetup");
  });

  test("keeps a zero method count rather than dropping it", async () => {
    /*
     * Zero is the count that matters and the one most easily lost: a
     * serializer that omits falsy values would turn "no authenticator has been
     * set up" into an absent field, which the page cannot tell apart from a
     * count it failed to load.
     */
    await callRoute({
      method: "GET",
      route: STATUS_ROUTE,
      params: { userId: USER_ID },
    });

    const payload: JSONObject = sentJsonObject();

    expect(Object.keys(payload)).toContain("verifiedTwoFactorAuthMethodCount");
    expect(payload["verifiedTwoFactorAuthMethodCount"]).toBe(0);
  });

  test("reports a configured account with its real method count", async () => {
    /*
     * The other end of the tri-state. Reported as the pending-setup value, an
     * operator would reset a user who was perfectly fine and lock them out
     * themselves.
     */
    statusSpy.mockResolvedValue({
      hasPassword: false,
      isEmailVerified: true,
      isTwoFactorAuthEnabled: true,
      twoFactorAuthStatus: TwoFactorAuthStatus.EnabledConfigured,
      verifiedTwoFactorAuthMethodCount: 2,
      hasPendingPasswordResetLink: false,
    } as UserAuthenticationStatus);

    await callRoute({
      method: "GET",
      route: STATUS_ROUTE,
      params: { userId: USER_ID },
    });

    const payload: JSONObject = sentJsonObject();

    expect(payload["twoFactorAuthStatus"]).toBe(
      TwoFactorAuthStatus.EnabledConfigured,
    );
    expect(payload["verifiedTwoFactorAuthMethodCount"]).toBe(2);
  });

  test("sets the no-cache headers before the payload goes out", async () => {
    /*
     * Headers written after the body has been sent are ignored, so the ORDER
     * is the protection, not merely that both calls happened. Whether one
     * named user has two factor auth configured is not a fact a shared cache
     * may keep, and it is stale the instant either action on this page runs.
     */
    await callRoute({
      method: "GET",
      route: STATUS_ROUTE,
      params: { userId: USER_ID },
    });

    const noCacheOrder: number = asMock(Response.setNoCacheHeaders).mock
      .invocationCallOrder[0]!;
    const sendOrder: number = asMock(Response.sendJsonObjectResponse).mock
      .invocationCallOrder[0]!;

    expect(Response.setNoCacheHeaders).toHaveBeenCalledTimes(1);
    expect(noCacheOrder).toBeLessThan(sendOrder);
  });
});
