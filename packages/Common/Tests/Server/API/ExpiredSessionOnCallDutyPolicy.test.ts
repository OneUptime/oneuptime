import { mockRouter } from "./Helpers";
import CommonAPI from "../../../Server/API/CommonAPI";
import OnCallDutyPolicyAPI from "../../../Server/API/OnCallDutyPolicyAPI";
import UserMiddleware from "../../../Server/Middleware/UserAuthorization";
import OnCallDutyPolicyService from "../../../Server/Services/OnCallDutyPolicyService";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import Response from "../../../Server/Utils/Response";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import Dictionary from "../../../Types/Dictionary";
import BadDataException from "../../../Types/Exception/BadDataException";
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

jest.mock("../../../Server/Utils/Express", () => {
  return {
    getRouter: () => {
      return mockRouter;
    },
  };
});

jest.mock("../../../Server/Utils/Response", () => {
  return {
    sendJsonObjectResponse: jest.fn(),
    sendEntityArrayResponse: jest.fn(),
    sendEntityResponse: jest.fn(),
    sendEmptySuccessResponse: jest.fn(),
    sendErrorResponse: jest.fn(),
  };
});

/*
 * GET /on-call-duty-policy/current-on-duty-escalation-policies backs the
 * "you are on call" indicator in the dashboard header, so every dashboard
 * page polls it. That makes it the request most likely to be the FIRST to
 * arrive after the access-token cookie has expired together with its JWT:
 * the browser stops sending the cookie, getUserMiddleware passes the request
 * on as Public with only the page's tenantid header, and this handler used to
 * answer "Invalid userId." (400). The browser client refreshes the session
 * and replays only on a 401, so that 400 left the header broken and the
 * session unrefreshed.
 *
 * It now checks for credentials first: no credentials at all is 401. Callers
 * that ARE authenticated keep exactly the answers they had - including a
 * project API key, which has no user to be on call and still gets
 * "Invalid userId." (a 401 would only send its client to refresh a session it
 * does not have).
 */

const ROUTE: string =
  "/on-call-duty-policy/current-on-duty-escalation-policies";

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const USER_ID: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");

function tenantPermissions(
  permissions: Array<Permission>,
): Dictionary<UserTenantAccessPermission> {
  const dictionary: Dictionary<UserTenantAccessPermission> = {};

  dictionary[PROJECT_ID.toString()] = {
    _type: "UserTenantAccessPermission",
    projectId: PROJECT_ID,
    permissions: permissions.map((permission: Permission) => {
      return {
        _type: "UserPermission",
        permission: permission,
        labelIds: [],
        isBlockPermission: false,
      } as UserPermission;
    }),
    isBlockPermission: false,
  } as UserTenantAccessPermission;

  return dictionary;
}

function withProps(props: DatabaseCommonInteractionProps): void {
  jest
    .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
    .mockResolvedValue(props);
}

type RouteCall = {
  thrown: unknown;
  nextCallCount: number;
};

async function callRoute(): Promise<RouteCall> {
  const req: ExpressRequest = {
    params: {},
    query: {},
    body: {},
    headers: {},
  } as unknown as ExpressRequest;

  const next: jest.Mock = jest.fn();

  await mockRouter
    .match("get", ROUTE)
    .handlerFunction(
      req,
      {} as ExpressResponse,
      next as unknown as NextFunction,
    );

  return {
    thrown: next.mock.calls[0] ? next.mock.calls[0][0] : undefined,
    nextCallCount: next.mock.calls.length,
  };
}

// The error this handler sent itself (it answers bad input without next()).
function sentError(): unknown {
  const sendError: jest.Mock =
    Response.sendErrorResponse as unknown as jest.Mock;

  expect(sendError).toHaveBeenCalledTimes(1);

  return sendError.mock.calls[0]![2];
}

function expectAuthenticationRequired(call: RouteCall): void {
  expect(call.nextCallCount).toBe(1);
  expect(call.thrown).toBeInstanceOf(NotAuthenticatedException);
  expect(call.thrown).not.toBeInstanceOf(NotAuthorizedException);
  expect(call.thrown).not.toBeInstanceOf(BadDataException);
  expect((call.thrown as NotAuthenticatedException).code).toBe(
    ExceptionCode.NotAuthenticatedException,
  );
  expect((call.thrown as NotAuthenticatedException).message).toBe(
    CommonAPI.AUTHENTICATION_REQUIRED_MESSAGE,
  );
}

let onCallLookup: jest.SpyInstance;

beforeAll(() => {
  new OnCallDutyPolicyAPI();
});

beforeEach(() => {
  jest.restoreAllMocks();
  jest.clearAllMocks();

  onCallLookup = jest
    .spyOn(OnCallDutyPolicyService, "getOnCallPoliciesWhereUserIsOnCallDuty")
    .mockResolvedValue({
      escalationRulesByUser: [],
      escalationRulesByTeam: [],
      escalationRulesBySchedule: [],
    });
});

afterEach(() => {
  jest.restoreAllMocks();
});

function expectNoLookupAndNoResponse(): void {
  expect(onCallLookup).not.toHaveBeenCalled();
  expect(Response.sendJsonObjectResponse).not.toHaveBeenCalled();
}

