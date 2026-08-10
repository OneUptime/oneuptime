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
import Email from "../../../Types/Email";
import BadDataException from "../../../Types/Exception/BadDataException";
import NotFoundException from "../../../Types/Exception/NotFoundException";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
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
 * The three master-admin endpoints behind the Admin Dashboard's
 * User > Authentication page.
 *
 * GET /user/:userId/authentication-status exists so that "does this account
 * have a password at all?" can be answered without the password column ever
 * leaving the server. A master admin bypasses column read permissions, so the
 * obvious alternative -- select `password` through the CRUD API and check it
 * in the browser -- would put every user's scrypt digest in a page's network
 * tab. The route therefore ships four derived booleans, and marks them
 * uncacheable: whether somebody can sign in with a password is not a fact a
 * shared proxy may keep, and it changes the instant either action below runs.
 *
 * POST /user/:userId/set-password is a deliberately separate route rather than
 * a PUT to /user/:id carrying a password, so that the gate is a middleware
 * anybody can grep for. The body's `password` is TYPE-CHECKED rather than
 * cast, and that check is load-bearing in a way no other test here would
 * notice: an `as string` on a JSON body is a lie the moment a caller posts an
 * object or a number, and the value flows straight into the hasher.
 *
 * POST /user/:userId/send-password-reset-link is the safer twin -- it never
 * puts the operator in possession of the user's credentials -- and echoes back
 * the address it mailed so the page can say where the link went.
 *
 * All three are guarded by the master-admin middleware. That is THE assertion
 * in this file: without it, any signed-in user could set any other user's
 * password and take over their account. Nothing else in these tests would
 * notice the middleware going missing, so each route is checked for it
 * directly.
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

const STATUS_ROUTE: string = "/user/:userId/authentication-status";
const SET_PASSWORD_ROUTE: string = "/user/:userId/set-password";
const RESET_LINK_ROUTE: string = "/user/:userId/send-password-reset-link";

const USER_ID: string = "00000000-0000-4000-8000-000000000001";

const AUTHENTICATION_STATUS: UserAuthenticationStatus = {
  hasPassword: true,
  isEmailVerified: false,
  isTwoFactorAuthEnabled: true,
  hasPendingPasswordResetLink: false,
};

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

