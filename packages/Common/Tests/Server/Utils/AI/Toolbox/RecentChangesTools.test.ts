import Monitor from "../../../../../Models/DatabaseModels/Monitor";
import MonitorStatusTimeline from "../../../../../Models/DatabaseModels/MonitorStatusTimeline";
import ScheduledMaintenance from "../../../../../Models/DatabaseModels/ScheduledMaintenance";
import TelemetryException from "../../../../../Models/DatabaseModels/TelemetryException";
import MonitorStatusTimelineService from "../../../../../Server/Services/MonitorStatusTimelineService";
import ScheduledMaintenanceService from "../../../../../Server/Services/ScheduledMaintenanceService";
import TelemetryExceptionService from "../../../../../Server/Services/TelemetryExceptionService";
import ChangeEventService from "../../../../../Server/Services/ChangeEventService";
import ServiceService from "../../../../../Server/Services/ServiceService";
import ChangeEvent from "../../../../../Models/AnalyticsModels/ChangeEvent";
import InBetween from "../../../../../Types/BaseDatabase/InBetween";
import Includes from "../../../../../Types/BaseDatabase/Includes";
import IncludesNone from "../../../../../Types/BaseDatabase/IncludesNone";
import { AIChatCitationTargetType } from "../../../../../Types/AI/AIChatTypes";
import logger from "../../../../../Server/Utils/Logger";
import AIToolbox, {
  ToolCallOutcome,
} from "../../../../../Server/Utils/AI/Toolbox/Index";
import { RecentChangesTool } from "../../../../../Server/Utils/AI/Toolbox/RecentChangesTools";
import {
  ToolContext,
  ToolExecutionResult,
} from "../../../../../Server/Utils/AI/Toolbox/ToolTypes";
import DatabaseCommonInteractionProps from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import SortOrder from "../../../../../Types/BaseDatabase/SortOrder";
import OneUptimeDate from "../../../../../Types/Date";
import BadDataException from "../../../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../../../Types/JSON";
import ObjectID from "../../../../../Types/ObjectID";
import Permission from "../../../../../Types/Permission";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

const projectId: ObjectID = new ObjectID(
  "11111111-1111-1111-1111-111111111111",
);
const otherProjectId: ObjectID = new ObjectID(
  "99999999-9999-9999-9999-999999999999",
);
const NOW: Date = new Date("2026-09-17T12:00:00.000Z");
const HOUR_MS: number = 60 * 60 * 1000;

interface RawOperator {
  objectLiteralParameters: Record<string, unknown>;
  getSql: (alias: string) => string;
}

interface SourceSpies {
  changes: jest.SpyInstance;
  serviceNames: jest.SpyInstance;
  exceptions: jest.SpyInstance;
  statusChanges: jest.SpyInstance;
  maintenance: jest.SpyInstance;
}

function context(
  allowed: Array<Permission> = [Permission.ProjectMember],
  blocked: Array<Permission> = [],
): ToolContext {
  const toUserPermission: (
    isBlock: boolean,
  ) => (permission: Permission) => JSONObject = (
    isBlock: boolean,
  ): ((permission: Permission) => JSONObject) => {
    return (permission: Permission): JSONObject => {
      return {
        permission: permission,
        labelIds: [],
        isBlockPermission: isBlock,
        _type: "UserPermission",
      };
    };
  };
  return {
    projectId: projectId,
    props: {
      tenantId: projectId,
      userId: ObjectID.generate(),
      userGlobalAccessPermission: {
        globalPermissions: [Permission.Public],
        projectIds: [projectId],
        _type: "UserGlobalAccessPermission",
      },
      userTenantAccessPermission: {
        [projectId.toString()]: {
          projectId: projectId,
          permissions: [
            ...allowed.map(toUserPermission(false)),
            ...blocked.map(toUserPermission(true)),
          ],
          _type: "UserTenantAccessPermission",
        },
      },
    } as unknown as DatabaseCommonInteractionProps,
  };
}

