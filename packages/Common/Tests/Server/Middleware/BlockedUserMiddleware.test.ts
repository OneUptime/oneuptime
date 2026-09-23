import MasterAdminAuthorization from "../../../Server/Middleware/MasterAdminAuthorization";
import UserMiddleware from "../../../Server/Middleware/UserAuthorization";
import AccessTokenService from "../../../Server/Services/AccessTokenService";
import ProjectService from "../../../Server/Services/ProjectService";
import UserService from "../../../Server/Services/UserService";
import {
  ExpressResponse,
  NextFunction,
  OneUptimeRequest,
} from "../../../Server/Utils/Express";
import JSONWebToken from "../../../Server/Utils/JsonWebToken";
import logger from "../../../Server/Utils/Logger";
import Response from "../../../Server/Utils/Response";
import Dictionary from "../../../Types/Dictionary";
import Email from "../../../Types/Email";
import Exception from "../../../Types/Exception/Exception";
import ExceptionMessages from "../../../Types/Exception/ExceptionMessages";
import NotAuthenticatedException from "../../../Types/Exception/NotAuthenticatedException";
import ServerException from "../../../Types/Exception/ServerException";
import Name from "../../../Types/Name";
import ObjectID from "../../../Types/ObjectID";
import { UserGlobalAccessPermission } from "../../../Types/Permission";
import UserType from "../../../Types/UserType";
import { getJestSpyOn } from "../../Spy";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * A BLOCKED USER'S ACCESS TOKEN STOPS WORKING, NOT JUST THEIR NEXT SIGN-IN.
 *
 * Access tokens are stateless JWTs that live for 15 minutes. Blocking a user
 * revokes their sessions, which stops /refresh-token from minting new ones,
 * but it cannot recall a token already in the browser. Before the request
 * middlewares consulted `User.isBlocked`, a user blocked by a master admin
 * kept full access -- including, for a master admin, every master-admin
 * route -- until that token ran out.
 *
 * Tokens are signed and decoded with the real JSONWebToken, so a "valid
 * token" here is one production would accept. UserService.isUserBlocked is
 * stubbed: its caching is UserServiceBlockedUser.test.ts.
 */

const USER_ID: ObjectID = new ObjectID("44444444-4444-4444-8444-444444444444");

type SignValidTokenFunction = (data?: { isMasterAdmin?: boolean }) => string;

const signValidToken: SignValidTokenFunction = (data?: {
  isMasterAdmin?: boolean;
}): string => {
  return JSONWebToken.signUserLoginToken({
    tokenData: {
      userId: USER_ID,
      email: new Email("blocked.user@example.com"),
      name: new Name("Blocked User"),
      timezone: null,
      isMasterAdmin: Boolean(data?.isMasterAdmin),
      isGlobalLogin: true,
      sessionId: ObjectID.generate(),
    },
    expiresInSeconds: 15 * 60,
  });
};

type BuildRequestFunction = (data: {
  cookies?: Dictionary<string>;
  headers?: Dictionary<string>;
}) => OneUptimeRequest;

// No tenant, so the permission path stays on the global lookup.
const buildRequest: BuildRequestFunction = (data: {
  cookies?: Dictionary<string>;
  headers?: Dictionary<string>;
}): OneUptimeRequest => {
  return {
    params: {},
    query: {},
    body: {},
    cookies: data.cookies || {},
    headers: { tenantid: "", ...(data.headers || {}) },
  } as unknown as OneUptimeRequest;
};

type MiddlewareFunction = (
  req: OneUptimeRequest,
  res: ExpressResponse,
  next: NextFunction,
) => Promise<void>;

type MiddlewareCallResult = {
  nextCalls: Array<Array<unknown>>;
  sentError: Exception | undefined;
  sendErrorCallCount: number;
};

type CallMiddlewareFunction = (
  middleware: MiddlewareFunction,
  req: OneUptimeRequest,
) => Promise<MiddlewareCallResult>;

const callMiddleware: CallMiddlewareFunction = async (
  middleware: MiddlewareFunction,
  req: OneUptimeRequest,
): Promise<MiddlewareCallResult> => {
  const res: ExpressResponse = { set: jest.fn() } as unknown as ExpressResponse;
  const next: jest.Mock = jest.fn();

  await middleware(req, res, next as unknown as NextFunction);

  const errorCalls: Array<Array<unknown>> = (
    Response.sendErrorResponse as unknown as jest.Mock
  ).mock.calls as Array<Array<unknown>>;

  return {
    nextCalls: next.mock.calls as Array<Array<unknown>>,
    sentError: errorCalls[0]?.[2] as Exception | undefined,
    sendErrorCallCount: errorCalls.length,
  };
};

type ExpectBlockedRefusalFunction = (result: MiddlewareCallResult) => void;

/*
 * A 401 specifically: the browser client answers a 401 by asking
 * /refresh-token for a new session, which is refused for a blocked user, and
 * that refusal is what signs them out. A 422 would leave a dead dashboard.
 */
