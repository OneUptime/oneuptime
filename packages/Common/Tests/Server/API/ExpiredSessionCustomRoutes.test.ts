import { mockRouter } from "./Helpers";
import CommonAPI from "../../../Server/API/CommonAPI";
import OnCallReadinessAPI from "../../../Server/API/OnCallReadinessAPI";
import UserMiddleware from "../../../Server/Middleware/UserAuthorization";
import OnCallDutyPolicyService from "../../../Server/Services/OnCallDutyPolicyService";
import OnCallReadinessService from "../../../Server/Services/OnCallReadinessService";
import OnCallSetupReminderService, {
  SetupReminderOutcome,
  SetupReminderResult,
  SetupReminderUserResult,
} from "../../../Server/Services/OnCallSetupReminderService";
import ProjectService from "../../../Server/Services/ProjectService";
import TeamMemberService from "../../../Server/Services/TeamMemberService";
import CookieUtil from "../../../Server/Utils/Cookie";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
  OneUptimeRequest,
} from "../../../Server/Utils/Express";
import logger from "../../../Server/Utils/Logger";
import Response from "../../../Server/Utils/Response";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import Dictionary from "../../../Types/Dictionary";
import BadDataException from "../../../Types/Exception/BadDataException";
import Exception from "../../../Types/Exception/Exception";
import ExceptionCode from "../../../Types/Exception/ExceptionCode";
import NotAuthenticatedException from "../../../Types/Exception/NotAuthenticatedException";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission, {
  UserPermission,
  UserTenantAccessPermission,
} from "../../../Types/Permission";
import UserType from "../../../Types/UserType";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * The customer report, replayed at the server.
 *
 * An admin opened On-Call > Readiness, left the tab for more than fifteen
 * minutes, came back and pressed "Send setup reminder". The dashboard answered
 * "You are not authorized to access this project's data." They were still
 * signed in - the refresh token was good for days - and they were an owner of
 * the project.
 *
 * What happened on the wire: the access-token cookie's maxAge is the JWT's own
 * fifteen-minute lifetime, so the browser had simply stopped sending it. The
 * POST arrived with the `tenantid` header the dashboard always adds, the
 * refresh-token cookie, and no access token. getUserMiddleware treats that as a
 * Public request and calls next(); the route's member guard then saw no userId
 * and refused with NotAuthorizedException - a 422. The browser client
 * (Common/UI/Utils/API/API.ts) refreshes the session and replays the request on
 * a 401 and on nothing else, so the 422 went straight to the screen.
 *
 * The fix is that "no credentials at all" is a 401 everywhere, decided before
 * anything about the project is looked at. This file drives the readiness
 * router - the customer's POST and its three GET siblings - the way that
 * request actually arrives:
 *
 *   - the REAL UserMiddleware.getUserMiddleware turns the cookie-less request
 *     into the Public request, instead of a fixture guessing at its shape;
 *   - the REAL CommonAPI.getDatabaseCommonInteractionProps turns that into
 *     props (only ProjectService's plan lookup is stubbed, because CI runs with
 *     billing enabled and the project does not exist);
 *   - the error the handler hands to next() is given to the REAL
 *     Response.sendErrorResponse, which applies the same "exception code is
 *     the HTTP status" rule as the app's error handler, so the assertions are
 *     on the status the browser would actually receive.
 *
 * Authenticated callers are built as getUserMiddleware leaves them after a
 * successful token decode (userType, userAuthorization, tenant permissions),
 * because running a real decode needs a signing secret and a database. What
 * they pin is that the change did NOT move anyone else: a logged-in member
 * without the reminder permission still gets the 422, and a privileged member
 * still sends.
 */

jest.mock("../../../Server/Utils/Express", () => {
  return {
    getRouter: () => {
      return mockRouter;
    },
  };
});

