import { mockRouter } from "./Helpers";
import CommonAPI from "../../../Server/API/CommonAPI";
import StatusPageAPI from "../../../Server/API/StatusPageAPI";
import UserMiddleware from "../../../Server/Middleware/UserAuthorization";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import Response from "../../../Server/Utils/Response";
import StatusPagesListingMonitorsBuilder, {
  StatusPagesListingMonitorsRequest,
} from "../../../Server/Utils/StatusPage/StatusPagesListingMonitorsBuilder";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import Dictionary from "../../../Types/Dictionary";
import BadDataException from "../../../Types/Exception/BadDataException";
import NotAuthenticatedException from "../../../Types/Exception/NotAuthenticatedException";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission, {
  UserTenantAccessPermission,
} from "../../../Types/Permission";
import StatusPageEventType from "../../../Types/StatusPage/StatusPageEventType";
import StatusPagesListingMonitors, {
  StatusPagesListingMonitorsResult,
} from "../../../Types/StatusPage/StatusPagesListingMonitors";
import UserType from "../../../Types/UserType";
import getJestMockFunction, { MockFunction } from "../../MockType";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * The route's own part of POST /status-page/listing-monitors: where it is,
 * what guards it, who it admits and what it hands the builder. What the
 * answer holds, through the real permission layer, is
 * StatusPagesListingMonitorsAPI.test.ts; the builder on its own is
 * Utils/StatusPage/StatusPagesListingMonitorsBuilder.test.ts.
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
    sendJsonObjectResponse: jest.fn(),
    sendEntityArrayResponse: jest.fn(),
    sendEntityResponse: jest.fn(),
    sendEmptySuccessResponse: jest.fn(),
    sendErrorResponse: jest.fn(),
    sendFileResponse: jest.fn(),
    sendTextResponse: jest.fn(),
    setNoCacheHeaders: jest.fn(),
  };
});

const ROUTE: string = "/status-page/listing-monitors";

const PROJECT_ID: ObjectID = new ObjectID(
  "10000000-0000-4000-8000-000000000001",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "10000000-0000-4000-8000-000000000002",
);
const MONITOR_ID: string = "c0000000-0000-4000-8000-000000000001";
const PAGE_ID: string = "b0000000-0000-4000-8000-000000000001";

let callerProps: DatabaseCommonInteractionProps;
let build: MockFunction;

function tenantPermissions(
  projectId: ObjectID,
): Dictionary<UserTenantAccessPermission> {
  return {
    [projectId.toString()]: {
      _type: "UserTenantAccessPermission",
      projectId: projectId,
      permissions: [
        {
          _type: "UserPermission",
          permission: Permission.ProjectMember,
          labelIds: [],
          isBlockPermission: false,
        },
      ],
    } as UserTenantAccessPermission,
  };
}

interface RouteCall {
  thrown: unknown;
  sent: JSONObject | undefined;
}

async function post(body: unknown): Promise<RouteCall> {
  const req: ExpressRequest = {
    params: {},
    query: {},
    body: body,
    headers: {},
  } as unknown as ExpressRequest;

  const res: ExpressResponse = {} as ExpressResponse;
  const next: MockFunction = getJestMockFunction();

  await mockRouter
    .match("post", ROUTE)
    .handlerFunction(req, res, next as unknown as NextFunction);

  const send: jest.Mock =
    Response.sendJsonObjectResponse as unknown as jest.Mock;

  return {
    thrown: next.mock.calls[0] ? next.mock.calls[0][0] : undefined,
    sent: send.mock.calls[0]
      ? (send.mock.calls[0][2] as JSONObject)
      : undefined,
  };
}

function builtRequest(): StatusPagesListingMonitorsRequest {
  expect(build).toHaveBeenCalledTimes(1);
  return build.mock.calls[0]![0] as StatusPagesListingMonitorsRequest;
}

beforeAll(() => {
  mockRouter.routes.length = 0;
  new StatusPageAPI();
});

