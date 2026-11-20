import {
  ProjectMetricsQueryAnswer,
  mayReadProjectMetrics,
  runProjectMetricsQuery,
  runPromQLOverProjectMetrics,
} from "../../../../Server/Utils/PromQL/PromQLDataSourceQuery";
import { JSONObject } from "../../../../Types/JSON";
import TelemetryReadAccess from "../../../../Server/Utils/Telemetry/TelemetryReadAccess";
import { getMetricReadPermissions } from "../../../../Server/Utils/Telemetry/MetricReadPermissions";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import AggregatedModel from "../../../../Types/BaseDatabase/AggregatedModel";
import { DataSourceResultKind } from "../../../../Types/DataSource/DataSourceQueryConfig";
import { DATA_SOURCE_MAX_SERIES } from "../../../../Types/DataSource/DataSourceLimits";
import BadDataException from "../../../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../../../Types/Exception/NotAuthorizedException";
import ObjectID from "../../../../Types/ObjectID";
import Permission from "../../../../Types/Permission";
import {
  PromQLSeries,
  PromQLSeriesSelection,
  PromQLSeriesSource,
} from "../../../../Utils/PromQL/PromQLEngineTypes";
import {
  PromQLLabelsTest,
  compilePromQLMatchers,
} from "../../../../Utils/PromQL/PromQLLabels";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import type { SpyInstance } from "jest-mock";

