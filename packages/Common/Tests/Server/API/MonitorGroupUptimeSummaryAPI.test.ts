import CommonAPI from "../../../Server/API/CommonAPI";
import MonitorGroupAPI from "../../../Server/API/MonitorGroupAPI";
import UserMiddleware from "../../../Server/Middleware/UserAuthorization";
import MonitorGroupService from "../../../Server/Services/MonitorGroupService";
import MonitorStatusTimelineService from "../../../Server/Services/MonitorStatusTimelineService";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import Response from "../../../Server/Utils/Response";
import { mockRouter } from "./Helpers";
import MonitorGroup from "../../../Models/DatabaseModels/MonitorGroup";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import Dictionary from "../../../Types/Dictionary";
import BadDataException from "../../../Types/Exception/BadDataException";
import Exception from "../../../Types/Exception/Exception";
import ExceptionCode from "../../../Types/Exception/ExceptionCode";
import NotAuthenticatedException from "../../../Types/Exception/NotAuthenticatedException";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import { JSONObject } from "../../../Types/JSON";
import { MonitorGroupUptimeSummary } from "../../../Types/Monitor/MonitorGroupUptimeSummary";
import ObjectID from "../../../Types/ObjectID";
import Permission, {
  UserPermission,
  UserTenantAccessPermission,
} from "../../../Types/Permission";
import UserType from "../../../Types/UserType";
import MonitorGroupUptimeSummaryUtil from "../../../Utils/Monitor/MonitorGroupUptimeSummaryUtil";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "@jest/globals";