beforeEach(() => {
  jest.clearAllMocks();

  callerProps = {
    userId: new ObjectID("20000000-0000-4000-8000-000000000001"),
    userType: UserType.User,
    tenantId: PROJECT_ID,
    userTenantAccessPermission: tenantPermissions(PROJECT_ID),
  };

  jest
    .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
    .mockImplementation((() => {
      return Promise.resolve(callerProps);
    }) as never);

  build = getJestMockFunction();
  build.mockImplementation((): Promise<StatusPagesListingMonitorsResult> => {
    return Promise.resolve({
      statusPages: [{ statusPageId: PAGE_ID, name: "Acme Public" }],
    });
  });
  jest
    .spyOn(StatusPagesListingMonitorsBuilder, "build")
    .mockImplementation(build as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("POST /status-page/listing-monitors, the route", () => {
  test("is registered once, behind the session and the expired-session guard", () => {
    const registrations: Array<ReturnType<typeof mockRouter.match>> =
      mockRouter.routes.filter(
        (route: ReturnType<typeof mockRouter.match>): boolean => {
          return route.method === "POST" && route.uri === ROUTE;
        },
      );

    expect(registrations).toHaveLength(1);
    expect(registrations[0]!.middlewares).toEqual([
      UserMiddleware.getUserMiddleware,
      UserMiddleware.requireUserAuthentication,
    ]);
  });

  test("the path is the one the dashboard calls", () => {
    expect(StatusPagesListingMonitors.apiPath).toBe(ROUTE);
  });

  test("answers a member with the builder's answer, and no-cache headers", async () => {
    const call: RouteCall = await post({
      monitorIds: [MONITOR_ID],
      eventType: StatusPageEventType.ScheduledEvent,
    });

    expect(call.thrown).toBeUndefined();
    expect(call.sent).toEqual({
      statusPages: [{ statusPageId: PAGE_ID, name: "Acme Public" }],
    });
    expect(Response.setNoCacheHeaders).toHaveBeenCalledTimes(1);

    const request: StatusPagesListingMonitorsRequest = builtRequest();

    expect(request.projectId.toString()).toBe(PROJECT_ID.toString());
    expect(
      request.monitorIds.map((id: ObjectID): string => {
        return id.toString();
      }),
    ).toEqual([MONITOR_ID]);
    expect(request.eventType).toBe(StatusPageEventType.ScheduledEvent);
  });

  test("hands the builder the caller's own permissions, for one project, never root", async () => {
    callerProps = { ...callerProps, isMultiTenantRequest: true };

    await post({ monitorIds: [MONITOR_ID] });

    const props: DatabaseCommonInteractionProps = builtRequest().props;

    expect(props.isRoot).toBeFalsy();
    expect(props.isMultiTenantRequest).toBe(false);
    expect(props.userId?.toString()).toBe(callerProps.userId?.toString());
    expect(props.userTenantAccessPermission).toBe(
      callerProps.userTenantAccessPermission,
    );
  });

  test("admits a project API key: its own permissions bound what it learns", async () => {
    callerProps = {
      userType: UserType.API,
      tenantId: PROJECT_ID,
      userTenantAccessPermission: tenantPermissions(PROJECT_ID),
    };

    const call: RouteCall = await post({ monitorIds: [MONITOR_ID] });

    expect(call.thrown).toBeUndefined();
    expect(call.sent).toBeDefined();
    expect(builtRequest().props.userType).toBe(UserType.API);
  });

  test("refuses a caller who is not in the project named in the tenant header", async () => {
    callerProps = {
      ...callerProps,
      userTenantAccessPermission: tenantPermissions(OTHER_PROJECT_ID),
    };

    const call: RouteCall = await post({ monitorIds: [MONITOR_ID] });

    expect(call.thrown).toBeInstanceOf(NotAuthorizedException);
    expect(build).not.toHaveBeenCalled();
    expect(call.sent).toBeUndefined();
  });

  test("asks for the project when the tenant header is missing", async () => {
    callerProps = { ...callerProps, tenantId: undefined };

    const call: RouteCall = await post({ monitorIds: [MONITOR_ID] });

    expect(call.thrown).toBeInstanceOf(BadDataException);
    expect(build).not.toHaveBeenCalled();
  });

  test("an expired session is told to sign in again (401), not refused", async () => {
    callerProps = {
      userType: UserType.Public,
      tenantId: PROJECT_ID,
    };

    const call: RouteCall = await post({ monitorIds: [MONITOR_ID] });

    expect(call.thrown).toBeInstanceOf(NotAuthenticatedException);
    expect(build).not.toHaveBeenCalled();
  });

  test("a malformed request is refused before anything is read", async () => {
    const call: RouteCall = await post({ monitorIds: "all" });

    expect(call.thrown).toBeInstanceOf(BadDataException);
    expect(build).not.toHaveBeenCalled();
  });
});