/*
 * The data source widgets' built-in source (issue #7713): a widget's
 * PromQL over the project's own metrics, as the person looking at the
 * dashboard, answered in the shape an outside Prometheus' answer takes for
 * the same widgets.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "0b000000-0000-4000-8000-000000000001",
);
const START_MS: number = Date.UTC(2026, 10, 20, 8, 0, 0);

// A member who may read the project's metrics, or one who may not.
const memberProps: (
  permissions: Array<Permission>,
) => DatabaseCommonInteractionProps = (
  permissions: Array<Permission>,
): DatabaseCommonInteractionProps => {
  return {
    tenantId: PROJECT_ID,
    userId: ObjectID.generate(),
    userTenantAccessPermission: {
      [PROJECT_ID.toString()]: {
        _type: "UserTenantAccessPermission",
        projectId: PROJECT_ID,
        permissions: permissions.map((permission: Permission) => {
          return {
            _type: "UserPermission",
            permission,
            labelIds: [],
            isBlockPermission: false,
          };
        }),
      },
    },
    userGlobalAccessPermission: {
      _type: "UserGlobalAccessPermission",
      globalPermissions: [Permission.Public, Permission.User],
      projectIds: [PROJECT_ID],
    },
  } as unknown as DatabaseCommonInteractionProps;
};

// Two services' request rates, a sample a minute for an hour.
class HeldSeries implements PromQLSeriesSource {
  public selections: Array<PromQLSeriesSelection> = [];

  public async select(
    selection: PromQLSeriesSelection,
  ): Promise<Array<PromQLSeries>> {
    this.selections.push(selection);
    const accepts: PromQLLabelsTest = compilePromQLMatchers(selection.matchers);

    return [
      { job: "api", value: 5 },
      { job: "worker", value: 2 },
    ]
      .map((item: { job: string; value: number }): PromQLSeries => {
        const timestampsMs: Array<number> = [];
        const values: Array<number> = [];

        for (let minute: number = 0; minute <= 60; minute++) {
          const atMs: number = START_MS + minute * 60000;

          if (atMs > selection.startTimeMs && atMs <= selection.endTimeMs) {
            timestampsMs.push(atMs);
            values.push(item.value);
          }
        }

        return {
          labels: { __name__: "requests", job: item.job },
          timestampsMs,
          values,
        };
      })
      .filter((series: PromQLSeries): boolean => {
        return accepts(series.labels) && series.values.length > 0;
      });
  }
}

const run: (data: {
  query: string;
  resultKind: DataSourceResultKind;
  props?: DatabaseCommonInteractionProps;
  stepInSeconds?: number;
  source?: PromQLSeriesSource;
}) => Promise<ProjectMetricsQueryAnswer> = (data: {
  query: string;
  resultKind: DataSourceResultKind;
  props?: DatabaseCommonInteractionProps;
  stepInSeconds?: number;
  source?: PromQLSeriesSource;
}): Promise<ProjectMetricsQueryAnswer> => {
  return runProjectMetricsQuery({
    props: data.props || memberProps(getMetricReadPermissions()),
    query: data.query,
    resultKind: data.resultKind,
    startDate: new Date(START_MS + 30 * 60000),
    endDate: new Date(START_MS + 40 * 60000),
    stepInSeconds: data.stepInSeconds,
    source: data.source || new HeldSeries(),
  });
};

describe("who may run PromQL over the project's metrics", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("a role that reads metrics, the wildcard, root and a master admin", () => {
    expect(mayReadProjectMetrics(memberProps(getMetricReadPermissions()))).toBe(
      true,
    );
    expect(
      mayReadProjectMetrics(
        memberProps([Permission.ReadAllOperationalResources]),
      ),
    ).toBe(true);
    expect(mayReadProjectMetrics({ isRoot: true })).toBe(true);
    expect(mayReadProjectMetrics({ isMasterAdmin: true })).toBe(true);
  });

  test("a member who may not read metrics is refused, and nothing is read", async () => {
    const source: HeldSeries = new HeldSeries();

    expect(mayReadProjectMetrics(memberProps([]))).toBe(false);
    await expect(
      run({
        query: "requests",
        resultKind: DataSourceResultKind.TimeSeries,
        props: memberProps([]),
        source,
      }),
    ).rejects.toThrow(NotAuthorizedException);
    expect(source.selections).toEqual([]);
  });

  test("a request with no project is refused", async () => {
    await expect(
      runProjectMetricsQuery({
        props: { userId: ObjectID.generate() },
        query: "requests",
        resultKind: DataSourceResultKind.TimeSeries,
        startDate: new Date(START_MS),
        endDate: new Date(START_MS + 60000),
      }),
    ).rejects.toThrow(BadDataException);
  });

  test("the project's metrics are read for the services the person may read", async () => {
    const serviceFilter: SpyInstance<
      typeof TelemetryReadAccess.getServiceFilter
    > = jest
      .spyOn(TelemetryReadAccess, "getServiceFilter")
      .mockRejectedValue(new Error("stop after the scope") as never);

    await expect(
      runProjectMetricsQuery({
        props: memberProps(getMetricReadPermissions()),
        query: "requests",
        resultKind: DataSourceResultKind.TimeSeries,
        startDate: new Date(START_MS),
        endDate: new Date(START_MS + 60000),
      }),
    ).rejects.toThrow("stop after the scope");
    expect(serviceFilter).toHaveBeenCalledTimes(1);
    expect(serviceFilter.mock.calls[0]![0].props.tenantId).toEqual(PROJECT_ID);
  });
});

describe("a chart's, a value's and a gauge's answer", () => {
  test("every step of the window, one series per label set, named by its labels", async () => {
    const answer: ProjectMetricsQueryAnswer = await run({
      query: "requests",
      resultKind: DataSourceResultKind.TimeSeries,
      stepInSeconds: 300,
    });

    expect(answer.resultKind).toBe(DataSourceResultKind.TimeSeries);

    const points: Array<AggregatedModel> =
      answer.resultKind === DataSourceResultKind.TimeSeries
        ? answer.result.data
        : [];

    // 30 to 40 minutes in, every 5 minutes: 3 steps, for each of 2 series.
    expect(points).toHaveLength(6);
    expect(points[0]).toEqual({
      timestamp: new Date(START_MS + 30 * 60000),
      value: 5,
      // The legend's {{job}} reads it; the name is no label of a series.
      attributes: { job: "api" },
    });
    expect(
      points.map((point: AggregatedModel): string => {
        return (point["attributes"] as Record<string, string>)["job"]!;
      }),
    ).toEqual(["api", "api", "api", "worker", "worker", "worker"]);
    expect(answer.result.truncated).toBe(false);
  });

  test("an aggregation is one series with no labels", async () => {
    const answer: ProjectMetricsQueryAnswer = await run({
      query: "sum(requests)",
      resultKind: DataSourceResultKind.TimeSeries,
      stepInSeconds: 600,
    });

    expect(answer.result).toEqual({
      data: [
        { timestamp: new Date(START_MS + 30 * 60000), value: 7 },
        { timestamp: new Date(START_MS + 40 * 60000), value: 7 },
      ],
      truncated: false,
    });
  });

  test("without a step, about 250 points across the window, never under 10s", async () => {
    const source: HeldSeries = new HeldSeries();

    const answer: ProjectMetricsQueryAnswer = await run({
      query: "sum(requests)",
      resultKind: DataSourceResultKind.TimeSeries,
      source,
    });

    // Ten minutes over 250 buckets is 2.4s, held to the 10s floor: 61 points.
    expect(
      answer.resultKind === DataSourceResultKind.TimeSeries
        ? answer.result.data.length
        : 0,
    ).toBe(61);
  });

  test(`more than ${DATA_SOURCE_MAX_SERIES} series are cut, and said to be`, async () => {
    const many: PromQLSeriesSource = {
      select: async (): Promise<Array<PromQLSeries>> => {
        return Array.from({ length: DATA_SOURCE_MAX_SERIES + 5 }).map(
          (_item: unknown, index: number): PromQLSeries => {
            return {
              labels: { __name__: "x", pod: `pod-${index}` },
              timestampsMs: [START_MS + 38 * 60000],
              values: [1],
            };
          },
        );
      },
    };

    const answer: ProjectMetricsQueryAnswer = await run({
      query: "x",
      resultKind: DataSourceResultKind.TimeSeries,
      stepInSeconds: 600,
      source: many,
    });

    expect(answer.result.truncated).toBe(true);
  });
});

describe("a query written for Grafana (issue #7697)", () => {
  test("its interval and range macros are filled from the window and step it runs at", async () => {
    const source: HeldSeries = new HeldSeries();

    // A 5-minute step: $__rate_interval is 5m + 15s, the range 10 minutes.
    const answer: ProjectMetricsQueryAnswer = await run({
      query: "sum(avg_over_time(requests[$__rate_interval])) + 0 * $__range_s",
      resultKind: DataSourceResultKind.TimeSeries,
      stepInSeconds: 300,
      source,
    });

    expect(
      answer.resultKind === DataSourceResultKind.TimeSeries
        ? answer.result.data
        : [],
    ).toHaveLength(3);
    // Each step read back the rate interval's 315 seconds.
    const last: PromQLSeriesSelection | undefined =
      source.selections[source.selections.length - 1];

    expect(last).toBeDefined();
    expect(
      (last?.endTimeMs || 0) - (last?.startTimeMs || 0),
    ).toBeGreaterThanOrEqual(10 * 60000 + 315000);
  });

  test("a table reads them at the end of the window", async () => {
    const answer: ProjectMetricsQueryAnswer = await run({
      query: "sum(avg_over_time(requests[$__range]))",
      resultKind: DataSourceResultKind.Table,
    });

    expect(answer.resultKind).toBe(DataSourceResultKind.Table);
    expect(
      answer.resultKind === DataSourceResultKind.Table
        ? answer.result.rows[0]?.["value"]
        : undefined,
    ).toBe(7);
  });
});

describe("a table's answer", () => {
  test("each series' value at the end of the window, a column per label", async () => {
    const answer: ProjectMetricsQueryAnswer = await run({
      query: "requests",
      resultKind: DataSourceResultKind.Table,
    });

    expect(answer.resultKind).toBe(DataSourceResultKind.Table);
    expect(answer.result).toEqual({
      columns: [
        { key: "__name__", title: "__name__", type: "Text" },
        { key: "job", title: "job", type: "Text" },
        { key: "value", title: "value", type: "Number" },
        { key: "timestamp", title: "timestamp", type: "Date" },
      ],
      rows: [
        {
          __name__: "requests",
          job: "api",
          value: 5,
          timestamp: new Date(START_MS + 40 * 60000).toISOString(),
        },
        {
          __name__: "requests",
          job: "worker",
          value: 2,
          timestamp: new Date(START_MS + 40 * 60000).toISOString(),
        },
      ],
      truncated: false,
    });
  });
});

describe("a query that cannot run says why", () => {
  test.each([
    ["rate(requests)", /^The PromQL query did not run\. .+/],
    ["sum(", /^The PromQL query did not run\. .+/],
    ["requests[5m]", /^The PromQL query did not run\. A chart over time/],
  ])("%s", async (query: string, message: RegExp) => {
    await expect(
      run({ query, resultKind: DataSourceResultKind.TimeSeries }),
    ).rejects.toThrow(message);
    await expect(
      run({ query, resultKind: DataSourceResultKind.TimeSeries }),
    ).rejects.toThrow(BadDataException);
  });
});

describe("a PromQL monitor's charts (issue #10227)", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  const runNarrowed: (data: {
    seriesLabels: JSONObject;
    source?: PromQLSeriesSource;
    query?: string;
  }) => Promise<ProjectMetricsQueryAnswer> = (data: {
    seriesLabels: JSONObject;
    source?: PromQLSeriesSource;
    query?: string;
  }): Promise<ProjectMetricsQueryAnswer> => {
    return runProjectMetricsQuery({
      props: memberProps(getMetricReadPermissions()),
      query: data.query || "requests",
      resultKind: DataSourceResultKind.TimeSeries,
      startDate: new Date(START_MS + 30 * 60000),
      endDate: new Date(START_MS + 40 * 60000),
      stepInSeconds: 300,
      seriesLabels: data.seriesLabels,
      source: data.source || new HeldSeries(),
    });
  };

  const jobsOf: (answer: ProjectMetricsQueryAnswer) => Array<string> = (
    answer: ProjectMetricsQueryAnswer,
  ): Array<string> => {
    return (
      answer.resultKind === DataSourceResultKind.TimeSeries
        ? answer.result.data
        : []
    ).map((point: AggregatedModel): string => {
      return (point["attributes"] as Record<string, string>)["job"]!;
    });
  };

  test("an incident's chart reads the one series that opened it, named as the monitor names it", async () => {
    // Without __name__, as the monitor names a series it opens one for.
    expect(jobsOf(await runNarrowed({ seriesLabels: { job: "worker" } }))).toEqual(
      ["worker", "worker", "worker"],
    );
  });

  test("a series named with __name__, where the check needed it, is found by it too; labels no series has find none", async () => {
    expect(
      jobsOf(
        await runNarrowed({
          seriesLabels: { __name__: "requests", job: "api" },
        }),
      ),
    ).toEqual(["api", "api", "api"]);

    // A label more than the series has: another series.
    expect(
      (await runNarrowed({ seriesLabels: { job: "api", pod: "api-1" } }))
        .result,
    ).toEqual({ data: [], truncated: false });
  });

  test(`the one series is kept before the cap of ${DATA_SOURCE_MAX_SERIES}, wherever it comes`, async () => {
    const wanted: number = DATA_SOURCE_MAX_SERIES + 40;
    const many: PromQLSeriesSource = {
      select: async (): Promise<Array<PromQLSeries>> => {
        return Array.from({ length: DATA_SOURCE_MAX_SERIES + 50 }).map(
          (_item: unknown, index: number): PromQLSeries => {
            return {
              labels: { __name__: "x", pod: `pod-${index}` },
              timestampsMs: [START_MS + 38 * 60000],
              values: [index],
            };
          },
        );
      },
    };

    const answer: ProjectMetricsQueryAnswer = await runNarrowed({
      query: "x",
      seriesLabels: { pod: `pod-${wanted}` },
      source: many,
    });

    expect(answer.result.truncated).toBe(false);
    expect(
      (answer.resultKind === DataSourceResultKind.TimeSeries
        ? answer.result.data
        : []
      ).map((point: AggregatedModel): unknown => {
        return [point.value, point["attributes"]];
      }),
    ).toEqual([[wanted, { pod: `pod-${wanted}` }]]);
  });

  test("the services the monitor reads are asked for among those the person may read", async () => {
    const serviceFilter: SpyInstance<
      typeof TelemetryReadAccess.getServiceFilter
    > = jest
      .spyOn(TelemetryReadAccess, "getServiceFilter")
      .mockRejectedValue(new Error("stop after the scope") as never);

    const serviceId: string = "0f8fad5b-d9cb-469f-a165-70867728950e";

    const runFor: (serviceIds: Array<string>) => Promise<unknown> = (
      serviceIds: Array<string>,
    ): Promise<unknown> => {
      return runProjectMetricsQuery({
        props: memberProps(getMetricReadPermissions()),
        query: "requests",
        resultKind: DataSourceResultKind.TimeSeries,
        startDate: new Date(START_MS),
        endDate: new Date(START_MS + 60000),
        serviceIds,
      });
    };

    await expect(runFor([serviceId])).rejects.toThrow("stop after the scope");
    expect(serviceFilter.mock.calls[0]![0].requested).toEqual([serviceId]);

    // None named: every service the person may read.
    await expect(runFor([])).rejects.toThrow("stop after the scope");
    expect(serviceFilter.mock.calls[1]![0].requested).toBeUndefined();
  });

  test("a member who may not read metrics is told which roles can", async () => {
    await expect(
      run({
        query: "requests",
        resultKind: DataSourceResultKind.TimeSeries,
        props: memberProps([]),
      }),
    ).rejects.toThrow(
      "You do not have permission to read this project's metrics. Ask a Project Owner or Project Admin for a role that reads telemetry.",
    );
  });
});

describe("PromQL over a project's metrics for a public dashboard (issue #10226)", () => {
  test("reads with the same engine, step and caps as the signed-in route", async () => {
    const source: HeldSeries = new HeldSeries();

    const answer: ProjectMetricsQueryAnswer = await runPromQLOverProjectMetrics(
      {
        projectId: PROJECT_ID,
        serviceFilter: {},
        query: "sum(requests)",
        resultKind: DataSourceResultKind.TimeSeries,
        startDate: new Date(START_MS + 30 * 60000),
        endDate: new Date(START_MS + 40 * 60000),
        source,
      },
    );

    // Ten minutes over 250 buckets, held to the 10s floor: 61 points.
    expect(
      answer.resultKind === DataSourceResultKind.TimeSeries
        ? answer.result.data.length
        : 0,
    ).toBe(61);
    expect(source.selections.length).toBeGreaterThan(0);
  });

  test("a query that does not parse says so, and reads nothing", async () => {
    const source: HeldSeries = new HeldSeries();

    await expect(
      runPromQLOverProjectMetrics({
        projectId: PROJECT_ID,
        serviceFilter: {},
        query: "sum(requests",
        resultKind: DataSourceResultKind.TimeSeries,
        startDate: new Date(START_MS),
        endDate: new Date(START_MS + 60000),
        source,
      }),
    ).rejects.toThrow("The PromQL query did not run.");
    expect(source.selections).toEqual([]);
  });
});
