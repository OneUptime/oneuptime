import CommonAPI from "../../../Server/API/CommonAPI";
import ProjectAPI, {
  getRetentionPermissions,
} from "../../../Server/API/ProjectAPI";
import UserMiddleware from "../../../Server/Middleware/UserAuthorization";
import ProjectService from "../../../Server/Services/ProjectService";
import ResolvedRecordRetention from "../../../Server/Utils/Retention/ResolvedRecordRetention";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import Response from "../../../Server/Utils/Response";
import { mockRouter } from "./Helpers";
import Project from "../../../Models/DatabaseModels/Project";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import Dictionary from "../../../Types/Dictionary";
import BadDataException from "../../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission, {
  UserPermission,
  UserTenantAccessPermission,
} from "../../../Types/Permission";
import {
  ResolvedRecordKind,
  ResolvedRecordRetentionServerLimits,
} from "../../../Types/Retention/ResolvedRecordRetention";
import UserType from "../../../Types/UserType";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "@jest/globals";

/*
 * The project's Data Retention routes (issues #6941, #6943):
 *
 *   GET  /project/:id/resolved-record-retention        the server's maximum
 *   POST /project/:id/resolved-record-retention/count  what a setting deletes now
 *
 * The first tells anyone who may read the project's retention what the
 * server holds it to; the second counts for the Project Owners and Admins
 * who may change it, never for anyone else, and answers a count that fails
 * with no count. Both name the project the request is authenticated for,
 * and read nothing until the caller is checked.
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
    sendJsonObjectResponse: jest.fn().mockImplementation((...args: []) => {
      return args;
    }),
    sendEmptySuccessResponse: jest.fn(),
    setNoCacheHeaders: jest.fn(),
    sendEntityResponse: jest.fn(),
    sendErrorResponse: jest.fn(),
  };
});

const LIMITS_ROUTE: string = "/project/:id/resolved-record-retention";
const COUNT_ROUTE: string = "/project/:id/resolved-record-retention/count";

function buildProps(data: {
  projectId: ObjectID;
  permissions: Array<Permission>;
}): DatabaseCommonInteractionProps {
  const tenantPermission: UserTenantAccessPermission = {
    _type: "UserTenantAccessPermission",
    projectId: data.projectId,
    permissions: data.permissions.map(
      (permission: Permission): UserPermission => {
        return {
          _type: "UserPermission",
          permission: permission,
          labelIds: [],
          isBlockPermission: false,
        };
      },
    ),
  };

  const permissionMap: Dictionary<UserTenantAccessPermission> = {};
  permissionMap[data.projectId.toString()] = tenantPermission;

  return {
    tenantId: data.projectId,
    userId: ObjectID.generate(),
    userType: UserType.User,
    userTenantAccessPermission: permissionMap,
  };
}

interface RouteCallResult {
  thrownToNext: unknown;
  res: ExpressResponse;
}

async function callRoute(data: {
  method: "GET" | "POST";
  route: string;
  id: string;
  body?: JSONObject | undefined;
}): Promise<RouteCallResult> {
  const req: ExpressRequest = {
    params: { id: data.id },
    query: {},
    body: data.body || {},
    headers: {},
  } as unknown as ExpressRequest;

  const res: ExpressResponse = {
    send: jest.fn(),
    json: jest.fn(),
    status: jest.fn().mockReturnThis(),
  } as unknown as ExpressResponse;

  const next: jest.Mock = jest.fn();

  await mockRouter
    .match(data.method, data.route)
    .handlerFunction(req, res, next as unknown as NextFunction);

  return {
    thrownToNext: next.mock.calls[0] ? next.mock.calls[0][0] : undefined,
    res: res,
  };
}

function sentBody(): JSONObject {
  expect(Response.sendJsonObjectResponse).toHaveBeenCalledTimes(1);
  return (Response.sendJsonObjectResponse as unknown as jest.Mock).mock
    .calls[0]![2] as JSONObject;
}

let projectId: ObjectID;
let propsSpy: jest.SpyInstance;
let limitsSpy: jest.SpyInstance;
let countSpy: jest.SpyInstance;
let savedSpy: jest.SpyInstance;

function caller(permissions: Array<Permission>): void {
  propsSpy.mockResolvedValue(
    buildProps({ projectId: projectId, permissions: permissions }),
  );
}

beforeAll(() => {
  mockRouter.routes.length = 0;
  new ProjectAPI();
});

beforeEach(() => {
  jest.clearAllMocks();
  projectId = ObjectID.generate();

  propsSpy = jest.spyOn(CommonAPI, "getDatabaseCommonInteractionProps");
  limitsSpy = jest
    .spyOn(ResolvedRecordRetention, "getServerLimits")
    .mockImplementation(
      async (
        kind: ResolvedRecordKind,
      ): Promise<ResolvedRecordRetentionServerLimits> => {
        return {
          maximumInDays: kind === ResolvedRecordKind.Incident ? 365 : undefined,
          defaultInDays: 0,
        };
      },
    );
  countSpy = jest
    .spyOn(ResolvedRecordRetention, "countDueRecords")
    .mockResolvedValue({ count: 4512, isAtLeast: false });

  const saved: Project = new Project();
  saved.keepIncidentsWithCompletedPostmortem = true;
  saved.keepIncidentsInPostmortemStatusIds = [
    "6943a000-0000-4000-8000-000000000001",
  ];
  savedSpy = jest.spyOn(ProjectService, "findOneById").mockResolvedValue(saved);

  caller([Permission.ProjectOwner]);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("who may ask", () => {
  test("the maximum is read by whoever may read the project's retention; the count by whoever may change it", () => {
    expect(
      getRetentionPermissions(ResolvedRecordKind.Incident, "read"),
    ).toEqual(
      new Project().getColumnAccessControlFor("incidentRetentionInDays")?.read,
    );
    expect(
      getRetentionPermissions(ResolvedRecordKind.Incident, "update"),
    ).toEqual([Permission.ProjectOwner, Permission.ProjectAdmin]);
    expect(getRetentionPermissions(ResolvedRecordKind.Alert, "update")).toEqual(
      [Permission.ProjectOwner, Permission.ProjectAdmin],
    );
  });

  test("both routes are mounted behind getUserMiddleware", () => {
    expect(mockRouter.match("GET", LIMITS_ROUTE).middlewares).toEqual([
      UserMiddleware.getUserMiddleware,
    ]);
    expect(mockRouter.match("POST", COUNT_ROUTE).middlewares).toEqual([
      UserMiddleware.getUserMiddleware,
    ]);
  });
});

describe("GET /project/:id/resolved-record-retention", () => {
  test("tells a member the server's maximum for incidents and alerts, uncached", async () => {
    caller([Permission.Viewer]);

    const result: RouteCallResult = await callRoute({
      method: "GET",
      route: LIMITS_ROUTE,
      id: projectId.toString(),
    });

    expect(result.thrownToNext).toBeUndefined();
    expect(Response.setNoCacheHeaders).toHaveBeenCalledWith(result.res);
    expect(sentBody()).toEqual({
      incidentMaximumInDays: 365,
      alertMaximumInDays: null,
    });
  });

  test("refuses a caller with no permission that reads the project's retention, reading nothing", async () => {
    caller([]);

    const result: RouteCallResult = await callRoute({
      method: "GET",
      route: LIMITS_ROUTE,
      id: projectId.toString(),
    });

    expect(result.thrownToNext).toBeInstanceOf(NotAuthorizedException);
    expect(limitsSpy).not.toHaveBeenCalled();
  });

  test("refuses another project's id than the one the request is for", async () => {
    const result: RouteCallResult = await callRoute({
      method: "GET",
      route: LIMITS_ROUTE,
      id: ObjectID.generate().toString(),
    });

    expect(result.thrownToNext).toBeInstanceOf(NotAuthorizedException);
    expect(limitsSpy).not.toHaveBeenCalled();
  });
});

describe("POST /project/:id/resolved-record-retention/count", () => {
  test("counts a Project Owner's change as it would be saved, held to the server's maximum", async () => {
    const result: RouteCallResult = await callRoute({
      method: "POST",
      route: COUNT_ROUTE,
      id: projectId.toString(),
      body: {
        kind: "Incident",
        retentionInDays: 90,
        keepIncidentsWithCompletedPostmortem: false,
      },
    });

    expect(result.thrownToNext).toBeUndefined();
    expect(sentBody()).toEqual({ count: 4512, isAtLeast: false });

    const call: Parameters<typeof ResolvedRecordRetention.countDueRecords>[0] =
      countSpy.mock.calls[0]![0];

    expect(call.kind).toBe(ResolvedRecordKind.Incident);
    expect(call.projectId.toString()).toBe(projectId.toString());
    expect(call.retentionInDays).toBe(90);
    expect(call.keepCompletedPostmortems).toBe(false);
    // What the change leaves out is the project's as saved.
    expect(call.keptPostmortemStatusIds).toEqual([
      "6943a000-0000-4000-8000-000000000001",
    ]);
    expect(call.maximumInDays).toBe(365);
    expect((savedSpy.mock.calls[0]![0] as { props: unknown }).props).toEqual({
      isRoot: true,
    });
  });

  test("a change of the statuses is counted with them, and an alert's with nothing about postmortems", async () => {
    await callRoute({
      method: "POST",
      route: COUNT_ROUTE,
      id: projectId.toString(),
      body: {
        kind: "Incident",
        retentionInDays: 365,
        keepIncidentsInPostmortemStatusIds: [
          "6943B000-0000-4000-8000-000000000002",
        ],
      },
    });

    expect(countSpy.mock.calls[0]![0].keepCompletedPostmortems).toBe(true);
    expect(countSpy.mock.calls[0]![0].keptPostmortemStatusIds).toEqual([
      "6943b000-0000-4000-8000-000000000002",
    ]);

    caller([Permission.ProjectAdmin]);
    await callRoute({
      method: "POST",
      route: COUNT_ROUTE,
      id: projectId.toString(),
      body: { kind: "Alert", retentionInDays: 30 },
    });

    expect(countSpy.mock.calls[1]![0].kind).toBe(ResolvedRecordKind.Alert);
    expect(countSpy.mock.calls[1]![0].maximumInDays).toBeUndefined();
  });

  test.each([
    [Permission.ProjectMember],
    [Permission.IncidentAdmin],
    [Permission.EditProject],
    [Permission.Viewer],
  ])(
    "refuses a %s, who may not change the setting, counting nothing",
    async (permission: Permission) => {
      caller([permission]);

      const result: RouteCallResult = await callRoute({
        method: "POST",
        route: COUNT_ROUTE,
        id: projectId.toString(),
        body: { kind: "Incident", retentionInDays: 90 },
      });

      expect(result.thrownToNext).toBeInstanceOf(NotAuthorizedException);
      expect(countSpy).not.toHaveBeenCalled();
    },
  );

  test("refuses a request that does not say what to count", async () => {
    for (const body of [
      {},
      { kind: "Incident" },
      { kind: "Incident", retentionInDays: 45 },
      { kind: "Monitor", retentionInDays: 90 },
    ]) {
      const result: RouteCallResult = await callRoute({
        method: "POST",
        route: COUNT_ROUTE,
        id: projectId.toString(),
        body: body as JSONObject,
      });

      expect(result.thrownToNext).toBeInstanceOf(BadDataException);
    }

    expect(countSpy).not.toHaveBeenCalled();
  });

  test("a count that fails or times out is answered with no count, never as an error", async () => {
    countSpy.mockRejectedValue(
      new Error("canceling statement due to statement timeout"),
    );

    const result: RouteCallResult = await callRoute({
      method: "POST",
      route: COUNT_ROUTE,
      id: projectId.toString(),
      body: { kind: "Incident", retentionInDays: 90 },
    });

    expect(result.thrownToNext).toBeUndefined();
    expect(sentBody()).toEqual({ count: null, isAtLeast: false });
  });

  test("refuses another project's id, counting nothing", async () => {
    const result: RouteCallResult = await callRoute({
      method: "POST",
      route: COUNT_ROUTE,
      id: ObjectID.generate().toString(),
      body: { kind: "Incident", retentionInDays: 90 },
    });

    expect(result.thrownToNext).toBeInstanceOf(NotAuthorizedException);
    expect(countSpy).not.toHaveBeenCalled();
  });
});
