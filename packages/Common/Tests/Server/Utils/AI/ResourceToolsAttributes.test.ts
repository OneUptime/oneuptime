import "../../TestingUtils/Init";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";
import Metric from "../../../../Models/AnalyticsModels/Metric";
import DockerHostService from "../../../../Server/Services/DockerHostService";
import HostService from "../../../../Server/Services/HostService";
import MetricService from "../../../../Server/Services/MetricService";
import AggregateBy from "../../../../Server/Types/AnalyticsDatabase/AggregateBy";
import {
  QueryResourceTelemetryTool,
  mergeScopeAttributes,
} from "../../../../Server/Utils/AI/Toolbox/ResourceTools";
import { MAX_METRIC_SERIES } from "../../../../Server/Utils/AI/Toolbox/MetricAttributeQuery";
import {
  ToolContext,
  ToolExecutionResult,
} from "../../../../Server/Utils/AI/Toolbox/ToolTypes";
import { AIResourceType } from "../../../../Types/AI/AIResourceContext";
import { AIChatWidgetType } from "../../../../Types/AI/AIChatTypes";
import AggregatedModel from "../../../../Types/BaseDatabase/AggregatedModel";
import AggregatedResult from "../../../../Types/BaseDatabase/AggregatedResult";
import AggregationInterval from "../../../../Types/BaseDatabase/AggregationInterval";
import AggregationType from "../../../../Types/BaseDatabase/AggregationType";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import { keyForHost } from "../../../../Utils/Telemetry/EntityKey";