describe(`GET ${ROUTE} - wiring`, () => {
  /*
   * getUserMiddleware is a context loader, not a gate; the handler is what
   * has to tell an anonymous caller to authenticate.
   */
  test("is mounted behind getUserMiddleware only", () => {
    expect(mockRouter.match("get", ROUTE).middlewares).toEqual([
      UserMiddleware.getUserMiddleware,
    ]);
  });
});

describe(`GET ${ROUTE} - an expired session`, () => {
  test("a caller with no credentials but the page's tenantid header gets 401, not 'Invalid userId.'", async () => {
    withProps({
      tenantId: PROJECT_ID,
      userType: UserType.Public,
      userId: undefined,
    });

    const call: RouteCall = await callRoute();

    expectAuthenticationRequired(call);
    expect(Response.sendErrorResponse).not.toHaveBeenCalled();
    expectNoLookupAndNoResponse();
  });

  test("a caller with no credentials and no tenantid header gets 401, not 'Invalid projectId.'", async () => {
    withProps({ userType: UserType.Public });

    const call: RouteCall = await callRoute();

    expectAuthenticationRequired(call);
    expect(Response.sendErrorResponse).not.toHaveBeenCalled();
    expectNoLookupAndNoResponse();
  });

  test("a caller getUserMiddleware left unclassified is anonymous too", async () => {
    withProps({ tenantId: PROJECT_ID });

    const call: RouteCall = await callRoute();

    expectAuthenticationRequired(call);
    expectNoLookupAndNoResponse();
  });

  /*
   * Tenant grants on a request with no user, no key and no master-admin
   * session prove nothing about who sent it.
   */
  test("stray tenant permissions do not make an anonymous caller authenticated", async () => {
    withProps({
      tenantId: PROJECT_ID,
      userType: UserType.Public,
      userTenantAccessPermission: tenantPermissions([Permission.ProjectOwner]),
    });

    const call: RouteCall = await callRoute();

    expectAuthenticationRequired(call);
    expectNoLookupAndNoResponse();
  });

  /*
   * isMasterAdmin is derived from a master-admin SESSION; the flag alone,
   * without a user or that session, is not a credential.
   */
  test("an isMasterAdmin flag without a user or a master-admin session is not a credential", async () => {
    withProps({ tenantId: PROJECT_ID, isMasterAdmin: true });

    const call: RouteCall = await callRoute();

    expectAuthenticationRequired(call);
    expectNoLookupAndNoResponse();
  });
});

describe(`GET ${ROUTE} - authenticated callers keep their answers`, () => {
  /*
   * A key has no user to be on call. It is authenticated, so it keeps the
   * 400 it always got rather than a 401 that would send it to refresh a
   * session it never had.
   */
  test("a project API key with no user still gets 400 'Invalid userId.'", async () => {
    withProps({
      tenantId: PROJECT_ID,
      userType: UserType.API,
      userId: undefined,
      userTenantAccessPermission: tenantPermissions([Permission.ProjectOwner]),
    });

    const call: RouteCall = await callRoute();

    expect(call.nextCallCount).toBe(0);

    const error: unknown = sentError();
    expect(error).toBeInstanceOf(BadDataException);
    expect(error).not.toBeInstanceOf(NotAuthenticatedException);
    expect((error as BadDataException).code).toBe(
      ExceptionCode.BadDataException,
    );
    expect((error as BadDataException).message).toBe("Invalid userId.");
    expectNoLookupAndNoResponse();
  });

  test("a master-admin session is a credential: with no user it gets 'Invalid userId.', not 401", async () => {
    withProps({
      tenantId: PROJECT_ID,
      userType: UserType.MasterAdmin,
      isMasterAdmin: true,
      userId: undefined,
    });

    const call: RouteCall = await callRoute();

    expect(call.nextCallCount).toBe(0);
    expect((sentError() as BadDataException).message).toBe("Invalid userId.");
    expectNoLookupAndNoResponse();
  });

  test("a signed-in user with no tenantid header still gets 400 'Invalid projectId.'", async () => {
    withProps({ userType: UserType.User, userId: USER_ID });

    const call: RouteCall = await callRoute();

    expect(call.nextCallCount).toBe(0);
    expect((sentError() as BadDataException).message).toBe(
      "Invalid projectId.",
    );
    expectNoLookupAndNoResponse();
  });

  test("a signed-in user gets their on-call escalation policies for the project", async () => {
    withProps({
      tenantId: PROJECT_ID,
      userType: UserType.User,
      userId: USER_ID,
      userTenantAccessPermission: tenantPermissions([Permission.ProjectMember]),
    });

    const call: RouteCall = await callRoute();

    expect(call.nextCallCount).toBe(0);
    expect(Response.sendErrorResponse).not.toHaveBeenCalled();
    expect(onCallLookup).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      userId: USER_ID,
    });

    const sendJson: jest.Mock =
      Response.sendJsonObjectResponse as unknown as jest.Mock;
    expect(sendJson).toHaveBeenCalledTimes(1);
    expect(sendJson.mock.calls[0]![2] as JSONObject).toEqual({
      escalationRulesByUser: [],
      escalationRulesByTeam: [],
      escalationRulesBySchedule: [],
    });
  });
});
