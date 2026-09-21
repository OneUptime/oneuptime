import CommonAPI from "../../../Server/API/CommonAPI";
import MonitorAPI from "../../../Server/API/MonitorAPI";
import UserMiddleware from "../../../Server/Middleware/UserAuthorization";
import MonitorService from "../../../Server/Services/MonitorService";
import MonitorStatusTimelineService from "../../../Server/Services/MonitorStatusTimelineService";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import Response from "../../../Server/Utils/Response";
import { mockRouter } from "./Helpers";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import MonitorStatusTimeline from "../../../Models/DatabaseModels/MonitorStatusTimeline";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import Dictionary from "../../../Types/Dictionary";
import BadDataException from "../../../Types/Exception/BadDataException";
import Exception from "../../../Types/Exception/Exception";
import ExceptionCode from "../../../Types/Exception/ExceptionCode";
import NotAuthenticatedException from "../../../Types/Exception/NotAuthenticatedException";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import { JSONObject } from "../../../Types/JSON";
import {
  MonitorUptimeSummary,
  MonitorUptimeWindowKey,
} from "../../../Types/Monitor/MonitorUptimeSummary";
import ObjectID from "../../../Types/ObjectID";
import Permission, {
  UserPermission,
  UserTenantAccessPermission,
} from "../../../Types/Permission";
import UserType from "../../../Types/UserType";
import MonitorUptimeSummaryUtil from "../../../Utils/Monitor/MonitorUptimeSummaryUtil";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "@jest/globals";

