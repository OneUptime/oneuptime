import RumApplication from "../../../../Models/DatabaseModels/RumApplication";
import Metric from "../../../../Models/AnalyticsModels/Metric";
import RumApplicationService from "../../../../Server/Services/RumApplicationService";
import MetricService, {
  MetricService as MetricServiceClass,
} from "../../../../Server/Services/MetricService";
import TraceAggregationService from "../../../../Server/Services/TraceAggregationService";
import ModelPermission from "../../../../Server/Types/AnalyticsDatabase/ModelPermission";
import AggregateBy from "../../../../Server/Types/AnalyticsDatabase/AggregateBy";
import { Statement } from "../../../../Server/Utils/AnalyticsDatabase/Statement";
import AIToolbox, {
  ToolCallOutcome,
} from "../../../../Server/Utils/AI/Toolbox/Index";
import {
  QueryRumApplicationsTool,
  QueryRumWebVitalsTool,
} from "../../../../Server/Utils/AI/Toolbox/RumTools";
import { QueryTracesTool } from "../../../../Server/Utils/AI/Toolbox/TraceTools";
import {
  ToolContext,
  ToolExecutionResult,
} from "../../../../Server/Utils/AI/Toolbox/ToolTypes";
import { AIChatCitationTargetType } from "../../../../Types/AI/AIChatTypes";
import AIChatPermissionMode from "../../../../Types/AI/AIChatPermissionMode";
import AggregatedModel from "../../../../Types/BaseDatabase/AggregatedModel";
import AggregatedResult from "../../../../Types/BaseDatabase/AggregatedResult";
import AggregationInterval from "../../../../Types/BaseDatabase/AggregationInterval";
import AggregationType from "../../../../Types/BaseDatabase/AggregationType";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import Includes from "../../../../Types/BaseDatabase/Includes";
import InBetween from "../../../../Types/BaseDatabase/InBetween";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import Permission from "../../../../Types/Permission";
import {
  WebVitalDefinition,
  WebVitalDefinitions,
} from "../../../../Types/Rum/WebVitals";
import ServiceType from "../../../../Types/Telemetry/ServiceType";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

const projectId: ObjectID = new ObjectID(
  "11111111-1111-1111-1111-111111111111",
);
const applicationId: ObjectID = new ObjectID(
  "22222222-2222-2222-2222-222222222222",
);
const otherApplicationId: ObjectID = new ObjectID(
  "33333333-3333-3333-3333-333333333333",
);
const start: Date = new Date("2026-09-16T12:00:00.000Z");
const end: Date = new Date("2026-09-17T12:00:00.000Z");
const args: JSONObject = {
  rumApplicationId: applicationId.toString(),
  startTime: start.toISOString(),
  endTime: end.toISOString(),
};

function context(
  allowed: Array<Permission> = [Permission.ProjectMember],
  blocked: Array<Permission> = [],
): ToolContext {
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
            ...allowed.map((permission: Permission) => {
              return {
                permission: permission,
                labelIds: [],
                isBlockPermission: false,
                _type: "UserPermission",
              };
            }),
            ...blocked.map((permission: Permission) => {
              return {
                permission: permission,
                labelIds: [],
                isBlockPermission: true,
                _type: "UserPermission",
              };
            }),
          ],
          _type: "UserTenantAccessPermission",
        },
      },
    } as unknown as DatabaseCommonInteractionProps,
  };
}

function application(): RumApplication {
  const result: RumApplication = new RumApplication();
  result._id = applicationId.toString();
  result.name = "Checkout browser";
  result.clientType = "browser";
  result.sdkLanguage = "javascript";
  result.otelCollectorStatus = "Connected";
  result.lastSeenAt = end;
  return result;
}

function aggregate(values: Record<string, number | null>): AggregatedResult {
  return {
    data: Object.entries(values).map(
      ([name, value]: [string, number | null]) => {
        return {
          timestamp: start,
          name: name,
          value: value,
        } as AggregatedModel;
      },
    ),
  };
}