function mockSources(data?: {
  changes?: Array<JSONObject> | Error;
  // What the cloud's own read of change events answers (none when left out).
  cloudChanges?: Array<JSONObject> | Error;
  serviceNames?: Array<JSONObject> | Error;
  exceptions?: Array<JSONObject> | Error;
  statusChanges?: Array<JSONObject> | Error;
  maintenance?: Array<JSONObject> | Error;
}): SourceSpies {
  const mock: (
    spy: jest.SpyInstance,
    value: Array<JSONObject> | Error | undefined,
  ) => jest.SpyInstance = (
    spy: jest.SpyInstance,
    value: Array<JSONObject> | Error | undefined,
  ): jest.SpyInstance => {
    if (value instanceof Error) {
      return spy.mockRejectedValue(value);
    }
    return spy.mockResolvedValue(value || []);
  };

  /*
   * A project-wide feed reads the cloud's changes apart (attributeKeys
   * includes cloud.provider): each read gets its own answer.
   */
  const changes: jest.SpyInstance = jest
    .spyOn(ChangeEventService, "findBy")
    .mockImplementation((async (args: { query: JSONObject }) => {
      const answer: Array<JSONObject> | Error | undefined =
        args.query["attributeKeys"] instanceof Includes
          ? data?.cloudChanges
          : data?.changes;

      if (answer instanceof Error) {
        throw answer;
      }

      return answer || [];
    }) as never);

  return {
    changes,
    serviceNames: mock(
      jest.spyOn(ServiceService, "findBy"),
      data?.serviceNames,
    ),
    exceptions: mock(
      jest.spyOn(TelemetryExceptionService, "findBy"),
      data?.exceptions,
    ),
    statusChanges: mock(
      jest.spyOn(MonitorStatusTimelineService, "findBy"),
      data?.statusChanges,
    ),
    maintenance: mock(
      jest.spyOn(ScheduledMaintenanceService, "findBy"),
      data?.maintenance,
    ),
  };
}

function callArg(spy: jest.SpyInstance): JSONObject {
  return spy.mock.calls[0]![0] as JSONObject;
}

function boundValues(operator: unknown): Array<unknown> {
  return Object.values((operator as RawOperator).objectLiteralParameters);
}

function asException(data: JSONObject): JSONObject {
  return data as unknown as TelemetryException as unknown as JSONObject;
}

function asStatusChange(data: JSONObject): JSONObject {
  return data as unknown as MonitorStatusTimeline as unknown as JSONObject;
}

function asMaintenance(data: JSONObject): JSONObject {
  return data as unknown as ScheduledMaintenance as unknown as JSONObject;
}