const POLICY_ROUTE: string = "/on-call-readiness/policy/:policyId";
const PROJECT_ROUTE: string = "/on-call-readiness/project";
const USER_ROUTE: string = "/on-call-readiness/user/:userId";
const REMINDER_ROUTE: string = "/on-call-readiness/send-setup-reminder";

// The member / permission refusal: what the customer saw, and must not again.
const REFUSAL: string = "You are not authorized to access this project's data.";

type RouterFunction = (
  req: ExpressRequest,
  res: ExpressResponse,
  next: NextFunction,
) => void | Promise<void>;

// The slice of Helpers.ts's private Route type this file relies on.
interface RegisteredRoute {
  method: string;
  uri: string;
  middlewares: Array<RouterFunction>;
  handlerFunction: RouterFunction;
}

interface RouteCallResult {
  // The exception the handler passed to next(), if any.
  thrownToNext: unknown;
  // Whether every middleware called next() and the handler itself ran.
  reachedHandler: boolean;
  // The HTTP status the client receives for a refusal, or undefined on success.
  status: number | undefined;
  // The body the client receives for a refusal.
  errorBody: JSONObject | undefined;
}

let projectId: ObjectID;
let otherProjectId: ObjectID;
let callerUserId: ObjectID;
let subjectUserId: ObjectID;
let policyId: ObjectID;

let sendRemindersSpy: jest.SpyInstance;
let policyReadinessSpy: jest.SpyInstance;
let projectReadinessSpy: jest.SpyInstance;
let userReadinessSpy: jest.SpyInstance;
let clearCacheSpy: jest.SpyInstance;
let policyFindOneByIdSpy: jest.SpyInstance;
let teamMemberFindBySpy: jest.SpyInstance;
let sendJsonSpy: jest.SpyInstance;

function findRoute(method: string, uri: string): RegisteredRoute {
  const route: RegisteredRoute | undefined = (
    mockRouter.routes as unknown as Array<RegisteredRoute>
  ).find((candidate: RegisteredRoute): boolean => {
    return candidate.method === method && candidate.uri === uri;
  });

  if (!route) {
    throw new Error(`No ${method} route registered for ${uri}`);
  }

  return route;
}

/*
 * The request a browser sends once the access-token cookie has expired: the
 * dashboard's `tenantid` header (ModelAPI.getCommonHeaders adds it to every
 * call) and the refresh-token cookie, which is long-lived and so is still
 * there. No access token and no Authorization header - which is the whole
 * point.
 */
function buildExpiredSessionRequest(data: {
  tenantId?: ObjectID | undefined;
  params?: Dictionary<string> | undefined;
  query?: Dictionary<string> | undefined;
  body?: JSONObject | undefined;
}): ExpressRequest {
  const headers: Dictionary<string> = {};

  if (data.tenantId) {
    headers["tenantid"] = data.tenantId.toString();
  }

  const cookies: Dictionary<string> = {};
  cookies[CookieUtil.getRefreshTokenKey()] = "still-valid-refresh-token";

  return {
    params: data.params || {},
    query: data.query || {},
    body: data.body || {},
    headers: headers,
    cookies: cookies,
  } as unknown as ExpressRequest;
}

/*
 * A logged-in caller as getUserMiddleware leaves the request after decoding a
 * valid access token and loading the caller's permissions for the tenant.
 *
 * isBlockPermission is an explicit false on every entry: the permission reads
 * filter on it strictly, so an undefined would silently drop the grant and turn
 * the "privileged member" below into an unprivileged one.
 */
function buildSignedInRequest(data: {
  tenantId: ObjectID;
  userId: ObjectID | undefined;
  userType: UserType;
  permissions: Array<Permission>;
  body?: JSONObject | undefined;
}): ExpressRequest {
  const userPermissions: Array<UserPermission> = data.permissions.map(
    (permission: Permission): UserPermission => {
      return {
        _type: "UserPermission",
        permission: permission,
        labelIds: [],
        isBlockPermission: false,
      };
    },
  );

  const tenantPermission: UserTenantAccessPermission = {
    _type: "UserTenantAccessPermission",
    projectId: data.tenantId,
    permissions: userPermissions,
  };

  const permissionMap: Dictionary<UserTenantAccessPermission> = {};
  permissionMap[data.tenantId.toString()] = tenantPermission;

  return {
    params: {},
    query: {},
    body: data.body || {},
    headers: { tenantid: data.tenantId.toString() },
    cookies: {},
    tenantId: data.tenantId,
    userType: data.userType,
    userAuthorization: data.userId ? { userId: data.userId } : undefined,
    userTenantAccessPermission: permissionMap,
  } as unknown as ExpressRequest;
}

