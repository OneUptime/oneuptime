import Monitor from "../../../../../Models/DatabaseModels/Monitor";
import MonitorStatusTimeline from "../../../../../Models/DatabaseModels/MonitorStatusTimeline";
import ScheduledMaintenance from "../../../../../Models/DatabaseModels/ScheduledMaintenance";
import TelemetryException from "../../../../../Models/DatabaseModels/TelemetryException";
import MonitorStatusTimelineService from "../../../../../Server/Services/MonitorStatusTimelineService";
import ScheduledMaintenanceService from "../../../../../Server/Services/ScheduledMaintenanceService";
import TelemetryExceptionService from "../../../../../Server/Services/TelemetryExceptionService";
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

  return {
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
    for (const spy of [
      spies.exceptions,
      spies.statusChanges,
      spies.maintenance,
    ]) {
      expect(spy).toHaveBeenCalledTimes(1);
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
    expect(logger.debug).toHaveBeenCalledTimes(3);
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
    expect(spies.exceptions).not.toHaveBeenCalled();
    expect(spies.statusChanges).not.toHaveBeenCalled();
    expect(spies.maintenance).not.toHaveBeenCalled();
  });
});
