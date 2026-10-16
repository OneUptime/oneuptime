import { afterEach, beforeEach, describe, expect, jest, test } from "@jest/globals";
import type { SpyInstance } from "jest-mock";
import Metric from "../../../../../Models/AnalyticsModels/Metric";
import MetricBaselineService from "../../../../../Server/Services/MetricBaselineService";
import MetricService from "../../../../../Server/Services/MetricService";
import AggregateBy from "../../../../../Server/Types/AnalyticsDatabase/AggregateBy";
import ModelPermission from "../../../../../Server/Types/AnalyticsDatabase/ModelPermission";
import {
  BaselineAnomalyTool,
  QueryMetricsTool,
} from "../../../../../Server/Utils/AI/Toolbox/MetricTools";
import { MAX_METRIC_SERIES } from "../../../../../Server/Utils/AI/Toolbox/MetricAttributeQuery";
import {
  ToolContext,
  ToolExecutionResult,
} from "../../../../../Server/Utils/AI/Toolbox/ToolTypes";
import {
  AIChatWidgetSeries,
  AIChatWidgetType,
} from "../../../../../Types/AI/AIChatTypes";
import AggregatedModel from "../../../../../Types/BaseDatabase/AggregatedModel";
import AggregatedResult from "../../../../../Types/BaseDatabase/AggregatedResult";
import AggregationInterval from "../../../../../Types/BaseDatabase/AggregationInterval";
import AggregationType from "../../../../../Types/BaseDatabase/AggregationType";
import DatabaseCommonInteractionProps from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { JSONObject } from "../../../../../Types/JSON";
import ObjectID from "../../../../../Types/ObjectID";
import Permission from "../../../../../Types/Permission";