const expectBlockedRefusal: ExpectBlockedRefusalFunction = (
  result: MiddlewareCallResult,
): void => {
  expect(result.nextCalls).toHaveLength(0);
  expect(result.sendErrorCallCount).toBe(1);
  expect(result.sentError).toBeInstanceOf(NotAuthenticatedException);
  expect(result.sentError?.code).toBe(401);
  expect(result.sentError?.message).toBe(ExceptionMessages.UserBlocked);
};

const GLOBAL_PERMISSION: UserGlobalAccessPermission = {
  _type: "UserGlobalAccessPermission",
  projectIds: [],
  globalPermissions: [],
};

let isUserBlocked: jest.SpyInstance;
let getUserGlobalAccessPermission: jest.SpyInstance;
let userUpdateLastActive: jest.SpyInstance;

beforeEach(() => {
  jest.clearAllMocks();

  getJestSpyOn(Response, "sendErrorResponse").mockImplementation(() => {
    return undefined as never;
  });
  getJestSpyOn(logger, "error").mockImplementation(() => {
    return undefined;
  });

  isUserBlocked = getJestSpyOn(UserService, "isUserBlocked").mockResolvedValue(
    false,
  );
  getUserGlobalAccessPermission = getJestSpyOn(
    AccessTokenService,
    "getUserGlobalAccessPermission",
  ).mockResolvedValue(GLOBAL_PERMISSION);
  userUpdateLastActive = getJestSpyOn(
    UserService,
    "updateLastActive",
  ).mockResolvedValue(undefined);
  getJestSpyOn(ProjectService, "updateLastActive").mockResolvedValue(undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("UserMiddleware.getUserMiddleware — a blocked user's live access token", () => {
  test("is refused with a 401 from the access-token cookie", async () => {
    isUserBlocked.mockResolvedValue(true);

    const result: MiddlewareCallResult = await callMiddleware(
      UserMiddleware.getUserMiddleware as MiddlewareFunction,
      buildRequest({ cookies: { "user-token": signValidToken() } }),
    );

    expectBlockedRefusal(result);
    expect(isUserBlocked).toHaveBeenCalledWith(USER_ID);
  });

  // The mobile app's transport.
  test("is refused with a 401 from an Authorization: Bearer header", async () => {
    isUserBlocked.mockResolvedValue(true);

    const result: MiddlewareCallResult = await callMiddleware(
      UserMiddleware.getUserMiddleware as MiddlewareFunction,
      buildRequest({
        headers: { authorization: `Bearer ${signValidToken()}` },
      }),
    );

    expectBlockedRefusal(result);
  });

  test("is refused for a master admin too", async () => {
    isUserBlocked.mockResolvedValue(true);

    const req: OneUptimeRequest = buildRequest({
      cookies: { "user-token": signValidToken({ isMasterAdmin: true }) },
    });

    const result: MiddlewareCallResult = await callMiddleware(
      UserMiddleware.getUserMiddleware as MiddlewareFunction,
      req,
    );

    expectBlockedRefusal(result);
    expect(req.userType).not.toBe(UserType.MasterAdmin);
  });

  test("resolves no permissions and records no activity for the refused request", async () => {
    isUserBlocked.mockResolvedValue(true);

    const req: OneUptimeRequest = buildRequest({
      cookies: { "user-token": signValidToken() },
    });

    await callMiddleware(
      UserMiddleware.getUserMiddleware as MiddlewareFunction,
      req,
    );

    expect(getUserGlobalAccessPermission).not.toHaveBeenCalled();
    expect(userUpdateLastActive).not.toHaveBeenCalled();
    expect(req.userGlobalAccessPermission).toBeUndefined();
  });

  test("still lets a user who is not blocked through", async () => {
    const req: OneUptimeRequest = buildRequest({
      cookies: { "user-token": signValidToken() },
    });

    const result: MiddlewareCallResult = await callMiddleware(
      UserMiddleware.getUserMiddleware as MiddlewareFunction,
      req,
    );

    expect(result.sendErrorCallCount).toBe(0);
    expect(result.nextCalls).toEqual([[]]);
    expect(req.userType).toBe(UserType.User);
    expect(req.userAuthorization?.userId.toString()).toBe(USER_ID.toString());
    expect(isUserBlocked).toHaveBeenCalledWith(USER_ID);
  });

  // "We could not find out" is not "not blocked".
  test("refuses the request when the blocked-status lookup fails", async () => {
    const lookupFailure: ServerException = new ServerException(
      "database unavailable",
    );
    isUserBlocked.mockRejectedValue(lookupFailure);

    const result: MiddlewareCallResult = await callMiddleware(
      UserMiddleware.getUserMiddleware as MiddlewareFunction,
      buildRequest({ cookies: { "user-token": signValidToken() } }),
    );

    expect(result.nextCalls).toHaveLength(0);
    expect(result.sendErrorCallCount).toBe(1);
    expect(result.sentError).toBe(lookupFailure);
  });

  test("is not consulted for a request with no access token", async () => {
    const result: MiddlewareCallResult = await callMiddleware(
      UserMiddleware.getUserMiddleware as MiddlewareFunction,
      buildRequest({}),
    );

    expect(result.nextCalls).toEqual([[]]);
    expect(isUserBlocked).not.toHaveBeenCalled();
  });
});

describe("UserMiddleware.getPublicRouteUserMiddleware — a blocked user's live access token", () => {
  /*
   * The public dashboard and status page routes never read the caller's
   * identity and cannot refresh a dashboard session, so a 401 there is a
   * reload loop. The blocked user is served exactly as an anonymous visitor.
   */
  test("is served anonymously rather than refused", async () => {
    isUserBlocked.mockResolvedValue(true);

    const req: OneUptimeRequest = buildRequest({
      cookies: { "user-token": signValidToken() },
    });

    const result: MiddlewareCallResult = await callMiddleware(
      UserMiddleware.getPublicRouteUserMiddleware as MiddlewareFunction,
      req,
    );

    expect(result.sendErrorCallCount).toBe(0);
    expect(result.nextCalls).toEqual([[]]);
    expect(req.userType).toBe(UserType.Public);
    expect(req.userAuthorization).toBeUndefined();
    expect(UserMiddleware.isAnonymousRequest(req)).toBe(true);
    expect(getUserGlobalAccessPermission).not.toHaveBeenCalled();
  });

  test("leaves a request that requireUserAuthentication still refuses", async () => {
    isUserBlocked.mockResolvedValue(true);

    const req: OneUptimeRequest = buildRequest({
      cookies: { "user-token": signValidToken() },
    });

    await callMiddleware(
      UserMiddleware.getPublicRouteUserMiddleware as MiddlewareFunction,
      req,
    );

    (Response.sendErrorResponse as unknown as jest.Mock).mockClear();

    const guarded: MiddlewareCallResult = await callMiddleware(
      UserMiddleware.requireUserAuthentication as MiddlewareFunction,
      req,
    );

    expect(guarded.nextCalls).toHaveLength(0);
    expect(guarded.sentError).toBeInstanceOf(NotAuthenticatedException);
  });
});

describe("MasterAdminAuthorization — a blocked master admin's live access token", () => {
  /*
   * The master-admin routes decode the JWT themselves instead of going
   * through getUserMiddleware, so they need the check of their own.
   */
  test("is refused with a 401 by isAuthorizedMasterAdminMiddleware", async () => {
    isUserBlocked.mockResolvedValue(true);

    const result: MiddlewareCallResult = await callMiddleware(
      MasterAdminAuthorization.isAuthorizedMasterAdminMiddleware as unknown as MiddlewareFunction,
      buildRequest({
        cookies: { "user-token": signValidToken({ isMasterAdmin: true }) },
      }),
    );

    expectBlockedRefusal(result);
    expect(isUserBlocked).toHaveBeenCalledWith(USER_ID);
  });

  test("is refused with a 401 by isAuthorizedMasterAdminOrMasterApiKeyMiddleware", async () => {
    isUserBlocked.mockResolvedValue(true);

    const result: MiddlewareCallResult = await callMiddleware(
      MasterAdminAuthorization.isAuthorizedMasterAdminOrMasterApiKeyMiddleware as unknown as MiddlewareFunction,
      buildRequest({
        cookies: { "user-token": signValidToken({ isMasterAdmin: true }) },
      }),
    );

    expectBlockedRefusal(result);
  });

  test("still lets a master admin who is not blocked through", async () => {
    const result: MiddlewareCallResult = await callMiddleware(
      MasterAdminAuthorization.isAuthorizedMasterAdminMiddleware as unknown as MiddlewareFunction,
      buildRequest({
        cookies: { "user-token": signValidToken({ isMasterAdmin: true }) },
      }),
    );

    expect(result.sendErrorCallCount).toBe(0);
    expect(result.nextCalls).toEqual([[]]);
  });

  // A lookup failure is reported as itself, not as an invalid token the client should refresh.
  test("reports a failed lookup as that failure, not as an invalid token", async () => {
    const lookupFailure: ServerException = new ServerException(
      "database unavailable",
    );
    isUserBlocked.mockRejectedValue(lookupFailure);

    const result: MiddlewareCallResult = await callMiddleware(
      MasterAdminAuthorization.isAuthorizedMasterAdminMiddleware as unknown as MiddlewareFunction,
      buildRequest({
        cookies: { "user-token": signValidToken({ isMasterAdmin: true }) },
      }),
    );

    expect(result.nextCalls).toHaveLength(0);
    expect(result.sendErrorCallCount).toBe(1);
    expect(result.sentError).toBe(lookupFailure);
  });

  // Not a master admin at all: refused as before, without a lookup.
  test("does not look up a caller that is refused as not a master admin", async () => {
    const result: MiddlewareCallResult = await callMiddleware(
      MasterAdminAuthorization.isAuthorizedMasterAdminMiddleware as unknown as MiddlewareFunction,
      buildRequest({ cookies: { "user-token": signValidToken() } }),
    );

    expect(result.nextCalls).toHaveLength(0);
    expect(result.sentError?.code).toBe(422);
    expect(isUserBlocked).not.toHaveBeenCalled();
  });
});
