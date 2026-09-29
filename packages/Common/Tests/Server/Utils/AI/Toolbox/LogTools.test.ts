import Log from "../../../../../Models/AnalyticsModels/Log";
import LogService from "../../../../../Server/Services/LogService";
import LogAggregationService, {
  HistogramBucket,
  HistogramRequest,
} from "../../../../../Server/Services/LogAggregationService";
import DatabaseRequestType from "../../../../../Server/Types/BaseDatabase/DatabaseRequestType";
import ModelPermission from "../../../../../Server/Types/AnalyticsDatabase/ModelPermission";
import logger from "../../../../../Server/Utils/Logger";
import AIToolbox, {
  ToolCallOutcome,
} from "../../../../../Server/Utils/AI/Toolbox/Index";
import {
  LogHistogramTool,
  SearchLogsTool,
} from "../../../../../Server/Utils/AI/Toolbox/LogTools";
import {
  ToolContext,
  ToolExecutionResult,
} from "../../../../../Server/Utils/AI/Toolbox/ToolTypes";
import {
  AIChatCitationTargetType,
  AIChatWidgetColumn,
  AIChatWidgetSeries,
  AIChatWidgetType,
} from "../../../../../Types/AI/AIChatTypes";
import DatabaseCommonInteractionProps from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import InBetween from "../../../../../Types/BaseDatabase/InBetween";
import Includes from "../../../../../Types/BaseDatabase/Includes";
import Search from "../../../../../Types/BaseDatabase/Search";
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
const serviceA: ObjectID = new ObjectID("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa");
const serviceB: ObjectID = new ObjectID("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb");
const serviceC: ObjectID = new ObjectID("cccccccc-cccc-cccc-cccc-cccccccccccc");
const NOW: Date = new Date("2026-09-17T12:00:00.000Z");
const HOUR_MS: number = 60 * 60 * 1000;

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

function makeLog(data: JSONObject): Log {
  return data as unknown as Log;
}

function firstCallArg(spy: jest.SpyInstance): JSONObject {
  return spy.mock.calls[0]![0] as JSONObject;
}

function queryOf(spy: jest.SpyInstance, callIndex: number = 0): JSONObject {
  return (spy.mock.calls[callIndex]![0] as JSONObject)["query"] as JSONObject;
}

function histogramRequest(spy: jest.SpyInstance): HistogramRequest {
  return spy.mock.calls[0]![0] as HistogramRequest;
}