/*
 * GET /monitor-group/uptime-summary/:monitorGroupId?timezone=<IANA zone>
 *
 * The Dashboard's monitor group page draws its Uptime Graph and its 90-day
 * uptime from this (issue #6886): the group's days as the database measures
 * them from every row, where the timeline route returns the group's rows
 * under a 10,000 row cap, oldest first. The summary behind it reads as root,
 * so the route applies what reading the group's history takes, and reads
 * nothing before the checks that come first have passed:
 *
 *   1. an authenticated member of the tenant (401 / 400 / 422),
 *   2. a valid group id and time zone (400),
 *   3. an Allow grant to read status timelines and no team BLOCK on it,
 *   4. the group read with the CALLER's props, and it must belong to the
 *      tenant.
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

const UPTIME_SUMMARY_ROUTE: string =
  "/monitor-group/uptime-summary/:monitorGroupId";

const PERMISSION_MESSAGE: string =
  "You do not have permission to read this monitor group's status history.";
const NOT_AUTHORIZED_MESSAGE: string =
  "You are not authorized to access this project's data.";

function buildProps(data: {
  projectId: ObjectID;
  userId: ObjectID;
  permissions: Array<Permission>;
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
  monitorGroupId: ObjectID;
  timezone: string;
}): MonitorGroupUptimeSummary {
  const end: Date = new Date("2026-09-21T12:00:00.000Z");

  return {
    monitorGroupId: data.monitorGroupId,
    timezone: data.timezone,
    generatedAt: end,
    startDate: new Date("2026-06-24T00:00:00.000Z"),
    endDate: end,
    buckets: [
      {
        bucketStart: new Date("2026-09-21T00:00:00.000Z"),
        bucketEnd: end,
        daySeconds: 43200,
        coveredSeconds: 43200,
        statusDurations: [
          {
            monitorStatusId: new ObjectID(
              "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
            ),
            seconds: 43200,
          },
        ],
      },
    ],
    coveredSeconds: 43200,
    downtimeSeconds: 0,
  };
}

interface RouteCallResult {
  thrownToNext: unknown;
  nextCallCount: number;
  req: ExpressRequest;
  res: ExpressResponse;
}

async function callRoute(data: {
  monitorGroupId: string;
  query?: Dictionary<string> | undefined;
}): Promise<RouteCallResult> {
  const req: ExpressRequest = {
    params: { monitorGroupId: data.monitorGroupId },
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
  select: Dictionary<unknown>;
  props: DatabaseCommonInteractionProps;
}

describe("GET /monitor-group/uptime-summary/:monitorGroupId", () => {
  let projectId: ObjectID;
  let otherProjectId: ObjectID;
  let userId: ObjectID;
  let monitorGroupId: ObjectID;

  let propsSpy: jest.SpyInstance;
  let groupRead: jest.SpyInstance;
  let summarySpy: jest.SpyInstance;
  let aggregateSpy: jest.SpyInstance;

  beforeAll(() => {
    mockRouter.routes.length = 0;
    new MonitorGroupAPI();
  });

  beforeEach(() => {
    jest.clearAllMocks();

    projectId = ObjectID.generate();
    otherProjectId = ObjectID.generate();
    userId = ObjectID.generate();
    monitorGroupId = ObjectID.generate();

    propsSpy = jest.spyOn(CommonAPI, "getDatabaseCommonInteractionProps");
    groupRead = jest.spyOn(MonitorGroupService, "findOneById");
    summarySpy = jest
      .spyOn(MonitorGroupService, "getUptimeSummary")
      .mockImplementation(
        async (data: {
          monitorGroupId: ObjectID;
          timezone: string;
        }): Promise<MonitorGroupUptimeSummary> => {
          return buildSummary({
            monitorGroupId: data.monitorGroupId,
            timezone: data.timezone,
          });
        },
      );
    aggregateSpy = jest.spyOn(
      MonitorStatusTimelineService,
      "getMonitorGroupDailyUptimeAggregate",
    );

    mockCaller([Permission.MonitorViewer]);
    mockGroupInProject(projectId);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

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

  function mockGroupInProject(groupProjectId: ObjectID | null): void {
    if (!groupProjectId) {
      groupRead.mockResolvedValue(null);
      return;
    }

    const group: MonitorGroup = new MonitorGroup();
    group.id = monitorGroupId;
    group.projectId = groupProjectId;
    groupRead.mockResolvedValue(group);
  }

  function expectNoReads(): void {
    expect(groupRead).not.toHaveBeenCalled();
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
    expect(mockRouter.match("GET", UPTIME_SUMMARY_ROUTE).middlewares).toEqual([
      UserMiddleware.getUserMiddleware,
    ]);
  });

  test("returns the summary JSON for a MonitorViewer member of the group's project, never cached", async () => {
    const result: RouteCallResult = await callRoute({
      monitorGroupId: monitorGroupId.toString(),
      query: { timezone: "Europe/London" },
    });

    expect(result.nextCallCount).toBe(0);
    expect(summarySpy).toHaveBeenCalledTimes(1);
    expect(Response.setNoCacheHeaders).toHaveBeenCalledWith(result.res);

    const sendArgs: Array<unknown> = (
      Response.sendJsonObjectResponse as unknown as jest.Mock
    ).mock.calls[0]!;

    expect(sendArgs[0]).toBe(result.req);
    expect(sendArgs[1]).toBe(result.res);

    const body: JSONObject = sendArgs[2] as JSONObject;

    expect(body).toEqual(
      MonitorGroupUptimeSummaryUtil.toJSON(
        buildSummary({
          monitorGroupId: monitorGroupId,
          timezone: "Europe/London",
        }),
      ),
    );

    // Plain ISO and id strings, which the page parses back.
    const parsed: MonitorGroupUptimeSummary | null =
      MonitorGroupUptimeSummaryUtil.fromJSON(body);

    expect(parsed?.monitorGroupId.toString()).toBe(monitorGroupId.toString());
    expect(parsed?.buckets).toHaveLength(1);
    expect(parsed?.coveredSeconds).toBe(43200);
  });

  test("rejects an unauthenticated caller with 401 before any read", async () => {
    propsSpy.mockResolvedValue({});

    const result: RouteCallResult = await callRoute({
      monitorGroupId: monitorGroupId.toString(),
    });

    expect(result.thrownToNext).toBeInstanceOf(NotAuthenticatedException);
    expect((result.thrownToNext as Exception).code).toBe(401);
    expectNoReads();
  });

  test("rejects a caller with no tenant header with 400 before any read", async () => {
    propsSpy.mockResolvedValue({ userId: userId, userType: UserType.User });

    const result: RouteCallResult = await callRoute({
      monitorGroupId: monitorGroupId.toString(),
    });

    expect(result.thrownToNext).toBeInstanceOf(BadDataException);
    expect((result.thrownToNext as Exception).code).toBe(
      ExceptionCode.BadDataException,
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
      monitorGroupId: monitorGroupId.toString(),
    });

    expect(result.thrownToNext).toBeInstanceOf(NotAuthorizedException);
    expect((result.thrownToNext as Exception).code).toBe(422);
    expectNoReads();
  });

  test("rejects an invalid group id with BadDataException before any read", async () => {
    const result: RouteCallResult = await callRoute({
      monitorGroupId: "not-a-monitor-group-id",
    });

    expect(result.thrownToNext).toBeInstanceOf(BadDataException);
    expect((result.thrownToNext as Exception).message).toContain(
      "Invalid ID format",
    );
    expectNoReads();
  });

  test("rejects an unknown timezone with BadDataException, and reads a missing one as UTC", async () => {
    const refused: RouteCallResult = await callRoute({
      monitorGroupId: monitorGroupId.toString(),
      query: { timezone: "Europe/Lodnon" },
    });

    expect(refused.thrownToNext).toBeInstanceOf(BadDataException);
    expect((refused.thrownToNext as Exception).message).toBe(
      "timezone must be an IANA time zone name, for example Europe/London.",
    );
    expectNoReads();

    const answered: RouteCallResult = await callRoute({
      monitorGroupId: monitorGroupId.toString(),
    });

    expect(answered.nextCallCount).toBe(0);
    expect(
      (summarySpy.mock.calls[0]![0] as { timezone: string }).timezone,
    ).toBe("UTC");
  });

  test("refuses a caller who may read the group but not its history (ReadMonitorGroup only)", async () => {
    mockCaller([Permission.ReadMonitorGroup]);

    const result: RouteCallResult = await callRoute({
      monitorGroupId: monitorGroupId.toString(),
    });

    expect(result.thrownToNext).toBeInstanceOf(NotAuthorizedException);
    expect((result.thrownToNext as Exception).message).toBe(PERMISSION_MESSAGE);
    expectNoReads();
  });

  test("admits a caller whose grant to the history is ReadMonitorStatusTimeline", async () => {
    mockCaller([
      Permission.ReadMonitorStatusTimeline,
      Permission.ReadMonitorGroup,
    ]);

    const result: RouteCallResult = await callRoute({
      monitorGroupId: monitorGroupId.toString(),
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
      monitorGroupId: monitorGroupId.toString(),
    });

    expect(result.thrownToNext).toBeInstanceOf(NotAuthorizedException);
    expect((result.thrownToNext as Exception).message).toContain(
      "is in your team's permission block list",
    );
    expectNoReads();
  });

  test("reads the group with the caller's props, not isRoot, before the summary", async () => {
    const callerProps: DatabaseCommonInteractionProps = mockCaller([
      Permission.MonitorViewer,
    ]);

    await callRoute({ monitorGroupId: monitorGroupId.toString() });

    expect(groupRead).toHaveBeenCalledTimes(1);

    const groupArgs: CapturedRead = groupRead.mock.calls[0]![0] as CapturedRead;

    expect(groupArgs.id?.toString()).toBe(monitorGroupId.toString());
    expect(groupArgs.select).toEqual({ _id: true, projectId: true });
    expect(groupArgs.props).toBe(callerProps);
    expect(groupArgs.props.isRoot).toBeFalsy();

    expect(groupRead.mock.invocationCallOrder[0]!).toBeLessThan(
      summarySpy.mock.invocationCallOrder[0]!,
    );
  });

  test("refuses a group the caller cannot see, with the same message as another project's", async () => {
    mockGroupInProject(null);

    const hidden: RouteCallResult = await callRoute({
      monitorGroupId: monitorGroupId.toString(),
    });

    expect(hidden.thrownToNext).toBeInstanceOf(NotAuthorizedException);
    expect((hidden.thrownToNext as Exception).message).toBe(
      NOT_AUTHORIZED_MESSAGE,
    );
    expectNoSummary();

    mockGroupInProject(otherProjectId);

    const foreign: RouteCallResult = await callRoute({
      monitorGroupId: monitorGroupId.toString(),
    });

    expect(foreign.thrownToNext).toBeInstanceOf(NotAuthorizedException);
    expect((foreign.thrownToNext as Exception).message).toBe(
      NOT_AUTHORIZED_MESSAGE,
    );
    expectNoSummary();
  });

  test("passes a refusal thrown by the caller-scoped group read straight through", async () => {
    groupRead.mockRejectedValue(
      new NotAuthorizedException("You do not have permission to read."),
    );

    const result: RouteCallResult = await callRoute({
      monitorGroupId: monitorGroupId.toString(),
    });

    expect(result.thrownToNext).toBeInstanceOf(NotAuthorizedException);
    expectNoSummary();
  });

  test("asks the service for exactly this group, the caller's tenant and the parsed timezone, as of now", async () => {
    const before: number = Date.now();

    await callRoute({
      monitorGroupId: monitorGroupId.toString(),
      // Canonicalised, so the database gets a name it knows.
      query: { timezone: "america/new_york" },
    });

    const after: number = Date.now();

    const args: {
      monitorGroupId: ObjectID;
      projectId: ObjectID;
      timezone: string;
      now: Date;
    } = summarySpy.mock.calls[0]![0] as {
      monitorGroupId: ObjectID;
      projectId: ObjectID;
      timezone: string;
      now: Date;
    };

    expect(args.monitorGroupId.toString()).toBe(monitorGroupId.toString());
    expect(args.projectId.toString()).toBe(projectId.toString());
    expect(args.timezone).toBe("America/New_York");
    expect(args.now.getTime()).toBeGreaterThanOrEqual(before);
    expect(args.now.getTime()).toBeLessThanOrEqual(after);
  });
});