/*
 * GET /monitor/uptime-summary/:monitorId?timezone=<IANA zone>
 *
 * The monitor overview's uptime bars and rolling windows. The aggregate
 * behind it runs as root, so the route itself has to apply everything the
 * CRUD read of MonitorStatusTimeline would have applied, and it must not
 * read anything before the checks that come first have passed:
 *
 *   1. an authenticated member of the tenant (401 / 400 / 422),
 *   2. a valid monitor id and time zone (400),
 *   3. an Allow grant to read timelines and no team BLOCK on it,
 *   4. the monitor read with the CALLER's props (table, label and owned
 *      scope), and it must belong to the tenant,
 *   5. a caller-scoped timeline read, with a root existence check when that
 *      is empty so an owned-scope caller cannot see rows it is not allowed
 *      to, while a monitor with no rows yet still gets an answer.
 *
 * Every service is spied at its public seam. Nothing touches a database.
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
    sendEntityArrayResponse: jest.fn().mockImplementation((...args: []) => {
      return args;
    }),
    sendJsonObjectResponse: jest.fn().mockImplementation((...args: []) => {
      return args;
    }),
    sendEmptySuccessResponse: jest.fn(),
    setNoCacheHeaders: jest.fn(),
    sendEntityResponse: jest.fn().mockImplementation((...args: []) => {
      return args;
    }),
    sendErrorResponse: jest.fn().mockImplementation((...args: []) => {
      return args;
    }),
  };
});

const UPTIME_SUMMARY_ROUTE: string = "/monitor/uptime-summary/:monitorId";

const PERMISSION_MESSAGE: string =
  "You do not have permission to read this monitor's status history.";
const NOT_AUTHORIZED_MESSAGE: string =
  "You are not authorized to access this project's data.";

function buildProps(data: {
  projectId: ObjectID;
  userId: ObjectID;
  permissions: Array<Permission>;
  // Unlabelled team BLOCK rows, which override any Allow on the table.
  blocks?: Array<Permission> | undefined;
}): DatabaseCommonInteractionProps {
  const grants: Array<UserPermission> = [
    ...data.permissions.map((permission: Permission): UserPermission => {
      return {
        _type: "UserPermission",
        permission: permission,
        labelIds: [],
        isBlockPermission: false,
      };
    }),
    ...(data.blocks || []).map((permission: Permission): UserPermission => {
      return {
        _type: "UserPermission",
        permission: permission,
        labelIds: [],
        isBlockPermission: true,
      };
    }),
  ];

  const tenantPermission: UserTenantAccessPermission = {
    _type: "UserTenantAccessPermission",
    projectId: data.projectId,
    permissions: grants,
  };

  const permissionMap: Dictionary<UserTenantAccessPermission> = {};
  permissionMap[data.projectId.toString()] = tenantPermission;

  return {
    tenantId: data.projectId,
    userId: data.userId,
    userType: UserType.User,
    userTenantAccessPermission: permissionMap,
  };
}

function buildSummary(data: {
  monitorId: ObjectID;
  timezone: string;
}): MonitorUptimeSummary {
  const operationalId: ObjectID = new ObjectID(
    "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  );
  const start: Date = new Date("2026-06-24T00:00:00.000Z");
  const end: Date = new Date("2026-09-21T12:00:00.000Z");

  return {
    monitorId: data.monitorId,
    timezone: data.timezone,
    generatedAt: end,
    startDate: start,
    endDate: end,
    buckets: [
      {
        bucketStart: new Date("2026-09-21T00:00:00.000Z"),
        bucketEnd: end,
        daySeconds: 43200,
        coveredSeconds: 43200,
        statusDurations: [{ monitorStatusId: operationalId, seconds: 43200 }],
      },
    ],
    windows: [
      {
        key: MonitorUptimeWindowKey.Last24Hours,
        startDate: new Date("2026-09-20T12:00:00.000Z"),
        endDate: end,
        windowSeconds: 86400,
        coveredSeconds: 86400,
        statusDurations: [{ monitorStatusId: operationalId, seconds: 86400 }],
      },
    ],
    isComplete: true,
    completeFrom: null,
    statuses: [
      {
        id: operationalId,
        name: "Operational",
        color: "#10b981",
        isOperationalState: true,
        isOfflineState: false,
        priority: 1,
      },
    ],
  };
}

interface RouteCallResult {
  thrownToNext: unknown;
  nextCallCount: number;
  req: ExpressRequest;
  res: ExpressResponse;
}

async function callRoute(data: {
  monitorId: string;
  query?: Dictionary<string> | undefined;
}): Promise<RouteCallResult> {
  const req: ExpressRequest = {
    params: { monitorId: data.monitorId },
    query: data.query || {},
    body: {},
    headers: {},
  } as unknown as ExpressRequest;

  const res: ExpressResponse = {
    send: jest.fn(),
    json: jest.fn(),
    status: jest.fn().mockReturnThis(),
  } as unknown as ExpressResponse;

  const next: jest.Mock = jest.fn();

  await mockRouter
    .match("GET", UPTIME_SUMMARY_ROUTE)
    .handlerFunction(req, res, next as unknown as NextFunction);

  return {
    thrownToNext: next.mock.calls[0] ? next.mock.calls[0][0] : undefined,
    nextCallCount: next.mock.calls.length,
    req: req,
    res: res,
  };
}

interface CapturedRead {
  id?: ObjectID | undefined;
  query?: Dictionary<unknown> | undefined;
  select: Dictionary<unknown>;
  props: DatabaseCommonInteractionProps;
}

describe("GET /monitor/uptime-summary/:monitorId", () => {
  let projectId: ObjectID;
  let otherProjectId: ObjectID;
  let userId: ObjectID;
  let monitorId: ObjectID;

  let propsSpy: jest.SpyInstance;
  let monitorRead: jest.SpyInstance;
  let timelineRead: jest.SpyInstance;
  let summarySpy: jest.SpyInstance;
  let aggregateSpy: jest.SpyInstance;

  beforeAll(() => {
    mockRouter.routes.length = 0;
    new MonitorAPI();
  });

  beforeEach(() => {
    jest.clearAllMocks();

    projectId = ObjectID.generate();
    otherProjectId = ObjectID.generate();
    userId = ObjectID.generate();
    monitorId = ObjectID.generate();

    propsSpy = jest.spyOn(CommonAPI, "getDatabaseCommonInteractionProps");
    monitorRead = jest.spyOn(MonitorService, "findOneById");
    timelineRead = jest
      .spyOn(MonitorStatusTimelineService, "findOneBy")
      .mockResolvedValue(visibleRow());
    summarySpy = jest
      .spyOn(MonitorStatusTimelineService, "getMonitorUptimeSummary")
      .mockImplementation(
        async (data: {
          monitorId: ObjectID;
          timezone: string;
        }): Promise<MonitorUptimeSummary> => {
          return buildSummary({
            monitorId: data.monitorId,
            timezone: data.timezone,
          });
        },
      );
    aggregateSpy = jest.spyOn(
      MonitorStatusTimelineService,
      "getDailyUptimeAggregate",
    );

    mockCaller([Permission.MonitorViewer]);
    mockMonitorInProject(projectId);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function visibleRow(): MonitorStatusTimeline {
    const row: MonitorStatusTimeline = new MonitorStatusTimeline();
    row.id = ObjectID.generate();
    return row;
  }

  function mockCaller(
    permissions: Array<Permission>,
    blocks?: Array<Permission>,
  ): DatabaseCommonInteractionProps {
    const props: DatabaseCommonInteractionProps = buildProps({
      projectId: projectId,
      userId: userId,
      permissions: permissions,
      blocks: blocks,
    });

    propsSpy.mockResolvedValue(props);

    return props;
  }

  function mockMonitorInProject(monitorProjectId: ObjectID | null): void {
    if (!monitorProjectId) {
      monitorRead.mockResolvedValue(null);
      return;
    }

    const monitor: Monitor = new Monitor();
    monitor.id = monitorId;
    monitor.projectId = monitorProjectId;
    monitorRead.mockResolvedValue(monitor);
  }

  function expectNoReads(): void {
    expect(monitorRead).not.toHaveBeenCalled();
    expect(timelineRead).not.toHaveBeenCalled();
    expect(summarySpy).not.toHaveBeenCalled();
    expect(aggregateSpy).not.toHaveBeenCalled();
    expect(Response.sendJsonObjectResponse).not.toHaveBeenCalled();
  }

  function expectNoSummary(): void {
    expect(summarySpy).not.toHaveBeenCalled();
    expect(aggregateSpy).not.toHaveBeenCalled();
    expect(Response.sendJsonObjectResponse).not.toHaveBeenCalled();
  }

  test("is mounted behind getUserMiddleware", () => {
    const middlewares: Array<unknown> = mockRouter.match(
      "GET",
      UPTIME_SUMMARY_ROUTE,
    ).middlewares;

    expect(middlewares).toEqual([UserMiddleware.getUserMiddleware]);
  });

  test("returns the summary JSON for a MonitorViewer member of the monitor's project", async () => {
    const result: RouteCallResult = await callRoute({
      monitorId: monitorId.toString(),
      query: { timezone: "Europe/London" },
    });

    expect(result.nextCallCount).toBe(0);
    expect(summarySpy).toHaveBeenCalledTimes(1);
    expect(Response.sendJsonObjectResponse).toHaveBeenCalledTimes(1);

    const sendArgs: Array<unknown> = (
      Response.sendJsonObjectResponse as unknown as jest.Mock
    ).mock.calls[0]!;

    expect(sendArgs[0]).toBe(result.req);
    expect(sendArgs[1]).toBe(result.res);

    /*
     * The page reads its clock offset from generatedAt, so a cached copy
     * must never be replayed.
     */
    expect(Response.setNoCacheHeaders).toHaveBeenCalledWith(result.res);

    const body: JSONObject = sendArgs[2] as JSONObject;

    expect(body).toEqual(
      MonitorUptimeSummaryUtil.toJSON(
        buildSummary({ monitorId: monitorId, timezone: "Europe/London" }),
      ),
    );

    // Plain ISO and id strings, which the page parses back.
    expect(body["monitorId"]).toBe(monitorId.toString());
    expect(body["startDate"]).toBe("2026-06-24T00:00:00.000Z");

    const parsed: MonitorUptimeSummary | null =
      MonitorUptimeSummaryUtil.fromJSON(body);

    expect(parsed?.monitorId.toString()).toBe(monitorId.toString());
    expect(parsed?.buckets).toHaveLength(1);
    expect(parsed?.statuses[0]?.name).toBe("Operational");
  });

  test("rejects an unauthenticated caller with 401 before any read", async () => {
    propsSpy.mockResolvedValue({});

    const result: RouteCallResult = await callRoute({
      monitorId: monitorId.toString(),
    });

    expect(result.thrownToNext).toBeInstanceOf(NotAuthenticatedException);
    expect((result.thrownToNext as Exception).code).toBe(401);
    expect((result.thrownToNext as Exception).message).toBe(
      CommonAPI.AUTHENTICATION_REQUIRED_MESSAGE,
    );
    expectNoReads();
  });

  test("rejects a caller with no tenant header with 400 before any read", async () => {
    propsSpy.mockResolvedValue({ userId: userId, userType: UserType.User });

    const result: RouteCallResult = await callRoute({
      monitorId: monitorId.toString(),
    });

    expect(result.thrownToNext).toBeInstanceOf(BadDataException);
    expect((result.thrownToNext as Exception).code).toBe(
      ExceptionCode.BadDataException,
    );
    expect((result.thrownToNext as Exception).message).toBe(
      "Project ID is required",
    );
    expectNoReads();
  });

  test("rejects a logged-in non-member with 422 before any read", async () => {
    propsSpy.mockResolvedValue({
      tenantId: projectId,
      userId: userId,
      userType: UserType.User,
      userTenantAccessPermission: {},
    });

    const result: RouteCallResult = await callRoute({
      monitorId: monitorId.toString(),
    });

    expect(result.thrownToNext).toBeInstanceOf(NotAuthorizedException);
    expect((result.thrownToNext as Exception).code).toBe(422);
    expectNoReads();
  });

  test("rejects an invalid monitor id with BadDataException", async () => {
    const result: RouteCallResult = await callRoute({
      monitorId: "not-a-monitor-id",
    });

    expect(result.thrownToNext).toBeInstanceOf(BadDataException);
    expect((result.thrownToNext as Exception).message).toContain(
      "Invalid ID format",
    );
    expectNoReads();
  });

  test("rejects an unknown timezone with BadDataException and treats a missing one as UTC", async () => {
    const refused: RouteCallResult = await callRoute({
      monitorId: monitorId.toString(),
      query: { timezone: "Europe/Lodnon" },
    });

    expect(refused.thrownToNext).toBeInstanceOf(BadDataException);
    expect((refused.thrownToNext as Exception).message).toBe(
      "timezone must be an IANA time zone name, for example Europe/London.",
    );
    expectNoReads();

    const answered: RouteCallResult = await callRoute({
      monitorId: monitorId.toString(),
    });

    expect(answered.nextCallCount).toBe(0);
    expect(summarySpy).toHaveBeenCalledTimes(1);
    expect(
      (summarySpy.mock.calls[0]![0] as { timezone: string }).timezone,
    ).toBe("UTC");
  });

  test("refuses a ReadProjectMonitor-only caller with the permission message and never calls the aggregate", async () => {
    /*
     * ReadProjectMonitor opens the Monitor row but not its history: it is
     * not on MonitorStatusTimeline's read list.
     */
    mockCaller([Permission.ReadProjectMonitor]);

    const result: RouteCallResult = await callRoute({
      monitorId: monitorId.toString(),
    });

    expect(result.thrownToNext).toBeInstanceOf(NotAuthorizedException);
    expect((result.thrownToNext as Exception).message).toBe(PERMISSION_MESSAGE);
    expectNoReads();
  });

  test("admits a caller whose only grant is ReadMonitorStatusTimeline", async () => {
    mockCaller([Permission.ReadMonitorStatusTimeline]);

    const result: RouteCallResult = await callRoute({
      monitorId: monitorId.toString(),
    });

    expect(result.nextCallCount).toBe(0);
    expect(summarySpy).toHaveBeenCalledTimes(1);
  });

  test("refuses a caller whose team BLOCKs ReadMonitorStatusTimeline", async () => {
    mockCaller(
      [Permission.MonitorViewer],
      [Permission.ReadMonitorStatusTimeline],
    );

    const result: RouteCallResult = await callRoute({
      monitorId: monitorId.toString(),
    });

    expect(result.thrownToNext).toBeInstanceOf(NotAuthorizedException);
    expect((result.thrownToNext as Exception).message).toContain(
      "is in your team's permission block list",
    );
    expectNoReads();
  });

  test("reads the monitor with the caller's props, not isRoot", async () => {
    const callerProps: DatabaseCommonInteractionProps = mockCaller([
      Permission.MonitorViewer,
    ]);

    await callRoute({ monitorId: monitorId.toString() });

    expect(monitorRead).toHaveBeenCalledTimes(1);

    const monitorArgs: CapturedRead = monitorRead.mock
      .calls[0]![0] as CapturedRead;

    expect(monitorArgs.id?.toString()).toBe(monitorId.toString());
    expect(monitorArgs.select).toEqual({ _id: true, projectId: true });
    expect(monitorArgs.props).toBe(callerProps);
    expect(monitorArgs.props.isRoot).toBeFalsy();

    // The timeline check is the caller's too, keyed on this monitor and tenant.
    expect(timelineRead).toHaveBeenCalledTimes(1);

    const timelineArgs: CapturedRead = timelineRead.mock
      .calls[0]![0] as CapturedRead;

    expect(timelineArgs.props).toBe(callerProps);
    expect(timelineArgs.props.isRoot).toBeFalsy();
    expect(String(timelineArgs.query?.["monitorId"])).toBe(
      monitorId.toString(),
    );
    expect(String(timelineArgs.query?.["projectId"])).toBe(
      projectId.toString(),
    );
    expect(timelineArgs.select).toEqual({ _id: true });

    // Reads run in order, and the aggregate only after both checks.
    expect(monitorRead.mock.invocationCallOrder[0]!).toBeLessThan(
      timelineRead.mock.invocationCallOrder[0]!,
    );
    expect(timelineRead.mock.invocationCallOrder[0]!).toBeLessThan(
      summarySpy.mock.invocationCallOrder[0]!,
    );
  });

  test("refuses the same way when the caller-scoped monitor read returns null", async () => {
    mockMonitorInProject(null);

    const result: RouteCallResult = await callRoute({
      monitorId: monitorId.toString(),
    });

    expect(result.thrownToNext).toBeInstanceOf(NotAuthorizedException);
    expect((result.thrownToNext as Exception).message).toBe(
      NOT_AUTHORIZED_MESSAGE,
    );
    expect(timelineRead).not.toHaveBeenCalled();
    expectNoSummary();
  });

  test("passes a refusal thrown by the caller-scoped monitor read straight through", async () => {
    monitorRead.mockRejectedValue(
      new NotAuthorizedException("You do not have permission to read."),
    );

    const result: RouteCallResult = await callRoute({
      monitorId: monitorId.toString(),
    });

    expect(result.thrownToNext).toBeInstanceOf(NotAuthorizedException);
    expect(timelineRead).not.toHaveBeenCalled();
    expectNoSummary();
  });

  test("refuses a monitor that belongs to another project", async () => {
    mockMonitorInProject(otherProjectId);

    const result: RouteCallResult = await callRoute({
      monitorId: monitorId.toString(),
    });

    expect(result.thrownToNext).toBeInstanceOf(NotAuthorizedException);
    expect((result.thrownToNext as Exception).message).toBe(
      NOT_AUTHORIZED_MESSAGE,
    );
    expect(timelineRead).not.toHaveBeenCalled();
    expectNoSummary();
  });

  test("refuses when the caller-scoped timeline read is empty but root finds rows (owned scope)", async () => {
    timelineRead
      .mockReset()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(visibleRow());

    const result: RouteCallResult = await callRoute({
      monitorId: monitorId.toString(),
    });

    expect(result.thrownToNext).toBeInstanceOf(NotAuthorizedException);
    expect((result.thrownToNext as Exception).message).toBe(
      NOT_AUTHORIZED_MESSAGE,
    );
    expect(timelineRead).toHaveBeenCalledTimes(2);

    const rootArgs: CapturedRead = timelineRead.mock
      .calls[1]![0] as CapturedRead;

    expect(rootArgs.props).toEqual({ isRoot: true });
    expect(String(rootArgs.query?.["monitorId"])).toBe(monitorId.toString());
    expect(String(rootArgs.query?.["projectId"])).toBe(projectId.toString());
    expectNoSummary();
  });

  test("still answers when the monitor has no timeline rows at all", async () => {
    timelineRead.mockReset().mockResolvedValue(null);

    const result: RouteCallResult = await callRoute({
      monitorId: monitorId.toString(),
    });

    expect(result.nextCallCount).toBe(0);
    expect(timelineRead).toHaveBeenCalledTimes(2);
    expect(summarySpy).toHaveBeenCalledTimes(1);
    expect(Response.sendJsonObjectResponse).toHaveBeenCalledTimes(1);
  });

  test("does not run the root existence check when the caller can see a row", async () => {
    const result: RouteCallResult = await callRoute({
      monitorId: monitorId.toString(),
    });

    expect(result.nextCallCount).toBe(0);
    expect(timelineRead).toHaveBeenCalledTimes(1);
  });

  test("asks the service for exactly this monitor and the parsed timezone", async () => {
    const before: number = Date.now();

    await callRoute({
      monitorId: monitorId.toString(),
      // Canonicalised by parseTimezone, so the database gets a name it knows.
      query: { timezone: "america/new_york" },
    });

    const after: number = Date.now();

    expect(summarySpy).toHaveBeenCalledTimes(1);

    const args: {
      monitorId: ObjectID;
      projectId: ObjectID;
      timezone: string;
      now: Date;
    } = summarySpy.mock.calls[0]![0] as {
      monitorId: ObjectID;
      projectId: ObjectID;
      timezone: string;
      now: Date;
    };

    expect(args.monitorId.toString()).toBe(monitorId.toString());
    // The tenant the caller was checked against, not anything from the path.
    expect(args.projectId.toString()).toBe(projectId.toString());
    expect(args.timezone).toBe("America/New_York");
    expect(args.now).toBeInstanceOf(Date);
    expect(args.now.getTime()).toBeGreaterThanOrEqual(before);
    expect(args.now.getTime()).toBeLessThanOrEqual(after);
  });
});