/*
 * Runs a registered route's middleware chain and handler for real, then hands
 * any error the handler raised to Response.sendErrorResponse - the app's error
 * path, reduced to the one rule these assertions need: the exception's code is
 * the HTTP status.
 *
 * `signedIn` requests skip the middleware: buildSignedInRequest already IS the
 * middleware's output for a valid token, and re-running it without that token
 * would overwrite the caller back to Public.
 */
async function callRoute(data: {
  method: string;
  uri: string;
  req: ExpressRequest;
  signedIn?: boolean | undefined;
}): Promise<RouteCallResult> {
  const route: RegisteredRoute = findRoute(data.method, data.uri);

  const sent: { status: number | undefined; body: JSONObject | undefined } = {
    status: undefined,
    body: undefined,
  };

  const res: ExpressResponse = {
    status: (code: number): ExpressResponse => {
      sent.status = code;
      return res;
    },
    send: (body: JSONObject): ExpressResponse => {
      sent.body = body;
      return res;
    },
    json: (body: JSONObject): ExpressResponse => {
      sent.body = body;
      return res;
    },
    setHeader: (): void => {
      // not needed by the paths under test
    },
  } as unknown as ExpressResponse;

  const middlewares: Array<RouterFunction> = data.signedIn
    ? []
    : route.middlewares;

  for (const middleware of middlewares) {
    const step: { calledNext: boolean; error: unknown } = {
      calledNext: false,
      error: undefined,
    };

    await middleware(data.req, res, ((error?: unknown): void => {
      step.calledNext = true;
      step.error = error;
    }) as NextFunction);

    if (!step.calledNext || step.error) {
      // The middleware answered the request itself.
      return {
        thrownToNext: step.error,
        reachedHandler: false,
        status: sent.status,
        errorBody: sent.body,
      };
    }
  }

  const outcome: { error: unknown } = { error: undefined };

  await route.handlerFunction(data.req, res, ((error?: unknown): void => {
    outcome.error = error;
  }) as NextFunction);

  if (outcome.error) {
    Response.sendErrorResponse(data.req, res, outcome.error as Exception);
  }

  return {
    thrownToNext: outcome.error,
    reachedHandler: true,
    status: sent.status,
    errorBody: sent.body,
  };
}

/*
 * The refusal an expired session must get, checked at both ends: the exception
 * the handler raised, and the status and message the browser receives.
 */
function expectAskedToAuthenticate(result: RouteCallResult): void {
  expect(result.thrownToNext).toBeInstanceOf(NotAuthenticatedException);
  expect(result.thrownToNext).not.toBeInstanceOf(NotAuthorizedException);
  expect((result.thrownToNext as Exception).code).toBe(
    ExceptionCode.NotAuthenticatedException,
  );
  expect(result.status).toBe(401);
  expect(result.errorBody?.["message"]).toBe(
    CommonAPI.AUTHENTICATION_REQUIRED_MESSAGE,
  );
  expect(result.errorBody?.["message"]).not.toBe(REFUSAL);
}

function expectNoReadinessWork(): void {
  expect(policyFindOneByIdSpy).not.toHaveBeenCalled();
  expect(teamMemberFindBySpy).not.toHaveBeenCalled();
  expect(policyReadinessSpy).not.toHaveBeenCalled();
  expect(projectReadinessSpy).not.toHaveBeenCalled();
  expect(userReadinessSpy).not.toHaveBeenCalled();
  expect(clearCacheSpy).not.toHaveBeenCalled();
  expect(sendRemindersSpy).not.toHaveBeenCalled();
  expect(sendJsonSpy).not.toHaveBeenCalled();
}