/*
 * query_metrics BY ATTRIBUTE (issue #4784).
 *
 * The customer's host was out of CPU and the investigation reported
 * "system.cpu.utilization is flat at about 0.125 every minute" - one average
 * across the CPU states, which always add up to 1. query_metrics now reads
 * that metric one series per state unless asked otherwise, and takes an
 * attribute filter and a groupBy like the metric explorer.
 *
 * And every read names the project: an autonomous investigation reads as
 * OneUptime itself, whose props carry no tenant for the model layer to add.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const START: string = "2026-10-16T13:00:00.000Z";
const END: string = "2026-10-16T13:10:00.000Z";

// An autonomous investigation's tool context, before the engine set a tenant.
const ROOT_RUN: ToolContext = { projectId: PROJECT_ID, props: { isRoot: true } };

function memberContext(): ToolContext {
  return {
    projectId: PROJECT_ID,
    props: {
      tenantId: PROJECT_ID,
      userId: ObjectID.generate(),
      userGlobalAccessPermission: {
        globalPermissions: [Permission.Public],
        projectIds: [PROJECT_ID],
        _type: "UserGlobalAccessPermission",
      },
      userTenantAccessPermission: {
        [PROJECT_ID.toString()]: {
          projectId: PROJECT_ID,
          _type: "UserTenantAccessPermission",
          permissions: [
            {
              permission: Permission.ProjectMember,
              labelIds: [],
              isBlockPermission: false,
              _type: "UserPermission",
            },
          ],
        },
      },
    } as unknown as DatabaseCommonInteractionProps,
  };
}

function cpuRow(state: string, minute: number, value: number): AggregatedModel {
  return {
    timestamp: new Date(new Date(START).getTime() + minute * 60000),
    value,
    attributes: { state, "cpu.mode": "" },
  } as AggregatedModel;
}

// The bucket averages of a host whose CPUs are saturated.
const SATURATED_HOST: Array<AggregatedModel> = [
  cpuRow("user", 0, 0.92),
  cpuRow("user", 1, 0.94),
  cpuRow("system", 0, 0.05),
  cpuRow("system", 1, 0.05),
  cpuRow("idle", 0, 0.01),
  cpuRow("idle", 1, 0),
];

let aggregate: SpyInstance<typeof MetricService.aggregateBy>;
let requests: Array<AggregateBy<Metric>>;

function answerWith(
  data: Array<AggregatedModel>,
  extra: Partial<AggregatedResult> = {},
): void {
  aggregate.mockImplementation(
    async (request: AggregateBy<Metric>): Promise<AggregatedResult> => {
      requests.push(request);

      if (request.aggregationType === AggregationType.Count) {
        return {
          data: data.map((item: AggregatedModel): AggregatedModel => {
            return { ...item, value: 2 };
          }),
          ...extra,
        };
      }

      return { data, ...extra };
    },
  );
}

beforeEach(() => {
  requests = [];
  aggregate = jest
    .spyOn(MetricService, "aggregateBy")
    .mockImplementation(
      async (request: AggregateBy<Metric>): Promise<AggregatedResult> => {
        requests.push(request);
        return { data: [] };
      },
    );
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("every read names the project", () => {
  test.each([
    ["an autonomous investigation (root, no tenant)", ROOT_RUN],
    ["a member's chat", memberContext()],
  ])("%s", async (_label: string, ctx: ToolContext) => {
    for (const args of [
      { metricName: "container.cpu.utilization" },
      { metricName: "system.cpu.utilization" },
      {
        metricName: "container.cpu.utilization",
        groupBy: ["resource.container.name"],
      },
    ]) {
      requests = [];
      await QueryMetricsTool.execute(
        { ...args, startTime: START, endTime: END },
        ctx,
      );

      expect(requests.length).toBeGreaterThan(0);

      for (const request of requests) {
        expect(
          (request.query as JSONObject)["projectId"]?.toString(),
        ).toBe(PROJECT_ID.toString());
        expect(request.props).toBe(ctx.props);
      }
    }
  });

  test("baseline_anomaly's own metric reads name it too", async () => {
    jest.spyOn(ModelPermission, "getReadScope").mockResolvedValue({
      readableIds: null,
      blockedIds: [],
    });
    jest.spyOn(MetricBaselineService, "getBaseline").mockResolvedValue({
      sampleCount: 50,
      mean: 10,
      stddev: 1,
      median: 10,
      p95: 12,
      minObserved: 7,
      maxObserved: 13,
      isReliable: true,
      windowDays: 14,
      hourOfWeek: 10,
    });
    jest.spyOn(MetricBaselineService, "getBandSeries").mockResolvedValue([
      {
        time: new Date(END),
        expectedLow: 7,
        expectedHigh: 13,
        mean: 10,
      } as never,
    ]);
    answerWith([{ timestamp: new Date(END), value: 11 } as AggregatedModel]);

    await BaselineAnomalyTool.execute(
      { metricName: "cpu.usage", atTime: END },
      ROOT_RUN,
    );

    // The current window and the chart's actual line.
    expect(requests).toHaveLength(2);
    for (const request of requests) {
      expect((request.query as JSONObject)["projectId"]).toBe(PROJECT_ID);
    }
  });
});

describe("a metric split by state, asked for as a whole", () => {
  test("system.cpu.utilization is read one series per state - a saturated host reads busy, not a flat 1/8", async () => {
    answerWith(SATURATED_HOST, { totalGroups: 3 });

    const result: ToolExecutionResult = await QueryMetricsTool.execute(
      { metricName: "system.cpu.utilization", startTime: START, endTime: END },
      ROOT_RUN,
    );

    // The grouped read: values and their counts, top series by peak.
    expect(requests).toHaveLength(2);
    expect(requests[0]!.groupByAttributeKeys).toEqual(["state", "cpu.mode"]);
    expect(requests[0]!.topK).toEqual({
      count: MAX_METRIC_SERIES,
      rankBy: "max",
    });
    expect(requests[0]!.aggregationType).toBe(AggregationType.Avg);
    expect(requests[1]!.aggregationType).toBe(AggregationType.Count);
    // A 10-minute window is read in 1-minute buckets.
    expect(requests[0]!.aggregationInterval).toBe(AggregationInterval.Minute);
    expect(requests[0]!.query).toEqual(
      expect.objectContaining({
        projectId: PROJECT_ID,
        name: "system.cpu.utilization",
      }),
    );
    expect((requests[0]!.query as JSONObject)["attributes"]).toBeUndefined();

    expect(result.dataForLlm).toContain(
      "series=state=user | min=0.92 | avg=0.93 | max=0.94 | latest=0.94 | trend=0.92 0.94",
    );
    expect(result.dataForLlm).toContain("series=state=idle");
    expect(result.dataForLlm).toContain(
      "system.cpu.utilization is reported once per state, so it was read one series per state",
    );
    expect(result.dataForLlm).toContain("Busy CPU is user + system");
    expect(result.dataForLlm).toContain(
      "3 series by state, cpu.mode, the highest peak first.",
    );
    expect(result.rowCount).toBe(3);
    expect(result.citationLabel).toBe(
      `Avg(system.cpu.utilization) by state, cpu.mode, ${START} – ${END}`,
    );
    expect(result.isTruncated).toBe(false);
    expect(result.widget?.type).toBe(AIChatWidgetType.TimeSeriesChart);
    expect(
      (
        (result.widget?.data as unknown as { series: Array<AIChatWidgetSeries> })
          .series || []
      ).map((series: AIChatWidgetSeries): string => {
        return series.name;
      }),
    ).toEqual(["state=user", "state=system", "state=idle"]);
  });

  test("a filter on one state reads that state as one series, with what it means", async () => {
    answerWith([
      { timestamp: new Date(START), value: 0.01 } as AggregatedModel,
    ]);

    const result: ToolExecutionResult = await QueryMetricsTool.execute(
      {
        metricName: "system.cpu.utilization",
        attributes: { state: "idle" },
        startTime: START,
        endTime: END,
      },
      ROOT_RUN,
    );

    expect(requests).toHaveLength(1);
    expect(requests[0]!.groupByAttributeKeys).toBeUndefined();
    expect((requests[0]!.query as JSONObject)["attributes"]).toEqual({
      state: "idle",
    });
    expect(result.dataForLlm).toContain(
      "idle near 0 means the CPUs are saturated",
    );
  });

  test("grouping it by host alone says each series still averages every state", async () => {
    answerWith([
      {
        timestamp: new Date(START),
        value: 0.125,
        attributes: { "resource.host.name": "web-1" },
      } as AggregatedModel,
    ]);

    const result: ToolExecutionResult = await QueryMetricsTool.execute(
      {
        metricName: "system.cpu.utilization",
        groupBy: ["resource.host.name"],
        startTime: START,
        endTime: END,
      },
      ROOT_RUN,
    );

    expect(requests[0]!.groupByAttributeKeys).toEqual(["resource.host.name"]);
    expect(result.dataForLlm).toContain(
      "Warning: system.cpu.utilization is reported once per state, and this read did not split it",
    );
  });
});

describe("attributes and groupBy on any metric", () => {
  test("an attribute filter narrows the read", async () => {
    await QueryMetricsTool.execute(
      {
        metricName: "container.cpu.utilization",
        attributes: { "resource.container.name": "api" },
        startTime: START,
        endTime: END,
      },
      ROOT_RUN,
    );

    expect(requests).toHaveLength(1);
    expect((requests[0]!.query as JSONObject)["attributes"]).toEqual({
      "resource.container.name": "api",
    });
  });

  test("groupBy reads one series per value, with no note about splits", async () => {
    answerWith([
      {
        timestamp: new Date(START),
        value: 197,
        attributes: { "resource.container.name": "api" },
      } as AggregatedModel,
      {
        timestamp: new Date(START),
        value: 3,
        attributes: { "resource.container.name": "db" },
      } as AggregatedModel,
    ]);

    const result: ToolExecutionResult = await QueryMetricsTool.execute(
      {
        metricName: "container.cpu.utilization",
        groupBy: ["resource.container.name"],
        aggregationType: "Max",
        startTime: START,
        endTime: END,
      },
      ROOT_RUN,
    );

    expect(requests[0]!.groupByAttributeKeys).toEqual([
      "resource.container.name",
    ]);
    expect(requests[0]!.aggregationType).toBe(AggregationType.Max);
    expect(result.dataForLlm).toContain(
      "series=resource.container.name=api | value=197",
    );
    expect(result.dataForLlm).not.toContain("reported once per");
  });

  test("an entity filter and an attribute filter apply together", async () => {
    const entityId: ObjectID = ObjectID.generate();

    await QueryMetricsTool.execute(
      {
        metricName: "system.memory.utilization",
        entityId: entityId.toString(),
        attributes: { state: "used" },
        startTime: START,
        endTime: END,
      },
      ROOT_RUN,
    );

    expect(requests[0]!.query).toEqual(
      expect.objectContaining({
        projectId: PROJECT_ID,
        primaryEntityId: entityId,
        attributes: { state: "used" },
      }),
    );
  });

  test("a grouped read over a day is read in buckets that fit a trend", async () => {
    await QueryMetricsTool.execute(
      {
        metricName: "container.memory.percent",
        groupBy: "resource.container.name",
        startTime: "2026-10-15T13:00:00.000Z",
        endTime: "2026-10-16T13:00:00.000Z",
      },
      ROOT_RUN,
    );

    expect(requests[0]!.aggregationInterval).toBe(
      AggregationInterval.ThirtyMinutes,
    );
  });

  test.each([
    [{ attributes: "state=idle" }, "attributes must be an object"],
    [{ groupBy: ["a", "b", "c", "d"] }, "groupBy takes at most 3"],
    [{ groupBy: [1] }, "groupBy must be a list of attribute keys"],
  ])(
    "refuses %j before reading anything",
    async (extra: JSONObject, message: string) => {
      await expect(
        QueryMetricsTool.execute(
          { metricName: "system.cpu.utilization", ...extra },
          ROOT_RUN,
        ),
      ).rejects.toThrow(message);
      expect(requests).toHaveLength(0);
    },
  );

  test("the schema offers both arguments and the description explains the split", () => {
    const properties: JSONObject = QueryMetricsTool.inputSchema[
      "properties"
    ] as JSONObject;

    expect(Object.keys(properties)).toEqual(
      expect.arrayContaining(["attributes", "groupBy"]),
    );
    expect(QueryMetricsTool.description).toContain(
      "CPU states always add up to 1",
    );
    expect(QueryMetricsTool.description).toContain(
      'groupBy ["resource.container.name"]',
    );
  });
});