beforeEach(() => {
  jest.spyOn(OneUptimeDate, "getCurrentDate").mockReturnValue(NOW);
  jest.spyOn(logger, "debug").mockImplementation(() => {
    return undefined;
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("recent_changes queries", () => {
  test("queries every source under the caller's props with the default 24h window and 15-per-source limit", async () => {
    const ctx: ToolContext = context();
    const spies: SourceSpies = mockSources();

    await RecentChangesTool.execute({}, ctx);

    const start: Date = new Date(NOW.getTime() - 24 * HOUR_MS);

    // Change events are read twice: the cloud's apart from the rest.
    expect(spies.changes).toHaveBeenCalledTimes(2);

    for (const spy of [
      spies.changes,
      spies.exceptions,
      spies.statusChanges,
      spies.maintenance,
    ]) {
      expect(spy.mock.calls.length).toBeGreaterThanOrEqual(1);
      const call: JSONObject = callArg(spy);
      expect(call["props"]).toBe(ctx.props);
      expect(call["limit"]).toBe(15);
      expect(call["skip"]).toBe(0);
      const query: JSONObject = call["query"] as JSONObject;
      expect(query["projectId"]).toBeUndefined();
    }

    // New exceptions: firstSeenAt inside [start, end].
    const exceptionCall: JSONObject = callArg(spies.exceptions);
    expect(exceptionCall["sort"]).toEqual({
      firstSeenAt: SortOrder.Descending,
    });
    const exceptionQuery: JSONObject = exceptionCall["query"] as JSONObject;
    expect(Object.keys(exceptionQuery)).toEqual(["firstSeenAt"]);
    expect(boundValues(exceptionQuery["firstSeenAt"])).toEqual([start, NOW]);

    // Monitor status changes: createdAt inside [start, end].
    const statusCall: JSONObject = callArg(spies.statusChanges);
    expect(statusCall["sort"]).toEqual({ createdAt: SortOrder.Descending });
    expect(statusCall["select"]).toEqual({
      createdAt: true,
      monitor: { name: true },
      monitorStatus: { name: true },
    });
    const statusQuery: JSONObject = statusCall["query"] as JSONObject;
    expect(Object.keys(statusQuery)).toEqual(["createdAt"]);
    expect(boundValues(statusQuery["createdAt"])).toEqual([start, NOW]);

    // Maintenance overlapping the window: startsAt <= end AND endsAt >= start.
    const maintenanceCall: JSONObject = callArg(spies.maintenance);
    expect(maintenanceCall["sort"]).toEqual({
      startsAt: SortOrder.Descending,
    });
    const maintenanceQuery: JSONObject = maintenanceCall["query"] as JSONObject;
    expect(Object.keys(maintenanceQuery).sort()).toEqual([
      "endsAt",
      "startsAt",
    ]);
    expect(boundValues(maintenanceQuery["startsAt"])).toEqual([NOW]);
    expect(
      (maintenanceQuery["startsAt"] as unknown as RawOperator).getSql("s"),
    ).toContain("<=");
    expect(boundValues(maintenanceQuery["endsAt"])).toEqual([start]);
    expect(
      (maintenanceQuery["endsAt"] as unknown as RawOperator).getSql("e"),
    ).toContain(">=");
  });

  test("ignores project ids passed as arguments", async () => {
    const ctx: ToolContext = context();
    const spies: SourceSpies = mockSources();

    await RecentChangesTool.execute(
      { projectId: otherProjectId.toString() },
      ctx,
    );

    for (const spy of [
      spies.changes,
      spies.exceptions,
      spies.statusChanges,
      spies.maintenance,
    ]) {
      const call: JSONObject = callArg(spy);
      expect(call["props"]).toBe(ctx.props);
      expect((call["query"] as JSONObject)["projectId"]).toBeUndefined();
    }
  });

  test("uses an explicit window", async () => {
    const spies: SourceSpies = mockSources();
    const start: Date = new Date("2026-09-15T10:00:00.000Z");
    const end: Date = new Date("2026-09-15T11:00:00.000Z");

    const result: ToolExecutionResult = await RecentChangesTool.execute(
      { startTime: start.toISOString(), endTime: end.toISOString() },
      context(),
    );

    const query: JSONObject = callArg(spies.exceptions)["query"] as JSONObject;
    expect(boundValues(query["firstSeenAt"])).toEqual([start, end]);
    expect(result.citationLabel).toBe(
      `Changes ${start.toISOString()} → ${end.toISOString()} (0 events)`,
    );
  });

  test.each([
    [100, 30],
    [30, 30],
    [0, 1],
    [-1, 1],
    ["7", 7],
    ["many", 15],
  ])(
    "clamps limitPerSource %p to %p for every source",
    async (input: unknown, expected: number) => {
      const spies: SourceSpies = mockSources();

      await RecentChangesTool.execute(
        { limitPerSource: input } as unknown as JSONObject,
        context(),
      );

      expect(callArg(spies.changes)["limit"]).toBe(expected);
      expect(callArg(spies.exceptions)["limit"]).toBe(expected);
      expect(callArg(spies.statusChanges)["limit"]).toBe(expected);
      expect(callArg(spies.maintenance)["limit"]).toBe(expected);
    },
  );

  test("rejects an invalid window before touching any source", async () => {
    const spies: SourceSpies = mockSources();

    await expect(
      RecentChangesTool.execute({ startTime: "an hour ago" }, context()),
    ).rejects.toThrow(BadDataException);
    await expect(
      RecentChangesTool.execute(
        {
          startTime: "2026-09-15T11:00:00.000Z",
          endTime: "2026-09-15T10:00:00.000Z",
        },
        context(),
      ),
    ).rejects.toThrow("startTime must be before endTime.");

    expect(spies.changes).not.toHaveBeenCalled();
    expect(spies.exceptions).not.toHaveBeenCalled();
    expect(spies.statusChanges).not.toHaveBeenCalled();
    expect(spies.maintenance).not.toHaveBeenCalled();
  });
});

describe("recent_changes output", () => {
  test("merges all sources into one feed, most recent first", async () => {
    mockSources({
      exceptions: [
        asException({
          exceptionType: "TypeError",
          message: "x is undefined",
          firstSeenAt: new Date("2026-09-17T10:00:00.000Z"),
          occuranceCount: 12,
        }),
      ],
      statusChanges: [
        asStatusChange({
          createdAt: new Date("2026-09-17T11:00:00.000Z"),
          monitor: { name: "Checkout API" },
          monitorStatus: { name: "Offline" },
        }),
        asStatusChange({
          createdAt: new Date("2026-09-17T09:00:00.000Z"),
          monitor: { name: "Checkout API" },
          monitorStatus: { name: "Operational" },
        }),
      ],
      maintenance: [
        asMaintenance({
          title: "DB upgrade",
          startsAt: new Date("2026-09-17T09:30:00.000Z"),
          endsAt: new Date("2026-09-17T13:00:00.000Z"),
          currentScheduledMaintenanceState: { name: "Ongoing" },
        }),
      ],
    });

    const result: ToolExecutionResult = await RecentChangesTool.execute(
      {},
      context(),
    );

    expect(result.rowCount).toBe(4);
    expect(result.dataForLlm.split("\n")).toEqual([
      "- at=2026-09-17T11:00:00.000Z | change=monitor_status_change | detail=Checkout API → Offline",
      "- at=2026-09-17T10:00:00.000Z | change=new_exception | detail=TypeError: x is undefined (x12)",
      "- at=2026-09-17T09:30:00.000Z | change=scheduled_maintenance | detail=DB upgrade (Ongoing)",
      "- at=2026-09-17T09:00:00.000Z | change=monitor_status_change | detail=Checkout API → Operational",
    ]);
    expect(result.citationLabel).toBe(
      `Changes ${new Date(NOW.getTime() - 24 * HOUR_MS).toISOString()} → ${NOW.toISOString()} (4 events)`,
    );
    expect(result.isTruncated).toBe(false);
    // recent_changes deliberately has no single deep link.
    expect(result.citationTarget).toBeUndefined();
    expect(result.widget).toBeUndefined();
  });

  test("maintenance that started before the window is still included (overlap semantics)", async () => {
    mockSources({
      maintenance: [
        asMaintenance({
          title: "Long migration",
          startsAt: new Date("2026-09-01T00:00:00.000Z"),
          endsAt: new Date("2026-09-30T00:00:00.000Z"),
        }),
      ],
    });

    const result: ToolExecutionResult = await RecentChangesTool.execute(
      {},
      context(),
    );

    expect(result.rowCount).toBe(1);
    expect(result.dataForLlm).toBe(
      "- at=2026-09-01T00:00:00.000Z | change=scheduled_maintenance | detail=Long migration (scheduled)",
    );
  });

  test("falls back to generic labels when optional fields are missing", async () => {
    mockSources({
      exceptions: [
        asException({ firstSeenAt: new Date("2026-09-17T11:00:00.000Z") }),
      ],
      statusChanges: [
        asStatusChange({ createdAt: new Date("2026-09-17T10:00:00.000Z") }),
      ],
      maintenance: [
        asMaintenance({ startsAt: new Date("2026-09-17T09:00:00.000Z") }),
      ],
    });

    const result: ToolExecutionResult = await RecentChangesTool.execute(
      {},
      context(),
    );

    expect(result.dataForLlm.split("\n")).toEqual([
      "- at=2026-09-17T11:00:00.000Z | change=new_exception | detail=Exception:  (x0)",
      "- at=2026-09-17T10:00:00.000Z | change=monitor_status_change | detail=Monitor → unknown",
      "- at=2026-09-17T09:00:00.000Z | change=scheduled_maintenance | detail=Maintenance (scheduled)",
    ]);
  });

  test("skips entries without a timestamp instead of inventing one", async () => {
    mockSources({
      exceptions: [asException({ message: "no first seen" })],
      statusChanges: [asStatusChange({ monitor: { name: "M" } })],
      maintenance: [asMaintenance({ title: "unscheduled" })],
    });

    const result: ToolExecutionResult = await RecentChangesTool.execute(
      {},
      context(),
    );

    expect(result.rowCount).toBe(0);
    expect(result.dataForLlm).toBe("(no rows found)");
  });

  test("a failing source is skipped and logged; the others still return", async () => {
    const spies: SourceSpies = mockSources({
      exceptions: new Error("exceptions table unavailable"),
      statusChanges: [
        asStatusChange({
          createdAt: new Date("2026-09-17T11:00:00.000Z"),
          monitor: { name: "API" },
          monitorStatus: { name: "Degraded" },
        }),
      ],
      maintenance: new Error("permission denied"),
    });

    const result: ToolExecutionResult = await RecentChangesTool.execute(
      {},
      context(),
    );

    expect(spies.statusChanges).toHaveBeenCalledTimes(1);
    expect(spies.maintenance).toHaveBeenCalledTimes(1);
    expect(result.rowCount).toBe(1);
    expect(result.dataForLlm).toContain("API → Degraded");
    expect(logger.debug).toHaveBeenCalledWith(
      expect.stringContaining("exceptions source skipped"),
    );
    expect(logger.debug).toHaveBeenCalledWith(
      expect.stringContaining("maintenance source skipped"),
    );
  });

  test("all sources failing yields an empty feed rather than an error", async () => {
    mockSources({
      changes: new Error("z"),
      exceptions: new Error("a"),
      statusChanges: new Error("b"),
      maintenance: new Error("c"),
    });

    const result: ToolExecutionResult = await RecentChangesTool.execute(
      {},
      context(),
    );

    expect(result.rowCount).toBe(0);
    expect(result.dataForLlm).toBe("(no rows found)");
    expect(logger.debug).toHaveBeenCalledTimes(4);
  });

  test("redacts secrets surfacing in exception messages", async () => {
    mockSources({
      exceptions: [
        asException({
          exceptionType: "AuthError",
          message: "token rejected for admin@example.com",
          firstSeenAt: new Date("2026-09-17T11:00:00.000Z"),
          occuranceCount: 1,
        }),
      ],
    });

    const result: ToolExecutionResult = await RecentChangesTool.execute(
      {},
      context(),
    );

    expect(result.dataForLlm).not.toContain("admin@example.com");
    expect(result.dataForLlm).toContain("[redacted-email]");
    expect(result.redactionCount).toBe(1);
  });

  test("a full 3x30 feed is capped at the serializer's 50 rows and flagged as truncated", async () => {
    const at: (minute: number) => Date = (minute: number): Date => {
      return new Date(NOW.getTime() - minute * 60 * 1000);
    };
    const exceptions: Array<JSONObject> = [];
    const statusChanges: Array<JSONObject> = [];
    const maintenance: Array<JSONObject> = [];
    for (let i: number = 0; i < 30; i++) {
      exceptions.push(
        asException({ message: `e${i}`, firstSeenAt: at(i * 3) }),
      );
      statusChanges.push(asStatusChange({ createdAt: at(i * 3 + 1) }));
      maintenance.push(
        asMaintenance({ title: `m${i}`, startsAt: at(i * 3 + 2) }),
      );
    }
    mockSources({
      exceptions: exceptions,
      statusChanges: statusChanges,
      maintenance: maintenance,
    });

    const result: ToolExecutionResult = await RecentChangesTool.execute(
      { limitPerSource: 30 },
      context(),
    );

    expect(result.rowCount).toBe(90);
    expect(result.isTruncated).toBe(true);
    expect(result.dataForLlm).toContain("showing the first 50 of 90 rows");
    // The most recent events are the ones kept.
    expect(result.dataForLlm.split("\n")[0]).toContain(
      `at=${NOW.toISOString()}`,
    );
  });
});

describe("recent_changes permission gate", () => {
  test("requiredPermissions mirror the Monitor read ACL and are cached", () => {
    const expected: Array<Permission> = new Monitor().getReadPermissions();
    const first: Array<Permission> = RecentChangesTool.requiredPermissions;
    expect(first).toEqual(expected);
    expect(first.length).toBeGreaterThan(0);
    expect(RecentChangesTool.requiredPermissions).toBe(first);
  });

  test("is registered in the toolbox as a read-only tool", () => {
    expect(AIToolbox.getToolByName("recent_changes")).toBe(RecentChangesTool);
    expect(AIToolbox.isMutationTool("recent_changes")).toBe(false);
  });

  test("denies users without monitor read access or with it blocked", () => {
    expect(AIToolbox.hasPermissionForTool(RecentChangesTool, context([]))).toBe(
      false,
    );
    expect(
      AIToolbox.hasPermissionForTool(
        RecentChangesTool,
        context([Permission.ProjectMember], [Permission.ProjectMember]),
      ),
    ).toBe(false);
    expect(
      AIToolbox.hasPermissionForTool(
        RecentChangesTool,
        context([Permission.ProjectOwner]),
      ),
    ).toBe(true);
  });

  test("refuses cross-project and multi-tenant contexts without querying", async () => {
    const spies: SourceSpies = mockSources();
    const ctx: ToolContext = context();

    const crossProject: ToolCallOutcome = await AIToolbox.executeTool({
      name: "recent_changes",
      args: {},
      ctx: { ...ctx, projectId: otherProjectId },
    });
    const multiTenant: ToolCallOutcome = await AIToolbox.executeTool({
      name: "recent_changes",
      args: {},
      ctx: { ...ctx, props: { ...ctx.props, isMultiTenantRequest: true } },
    });

    expect(crossProject.success).toBe(false);
    expect(multiTenant.success).toBe(false);
    expect(spies.changes).not.toHaveBeenCalled();
    expect(spies.exceptions).not.toHaveBeenCalled();
    expect(spies.statusChanges).not.toHaveBeenCalled();
    expect(spies.maintenance).not.toHaveBeenCalled();
  });
});

function asChange(data: JSONObject): JSONObject {
  return data as unknown as ChangeEvent as unknown as JSONObject;
}

const CHECKOUT_ID: ObjectID = new ObjectID(
  "22222222-2222-2222-2222-222222222222",
);
const CHANGE_ID: ObjectID = new ObjectID(
  "33333333-3333-3333-3333-333333333333",
);

describe("recent_changes change events", () => {
  test("reads change events in the window, newest first, under the caller's props", async () => {
    const ctx: ToolContext = context();
    const spies: SourceSpies = mockSources();
    const start: Date = new Date("2026-09-17T10:00:00.000Z");

    await RecentChangesTool.execute({ startTime: start.toISOString() }, ctx);

    const call: JSONObject = callArg(spies.changes);
    expect(call["props"]).toBe(ctx.props);
    expect(call["sort"]).toEqual({ time: SortOrder.Descending });
    expect(call["select"]).toEqual({
      _id: true,
      time: true,
      eventType: true,
      title: true,
      primaryEntityId: true,
      attributes: true,
    });

    const query: JSONObject = call["query"] as JSONObject;
    expect(Object.keys(query)).toEqual(["attributeKeys", "time"]);
    const window: InBetween<Date> = query["time"] as unknown as InBetween<Date>;
    expect(window).toBeInstanceOf(InBetween);
    expect(window.startValue).toEqual(start);
    expect(window.endValue).toEqual(NOW);

    // The rest, then the cloud's own: a busy account crowds nothing out.
    expect(query["attributeKeys"]).toBeInstanceOf(IncludesNone);
    expect((query["attributeKeys"] as unknown as IncludesNone).values).toEqual([
      "cloud.provider",
    ]);
    const cloudQuery: JSONObject = (
      spies.changes.mock.calls[1]![0] as JSONObject
    )["query"] as JSONObject;
    expect(cloudQuery["attributeKeys"]).toBeInstanceOf(Includes);
    expect(cloudQuery["time"]).toBeInstanceOf(InBetween);
    expect((spies.changes.mock.calls[1]![0] as JSONObject)["limit"]).toBe(15);
  });

  test("a cloud account's changes are listed beside the rest, each read with its own limit", async () => {
    mockSources({
      changes: [
        asChange({
          _id: CHANGE_ID.toString(),
          time: new Date("2026-09-17T11:30:00.000Z"),
          eventType: "deployment",
          title: "Deploy 2.3.1",
          attributes: {},
        }),
      ],
      cloudChanges: [
        asChange({
          _id: "44444444-4444-4444-4444-444444444444",
          time: new Date("2026-09-17T11:40:00.000Z"),
          eventType: "config-change",
          title: "ec2:AuthorizeSecurityGroupIngress on sg-0abc",
          attributes: {
            "cloud.provider": "aws",
            "cloud.account.id": "123456789012",
            "cloud.region": "eu-west-1",
            "cloud.resource_id": "sg-0abc",
            "oneuptime.cloud.operation": "ec2:AuthorizeSecurityGroupIngress",
            "oneuptime.cloud.actor": "alice",
            "oneuptime.change.status": "succeeded",
            "oneuptime.change.source": "cloud",
          },
        }),
      ],
    });

    const result: ToolExecutionResult = await RecentChangesTool.execute(
      {},
      context(),
    );

    expect(result.dataForLlm.split("\n")).toEqual([
      "- at=2026-09-17T11:40:00.000Z | change=config-change | detail=ec2:AuthorizeSecurityGroupIngress on sg-0abc (ec2:AuthorizeSecurityGroupIngress by alice, on sg-0abc, account 123456789012, eu-west-1, succeeded, recorded from the cloud account's activity log) | changeId=44444444-4444-4444-4444-444444444444",
      `- at=2026-09-17T11:30:00.000Z | change=deployment | detail=Deploy 2.3.1 | changeId=${CHANGE_ID.toString()}`,
    ]);
  });

  test("cloudResourceId or cloudAccountId narrows the change events to that resource's or account's", async () => {
    const spies: SourceSpies = mockSources();
    const cloudResourceId: string = "55555555-5555-5555-5555-555555555555";

    const result: ToolExecutionResult = await RecentChangesTool.execute(
      { cloudResourceId, cloudAccountId: "123456789012" },
      context(),
    );

    expect(spies.changes).toHaveBeenCalledTimes(1);
    const query: JSONObject = callArg(spies.changes)["query"] as JSONObject;
    expect(query["attributes"]).toEqual({
      "oneuptime.resource.id": cloudResourceId,
      "cloud.account.id": "123456789012",
    });
    expect(query["attributeKeys"]).toBeUndefined();

    // Exceptions, monitors and maintenance are listed either way.
    expect(spies.exceptions).toHaveBeenCalledTimes(1);
    expect(spies.statusChanges).toHaveBeenCalledTimes(1);

    // The feed of one cloud resource opens that resource.
    expect(result.citationTarget).toEqual({
      type: AIChatCitationTargetType.TelemetryResourceView,
      params: { resourceType: "CloudResource", resourceId: cloudResourceId },
    });
  });

  test("a deploy says what changed, on which service, with its id for get_change_details", async () => {
    const spies: SourceSpies = mockSources({
      changes: [
        asChange({
          _id: CHANGE_ID.toString(),
          time: new Date("2026-09-17T11:30:00.000Z"),
          eventType: "deployment",
          title: "Deploy 2.3.1",
          primaryEntityId: CHECKOUT_ID,
          attributes: {
            "service.version": "2.3.1",
            "oneuptime.change.previous_version": "2.3.0",
            "vcs.ref.head.revision": "1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b",
            "deployment.environment.name": "production",
            "oneuptime.change.source": "api",
          },
        }),
      ],
      serviceNames: [{ _id: CHECKOUT_ID.toString(), name: "checkout" }],
      exceptions: [
        asException({
          exceptionType: "TypeError",
          message: "total is undefined",
          firstSeenAt: new Date("2026-09-17T11:32:00.000Z"),
          occuranceCount: 40,
          firstSeenInRelease: "2.3.1",
        }),
      ],
    });

    const ctx: ToolContext = context();
    const result: ToolExecutionResult = await RecentChangesTool.execute(
      {},
      ctx,
    );

    expect(result.dataForLlm.split("\n")).toEqual([
      "- at=2026-09-17T11:32:00.000Z | change=new_exception | detail=TypeError: total is undefined (x40, first seen in 2.3.1)",
      `- at=2026-09-17T11:30:00.000Z | change=deployment | detail=checkout: Deploy 2.3.1 (2.3.0 → 2.3.1, commit 1a2b3c4, production, recorded from the change-events API) | changeId=${CHANGE_ID.toString()}`,
    ]);

    // The service names are read with the caller's own permissions.
    const namesCall: JSONObject = callArg(spies.serviceNames);
    expect(namesCall["props"]).toBe(ctx.props);
    expect(namesCall["select"]).toEqual({ _id: true, name: true });
  });

  test("a change event of a service the caller cannot see is listed unnamed", async () => {
    mockSources({
      changes: [
        asChange({
          _id: CHANGE_ID.toString(),
          time: new Date("2026-09-17T11:30:00.000Z"),
          eventType: "deployment",
          title: "Rolled out web/api",
          primaryEntityId: CHECKOUT_ID,
          attributes: {},
        }),
      ],
      serviceNames: new Error("no access"),
    });

    const result: ToolExecutionResult = await RecentChangesTool.execute(
      {},
      context(),
    );

    expect(result.dataForLlm).toBe(
      `- at=2026-09-17T11:30:00.000Z | change=deployment | detail=Rolled out web/api | changeId=${CHANGE_ID.toString()}`,
    );
  });

  test("project-wide changes and what OneUptime ran itself are listed too", async () => {
    const spies: SourceSpies = mockSources({
      changes: [
        asChange({
          _id: CHANGE_ID.toString(),
          time: new Date("2026-09-17T11:00:00.000Z"),
          eventType: "remediation",
          title:
            "OneUptime AI ran kubectl rollout restart deployment/api -n web",
          attributes: {
            "oneuptime.change.source": "oneuptime-ai",
            "oneuptime.change.status": "succeeded",
            "oneuptime.command":
              "kubectl rollout restart deployment/api -n web",
          },
        }),
        asChange({
          time: new Date("2026-09-17T10:00:00.000Z"),
          title: "Feature flags refreshed",
        }),
      ],
    });

    const result: ToolExecutionResult = await RecentChangesTool.execute(
      {},
      context(),
    );

    expect(spies.serviceNames).not.toHaveBeenCalled();
    expect(result.dataForLlm.split("\n")).toEqual([
      `- at=2026-09-17T11:00:00.000Z | change=remediation | detail=OneUptime AI ran kubectl rollout restart deployment/api -n web (command: kubectl rollout restart deployment/api -n web, succeeded, recorded from a fix OneUptime AI ran) | changeId=${CHANGE_ID.toString()}`,
      "- at=2026-09-17T10:00:00.000Z | change=change | detail=Feature flags refreshed",
    ]);
  });

  test("a posted title is capped and redacted like any field", async () => {
    mockSources({
      changes: [
        asChange({
          time: new Date("2026-09-17T11:00:00.000Z"),
          eventType: "deployment",
          title: `Deploy by admin@example.com ${"x".repeat(1000)}`,
        }),
      ],
    });

    const result: ToolExecutionResult = await RecentChangesTool.execute(
      {},
      context(),
    );

    expect(result.dataForLlm).not.toContain("admin@example.com");
    expect(result.dataForLlm).toContain("[redacted-email]");
    expect(result.dataForLlm.length).toBeLessThan(500);
  });
});

describe("recent_changes for one service", () => {
  test("serviceId narrows the change events and the exceptions, not monitors or maintenance", async () => {
    const spies: SourceSpies = mockSources();

    await RecentChangesTool.execute(
      { serviceId: CHECKOUT_ID.toString() },
      context(),
    );

    expect(
      (callArg(spies.changes)["query"] as JSONObject)["primaryEntityId"],
    ).toEqual(CHECKOUT_ID);
    expect(
      (callArg(spies.exceptions)["query"] as JSONObject)["primaryEntityId"],
    ).toEqual(CHECKOUT_ID);
    expect(
      Object.keys(callArg(spies.statusChanges)["query"] as JSONObject),
    ).toEqual(["createdAt"]);
    expect(
      Object.keys(callArg(spies.maintenance)["query"] as JSONObject).sort(),
    ).toEqual(["endsAt", "startsAt"]);
  });

  test("one service's feed opens that service's page", async () => {
    mockSources();

    const result: ToolExecutionResult = await RecentChangesTool.execute(
      { serviceId: CHECKOUT_ID.toString() },
      context(),
    );

    expect(result.citationTarget).toEqual({
      type: AIChatCitationTargetType.ServiceView,
      params: { serviceId: CHECKOUT_ID.toString() },
    });
  });
});