function emptySummary(forProjectId: ObjectID): JSONObject {
  return {
    projectId: forProjectId,
    readyCount: 0,
    partiallyReadyCount: 0,
    notReachableCount: 0,
    isFallbackEnabled: true,
    isTruncated: false,
    users: [],
  } as unknown as JSONObject;
}

beforeEach(() => {
  jest.clearAllMocks();

  projectId = ObjectID.generate();
  otherProjectId = ObjectID.generate();
  callerUserId = ObjectID.generate();
  subjectUserId = ObjectID.generate();
  policyId = ObjectID.generate();

  // Both sources of 401 in this file log the refusal; keep the output clean.
  jest.spyOn(logger, "error").mockImplementation((): void => {});

  /*
   * getUserMiddleware fires a lastActive write for any tenant header, and
   * getDatabaseCommonInteractionProps resolves the plan when billing is on
   * (it is in CI). Neither is under test, and both would reach the database.
   */
  jest.spyOn(ProjectService, "updateLastActive").mockResolvedValue(undefined);
  jest
    .spyOn(ProjectService, "getCurrentPlan")
    .mockResolvedValue({ plan: null, isSubscriptionUnpaid: false });

  sendJsonSpy = jest
    .spyOn(Response, "sendJsonObjectResponse")
    .mockImplementation((): void => {});

  policyFindOneByIdSpy = jest
    .spyOn(OnCallDutyPolicyService, "findOneById")
    .mockResolvedValue({ id: policyId, projectId: projectId } as never);

  teamMemberFindBySpy = jest
    .spyOn(TeamMemberService, "findBy")
    .mockResolvedValue([{ _id: ObjectID.generate().toString() }] as never);

  policyReadinessSpy = jest
    .spyOn(OnCallReadinessService, "getReadinessForPolicy")
    .mockResolvedValue(emptySummary(projectId) as never);

  projectReadinessSpy = jest
    .spyOn(OnCallReadinessService, "getReadinessForProject")
    .mockResolvedValue(emptySummary(projectId) as never);

  userReadinessSpy = jest
    .spyOn(OnCallReadinessService, "getReadinessForUser")
    .mockRejectedValue(
      new Error("not stubbed: no test here reads a single user") as never,
    );

  clearCacheSpy = jest.spyOn(OnCallReadinessService, "clearCache");

  sendRemindersSpy = jest
    .spyOn(OnCallSetupReminderService, "sendSetupReminders")
    .mockImplementation((async (data: {
      projectId: ObjectID;
      userIds: Array<ObjectID>;
    }): Promise<SetupReminderResult> => {
      return {
        projectId: data.projectId,
        requestedCount: data.userIds.length,
        sentCount: data.userIds.length,
        skippedCount: 0,
        failedCount: 0,
        results: data.userIds.map(
          (userId: ObjectID): SetupReminderUserResult => {
            return {
              userId: userId,
              outcome: SetupReminderOutcome.Sent,
              message: "Reminder sent to their account email address.",
            };
          },
        ),
      };
    }) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the request an expired session actually sends", () => {
  test("getUserMiddleware turns it into an anonymous Public request that still carries the tenant", async () => {
    /*
     * Pinned first because every other test in this file depends on it: the
     * cookie-less request is let THROUGH the user middleware, not refused
     * there, so the route's own guard is what answers it.
     */
    const req: ExpressRequest = buildExpiredSessionRequest({
      tenantId: projectId,
      body: { userIds: [subjectUserId.toString()] },
    });

    const next: jest.Mock = jest.fn();

    await UserMiddleware.getUserMiddleware(
      req,
      {} as ExpressResponse,
      next as unknown as NextFunction,
    );

    expect(next).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledWith();

    const oneUptimeRequest: OneUptimeRequest = req as OneUptimeRequest;

    expect(oneUptimeRequest.userType).toBe(UserType.Public);
    expect(oneUptimeRequest.tenantId?.toString()).toBe(projectId.toString());
    expect(oneUptimeRequest.userAuthorization).toBeUndefined();
    expect(UserMiddleware.isAnonymousRequest(oneUptimeRequest)).toBe(true);

    const props: DatabaseCommonInteractionProps =
      await CommonAPI.getDatabaseCommonInteractionProps(req);

    expect(props.userId).toBeUndefined();
    expect(props.tenantId?.toString()).toBe(projectId.toString());
    expect(CommonAPI.isAnonymous(props)).toBe(true);
  });

  test("the middleware's 401 and the guards' 401 read the same to the user", () => {
    /*
     * Both are "you need to log in again". If the refresh itself fails, this
     * is the sentence the dashboard ends up showing, whichever layer refused.
     */
    expect(CommonAPI.AUTHENTICATION_REQUIRED_MESSAGE).toBe(
      UserMiddleware.AUTHENTICATION_REQUIRED_MESSAGE,
    );
    expect(CommonAPI.AUTHENTICATION_REQUIRED_MESSAGE).toBe(
      "Authentication required. Please log in to access this resource.",
    );
  });

  test("the readiness routes are behind the user middleware only, so the handler's guard is what answers", () => {
    for (const [method, uri] of [
      ["GET", POLICY_ROUTE],
      ["GET", PROJECT_ROUTE],
      ["GET", USER_ROUTE],
      ["POST", REMINDER_ROUTE],
    ] as Array<[string, string]>) {
      const route: RegisteredRoute = findRoute(method, uri);

      expect(route.middlewares).toEqual([UserMiddleware.getUserMiddleware]);
    }

    // The module exports the router the routes were registered on.
    expect(OnCallReadinessAPI).toBe(mockRouter);
  });
});

describe("POST /on-call-readiness/send-setup-reminder with an expired session", () => {
  test("is answered 401 - not the 422 'not authorized' the customer saw - and nothing is sent", async () => {
    const result: RouteCallResult = await callRoute({
      method: "POST",
      uri: REMINDER_ROUTE,
      req: buildExpiredSessionRequest({
        tenantId: projectId,
        body: { userIds: [subjectUserId.toString()] },
      }),
    });

    expect(result.reachedHandler).toBe(true);
    expectAskedToAuthenticate(result);
    expect(result.status).not.toBe(ExceptionCode.NotAuthorizedException);
    expectNoReadinessWork();
  });

  test("is 401 even without the tenant header - who you are is asked before which project", async () => {
    const result: RouteCallResult = await callRoute({
      method: "POST",
      uri: REMINDER_ROUTE,
      req: buildExpiredSessionRequest({
        tenantId: undefined,
        body: { userIds: [subjectUserId.toString()] },
      }),
    });

    expectAskedToAuthenticate(result);
    expect(result.status).not.toBe(ExceptionCode.BadDataException);
    expectNoReadinessWork();
  });

  test("is 401 even when the body is malformed - the body is never read for a caller with no session", async () => {
    const result: RouteCallResult = await callRoute({
      method: "POST",
      uri: REMINDER_ROUTE,
      req: buildExpiredSessionRequest({
        tenantId: projectId,
        body: { userIds: "not-even-an-array" } as unknown as JSONObject,
      }),
    });

    expectAskedToAuthenticate(result);
    expectNoReadinessWork();
  });

  test("is 401 when the body names a project of its own - nothing in the request can stand in for a session", async () => {
    const result: RouteCallResult = await callRoute({
      method: "POST",
      uri: REMINDER_ROUTE,
      req: buildExpiredSessionRequest({
        tenantId: undefined,
        body: {
          projectId: projectId.toString(),
          userIds: [subjectUserId.toString()],
        },
      }),
    });

    expectAskedToAuthenticate(result);
    expectNoReadinessWork();
  });

  test("a stale access token that IS still sent is refused 401 by the middleware, before the handler", async () => {
    /*
     * The other way an expired session arrives: a client that keeps the token
     * past its lifetime (the mobile app, or a cookie that outlived its JWT).
     * getUserMiddleware cannot decode it and answers 401 itself.
     */
    const req: ExpressRequest = buildExpiredSessionRequest({
      tenantId: projectId,
      body: { userIds: [subjectUserId.toString()] },
    });

    (req as unknown as { cookies: Dictionary<string> }).cookies[
      CookieUtil.getUserTokenKey()
    ] = "an.expired.jwt";

    const result: RouteCallResult = await callRoute({
      method: "POST",
      uri: REMINDER_ROUTE,
      req: req,
    });

    expect(result.reachedHandler).toBe(false);
    expect(result.status).toBe(401);
    expect(result.errorBody?.["message"]).toBe(
      "AccessToken is invalid or expired. Please refresh your token.",
    );
    expectNoReadinessWork();
  });

  test("the refreshed replay of the same POST succeeds, and the reminder goes out exactly once", async () => {
    /*
     * The whole point of answering 401: the client refreshes the session and
     * resends the identical request. First attempt refused without side
     * effects, second attempt (same body, now with a session) sends.
     */
    const body: JSONObject = { userIds: [subjectUserId.toString()] };

    const expired: RouteCallResult = await callRoute({
      method: "POST",
      uri: REMINDER_ROUTE,
      req: buildExpiredSessionRequest({ tenantId: projectId, body: body }),
    });

    expectAskedToAuthenticate(expired);
    expect(sendRemindersSpy).not.toHaveBeenCalled();

    const replayed: RouteCallResult = await callRoute({
      method: "POST",
      uri: REMINDER_ROUTE,
      req: buildSignedInRequest({
        tenantId: projectId,
        userId: callerUserId,
        userType: UserType.User,
        permissions: [Permission.ProjectOwner],
        body: body,
      }),
      signedIn: true,
    });

    expect(replayed.thrownToNext).toBeUndefined();
    expect(replayed.status).toBeUndefined();
    expect(sendRemindersSpy).toHaveBeenCalledTimes(1);
    expect(sendJsonSpy).toHaveBeenCalledTimes(1);
  });
});

describe("POST /on-call-readiness/send-setup-reminder for signed-in callers is unchanged", () => {
  test("a privileged member sends, to the project from their tenant", async () => {
    const result: RouteCallResult = await callRoute({
      method: "POST",
      uri: REMINDER_ROUTE,
      req: buildSignedInRequest({
        tenantId: projectId,
        userId: callerUserId,
        userType: UserType.User,
        permissions: [Permission.ProjectMember, Permission.OnCallAdmin],
        body: { userIds: [subjectUserId.toString()] },
      }),
      signedIn: true,
    });

    expect(result.thrownToNext).toBeUndefined();
    expect(sendRemindersSpy).toHaveBeenCalledTimes(1);

    const call: { projectId: ObjectID; userIds: Array<ObjectID> } =
      sendRemindersSpy.mock.calls[0]![0] as {
        projectId: ObjectID;
        userIds: Array<ObjectID>;
      };

    expect(call.projectId.toString()).toBe(projectId.toString());
    expect(
      call.userIds.map((id: ObjectID): string => {
        return id.toString();
      }),
    ).toEqual([subjectUserId.toString()]);

    const payload: JSONObject = sendJsonSpy.mock.calls[0]![2] as JSONObject;

    expect(payload["sentCount"]).toBe(1);
  });

  test("a member without the reminder permission still gets the 422 refusal, and nothing is sent", async () => {
    /*
     * A real, current session - so NOT a 401. Answering 401 here would make
     * the dashboard refresh a perfectly good session and replay the POST into
     * the same refusal.
     */
    const result: RouteCallResult = await callRoute({
      method: "POST",
      uri: REMINDER_ROUTE,
      req: buildSignedInRequest({
        tenantId: projectId,
        userId: callerUserId,
        userType: UserType.User,
        permissions: [Permission.ProjectMember],
        body: { userIds: [subjectUserId.toString()] },
      }),
      signedIn: true,
    });

    expect(result.thrownToNext).toBeInstanceOf(NotAuthorizedException);
    expect(result.thrownToNext).not.toBeInstanceOf(NotAuthenticatedException);
    expect((result.thrownToNext as Exception).code).toBe(
      ExceptionCode.NotAuthorizedException,
    );
    expect(result.status).toBe(422);
    expect(result.errorBody?.["message"]).toBe(REFUSAL);
    expectNoReadinessWork();
  });

  test("an owner of ANOTHER project naming this one in the header still gets the 422", async () => {
    const req: ExpressRequest = buildSignedInRequest({
      tenantId: otherProjectId,
      userId: callerUserId,
      userType: UserType.User,
      permissions: [Permission.ProjectOwner],
      body: { userIds: [subjectUserId.toString()] },
    });

    // The header says this project; the grants are for the other one.
    (req as OneUptimeRequest).tenantId = projectId;
    req.headers["tenantid"] = projectId.toString();

    const result: RouteCallResult = await callRoute({
      method: "POST",
      uri: REMINDER_ROUTE,
      req: req,
      signedIn: true,
    });

    expect(result.thrownToNext).toBeInstanceOf(NotAuthorizedException);
    expect(result.status).toBe(422);
    expectNoReadinessWork();
  });

  test("a signed-in caller with no tenant header still gets the 400", async () => {
    const req: ExpressRequest = buildSignedInRequest({
      tenantId: projectId,
      userId: callerUserId,
      userType: UserType.User,
      permissions: [Permission.ProjectOwner],
      body: { userIds: [subjectUserId.toString()] },
    });

    // Signed in, but the call carried no tenant header.
    (req as OneUptimeRequest).tenantId = undefined as unknown as ObjectID;
    req.headers = {};

    const result: RouteCallResult = await callRoute({
      method: "POST",
      uri: REMINDER_ROUTE,
      req: req,
      signedIn: true,
    });

    expect(result.thrownToNext).toBeInstanceOf(BadDataException);
    expect(result.status).toBe(400);
    expectNoReadinessWork();
  });

  test("a project API key - authenticated, but not a person - gets the 422, not a 401", async () => {
    /*
     * An API client has no session to refresh, so a 401 would send it round a
     * refresh it can never complete. The route is for members; the key is
     * refused as not authorised, exactly as before.
     */
    const result: RouteCallResult = await callRoute({
      method: "POST",
      uri: REMINDER_ROUTE,
      req: buildSignedInRequest({
        tenantId: projectId,
        userId: undefined,
        userType: UserType.API,
        permissions: [Permission.ProjectOwner],
        body: { userIds: [subjectUserId.toString()] },
      }),
      signedIn: true,
    });

    expect(result.thrownToNext).toBeInstanceOf(NotAuthorizedException);
    expect(result.status).toBe(422);
    expect(result.errorBody?.["message"]).toBe(REFUSAL);
    expectNoReadinessWork();
  });
});

describe("the readiness GET routes with an expired session", () => {
  type ReadCase = {
    name: string;
    uri: string;
  };

  const reads: Array<ReadCase> = [
    { name: "GET /on-call-readiness/policy/:policyId", uri: POLICY_ROUTE },
    { name: "GET /on-call-readiness/project", uri: PROJECT_ROUTE },
    { name: "GET /on-call-readiness/user/:userId", uri: USER_ROUTE },
  ];

  // Ids are generated per test, so the path params are filled in here.
  function paramsFor(uri: string): Dictionary<string> {
    if (uri === POLICY_ROUTE) {
      return { policyId: policyId.toString() };
    }

    if (uri === USER_ROUTE) {
      return { userId: subjectUserId.toString() };
    }

    return {};
  }

  test.each(reads)(
    "$name answers 401 and does no readiness work",
    async (read: ReadCase) => {
      const result: RouteCallResult = await callRoute({
        method: "GET",
        uri: read.uri,
        req: buildExpiredSessionRequest({
          tenantId: projectId,
          params: paramsFor(read.uri),
        }),
      });

      expect(result.reachedHandler).toBe(true);
      expectAskedToAuthenticate(result);
      expectNoReadinessWork();
    },
  );

  test.each(reads)(
    "$name with ?refresh=true does not clear the shared readiness cache for an anonymous caller",
    async (read: ReadCase) => {
      const result: RouteCallResult = await callRoute({
        method: "GET",
        uri: read.uri,
        req: buildExpiredSessionRequest({
          tenantId: projectId,
          params: paramsFor(read.uri),
          query: { refresh: "true" },
        }),
      });

      expectAskedToAuthenticate(result);
      expect(clearCacheSpy).not.toHaveBeenCalled();
    },
  );

  test.each(reads)(
    "$name answers 401 without a tenant header too",
    async (read: ReadCase) => {
      const result: RouteCallResult = await callRoute({
        method: "GET",
        uri: read.uri,
        req: buildExpiredSessionRequest({
          tenantId: undefined,
          params: paramsFor(read.uri),
        }),
      });

      expectAskedToAuthenticate(result);
      expectNoReadinessWork();
    },
  );

  test("a malformed path id from an anonymous caller is still the 401, not the 400", async () => {
    const result: RouteCallResult = await callRoute({
      method: "GET",
      uri: POLICY_ROUTE,
      req: buildExpiredSessionRequest({
        tenantId: projectId,
        params: { policyId: "not-a-uuid" },
      }),
    });

    expectAskedToAuthenticate(result);
    expectNoReadinessWork();
  });

  test("a signed-in member still reads the project summary (the reads keep the membership bar)", async () => {
    const result: RouteCallResult = await callRoute({
      method: "GET",
      uri: PROJECT_ROUTE,
      req: buildSignedInRequest({
        tenantId: projectId,
        userId: callerUserId,
        userType: UserType.User,
        permissions: [Permission.ProjectMember],
      }),
      signedIn: true,
    });

    expect(result.thrownToNext).toBeUndefined();
    expect(result.status).toBeUndefined();
    expect(projectReadinessSpy).toHaveBeenCalledTimes(1);
    expect(sendJsonSpy).toHaveBeenCalledTimes(1);
  });

  test("a signed-in member reads a policy of their own project", async () => {
    const req: ExpressRequest = buildSignedInRequest({
      tenantId: projectId,
      userId: callerUserId,
      userType: UserType.User,
      permissions: [Permission.ProjectMember],
    });

    (req as unknown as { params: Dictionary<string> }).params = {
      policyId: policyId.toString(),
    };

    const result: RouteCallResult = await callRoute({
      method: "GET",
      uri: POLICY_ROUTE,
      req: req,
      signedIn: true,
    });

    expect(result.thrownToNext).toBeUndefined();
    expect(policyReadinessSpy).toHaveBeenCalledTimes(1);
  });

  test("a signed-in caller who is not a member of the named project still gets the 422", async () => {
    const req: ExpressRequest = buildSignedInRequest({
      tenantId: otherProjectId,
      userId: callerUserId,
      userType: UserType.User,
      permissions: [Permission.ProjectMember],
    });

    (req as OneUptimeRequest).tenantId = projectId;
    req.headers["tenantid"] = projectId.toString();

    const result: RouteCallResult = await callRoute({
      method: "GET",
      uri: PROJECT_ROUTE,
      req: req,
      signedIn: true,
    });

    expect(result.thrownToNext).toBeInstanceOf(NotAuthorizedException);
    expect(result.status).toBe(422);
    expect(result.errorBody?.["message"]).toBe(REFUSAL);
    expectNoReadinessWork();
  });
});