/*
 * query_resource_telemetry BY ATTRIBUTE (issue #4784).
 *
 * One resource's metrics, filtered and grouped by attribute - and the host
 * metrics the agent reports once per state read one series per state - while
 * the resource's own scope stays what it is: a filter may narrow a host's
 * telemetry, never point it at another runtime or another host.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const HOST_ID: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");
const START: string = "2026-10-16T13:00:00.000Z";
const END: string = "2026-10-16T14:00:00.000Z";
const ROOT_RUN: ToolContext = {
  projectId: PROJECT_ID,
  props: { isRoot: true, tenantId: PROJECT_ID },
};

let aggregate: SpyInstance<typeof MetricService.aggregateBy>;
let requests: Array<AggregateBy<Metric>>;
let answer: (request: AggregateBy<Metric>) => AggregatedResult;

function host(): JSONObject {
  return {
    _id: HOST_ID.toString(),
    name: "web-1",
    hostIdentifier: "web-1",
    isArchived: false,
    lastSeenAt: new Date(END),
  };
}

function args(type: AIResourceType, extra: JSONObject = {}): JSONObject {
  return {
    resourceType: type,
    resourceId: HOST_ID.toString(),
    signal: "metrics",
    startTime: START,
    endTime: END,
    ...extra,
  };
}

beforeEach(() => {
  requests = [];
  answer = (): AggregatedResult => {
    return { data: [] };
  };
  jest.spyOn(HostService, "findBy").mockResolvedValue([host()] as never);
  jest.spyOn(DockerHostService, "findBy").mockResolvedValue([host()] as never);
  aggregate = jest
    .spyOn(MetricService, "aggregateBy")
    .mockImplementation(
      async (request: AggregateBy<Metric>): Promise<AggregatedResult> => {
        requests.push(request);
        return answer(request);
      },
    );
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("a host's split metrics", () => {
  test("system.cpu.utilization on a host is read one series per state, inside the host's scope", async () => {
    answer = (request: AggregateBy<Metric>): AggregatedResult => {
      const rows: Array<AggregatedModel> = [
        {
          timestamp: new Date(START),
          value: request.aggregationType === AggregationType.Count ? 2 : 0.97,
          attributes: { state: "user", "cpu.mode": "" },
        } as AggregatedModel,
        {
          timestamp: new Date(START),
          value: request.aggregationType === AggregationType.Count ? 2 : 0,
          attributes: { state: "idle", "cpu.mode": "" },
        } as AggregatedModel,
      ];
      return { data: rows, totalGroups: 2 };
    };

    const result: ToolExecutionResult =
      await QueryResourceTelemetryTool.execute(
        args(AIResourceType.Host, { metricName: "system.cpu.utilization" }),
        ROOT_RUN,
      );

    expect(aggregate).toHaveBeenCalledTimes(2);
    const request: AggregateBy<Metric> = requests[0]!;

    expect(request.groupByAttributeKeys).toEqual(["state", "cpu.mode"]);
    expect(request.topK).toEqual({ count: MAX_METRIC_SERIES, rankBy: "max" });
    // An hour is read in 5-minute buckets, as every trend of this tool is.
    expect(request.aggregationInterval).toBe(AggregationInterval.FiveMinutes);
    expect(request.query).toEqual(
      expect.objectContaining({
        projectId: PROJECT_ID,
        name: "system.cpu.utilization",
        resourceEntityScopes: [
          {
            entityIds: [HOST_ID.toString()],
            entityKeys: [keyForHost(PROJECT_ID.toString(), "web-1")],
            attributeKey: "resource.host.name",
            attributeValues: ["web-1"],
          },
        ],
      }),
    );
    expect(result.dataForLlm).toContain("series=state=user | value=0.97");
    expect(result.dataForLlm).toContain(
      "system.cpu.utilization is reported once per state",
    );
    expect(result.dataForLlm).toContain(
      "Scope is the parent resource; no individual child identity or namespace was selected.",
    );
    // Named by the attribute the rows carry, before the window it read.
    expect(result.citationLabel).toBe(
      `Host metrics by state, ${START} – ${END}`,
    );
    expect(result.widget?.type).toBe(AIChatWidgetType.TimeSeriesChart);
    /*
     * What people read on the chart: what was read, and the window. The
     * scope note is the model's, in the result above, never the chart's.
     */
    expect(result.widget?.title).toBe("Avg of system.cpu.utilization by state");
    expect(result.widget?.description).toBe(`${START} – ${END}`);
    expect(result.widget?.description).not.toContain("Scope is");
    expect(
      (
        result.widget?.data as unknown as {
          series: Array<{ name: string }>;
        }
      ).series.map((series: { name: string }): string => {
        return series.name;
      }),
    ).toContain("user");
  });

  test("a whole-window summary of a split metric is one value per state, and no chart", async () => {
    answer = (): AggregatedResult => {
      return {
        data: [
          {
            timestamp: new Date(START),
            value: 0.81,
            attributes: { state: "used" },
          } as AggregatedModel,
        ],
      };
    };

    const result: ToolExecutionResult =
      await QueryResourceTelemetryTool.execute(
        args(AIResourceType.Host, {
          metricName: "system.memory.utilization",
          mode: "summary",
        }),
        ROOT_RUN,
      );

    expect(requests[0]!.aggregationInterval).toBe(AggregationInterval.Total);
    expect(requests[0]!.groupByAttributeKeys).toEqual([
      "state",
      "system.memory.state",
    ]);
    expect(result.dataForLlm).toContain("series=state=used | value=0.81");
    expect(result.dataForLlm).toContain("Each value covers the whole window.");
    expect(result.widget).toBeUndefined();
  });
});