function mockAverages(
  current: AggregatedResult,
  previous: AggregatedResult = current,
): jest.SpyInstance {
  return jest
    .spyOn(MetricService, "aggregateBy")
    .mockImplementation(
      async (descriptor: AggregateBy<Metric>): Promise<AggregatedResult> => {
        const result: AggregatedResult =
          descriptor.endTimestamp.getTime() <= start.getTime()
            ? previous
            : current;
        if (descriptor.aggregationType === AggregationType.Avg) {
          return result;
        }
        return {
          ...result,
          data: result.data.map((row: AggregatedModel): AggregatedModel => {
            return { ...row, value: 1 };
          }),
        };
      },
    );
}

function widgetRows(result: ToolExecutionResult): Array<JSONObject> {
  return result.widget?.data["rows"] as Array<JSONObject>;
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("query_rum_applications", () => {
  test("lists only safe application metadata under the authenticated project and caller props", async () => {
    const ctx: ToolContext = context();
    const app: RumApplication = application();
    app.sessionReplayMaskSelectors = ["sensitive-selector"];
    const findBy: jest.SpyInstance = jest
      .spyOn(RumApplicationService, "findBy")
      .mockResolvedValue([app]);
    const result: ToolExecutionResult = await QueryRumApplicationsTool.execute(
      { projectId: otherApplicationId.toString() },
      ctx,
    );
    const call: JSONObject = findBy.mock.calls[0]![0] as JSONObject;
    expect(call["props"]).toBe(ctx.props);
    expect(call["query"]).toEqual({ projectId: projectId });
    expect(call["select"]).toEqual({
      _id: true,
      name: true,
      clientType: true,
      sdkLanguage: true,
      otelCollectorStatus: true,
      lastSeenAt: true,
    });
    expect(result.rowCount).toBe(1);
    expect(result.dataForLlm).toContain("Checkout browser");
    expect(result.dataForLlm).not.toContain("sensitive-selector");
    expect(result.citationTarget).toEqual({
      type: AIChatCitationTargetType.RumApplications,
    });
    expect(widgetRows(result)[0]).toMatchObject({
      id: applicationId.toString(),
      connectionStatus: "Connected",
    });
  });

  test("detail queries pin both application and project and link to the selected app", async () => {
    const findBy: jest.SpyInstance = jest
      .spyOn(RumApplicationService, "findBy")
      .mockResolvedValue([application()]);
    const result: ToolExecutionResult = await QueryRumApplicationsTool.execute(
      { ...args, skip: 50, limit: 50 },
      context(),
    );
    expect(findBy.mock.calls[0]![0]).toMatchObject({
      query: { _id: applicationId.toString(), projectId: projectId },
      limit: 1,
      skip: 0,
    });
    expect(result.citationTarget).toEqual({
      type: AIChatCitationTargetType.RumApplicationView,
      params: { rumApplicationId: applicationId.toString() },
    });
    expect(result.isTruncated).toBe(false);
  });

  test("supports name search and clamps pagination", async () => {
    const findBy: jest.SpyInstance = jest
      .spyOn(RumApplicationService, "findBy")
      .mockResolvedValue([]);
    await QueryRumApplicationsTool.execute(
      { nameSearch: " checkout ", limit: 900, skip: 900 },
      context(),
    );
    expect(findBy.mock.calls[0]![0]).toMatchObject({ limit: 50, skip: 500 });
    expect(
      (findBy.mock.calls[0]![0] as { query: { name: unknown } }).query.name,
    ).toBeDefined();
    await QueryRumApplicationsTool.execute({ limit: -3, skip: -1 }, context());
    expect(findBy.mock.calls[1]![0]).toMatchObject({ limit: 1, skip: 0 });
  });

  test("reports potentially incomplete pages rather than implying a complete inventory", async () => {
    jest
      .spyOn(RumApplicationService, "findBy")
      .mockResolvedValue([application()]);
    const result: ToolExecutionResult = await QueryRumApplicationsTool.execute(
      { limit: 1 },
      context(),
    );
    expect(result.isTruncated).toBe(true);
    expect(result.dataForLlm).toContain("increase skip");
  });

  test("empty inventories do not create invented rows or widgets", async () => {
    jest.spyOn(RumApplicationService, "findBy").mockResolvedValue([]);
    const result: ToolExecutionResult = await QueryRumApplicationsTool.execute(
      {},
      context(),
    );
    expect(result.rowCount).toBe(0);
    expect(result.widget).toBeUndefined();
    expect(result.dataForLlm).toContain("no rows found");
  });

  test("redacts sensitive strings before they reach the model", async () => {
    const app: RumApplication = application();
    app.name = "Customer jane@example.com";
    jest.spyOn(RumApplicationService, "findBy").mockResolvedValue([app]);
    const result: ToolExecutionResult = await QueryRumApplicationsTool.execute(
      {},
      context(),
    );
    expect(result.dataForLlm).not.toContain("jane@example.com");
    expect(result.dataForLlm).toContain("[redacted-email]");
    expect(result.redactionCount).toBeGreaterThan(0);
  });
});

describe("query_rum_web_vitals", () => {
  beforeEach(() => {
    jest
      .spyOn(RumApplicationService, "findOneBy")
      .mockResolvedValue(application());
  });

  test("compares full-window weighted averages with bounded, application-scoped queries", async () => {
    const ctx: ToolContext = context();
    const fetch: jest.SpyInstance = mockAverages(
      aggregate({ "web_vital.lcp": 3000, "web_vital.cls": 0 }),
      aggregate({ "web_vital.lcp": 2000, "web_vital.cls": 0.1 }),
    );
    const result: ToolExecutionResult = await QueryRumWebVitalsTool.execute(
      { ...args, projectId: otherApplicationId.toString() },
      ctx,
    );
    expect(fetch).toHaveBeenCalledTimes(4);
    for (const call of fetch.mock.calls) {
      const query: JSONObject = call[0].query as JSONObject;
      expect(query["projectId"]).toEqual(projectId);
      expect(query["primaryEntityId"]).toEqual(applicationId);
      expect(query["primaryEntityType"]).toBe(ServiceType.RealUserMonitor);
      expect((query["name"] as Includes).values).toHaveLength(20);
      expect(query["time"]).toBeInstanceOf(InBetween);
      expect(call[0]).toMatchObject({
        props: ctx.props,
        aggregationInterval: AggregationInterval.Total,
        groupBy: { name: true },
        limit: 21,
        skip: 0,
        timeoutOverflowMode: "throw",
      });
    }
    expect(
      fetch.mock.calls.map(
        (call: Array<{ aggregationType: AggregationType }>) => {
          return call[0]?.aggregationType;
        },
      ),
    ).toEqual([
      AggregationType.Avg,
      AggregationType.Avg,
      AggregationType.Count,
      AggregationType.Count,
    ]);
    expect(fetch.mock.calls[0]![0]).toMatchObject({
      startTimestamp: start,
      endTimestamp: end,
    });
    expect(fetch.mock.calls[1]![0]).toMatchObject({
      startTimestamp: new Date("2026-09-15T12:00:00.000Z"),
      endTimestamp: start,
    });
    const currentTimeFilter: InBetween<Date> = fetch.mock.calls[0]![0].query
      .time as InBetween<Date>;
    const previousTimeFilter: InBetween<Date> = fetch.mock.calls[1]![0].query
      .time as InBetween<Date>;
    expect(currentTimeFilter.endValue).toEqual(new Date(end.getTime() - 1));
    expect(previousTimeFilter.endValue).toEqual(new Date(start.getTime() - 1));
    expect(previousTimeFilter.endValue.getTime()).toBeLessThan(
      currentTimeFilter.startValue.getTime(),
    );
    expect(RumApplicationService.findOneBy).toHaveBeenCalledWith({
      query: { _id: applicationId.toString(), projectId: projectId },
      select: { _id: true },
      props: ctx.props,
    });
    expect(widgetRows(result)).toEqual([
      {
        vital: "LCP",
        metricName: "web_vital.lcp",
        average: 3000,
        observations: 1,
        unit: "ms",
        rating: "Needs improvement",
        previousAverage: 2000,
        previousObservations: 1,
        changePercent: 50,
      },
      {
        vital: "CLS",
        metricName: "web_vital.cls",
        average: 0,
        observations: 1,
        unit: "score",
        rating: "Good",
        previousAverage: 0.1,
        previousObservations: 1,
        changePercent: -100,
      },
    ]);
    expect(result.dataForLlm).toContain("Missing vitals: INP, FCP, TTFB");
    expect(result.dataForLlm).toContain("not p75");
    expect(result.rowCount).toBe(2);
    expect(result.citationTarget).toEqual({
      type: AIChatCitationTargetType.RumApplicationView,
      params: { rumApplicationId: applicationId.toString() },
    });
    expect(result.citationLabel).toContain(start.toISOString());
    expect(result.citationLabel).toContain(end.toISOString());
  });

  test("its aggregate descriptors render valid grouped, weighted SQL with separately bound tenant, application and aliases", async () => {
    const fetch: jest.SpyInstance = jest
      .spyOn(MetricService, "aggregateBy")
      .mockResolvedValue(aggregate({}));
    await QueryRumWebVitalsTool.execute(args, context());
    const descriptor: AggregateBy<Metric> = fetch.mock
      .calls[0]![0] as AggregateBy<Metric>;
    const service: MetricServiceClass = new MetricServiceClass();
    const result: { statement: Statement; columns: Array<string> } =
      service.toAggregateStatement(descriptor);
    expect(result.statement.query).toContain("sum(multiIf(isNotNull(count)");
    expect(result.statement.query).toContain("min(time) as time");
    expect(result.statement.query).toContain("GROUP BY name");
    expect(result.statement.query).not.toContain("MetricItemAggMV1m");
    expect(result.columns).toContain("name");
    const countResult: { statement: Statement; columns: Array<string> } =
      service.toAggregateStatement(
        fetch.mock.calls[2]![0] as AggregateBy<Metric>,
      );
    expect(countResult.statement.query).toContain("toFloat64(count)");
    expect(countResult.statement.query).not.toContain("count(value)");
    const bound: string = JSON.stringify(result.statement.query_params);
    expect(bound).toContain(projectId.toString());
    expect(bound).toContain(applicationId.toString());
    expect(bound).toContain(ServiceType.RealUserMonitor);
    for (const definition of WebVitalDefinitions) {
      for (const name of definition.names) {
        expect(bound).toContain(name);
      }
    }
  });

  test.each(
    WebVitalDefinitions.flatMap((definition: WebVitalDefinition) => {
      return definition.names.map((name: string): [string, string] => {
        return [definition.key, name];
      });
    }),
  )("recognizes the %s alias %s", async (vital: string, name: string) => {
    const fetch: jest.SpyInstance = jest
      .spyOn(MetricService, "aggregateBy")
      .mockResolvedValue(aggregate({ [name]: 1 }));
    const result: ToolExecutionResult = await QueryRumWebVitalsTool.execute(
      { ...args, vital: vital },
      context(),
    );
    expect(widgetRows(result)[0]).toMatchObject({
      vital: vital.toUpperCase(),
      metricName: name,
      average: 1,
      changePercent: 0,
    });
    expect(
      (fetch.mock.calls[0]![0].query.name as Includes).values,
    ).toHaveLength(4);
  });

  test("prefers the first alias with data and never sums duplicates or compares different aliases", async () => {
    mockAverages(
      aggregate({ "web.vitals.lcp": 9000, "web_vital.lcp": 3000 }),
      aggregate({ "web.vitals.lcp": 1000 }),
    );
    const result: ToolExecutionResult = await QueryRumWebVitalsTool.execute(
      args,
      context(),
    );
    expect(widgetRows(result)).toEqual([
      {
        vital: "LCP",
        metricName: "web_vital.lcp",
        average: 3000,
        observations: 1,
        unit: "ms",
        rating: "Needs improvement",
        previousAverage: null,
        previousObservations: null,
        changePercent: null,
      },
    ]);
  });

  test("zero previous averages do not create infinite percentage changes", async () => {
    mockAverages(
      aggregate({ "web_vital.cls": 0.1 }),
      aggregate({ "web_vital.cls": 0 }),
    );
    const result: ToolExecutionResult = await QueryRumWebVitalsTool.execute(
      args,
      context(),
    );
    expect(widgetRows(result)[0]).toMatchObject({
      previousAverage: 0,
      changePercent: null,
    });
  });

  test("empty histogram exports are missing, while a zero with actual observations stays Good", async () => {
    jest
      .spyOn(MetricService, "aggregateBy")
      .mockResolvedValueOnce(
        aggregate({ "web_vital.lcp": 0, "web_vital.cls": 0 }),
      )
      .mockResolvedValueOnce(aggregate({ "web_vital.cls": 0 }))
      .mockResolvedValueOnce(
        aggregate({ "web_vital.lcp": 0, "web_vital.cls": 12 }),
      )
      .mockResolvedValueOnce(aggregate({ "web_vital.cls": 0 }));
    const result: ToolExecutionResult = await QueryRumWebVitalsTool.execute(
      args,
      context(),
    );
    expect(widgetRows(result)).toEqual([
      {
        vital: "CLS",
        metricName: "web_vital.cls",
        average: 0,
        observations: 12,
        unit: "score",
        rating: "Good",
        previousAverage: null,
        previousObservations: null,
        changePercent: null,
      },
    ]);
    expect(result.dataForLlm).toContain("Missing vitals: LCP, INP, FCP, TTFB");
  });

  test.each([null, NaN, Infinity, -1])(
    "treats unusable aggregate %p as missing, without inventing zero",
    async (value: number | null) => {
      jest
        .spyOn(MetricService, "aggregateBy")
        .mockResolvedValue(aggregate({ "web_vital.lcp": value }));
      const result: ToolExecutionResult = await QueryRumWebVitalsTool.execute(
        args,
        context(),
      );
      expect(result.rowCount).toBe(0);
      expect(result.widget).toBeUndefined();
      expect(result.dataForLlm).toContain(
        "Missing vitals: LCP, INP, CLS, FCP, TTFB",
      );
    },
  );

  test.each([
    [2499, "Good"],
    [2500, "Needs improvement"],
    [3999, "Needs improvement"],
    [4000, "Poor"],
  ])(
    "rates LCP average %p at the dashboard threshold as %s",
    async (value: number | string, expected: number | string) => {
      jest
        .spyOn(MetricService, "aggregateBy")
        .mockResolvedValue(aggregate({ "web_vital.lcp": value as number }));
      const result: ToolExecutionResult = await QueryRumWebVitalsTool.execute(
        args,
        context(),
      );
      expect(widgetRows(result)[0]?.["rating"]).toBe(expected);
    },
  );

  test("defaults to 24 hours and clamps oversized windows to 30 days", async () => {
    const fetch: jest.SpyInstance = jest
      .spyOn(MetricService, "aggregateBy")
      .mockResolvedValue(aggregate({}));
    await QueryRumWebVitalsTool.execute(
      {
        rumApplicationId: applicationId.toString(),
        endTime: end.toISOString(),
      },
      context(),
    );
    expect(fetch.mock.calls[0]![0]).toMatchObject({
      startTimestamp: start,
      endTimestamp: end,
    });
    await QueryRumWebVitalsTool.execute(
      { ...args, startTime: "2020-01-01T00:00:00.000Z" },
      context(),
    );
    expect(fetch.mock.calls[4]![0]).toMatchObject({
      startTimestamp: new Date(end.getTime() - 30 * 86400000),
      endTimestamp: end,
    });
    expect(fetch.mock.calls[5]![0]).toMatchObject({
      startTimestamp: new Date(end.getTime() - 60 * 86400000),
      endTimestamp: new Date(end.getTime() - 30 * 86400000),
    });
  });

  test.each([
    { startTime: "invalid" },
    { endTime: "invalid" },
    { startTime: end.toISOString() },
    { startTime: "2027-01-01T00:00:00Z" },
    { vital: "unknown" },
    { rumApplicationId: "not-an-id" },
    { rumApplicationId: "" },
    { rumApplicationId: 123 },
    { rumApplicationId: null },
  ])(
    "rejects invalid arguments before database access: %p",
    async (overrides: JSONObject) => {
      const fetch: jest.SpyInstance = jest
        .spyOn(MetricService, "aggregateBy")
        .mockResolvedValue(aggregate({}));
      await expect(
        QueryRumWebVitalsTool.execute({ ...args, ...overrides }, context()),
      ).rejects.toThrow();
      expect(fetch).not.toHaveBeenCalled();
      expect(RumApplicationService.findOneBy).not.toHaveBeenCalled();
    },
  );

  test("does not read metrics for a missing or inaccessible application", async () => {
    jest.mocked(RumApplicationService.findOneBy).mockResolvedValue(null);
    const fetch: jest.SpyInstance = jest
      .spyOn(MetricService, "aggregateBy")
      .mockResolvedValue(aggregate({}));
    await expect(
      QueryRumWebVitalsTool.execute(args, context()),
    ).rejects.toThrow("not found or is not accessible");
    expect(fetch).not.toHaveBeenCalled();
  });

  test("propagates metric permission failures rather than retrying as root", async () => {
    const fetch: jest.SpyInstance = jest
      .spyOn(MetricService, "aggregateBy")
      .mockRejectedValue(new Error("Metric permission denied"));
    const ctx: ToolContext = context([Permission.ReadRumApplication]);
    await expect(QueryRumWebVitalsTool.execute(args, ctx)).rejects.toThrow(
      "Metric permission denied",
    );
    expect(
      fetch.mock.calls.every(
        (call: Array<{ props: DatabaseCommonInteractionProps }>) => {
          return call[0]?.props === ctx.props;
        },
      ),
    ).toBe(true);
  });

  test.each([true, false])(
    "rejects truncated data from the %p current-window branch",
    async (currentTruncated: boolean) => {
      mockAverages(
        {
          ...aggregate({ "web_vital.lcp": 2 }),
          truncated: currentTruncated,
        },
        {
          ...aggregate({ "web_vital.lcp": 1 }),
          truncated: !currentTruncated,
        },
      );
      await expect(
        QueryRumWebVitalsTool.execute(args, context()),
      ).rejects.toThrow("incomplete data");
    },
  );
});

describe("RUM tools through the real toolbox authorization and execution path", () => {
  test.each(["query_rum_applications", "query_rum_web_vitals"])(
    "registers %s in read-only mode",
    (name: string) => {
      expect(
        AIToolbox.getLlmToolDefinitions(AIChatPermissionMode.ReadOnly).some(
          (definition: { name: string }) => {
            return definition.name === name;
          },
        ),
      ).toBe(true);
      expect(AIToolbox.isMutationTool(name)).toBe(false);
    },
  );

  test("executes the app-to-vitals workflow without elevating either query", async () => {
    const ctx: ToolContext = context();
    jest
      .spyOn(RumApplicationService, "findBy")
      .mockResolvedValue([application()]);
    jest
      .spyOn(RumApplicationService, "findOneBy")
      .mockResolvedValue(application());
    const fetch: jest.SpyInstance = jest
      .spyOn(MetricService, "aggregateBy")
      .mockResolvedValue(aggregate({ "web_vital.lcp": 3000 }));
    const discovered: ToolCallOutcome = await AIToolbox.executeTool({
      name: "query_rum_applications",
      args: {},
      ctx: ctx,
    });
    const vitals: ToolCallOutcome = await AIToolbox.executeTool({
      name: "query_rum_web_vitals",
      args: args,
      ctx: ctx,
    });
    expect(discovered.success).toBe(true);
    expect(discovered.result?.dataForLlm).toContain(applicationId.toString());
    expect(vitals.success).toBe(true);
    expect(vitals.result?.rowCount).toBe(1);
    expect(fetch.mock.calls[0]![0].props).toBe(ctx.props);
  });

  test.each(["query_rum_applications", "query_rum_web_vitals"])(
    "denies %s before any data access without a grant or with a blocking grant",
    async (name: string) => {
      const find: jest.SpyInstance = jest
        .spyOn(RumApplicationService, "findBy")
        .mockResolvedValue([]);
      const findOne: jest.SpyInstance = jest
        .spyOn(RumApplicationService, "findOneBy")
        .mockResolvedValue(null);
      const fetch: jest.SpyInstance = jest
        .spyOn(MetricService, "aggregateBy")
        .mockResolvedValue(aggregate({}));
      for (const ctx of [
        context([]),
        context([Permission.ProjectMember], [Permission.ReadRumApplication]),
      ]) {
        expect(
          (await AIToolbox.executeTool({ name: name, args: args, ctx: ctx }))
            .success,
        ).toBe(false);
      }
      expect(find).not.toHaveBeenCalled();
      expect(findOne).not.toHaveBeenCalled();
      expect(fetch).not.toHaveBeenCalled();
    },
  );

  test.each(["query_rum_applications", "query_rum_web_vitals"])(
    "denies %s for cross-project and multi-tenant contexts",
    async (name: string) => {
      const find: jest.SpyInstance = jest
        .spyOn(RumApplicationService, "findBy")
        .mockResolvedValue([]);
      const findOne: jest.SpyInstance = jest
        .spyOn(RumApplicationService, "findOneBy")
        .mockResolvedValue(null);
      const ctx: ToolContext = context();
      expect(
        (
          await AIToolbox.executeTool({
            name: name,
            args: args,
            ctx: { ...ctx, projectId: otherApplicationId },
          })
        ).success,
      ).toBe(false);
      expect(
        (
          await AIToolbox.executeTool({
            name: name,
            args: args,
            ctx: {
              ...ctx,
              props: { ...ctx.props, isMultiTenantRequest: true },
            },
          })
        ).success,
      ).toBe(false);
      expect(find).not.toHaveBeenCalled();
      expect(findOne).not.toHaveBeenCalled();
    },
  );
});

describe("RUM browser trace scoping", () => {
  test.each([
    [[applicationId], applicationId.toString()],
    [[otherApplicationId], ObjectID.getZeroObjectID().toString()],
    [[], ObjectID.getZeroObjectID().toString()],
  ])(
    "intersects an application request with owned/label-scoped analytics access",
    async (allowed: unknown, expected: unknown) => {
      jest
        .spyOn(ModelPermission, "getAccessibleServiceIdsForAnalyticsModel")
        .mockResolvedValue(allowed as Array<ObjectID>);
      const query: jest.SpyInstance = jest
        .spyOn(TraceAggregationService, "getAnalyticsTable")
        .mockResolvedValue([]);
      await QueryTracesTool.execute(
        { serviceId: applicationId.toString(), rootOnly: true },
        context(),
      );
      expect(
        query.mock.calls[0]![0].serviceIds.map((id: ObjectID) => {
          return id.toString();
        }),
      ).toEqual([expected]);
      expect(query.mock.calls[0]![0].projectId).toEqual(projectId);
      expect(query.mock.calls[0]![0].rootOnly).toBe(true);
    },
  );
});