beforeEach(() => {
  jest.spyOn(OneUptimeDate, "getCurrentDate").mockReturnValue(NOW);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("search_logs", () => {
  test("defaults to the last hour, 25 rows, newest first, under the caller's props", async () => {
    const ctx: ToolContext = context();
    const findBy: jest.SpyInstance = jest
      .spyOn(LogService, "findBy")
      .mockResolvedValue([]);

    await SearchLogsTool.execute({}, ctx);

    expect(findBy).toHaveBeenCalledTimes(1);
    const call: JSONObject = firstCallArg(findBy);
    expect(call["props"]).toBe(ctx.props);
    expect(call["limit"]).toBe(25);
    expect(call["skip"]).toBe(0);
    expect(call["sort"]).toEqual({ time: SortOrder.Descending });
    expect(call["select"]).toEqual({
      time: true,
      severityText: true,
      body: true,
      traceId: true,
      spanId: true,
      primaryEntityId: true,
    });

    const query: JSONObject = call["query"] as JSONObject;
    expect(Object.keys(query)).toEqual(["time"]);
    const time: InBetween<Date> = query["time"] as InBetween<Date>;
    expect(time).toBeInstanceOf(InBetween);
    expect(time.endValue).toEqual(NOW);
    expect(time.startValue).toEqual(new Date(NOW.getTime() - HOUR_MS));
  });

  test("never lets arguments redirect the query to another project or tenant", async () => {
    const ctx: ToolContext = context();
    const findBy: jest.SpyInstance = jest
      .spyOn(LogService, "findBy")
      .mockResolvedValue([]);

    await SearchLogsTool.execute(
      {
        projectId: otherProjectId.toString(),
        tenantId: otherProjectId.toString(),
        props: { isRoot: true },
      },
      ctx,
    );

    const call: JSONObject = firstCallArg(findBy);
    const query: JSONObject = call["query"] as JSONObject;
    expect(query["projectId"]).toBeUndefined();
    expect(query["tenantId"]).toBeUndefined();
    expect(call["props"]).toBe(ctx.props);
    expect((call["props"] as JSONObject)["isRoot"]).toBeUndefined();
    expect(JSON.stringify(call)).not.toContain(otherProjectId.toString());
  });

  test("applies severity, body, trace and service filters", async () => {
    const findBy: jest.SpyInstance = jest
      .spyOn(LogService, "findBy")
      .mockResolvedValue([]);

    await SearchLogsTool.execute(
      {
        severityTexts: ["Error", "", "  ", 42, "Fatal"],
        bodySearchText: "  connection refused  ",
        traceId: " abc123 ",
        serviceId: serviceA.toString(),
      },
      context(),
    );

    const query: JSONObject = queryOf(findBy);
    expect(query["severityText"]).toBeInstanceOf(Includes);
    expect((query["severityText"] as Includes).values).toEqual([
      "Error",
      "Fatal",
    ]);
    expect(query["body"]).toBeInstanceOf(Search);
    expect((query["body"] as Search<string>).value).toBe("connection refused");
    expect(query["traceId"]).toBe("abc123");
    expect(query["primaryEntityId"]).toBeInstanceOf(ObjectID);
    expect((query["primaryEntityId"] as ObjectID).toString()).toBe(
      serviceA.toString(),
    );
  });

  test("ignores empty, whitespace-only and wrongly-typed filters", async () => {
    const findBy: jest.SpyInstance = jest
      .spyOn(LogService, "findBy")
      .mockResolvedValue([]);

    await SearchLogsTool.execute(
      {
        severityTexts: ["", "   ", 5] as unknown as JSONObject,
        bodySearchText: "   ",
        traceId: 12345,
        serviceId: "",
      },
      context(),
    );
    await SearchLogsTool.execute(
      { severityTexts: "Error", bodySearchText: null, traceId: [] },
      context(),
    );

    for (const index of [0, 1]) {
      expect(Object.keys(queryOf(findBy, index))).toEqual(["time"]);
    }
  });

  test.each([
    [900, 50],
    [50, 50],
    [0, 1],
    [-5, 1],
    ["10", 10],
    [7.9, 7],
    ["not-a-number", 25],
    [null, 25],
    [Number.POSITIVE_INFINITY, 25],
  ])("clamps limit %p to %p", async (input: unknown, expected: number) => {
    const findBy: jest.SpyInstance = jest
      .spyOn(LogService, "findBy")
      .mockResolvedValue([]);

    await SearchLogsTool.execute(
      { limit: input } as unknown as JSONObject,
      context(),
    );

    expect(firstCallArg(findBy)["limit"]).toBe(expected);
  });

  test("uses an explicit time range and clamps windows longer than 30 days", async () => {
    const findBy: jest.SpyInstance = jest
      .spyOn(LogService, "findBy")
      .mockResolvedValue([]);

    const start: string = "2026-09-10T00:00:00.000Z";
    const end: string = "2026-09-10T06:00:00.000Z";
    await SearchLogsTool.execute({ startTime: start, endTime: end }, context());

    const firstTime: InBetween<Date> = queryOf(findBy, 0)[
      "time"
    ] as InBetween<Date>;
    expect(firstTime.startValue).toEqual(new Date(start));
    expect(firstTime.endValue).toEqual(new Date(end));

    await SearchLogsTool.execute(
      { startTime: "2025-01-01T00:00:00.000Z", endTime: end },
      context(),
    );
    const clamped: InBetween<Date> = queryOf(findBy, 1)[
      "time"
    ] as InBetween<Date>;
    expect(clamped.endValue).toEqual(new Date(end));
    expect(clamped.startValue).toEqual(
      new Date(new Date(end).getTime() - 30 * 24 * HOUR_MS),
    );
  });

  test.each([
    [{ startTime: "yesterday-ish" }, "startTime"],
    [{ endTime: "not a date" }, "endTime"],
    [
      {
        startTime: "2026-09-10T06:00:00.000Z",
        endTime: "2026-09-10T00:00:00.000Z",
      },
      "before endTime",
    ],
    [
      {
        startTime: "2026-09-10T06:00:00.000Z",
        endTime: "2026-09-10T06:00:00.000Z",
      },
      "before endTime",
    ],
  ])(
    "rejects invalid time range %p without querying",
    async (args: JSONObject, messagePart: string) => {
      const findBy: jest.SpyInstance = jest
        .spyOn(LogService, "findBy")
        .mockResolvedValue([]);

      await expect(SearchLogsTool.execute(args, context())).rejects.toThrow(
        BadDataException,
      );
      await expect(SearchLogsTool.execute(args, context())).rejects.toThrow(
        messagePart,
      );
      expect(findBy).not.toHaveBeenCalled();
    },
  );

  test("formats rows for the model and builds a table widget from raw rows", async () => {
    const t1: Date = new Date("2026-09-17T11:59:00.000Z");
    const t2: Date = new Date("2026-09-17T11:58:00.000Z");
    jest.spyOn(LogService, "findBy").mockResolvedValue([
      makeLog({
        time: t1,
        severityText: "Error",
        body: "payment failed for user jane@example.com",
        traceId: "0af7651916cd43dd8448eb211c80319c",
        spanId: "b7ad6b7169203331",
        primaryEntityId: serviceA,
      }),
      makeLog({
        time: t2,
        severityText: "Info",
        body: "healthy",
      }),
    ]);

    const result: ToolExecutionResult = await SearchLogsTool.execute(
      {},
      context(),
    );

    expect(result.rowCount).toBe(2);
    expect(result.isTruncated).toBe(false);
    const lines: Array<string> = result.dataForLlm.split("\n");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe(
      `- time=${t1.toISOString()} | severity=Error | body=payment failed for user [redacted-email] | traceId=0af7651916cd43dd8448eb211c80319c | spanId=b7ad6b7169203331`,
    );
    expect(lines[1]).toBe(
      `- time=${t2.toISOString()} | severity=Info | body=healthy`,
    );
    // The service id is selected but not surfaced to the model.
    expect(result.dataForLlm).not.toContain(serviceA.toString());
    expect(result.redactionCount).toBe(1);

    expect(result.citationTarget).toEqual({
      type: AIChatCitationTargetType.Logs,
    });
    expect(result.citationLabel).toBe(
      `Logs ${new Date(NOW.getTime() - HOUR_MS).toISOString()} – ${NOW.toISOString()} (2 shown)`,
    );

    expect(result.widget?.type).toBe(AIChatWidgetType.Table);
    expect(result.widget?.title).toBe("Logs (2)");
    expect(
      (result.widget?.data.columns || []).map((column: AIChatWidgetColumn) => {
        return column.key;
      }),
    ).toEqual(["time", "severity", "body", "traceId"]);
    const widgetRows: Array<JSONObject> = result.widget?.data[
      "rows"
    ] as Array<JSONObject>;
    // Widget is rendered back to the same RBAC-checked user: raw, unredacted.
    expect(widgetRows[0]!["body"]).toBe(
      "payment failed for user jane@example.com",
    );
    expect(result.widget?.data["link"]).toEqual({
      type: AIChatCitationTargetType.Logs,
    });
  });

  test("empty results produce no widget and an explicit no-rows marker", async () => {
    jest.spyOn(LogService, "findBy").mockResolvedValue([]);

    const result: ToolExecutionResult = await SearchLogsTool.execute(
      {},
      context(),
    );

    expect(result.rowCount).toBe(0);
    expect(result.dataForLlm).toBe("(no rows found)");
    expect(result.widget).toBeUndefined();
    expect(result.citationLabel).toContain("(0 shown)");
  });

  test("truncates very long log bodies in the model payload", async () => {
    jest
      .spyOn(LogService, "findBy")
      .mockResolvedValue([
        makeLog({ time: NOW, severityText: "Info", body: "x".repeat(2000) }),
      ]);

    const result: ToolExecutionResult = await SearchLogsTool.execute(
      {},
      context(),
    );

    expect(result.isTruncated).toBe(true);
    expect(result.dataForLlm).toContain("… [truncated]");
    expect(result.dataForLlm.length).toBeLessThan(700);
  });

  test("propagates service failures from execute", async () => {
    jest
      .spyOn(LogService, "findBy")
      .mockRejectedValue(new Error("ClickHouse unavailable"));

    await expect(SearchLogsTool.execute({}, context())).rejects.toThrow(
      "ClickHouse unavailable",
    );
  });
});

describe("log_histogram", () => {
  let getAccessible: jest.SpyInstance;

  beforeEach(() => {
    getAccessible = jest
      .spyOn(ModelPermission, "getAccessibleServiceIdsForAnalyticsModel")
      .mockResolvedValue(null);
  });

  test("scopes the raw aggregation to the authenticated project, not the arguments", async () => {
    const ctx: ToolContext = context();
    const getHistogram: jest.SpyInstance = jest
      .spyOn(LogAggregationService, "getHistogram")
      .mockResolvedValue([]);

    await LogHistogramTool.execute(
      { projectId: otherProjectId.toString() },
      ctx,
    );

    const request: HistogramRequest = histogramRequest(getHistogram);
    expect(request.projectId).toBe(ctx.projectId);
    expect(request.projectId.toString()).toBe(projectId.toString());
    expect(getAccessible).toHaveBeenCalledWith(
      Log,
      ctx.props,
      DatabaseRequestType.Read,
    );
  });

  test("defaults to 24 hours in 30-minute buckets with no filters", async () => {
    const getHistogram: jest.SpyInstance = jest
      .spyOn(LogAggregationService, "getHistogram")
      .mockResolvedValue([]);

    await LogHistogramTool.execute({}, context());

    const request: HistogramRequest = histogramRequest(getHistogram);
    expect(request.endTime).toEqual(NOW);
    expect(request.startTime).toEqual(new Date(NOW.getTime() - 24 * HOUR_MS));
    expect(request.bucketSizeInMinutes).toBe(30);
    expect(request.serviceIds).toBeUndefined();
    expect(request.severityTexts).toBeUndefined();
    expect(request.bodySearchText).toBeUndefined();
  });

  test.each([
    ["2026-09-17T11:30:00.000Z", 1],
    ["2026-09-17T11:59:00.000Z", 1],
    ["2026-09-17T08:00:00.000Z", 5],
    ["2026-09-17T11:00:00.000Z", 2],
    ["2026-08-18T12:00:00.000Z", 900],
    // Longer than 30 days is clamped to 30 days first.
    ["2026-01-01T00:00:00.000Z", 900],
  ])(
    "window starting %s uses %p-minute buckets (at most 48 buckets)",
    async (startTime: string, expected: number) => {
      const getHistogram: jest.SpyInstance = jest
        .spyOn(LogAggregationService, "getHistogram")
        .mockResolvedValue([]);

      await LogHistogramTool.execute(
        { startTime: startTime, endTime: NOW.toISOString() },
        context(),
      );

      const request: HistogramRequest = histogramRequest(getHistogram);
      expect(request.bucketSizeInMinutes).toBe(expected);
      const windowMinutes: number =
        (request.endTime.getTime() - request.startTime.getTime()) / 60000;
      expect(Math.ceil(windowMinutes / expected)).toBeLessThanOrEqual(48);
    },
  );

  test("forwards severity and body filters", async () => {
    const getHistogram: jest.SpyInstance = jest
      .spyOn(LogAggregationService, "getHistogram")
      .mockResolvedValue([]);

    await LogHistogramTool.execute(
      { severityTexts: ["Error", ""], bodySearchText: " timeout " },
      context(),
    );

    const request: HistogramRequest = histogramRequest(getHistogram);
    expect(request.severityTexts).toEqual(["Error"]);
    expect(request.bodySearchText).toBe("timeout");
  });

  test("project-wide users can filter to a single requested service", async () => {
    const getHistogram: jest.SpyInstance = jest
      .spyOn(LogAggregationService, "getHistogram")
      .mockResolvedValue([]);

    await LogHistogramTool.execute(
      { serviceId: serviceA.toString() },
      context(),
    );

    const serviceIds: Array<ObjectID> | undefined =
      histogramRequest(getHistogram).serviceIds;
    expect(serviceIds?.map(String)).toEqual([serviceA.toString()]);
  });

  test("label-restricted users only ever see their accessible services", async () => {
    getAccessible.mockResolvedValue([serviceA, serviceB]);
    const getHistogram: jest.SpyInstance = jest
      .spyOn(LogAggregationService, "getHistogram")
      .mockResolvedValue([]);

    await LogHistogramTool.execute({}, context());
    await LogHistogramTool.execute(
      { serviceId: serviceB.toString() },
      context(),
    );
    await LogHistogramTool.execute(
      { serviceId: serviceC.toString() },
      context(),
    );

    const idsForCall: (index: number) => Array<string> = (
      index: number,
    ): Array<string> => {
      return (
        (getHistogram.mock.calls[index]![0] as HistogramRequest).serviceIds ||
        []
      ).map(String);
    };

    expect(idsForCall(0)).toEqual([serviceA.toString(), serviceB.toString()]);
    expect(idsForCall(1)).toEqual([serviceB.toString()]);
    // An inaccessible service must not widen to "no filter" (whole project).
    expect(idsForCall(2)).toEqual([ObjectID.getZeroObjectID().toString()]);
  });

  test("users with no accessible services get a no-match sentinel, never an unfiltered query", async () => {
    getAccessible.mockResolvedValue([]);
    const getHistogram: jest.SpyInstance = jest
      .spyOn(LogAggregationService, "getHistogram")
      .mockResolvedValue([]);

    await LogHistogramTool.execute({}, context());

    const serviceIds: Array<ObjectID> | undefined =
      histogramRequest(getHistogram).serviceIds;
    expect(serviceIds).toBeDefined();
    expect(serviceIds?.map(String)).toEqual([
      ObjectID.getZeroObjectID().toString(),
    ]);
  });

  test("pivots (bucket, severity) rows into one sorted row per bucket and a stacked bar chart", async () => {
    const buckets: Array<HistogramBucket> = [
      { time: "2026-09-17 11:30:00", severity: "Error", count: 12 },
      { time: "2026-09-17 11:00:00", severity: "Info", count: 100 },
      { time: "2026-09-17 11:30:00", severity: "Warn", count: 3 },
      { time: "2026-09-17 11:00:00", severity: "", count: 4 },
    ];
    jest
      .spyOn(LogAggregationService, "getHistogram")
      .mockResolvedValue(buckets);

    const result: ToolExecutionResult = await LogHistogramTool.execute(
      {},
      context(),
    );

    expect(result.rowCount).toBe(2);
    expect(result.dataForLlm).toBe(
      [
        "- time=2026-09-17 11:00:00 | Info=100 | Unspecified=4",
        "- time=2026-09-17 11:30:00 | Error=12 | Warn=3",
      ].join("\n"),
    );
    expect(result.citationTarget).toEqual({
      type: AIChatCitationTargetType.Logs,
    });
    expect(result.citationLabel).toBe(
      `Log volume by severity, ${new Date(NOW.getTime() - 24 * HOUR_MS).toISOString()} – ${NOW.toISOString()}`,
    );

    expect(result.widget?.type).toBe(AIChatWidgetType.BarChart);
    expect(result.widget?.data["stacked"]).toBe(true);
    expect(result.widget?.data["xIsTime"]).toBe(true);
    expect(result.widget?.data["unit"]).toBe("logs");
    const series: Array<AIChatWidgetSeries> | undefined =
      result.widget?.data.series;
    expect(series).toEqual([
      {
        name: "Info",
        points: [
          { x: "2026-09-17 11:00:00", y: 100 },
          { x: "2026-09-17 11:30:00", y: 0 },
        ],
      },
      {
        name: "Unspecified",
        points: [
          { x: "2026-09-17 11:00:00", y: 4 },
          { x: "2026-09-17 11:30:00", y: 0 },
        ],
      },
      {
        name: "Error",
        points: [
          { x: "2026-09-17 11:00:00", y: 0 },
          { x: "2026-09-17 11:30:00", y: 12 },
        ],
      },
      {
        name: "Warn",
        points: [
          { x: "2026-09-17 11:00:00", y: 0 },
          { x: "2026-09-17 11:30:00", y: 3 },
        ],
      },
    ]);
  });

  test("a full 48-bucket window is never truncated by the serializer row cap", async () => {
    const buckets: Array<HistogramBucket> = [];
    for (let i: number = 0; i < 48; i++) {
      const time: string = `bucket-${String(i).padStart(2, "0")}`;
      buckets.push({ time: time, severity: "Error", count: i });
      buckets.push({ time: time, severity: "Info", count: i * 2 });
    }
    jest
      .spyOn(LogAggregationService, "getHistogram")
      .mockResolvedValue(buckets);

    const result: ToolExecutionResult = await LogHistogramTool.execute(
      {},
      context(),
    );

    expect(result.rowCount).toBe(48);
    expect(result.isTruncated).toBe(false);
    expect(result.dataForLlm).toContain("time=bucket-47 | Error=47 | Info=94");
  });

  test("empty histograms produce no widget", async () => {
    jest.spyOn(LogAggregationService, "getHistogram").mockResolvedValue([]);

    const result: ToolExecutionResult = await LogHistogramTool.execute(
      {},
      context(),
    );

    expect(result.rowCount).toBe(0);
    expect(result.dataForLlm).toBe("(no rows found)");
    expect(result.widget).toBeUndefined();
  });

  test("fails closed when the owned-scope lookup fails", async () => {
    getAccessible.mockRejectedValue(new Error("scope lookup failed"));
    const getHistogram: jest.SpyInstance = jest
      .spyOn(LogAggregationService, "getHistogram")
      .mockResolvedValue([]);

    await expect(LogHistogramTool.execute({}, context())).rejects.toThrow(
      "scope lookup failed",
    );
    expect(getHistogram).not.toHaveBeenCalled();
  });

  test("rejects invalid timestamps before resolving scope or querying", async () => {
    const getHistogram: jest.SpyInstance = jest
      .spyOn(LogAggregationService, "getHistogram")
      .mockResolvedValue([]);

    await expect(
      LogHistogramTool.execute({ endTime: "garbage" }, context()),
    ).rejects.toThrow(BadDataException);
    expect(getAccessible).not.toHaveBeenCalled();
    expect(getHistogram).not.toHaveBeenCalled();
  });
});

describe("log tools through the AI toolbox gate", () => {
  test("both tools are registered and read-only", () => {
    expect(AIToolbox.getToolByName("search_logs")).toBe(SearchLogsTool);
    expect(AIToolbox.getToolByName("log_histogram")).toBe(LogHistogramTool);
    expect(AIToolbox.isMutationTool("search_logs")).toBe(false);
    expect(AIToolbox.isMutationTool("log_histogram")).toBe(false);
  });

  test.each([
    Permission.ProjectMember,
    Permission.Viewer,
    Permission.TelemetryViewer,
    Permission.ReadTelemetryServiceLog,
  ])("grants log tools to %s", (permission: Permission) => {
    for (const tool of [SearchLogsTool, LogHistogramTool]) {
      expect(AIToolbox.hasPermissionForTool(tool, context([permission]))).toBe(
        true,
      );
    }
  });

  test("denies users without a log read permission or with a blocked one", () => {
    for (const tool of [SearchLogsTool, LogHistogramTool]) {
      expect(AIToolbox.hasPermissionForTool(tool, context([]))).toBe(false);
      expect(
        AIToolbox.hasPermissionForTool(
          tool,
          context([Permission.SecurityViewer]),
        ),
      ).toBe(false);
      expect(
        AIToolbox.hasPermissionForTool(
          tool,
          context([Permission.ProjectMember], [Permission.ProjectMember]),
        ),
      ).toBe(false);
    }
  });

  test.each(["search_logs", "log_histogram"])(
    "%s refuses cross-project and multi-tenant contexts without querying",
    async (name: string) => {
      const findBy: jest.SpyInstance = jest
        .spyOn(LogService, "findBy")
        .mockResolvedValue([]);
      const getHistogram: jest.SpyInstance = jest
        .spyOn(LogAggregationService, "getHistogram")
        .mockResolvedValue([]);
      const ctx: ToolContext = context();

      const crossProject: ToolCallOutcome = await AIToolbox.executeTool({
        name: name,
        args: {},
        ctx: { ...ctx, projectId: otherProjectId },
      });
      const multiTenant: ToolCallOutcome = await AIToolbox.executeTool({
        name: name,
        args: {},
        ctx: { ...ctx, props: { ...ctx.props, isMultiTenantRequest: true } },
      });
      const noPermission: ToolCallOutcome = await AIToolbox.executeTool({
        name: name,
        args: {},
        ctx: context([]),
      });

      expect(crossProject.success).toBe(false);
      expect(multiTenant.success).toBe(false);
      expect(noPermission.success).toBe(false);
      expect(noPermission.textForLlm).toContain("does not have permission");
      expect(findBy).not.toHaveBeenCalled();
      expect(getHistogram).not.toHaveBeenCalled();
    },
  );

  test("surfaces bad arguments to the model as a recoverable error", async () => {
    // executeTool races the tool against a 45s timeout timer; keep it fake.
    jest.useFakeTimers({ doNotFake: ["nextTick", "setImmediate"] });
    jest.spyOn(logger, "error").mockImplementation(() => {
      return undefined;
    });
    const findBy: jest.SpyInstance = jest
      .spyOn(LogService, "findBy")
      .mockResolvedValue([]);

    const outcome: ToolCallOutcome = await AIToolbox.executeTool({
      name: "search_logs",
      args: { startTime: "last tuesday" },
      ctx: context(),
    });

    expect(outcome.success).toBe(false);
    expect(outcome.errorMessage).toContain("not a valid ISO 8601 timestamp");
    expect(outcome.textForLlm).toContain("Error executing search_logs");
    expect(findBy).not.toHaveBeenCalled();
    jest.clearAllTimers();
    jest.useRealTimers();
  });
});