describe("attributes and groupBy on a resource", () => {
  test("a Docker host's filter narrows its Docker metrics and never changes the runtime", async () => {
    await QueryResourceTelemetryTool.execute(
      args(AIResourceType.DockerHost, {
        metricName: "container.cpu.utilization",
        attributes: { "resource.container.name": "api" },
      }),
      ROOT_RUN,
    );

    expect((requests[0]!.query as JSONObject)["attributes"]).toEqual({
      "resource.container.name": "api",
      "resource.container.runtime": "docker",
    });
    expect(requests[0]!.groupByAttributeKeys).toBeUndefined();
  });

  test("a filter that would point a Docker host at another runtime is refused before any read", async () => {
    await expect(
      QueryResourceTelemetryTool.execute(
        args(AIResourceType.DockerHost, {
          metricName: "container.cpu.utilization",
          attributes: { "resource.container.runtime": "podman" },
        }),
        ROOT_RUN,
      ),
    ).rejects.toThrow(
      "resource.container.runtime is part of this resource's scope (docker)",
    );
    expect(aggregate).not.toHaveBeenCalled();
  });

  test("a container host's metrics grouped per container", async () => {
    answer = (request: AggregateBy<Metric>): AggregatedResult => {
      return {
        data: ["api", "db"].map((name: string): AggregatedModel => {
          return {
            timestamp: new Date(START),
            value:
              request.aggregationType === AggregationType.Count
                ? 1
                : name === "api"
                  ? 190
                  : 2,
            attributes: { "resource.container.name": name },
          } as AggregatedModel;
        }),
        totalGroups: 2,
      };
    };

    const result: ToolExecutionResult =
      await QueryResourceTelemetryTool.execute(
        args(AIResourceType.DockerHost, {
          metricName: "container.cpu.utilization",
          groupBy: ["resource.container.name"],
          mode: "summary",
        }),
        ROOT_RUN,
      );

    expect(requests[0]!.groupByAttributeKeys).toEqual([
      "resource.container.name",
    ]);
    expect(
      result.dataForLlm.indexOf("resource.container.name=api"),
    ).toBeLessThan(result.dataForLlm.indexOf("resource.container.name=db"));
    expect(result.dataForLlm).not.toContain("reported once per");
  });

  test("groupBy needs a metric name: discovery stays a list of names", async () => {
    await expect(
      QueryResourceTelemetryTool.execute(
        args(AIResourceType.Host, { groupBy: ["state"] }),
        ROOT_RUN,
      ),
    ).rejects.toThrow("groupBy needs a metricName");
    expect(aggregate).not.toHaveBeenCalled();
  });

  test("discovery takes an attribute filter and still groups by name only", async () => {
    await QueryResourceTelemetryTool.execute(
      args(AIResourceType.Host, { attributes: { state: "used" } }),
      ROOT_RUN,
    );

    expect(requests).toHaveLength(1);
    expect(requests[0]!.groupBy).toEqual({ name: true });
    expect(requests[0]!.groupByAttributeKeys).toBeUndefined();
    expect((requests[0]!.query as JSONObject)["attributes"]).toEqual({
      state: "used",
    });
  });

  test("the description no longer says containers cannot be ranked, and points at query_containers", () => {
    expect(QueryResourceTelemetryTool.description).not.toContain(
      "No child/pod/container rankings",
    );
    expect(QueryResourceTelemetryTool.description).toContain(
      "use query_containers",
    );
    expect(
      Object.keys(
        QueryResourceTelemetryTool.inputSchema["properties"] as JSONObject,
      ),
    ).toEqual(expect.arrayContaining(["attributes", "groupBy"]));
  });
});

describe("mergeScopeAttributes", () => {
  test("the scope wins and a caller's filter is added to it", () => {
    expect(
      mergeScopeAttributes(
        { "resource.container.runtime": "docker" },
        { "resource.container.name": "api" },
      ),
    ).toEqual({
      "resource.container.name": "api",
      "resource.container.runtime": "docker",
    });
  });

  test("the same value as the scope is no conflict", () => {
    expect(
      mergeScopeAttributes(
        { "resource.container.runtime": "docker" },
        { "resource.container.runtime": "docker" },
      ),
    ).toEqual({ "resource.container.runtime": "docker" });
  });

  test("no filter keeps the scope as it is; no scope keeps the filter", () => {
    const scope: Record<string, string> = { "resource.cloud.platform": "aws" };

    expect(mergeScopeAttributes(scope, undefined)).toBe(scope);
    expect(mergeScopeAttributes(undefined, { state: "idle" })).toEqual({
      state: "idle",
    });
    expect(mergeScopeAttributes(undefined, undefined)).toBeUndefined();
  });
});
