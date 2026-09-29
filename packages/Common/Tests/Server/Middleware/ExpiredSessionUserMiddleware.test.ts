import CommonAPI from "../../../Server/API/CommonAPI";
import UserMiddleware from "../../../Server/Middleware/UserAuthorization";
import {
  ExpressResponse,
  NextFunction,
  OneUptimeRequest,
} from "../../../Server/Utils/Express";
import Response from "../../../Server/Utils/Response";
import Dictionary from "../../../Types/Dictionary";
import Exception from "../../../Types/Exception/Exception";
import ExceptionCode from "../../../Types/Exception/ExceptionCode";
import NotAuthenticatedException from "../../../Types/Exception/NotAuthenticatedException";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import JSONWebTokenData from "../../../Types/JsonWebTokenData";
import ObjectID from "../../../Types/ObjectID";
import Permission, {
  UserPermission,
  UserTenantAccessPermission,
} from "../../../Types/Permission";
import UserType from "../../../Types/UserType";
import { getJestSpyOn } from "../../Spy";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * The request-level half of the expired-session fix.
 *
 * THE BUG
 *
 * The access-token cookie's maxAge is the JWT's own 15 minute lifetime, so a
 * Dashboard tab left open longer than that sends its next request with no
 * token at all. getUserMiddleware does not refuse such a request: it marks it
 * UserType.Public and lets it through, because plenty of routes (status pages,
 * public dashboards, CRUD reads of Public-permission models) are meant to be
 * reachable anonymously. Whatever runs next decides.
 *
 * The browser client (Common/UI/Utils/API/API.ts) refreshes the session and
 * replays the request ONLY on a 401. Everything that refused the anonymous
 * request with anything else - a 422 NotAuthorizedException ("You are not
 * authorized to access this project's data", "Project ID is required to
 * access this resource") or a 400 - surfaced as a hard error to a user whose
 * only problem was an idle tab.
 *
 * WHAT THIS FILE PINS
 *
 *   1. isAnonymousRequest is exactly "getUserMiddleware found neither a token
 *      nor an API key": userType unset or Public. API keys and master admins
 *      are credentials, not anonymity.
 *   2. requireUserAuthentication answers an anonymous request with a 401 and
 *      admits every credentialed one - including API keys, so automation on
 *      the routes that gained this guard keeps working.
 *   3. requirePermission asks "who are you?" BEFORE "which project?" and
 *      "what may you do?". An anonymous request with no tenant used to get
 *      the 422 "Project ID is required"; it now gets the 401, because no
 *      answer about tenants or permissions means anything until the caller
 *      has credentials. Every refusal of a credentialed caller is unchanged.
 *
 * Response.sendErrorResponse is spied on and silenced, so the assertion is on
 * the exception the middleware chose - its class and its code - rather than
 * on how Express would serialize it.
 */

const AUTHENTICATION_REQUIRED_MESSAGE: string =
  "Authentication required. Please log in to access this resource.";

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const USER_ID: ObjectID = new ObjectID("33333333-3333-4333-8333-333333333333");

type RequestFixture = {
  userType?: UserType | undefined;
  tenantId?: ObjectID | undefined;
  userAuthorization?: Partial<JSONWebTokenData> | undefined;
  userTenantAccessPermission?:
    | Dictionary<UserTenantAccessPermission>
    | undefined;
};

type BuildRequestFunction = (fixture: RequestFixture) => OneUptimeRequest;

const buildRequest: BuildRequestFunction = (
  fixture: RequestFixture,
): OneUptimeRequest => {
  return {
    headers: {},
    params: {},
    query: {},
    body: {},
    ...fixture,
  } as unknown as OneUptimeRequest;
};

type TenantPermissionFunction = (data: {
  projectId: ObjectID;
  permissions: Array<Permission>;
}) => Dictionary<UserTenantAccessPermission>;

const tenantPermission: TenantPermissionFunction = (data: {
  projectId: ObjectID;
  permissions: Array<Permission>;
}): Dictionary<UserTenantAccessPermission> => {
  return {
    [data.projectId.toString()]: {
      _type: "UserTenantAccessPermission",
      projectId: data.projectId,
      permissions: data.permissions.map(
        (permission: Permission): UserPermission => {
          return {
            _type: "UserPermission",
            permission: permission,
            labelIds: [],
          };
        },
      ),
    },
  };
};

type MiddlewareCallResult = {
  nextCalls: Array<Array<unknown>>;
  sentError: Exception | undefined;
  sendErrorCallCount: number;
};

type MiddlewareFunction = (
  req: OneUptimeRequest,
  res: ExpressResponse,
  next: NextFunction,
) => Promise<void>;

type CallMiddlewareFunction = (
  middleware: MiddlewareFunction,
  req: OneUptimeRequest,
) => Promise<MiddlewareCallResult>;

const callMiddleware: CallMiddlewareFunction = async (
  middleware: MiddlewareFunction,
  req: OneUptimeRequest,
): Promise<MiddlewareCallResult> => {
  const res: ExpressResponse = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
    send: jest.fn().mockReturnThis(),
  } as unknown as ExpressResponse;

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

type ExpectRefusedFunction = (result: MiddlewareCallResult) => void;

const expectUnauthenticated: ExpectRefusedFunction = (
  result: MiddlewareCallResult,
): void => {
  expect(result.nextCalls).toHaveLength(0);
  expect(result.sendErrorCallCount).toBe(1);
  expect(result.sentError).toBeInstanceOf(NotAuthenticatedException);
  expect(result.sentError?.code).toBe(ExceptionCode.NotAuthenticatedException);
  expect(result.sentError?.code).toBe(401);
  expect(result.sentError?.message).toBe(AUTHENTICATION_REQUIRED_MESSAGE);
};

type ExpectForbiddenFunction = (
  result: MiddlewareCallResult,
  message: string,
) => void;

const expectNotAuthorized: ExpectForbiddenFunction = (
  result: MiddlewareCallResult,
  message: string,
): void => {
  expect(result.nextCalls).toHaveLength(0);
  expect(result.sendErrorCallCount).toBe(1);
  expect(result.sentError).toBeInstanceOf(NotAuthorizedException);
  expect(result.sentError?.code).toBe(ExceptionCode.NotAuthorizedException);
  expect(result.sentError?.code).toBe(422);
  expect(result.sentError?.message).toBe(message);
};

type ExpectPassedFunction = (result: MiddlewareCallResult) => void;

const expectPassed: ExpectPassedFunction = (
  result: MiddlewareCallResult,
): void => {
  expect(result.sendErrorCallCount).toBe(0);
  expect(result.nextCalls).toHaveLength(1);
  // next() with an argument is Express's error path, not a pass.
  expect(result.nextCalls[0]).toEqual([]);
};

beforeEach(() => {
  jest.clearAllMocks();

  getJestSpyOn(Response, "sendErrorResponse").mockImplementation(() => {
    return undefined as never;
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("UserMiddleware.AUTHENTICATION_REQUIRED_MESSAGE", () => {
  /*
   * The request-level and the props-level refusal are two halves of one
   * contract with the client, and a user who hits one route and then another
   * should not see two different sentences for the same expired session.
   */
  test("is the same sentence CommonAPI uses", () => {
    expect(UserMiddleware.AUTHENTICATION_REQUIRED_MESSAGE).toBe(
      AUTHENTICATION_REQUIRED_MESSAGE,
    );
    expect(UserMiddleware.AUTHENTICATION_REQUIRED_MESSAGE).toBe(
      CommonAPI.AUTHENTICATION_REQUIRED_MESSAGE,
    );
  });
});

describe("UserMiddleware.isAnonymousRequest", () => {
  test.each([
    ["no userType at all (getUserMiddleware never ran)", undefined, true],
    ["UserType.Public (no token, no API key)", UserType.Public, true],
    ["UserType.User (a decoded session)", UserType.User, false],
    ["UserType.API (a project API key)", UserType.API, false],
    [
      "UserType.MasterAdmin (a master admin session)",
      UserType.MasterAdmin,
      false,
    ],
  ])(
    "%s -> anonymous: %p",
    (_label: string, userType: UserType | undefined, expected: boolean) => {
      expect(
        UserMiddleware.isAnonymousRequest(buildRequest({ userType: userType })),
      ).toBe(expected);
    },
  );

  /*
   * The decision keys on userType alone, which is what getUserMiddleware
   * sets. Stray session-shaped data on a Public request (a tenant, a
   * userAuthorization object, a permission map) must not promote it.
   */
  test("ignores session-shaped data on a Public request", () => {
    expect(
      UserMiddleware.isAnonymousRequest(
        buildRequest({
          userType: UserType.Public,
          tenantId: PROJECT_ID,
          userAuthorization: { userId: USER_ID },
          userTenantAccessPermission: tenantPermission({
            projectId: PROJECT_ID,
            permissions: [Permission.ProjectOwner],
          }),
        }),
      ),
    ).toBe(true);
  });

  /*
   * A master admin session carries no userId requirement here, and an API
   * key carries no userId at all. Neither is anonymous.
   */
  test("does not need a userId to call a request credentialed", () => {
    expect(
      UserMiddleware.isAnonymousRequest(
        buildRequest({ userType: UserType.API }),
      ),
    ).toBe(false);
    expect(
      UserMiddleware.isAnonymousRequest(
        buildRequest({ userType: UserType.MasterAdmin }),
      ),
    ).toBe(false);
  });
});

describe("UserMiddleware.requireUserAuthentication", () => {
  test.each([
    ["no userType", undefined],
    ["UserType.Public", UserType.Public],
  ])(
    "answers a request with %s with a 401",
    async (_label: string, userType: UserType | undefined) => {
      const result: MiddlewareCallResult = await callMiddleware(
        UserMiddleware.requireUserAuthentication as MiddlewareFunction,
        buildRequest({ userType: userType, tenantId: PROJECT_ID }),
      );

      expectUnauthenticated(result);
    },
  );

  test.each([
    ["a signed-in user", UserType.User, { userId: USER_ID }],
    ["a project API key", UserType.API, undefined],
    [
      "a master admin",
      UserType.MasterAdmin,
      { userId: USER_ID, isMasterAdmin: true },
    ],
  ])(
    "lets %s through",
    async (
      _label: string,
      userType: UserType,
      userAuthorization: Partial<JSONWebTokenData> | undefined,
    ) => {
      const result: MiddlewareCallResult = await callMiddleware(
        UserMiddleware.requireUserAuthentication as MiddlewareFunction,
        buildRequest({
          userType: userType,
          tenantId: PROJECT_ID,
          userAuthorization: userAuthorization,
        }),
      );

      expectPassed(result);
    },
  );

  /*
   * This guard is presence-only. Tenant and permission checks belong to
   * whatever follows it, so a credentialed request with no tenant is still
   * let through here - the refusal, if any, comes later and stays a 4xx the
   * client treats as final.
   */
  test("does not look at the tenant", async () => {
    const result: MiddlewareCallResult = await callMiddleware(
      UserMiddleware.requireUserAuthentication as MiddlewareFunction,
      buildRequest({ userType: UserType.User, userAuthorization: {} }),
    );

    expectPassed(result);
  });
});

describe("UserMiddleware.requirePermission", () => {
  const guard: MiddlewareFunction = UserMiddleware.requirePermission({
    permissions: [Permission.ProjectOwner, Permission.ProjectAdmin],
  }) as MiddlewareFunction;

  describe("an anonymous request", () => {
    test.each([
      ["no userType", undefined],
      ["UserType.Public", UserType.Public],
    ])(
      "with %s and a tenant gets a 401",
      async (_label: string, userType: UserType | undefined) => {
        const result: MiddlewareCallResult = await callMiddleware(
          guard,
          buildRequest({ userType: userType, tenantId: PROJECT_ID }),
        );

        expectUnauthenticated(result);
      },
    );

    /*
     * The ordering this change is about. This request used to get
     * "Project ID is required to access this resource." (422). The tenantid
     * header is the Dashboard's, not the session's, so its absence says
     * nothing about why the caller is anonymous - and a 422 here would stop
     * the client from refreshing a session that is merely expired.
     */
    test.each([
      ["no userType", undefined],
      ["UserType.Public", UserType.Public],
    ])(
      "with %s and NO tenant still gets the 401, not the tenant 422",
      async (_label: string, userType: UserType | undefined) => {
        const result: MiddlewareCallResult = await callMiddleware(
          guard,
          buildRequest({ userType: userType }),
        );

        expectUnauthenticated(result);
        expect(result.sentError?.message).not.toBe(
          "Project ID is required to access this resource.",
        );
      },
    );

    /*
     * Permission data that somehow survived onto an anonymous request is not
     * a credential. Only userType is.
     */
    test("gets a 401 even when it carries a matching permission map", async () => {
      const result: MiddlewareCallResult = await callMiddleware(
        guard,
        buildRequest({
          userType: UserType.Public,
          tenantId: PROJECT_ID,
          userTenantAccessPermission: tenantPermission({
            projectId: PROJECT_ID,
            permissions: [Permission.ProjectOwner],
          }),
        }),
      );

      expectUnauthenticated(result);
    });
  });

  describe("a master admin", () => {
    test("bypasses the tenant and permission checks", async () => {
      const result: MiddlewareCallResult = await callMiddleware(
        guard,
        buildRequest({
          userType: UserType.MasterAdmin,
          userAuthorization: { userId: USER_ID, isMasterAdmin: true },
        }),
      );

      expectPassed(result);
    });
  });

  describe("a signed-in user (unchanged refusals)", () => {
    test("without a tenant gets the 422 'Project ID is required'", async () => {
      const result: MiddlewareCallResult = await callMiddleware(
        guard,
        buildRequest({
          userType: UserType.User,
          userAuthorization: { userId: USER_ID },
        }),
      );

      expectNotAuthorized(
        result,
        "Project ID is required to access this resource.",
      );
    });

    test("with no permissions in the tenant gets a 422", async () => {
      const result: MiddlewareCallResult = await callMiddleware(
        guard,
        buildRequest({
          userType: UserType.User,
          tenantId: PROJECT_ID,
          userAuthorization: { userId: USER_ID },
          userTenantAccessPermission: tenantPermission({
            projectId: OTHER_PROJECT_ID,
            permissions: [Permission.ProjectOwner],
          }),
        }),
      );

      expectNotAuthorized(
        result,
        "You do not have permission to access this project.",
      );
    });

    test("without the required permission gets a 422", async () => {
      const result: MiddlewareCallResult = await callMiddleware(
        guard,
        buildRequest({
          userType: UserType.User,
          tenantId: PROJECT_ID,
          userAuthorization: { userId: USER_ID },
          userTenantAccessPermission: tenantPermission({
            projectId: PROJECT_ID,
            permissions: [Permission.ProjectMember],
          }),
        }),
      );

      expectNotAuthorized(
        result,
        "You do not have the required permission to perform this action.",
      );
    });

    test.each([Permission.ProjectOwner, Permission.ProjectAdmin])(
      "with %s is let through",
      async (permission: Permission) => {
        const result: MiddlewareCallResult = await callMiddleware(
          guard,
          buildRequest({
            userType: UserType.User,
            tenantId: PROJECT_ID,
            userAuthorization: { userId: USER_ID },
            userTenantAccessPermission: tenantPermission({
              projectId: PROJECT_ID,
              permissions: [Permission.ProjectMember, permission],
            }),
          }),
        );

        expectPassed(result);
      },
    );
  });

  /*
   * A project API key is a credential: it is not anonymous, so it is judged
   * on its tenant and permissions like a user, and keeps exactly the answers
   * it had before this change.
   */
  describe("a project API key (unchanged)", () => {
    test("without a tenant gets the 422 'Project ID is required'", async () => {
      const result: MiddlewareCallResult = await callMiddleware(
        guard,
        buildRequest({ userType: UserType.API }),
      );

      expectNotAuthorized(
        result,
        "Project ID is required to access this resource.",
      );
    });

    test("with the required permission is let through", async () => {
      const result: MiddlewareCallResult = await callMiddleware(
        guard,
        buildRequest({
          userType: UserType.API,
          tenantId: PROJECT_ID,
          userTenantAccessPermission: tenantPermission({
            projectId: PROJECT_ID,
            permissions: [Permission.ProjectAdmin],
          }),
        }),
      );

      expectPassed(result);
    });

    test("without the required permission gets a 422", async () => {
      const result: MiddlewareCallResult = await callMiddleware(
        guard,
        buildRequest({
          userType: UserType.API,
          tenantId: PROJECT_ID,
          userTenantAccessPermission: tenantPermission({
            projectId: PROJECT_ID,
            permissions: [Permission.ProjectMember],
          }),
        }),
      );

      expectNotAuthorized(
        result,
        "You do not have the required permission to perform this action.",
      );
    });
  });
});