describe("GET /user/:userId/authentication-status", () => {
  let statusSpy: jest.SpyInstance;

  beforeAll(() => {
    mockRouter.routes.length = 0;
    new UserAPI();
  });

  beforeEach(() => {
    jest.clearAllMocks();

    statusSpy = jest
      .spyOn(UserService, "getAuthenticationStatus")
      .mockResolvedValue(AUTHENTICATION_STATUS);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("the route is registered", () => {
    /*
     * A typo in the path is not a compile error and not a test failure
     * anywhere else — it is a 404 that the page surfaces as an unexplained
     * error the first time an operator opens it.
     */
    expect(() => {
      return mockRouter.match("GET", STATUS_ROUTE);
    }).not.toThrow();
  });

  test("only a master admin can reach it", () => {
    expect(mockRouter.match("GET", STATUS_ROUTE).middleware).toBe(
      MasterAdminAuthorization.isAuthorizedMasterAdminMiddleware,
    );
  });

  test("reads the status of the user in the path", async () => {
    await callRoute({
      method: "GET",
      route: STATUS_ROUTE,
      params: { userId: USER_ID },
    });

    expect(statusSpy).toHaveBeenCalledTimes(1);
    expect((statusSpy.mock.calls[0]![0] as ObjectID).toString()).toBe(USER_ID);
  });

  test("sends exactly what the service reported", async () => {
    /*
     * The page renders these four booleans directly. A field dropped or
     * renamed on the way out reads as `undefined`, which the UI shows as "no
     * password" for an account that has one.
     */
    await callRoute({
      method: "GET",
      route: STATUS_ROUTE,
      params: { userId: USER_ID },
    });

    expect(sentJsonObject()).toEqual({
      hasPassword: true,
      isEmailVerified: false,
      isTwoFactorAuthEnabled: true,
      hasPendingPasswordResetLink: false,
    });
  });

  test("tells caches not to keep the answer", async () => {
    /*
     * Whether an account can sign in with a password is a fact about one named
     * user, served over a session-authenticated GET. Without no-store a shared
     * proxy is entitled to hand it to the next caller — and it is stale the
     * moment either action on the page is used.
     */
    const result: RouteCallResult = await callRoute({
      method: "GET",
      route: STATUS_ROUTE,
      params: { userId: USER_ID },
    });

    expect(Response.setNoCacheHeaders).toHaveBeenCalledTimes(1);
    expect(Response.setNoCacheHeaders).toHaveBeenCalledWith(result.res);
  });

  test("sets the no-cache headers before the body goes out", async () => {
    /*
     * Headers written after the response has been sent are ignored, so the
     * ORDER is the whole protection — not merely that both calls happened.
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

    expect(noCacheOrder).toBeLessThan(sendOrder);
  });

  test("rejects a missing user id without reading anything", async () => {
    const result: RouteCallResult = await callRoute({
      method: "GET",
      route: STATUS_ROUTE,
      params: {},
    });

    expect(statusSpy).not.toHaveBeenCalled();
    expect(result.nextCallCount).toBe(1);
    expect(result.thrownToNext).toBeInstanceOf(BadDataException);
    expect(Response.sendJsonObjectResponse).not.toHaveBeenCalled();
  });

  test("rejects a user id that is not a uuid without reading anything", async () => {
    const result: RouteCallResult = await callRoute({
      method: "GET",
      route: STATUS_ROUTE,
      params: { userId: '\'; DROP TABLE "User"; --' },
    });

    expect(statusSpy).not.toHaveBeenCalled();
    expect(result.nextCallCount).toBe(1);
    expect(Response.sendJsonObjectResponse).not.toHaveBeenCalled();
  });

  test("passes a read failure on rather than reporting a status", async () => {
    /*
     * "No such user" must reach the caller as a failure. Swallowed, the page
     * would render the default booleans and tell an operator that a user who
     * does not exist has no password.
     */
    const readError: NotFoundException = new NotFoundException(
      "User not found.",
    );

    statusSpy.mockRejectedValue(readError);

    const result: RouteCallResult = await callRoute({
      method: "GET",
      route: STATUS_ROUTE,
      params: { userId: USER_ID },
    });

    expect(result.thrownToNext).toBe(readError);
    expect(result.nextCallCount).toBe(1);
    expect(Response.sendJsonObjectResponse).not.toHaveBeenCalled();
  });
});

describe("POST /user/:userId/set-password", () => {
  let setPasswordSpy: jest.SpyInstance;

  beforeAll(() => {
    mockRouter.routes.length = 0;
    new UserAPI();
  });

  beforeEach(() => {
    jest.clearAllMocks();

    setPasswordSpy = jest
      .spyOn(UserService, "setPassword")
      .mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  const expectRejected: (body: Dictionary<unknown>) => Promise<void> = async (
    body: Dictionary<unknown>,
  ): Promise<void> => {
    const result: RouteCallResult = await callRoute({
      method: "POST",
      route: SET_PASSWORD_ROUTE,
      params: { userId: USER_ID },
      body: body,
    });

    expect(setPasswordSpy).not.toHaveBeenCalled();
    expect(result.nextCallCount).toBe(1);
    expect(result.thrownToNext).toBeInstanceOf(BadDataException);
    expect(Response.sendEmptySuccessResponse).not.toHaveBeenCalled();
  };

  test("the route is registered", () => {
    expect(() => {
      return mockRouter.match("POST", SET_PASSWORD_ROUTE);
    }).not.toThrow();
  });

  test("only a master admin can reach it", () => {
    /*
     * The single most important line in this file. This route rewrites another
     * person's credentials; with the middleware gone, every signed-in user on
     * the instance could take over every account on it.
     */
    expect(mockRouter.match("POST", SET_PASSWORD_ROUTE).middleware).toBe(
      MasterAdminAuthorization.isAuthorizedMasterAdminMiddleware,
    );
  });

  test("sets the password of the user in the path", async () => {
    await callRoute({
      method: "POST",
      route: SET_PASSWORD_ROUTE,
      params: { userId: USER_ID },
      body: { password: "correct-horse" },
    });

    expect(setPasswordSpy).toHaveBeenCalledTimes(1);

    const call: { userId: ObjectID; password: string } = setPasswordSpy.mock
      .calls[0]![0] as { userId: ObjectID; password: string };

    expect(call.userId.toString()).toBe(USER_ID);
    expect(call.password).toBe("correct-horse");
  });

  test("forwards the password byte for byte, spaces and all", async () => {
    /*
     * A password is whatever the person typed. Trimming, normalising or
     * re-encoding it here would store something other than what was entered,
     * and the very next sign-in would fail with no clue as to why.
     */
    const password: string = "  pässwörd ✅ 🔐  ";

    await callRoute({
      method: "POST",
      route: SET_PASSWORD_ROUTE,
      params: { userId: USER_ID },
      body: { password: password },
    });

    expect(
      (setPasswordSpy.mock.calls[0]![0] as { password: string }).password,
    ).toBe(password);
  });

  test("leaves the password policy to the service rather than pre-judging it", async () => {
    /*
     * The route's only job is the type check; length and blankness rules live
     * in one place (Types/Password) behind the service, so the browser form
     * and the endpoint cannot drift apart. A short string is a STRING, so it
     * must reach the service and be refused there — a duplicate rule here
     * would be a second copy free to disagree.
     */
    await callRoute({
      method: "POST",
      route: SET_PASSWORD_ROUTE,
      params: { userId: USER_ID },
      body: { password: "abc" },
    });

    expect(setPasswordSpy).toHaveBeenCalledTimes(1);
    expect(
      (setPasswordSpy.mock.calls[0]![0] as { password: string }).password,
    ).toBe("abc");
  });

  test("reports success with an empty body, never echoing the password", async () => {
    await callRoute({
      method: "POST",
      route: SET_PASSWORD_ROUTE,
      params: { userId: USER_ID },
      body: { password: "correct-horse" },
    });

    expect(Response.sendEmptySuccessResponse).toHaveBeenCalledTimes(1);
    expect(Response.sendJsonObjectResponse).not.toHaveBeenCalled();
  });

  test("rejects a missing password", async () => {
    await expectRejected({});
  });

  test("rejects a null password", async () => {
    await expectRejected({ password: null });
  });

  test("rejects a numeric password", async () => {
    /*
     * JSON numbers arrive as numbers. `123456` would satisfy a length check
     * written against `String(password)` while being nothing a person could
     * ever type at a sign-in form.
     */
    await expectRejected({ password: 123456 });
  });

  test("rejects a boolean password", async () => {
    await expectRejected({ password: true });
  });

  test("rejects an object password", async () => {
    /*
     * THE case this type check exists for. Had the handler written
     * `req.body["password"] as string`, TypeScript would have believed it and
     * a JSON object would have sailed into the hasher: HashedString would then
     * hash whatever `String(value)` produces — "[object Object]" for a plain
     * object, or, worse, an attacker-chosen value where the object carries its
     * own `toString`. Every account set that way would share one password.
     * A cast cannot catch this; only a runtime `typeof` can.
     */
    await expectRejected({ password: { toString: "[object Object]" } });
  });

  test("rejects a nested object password", async () => {
    await expectRejected({ password: { value: "correct-horse" } });
  });

  test("rejects an array password", async () => {
    // Arrays are objects, and `String(["hunter2"])` is the innocuous "hunter2".
    await expectRejected({ password: ["correct-horse"] });
  });

  test("rejects a missing user id without setting anything", async () => {
    const result: RouteCallResult = await callRoute({
      method: "POST",
      route: SET_PASSWORD_ROUTE,
      params: {},
      body: { password: "correct-horse" },
    });

    expect(setPasswordSpy).not.toHaveBeenCalled();
    expect(result.nextCallCount).toBe(1);
    expect(Response.sendEmptySuccessResponse).not.toHaveBeenCalled();
  });

  test("rejects a user id that is not a uuid without setting anything", async () => {
    const result: RouteCallResult = await callRoute({
      method: "POST",
      route: SET_PASSWORD_ROUTE,
      params: { userId: "not-a-uuid" },
      body: { password: "correct-horse" },
    });

    expect(setPasswordSpy).not.toHaveBeenCalled();
    expect(result.nextCallCount).toBe(1);
    expect(Response.sendEmptySuccessResponse).not.toHaveBeenCalled();
  });

  test("passes a write failure on rather than reporting success", async () => {
    /*
     * The policy rejection and "user not found" both arrive this way. Reported
     * as success, an operator would hand somebody a password that was never
     * stored.
     */
    const writeError: BadDataException = new BadDataException(
      "Password cannot be less than 6 characters.",
    );

    setPasswordSpy.mockRejectedValue(writeError);

    const result: RouteCallResult = await callRoute({
      method: "POST",
      route: SET_PASSWORD_ROUTE,
      params: { userId: USER_ID },
      body: { password: "abc" },
    });

    expect(result.thrownToNext).toBe(writeError);
    expect(result.nextCallCount).toBe(1);
    expect(Response.sendEmptySuccessResponse).not.toHaveBeenCalled();
  });
});

describe("POST /user/:userId/send-password-reset-link", () => {
  let sendLinkSpy: jest.SpyInstance;

  beforeAll(() => {
    mockRouter.routes.length = 0;
    new UserAPI();
  });

  beforeEach(() => {
    jest.clearAllMocks();

    sendLinkSpy = jest
      .spyOn(UserService, "sendPasswordResetLink")
      .mockResolvedValue(new Email("locked.out@example.com"));
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("the route is registered", () => {
    expect(() => {
      return mockRouter.match("POST", RESET_LINK_ROUTE);
    }).not.toThrow();
  });

  test("only a master admin can reach it", () => {
    /*
     * Mailing a reset link is a credential-changing action too: it is the
     * password takeover with one extra step, taken by whoever controls the
     * mailbox.
     */
    expect(mockRouter.match("POST", RESET_LINK_ROUTE).middleware).toBe(
      MasterAdminAuthorization.isAuthorizedMasterAdminMiddleware,
    );
  });

  test("sends the link to the user in the path", async () => {
    await callRoute({
      method: "POST",
      route: RESET_LINK_ROUTE,
      params: { userId: USER_ID },
    });

    expect(sendLinkSpy).toHaveBeenCalledTimes(1);
    expect(
      (sendLinkSpy.mock.calls[0]![0] as { userId: ObjectID }).userId.toString(),
    ).toBe(USER_ID);
  });

  test("reports the address the link actually went to", async () => {
    await callRoute({
      method: "POST",
      route: RESET_LINK_ROUTE,
      params: { userId: USER_ID },
    });

    expect(sentJsonObject()).toEqual({ email: "locked.out@example.com" });
  });

  test("reports the address as a plain string, not a serialized Email", async () => {
    /*
     * The service returns an Email, whose toJSON is
     * `{_type: "Email", value: "..."}`. Sending the object itself would still
     * be a 200 with an `email` key, so nothing fails loudly — the page just
     * renders "[object Object]" in the sentence telling the operator where the
     * link was sent, which is the one fact they came for.
     */
    await callRoute({
      method: "POST",
      route: RESET_LINK_ROUTE,
      params: { userId: USER_ID },
    });

    const email: unknown = sentJsonObject()["email"];

    expect(typeof email).toBe("string");
    expect(email).toBe("locked.out@example.com");
  });

  test("rejects a missing user id without sending anything", async () => {
    const result: RouteCallResult = await callRoute({
      method: "POST",
      route: RESET_LINK_ROUTE,
      params: {},
    });

    expect(sendLinkSpy).not.toHaveBeenCalled();
    expect(result.nextCallCount).toBe(1);
    expect(result.thrownToNext).toBeInstanceOf(BadDataException);
    expect(Response.sendJsonObjectResponse).not.toHaveBeenCalled();
  });

  test("rejects a user id that is not a uuid without sending anything", async () => {
    const result: RouteCallResult = await callRoute({
      method: "POST",
      route: RESET_LINK_ROUTE,
      params: { userId: '\'; DROP TABLE "User"; --' },
    });

    expect(sendLinkSpy).not.toHaveBeenCalled();
    expect(result.nextCallCount).toBe(1);
    expect(Response.sendJsonObjectResponse).not.toHaveBeenCalled();
  });

  test("passes a mail failure on rather than reporting the link was sent", async () => {
    /*
     * The service awaits the send precisely so that an instance which cannot
     * send mail says so. Swallowing it here would put the operator back where
     * they started: told the link is on its way, waiting for one that will
     * never arrive.
     */
    const mailError: Error = new Error("SMTP server is not configured.");

    sendLinkSpy.mockRejectedValue(mailError);

    const result: RouteCallResult = await callRoute({
      method: "POST",
      route: RESET_LINK_ROUTE,
      params: { userId: USER_ID },
    });

    expect(result.thrownToNext).toBe(mailError);
    expect(result.nextCallCount).toBe(1);
    expect(Response.sendJsonObjectResponse).not.toHaveBeenCalled();
  });
});
