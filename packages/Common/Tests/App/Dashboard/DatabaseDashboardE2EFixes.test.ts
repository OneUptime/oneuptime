import { afterEach, describe, expect, jest, test } from "@jest/globals";
import {
  DatabaseMetricListValue,
  DatabaseQueryMetrics,
  DatabaseTimePoint,
  buildDatabaseSpanQuery,
  fetchDatabaseMetricListValues,
  fetchDatabaseQueryMetrics,
  getCompleteBucketSeries,
  getDatabaseConnectionSpanNameExclusions,
  getDatabaseMetricListCaption,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Database/Utils/DatabaseServerTelemetryQueries";
import {
  DATABASE_LIVENESS_DESCRIPTION,
  DATABASE_RUNTIME_METRICS,
  DatabaseEngineMetricsStatus,
  DatabaseLivenessStatus,
  formatDatabaseAxisNumber,
  formatDatabaseMetricAxisValue,
  formatDatabaseMetricUnitAxisValue,
  formatDatabaseMetricValue,
  formatDatabaseRuntimeAxisValue,
  formatDatabaseRuntimeValue,
  getDatabaseEngineMetricsStatusLabel,
  getDatabaseHeaderIdentifier,
  getDatabaseLivenessLabel,
  getDatabaseLivenessStatus,
  getDatabaseLivenessTone,
  getDatabaseMetricAxisUnitLabel,
  getDatabaseMetricUnitAxisLabel,
  getDatabaseRuntimeChartTitle,
  getDatabaseUnitSingular,
  isDatabaseServerFound,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Database/Utils/DatabaseServerPresentation";
import {
  getDatabaseServerInstanceMemberKeys,
  getDatabaseServerMemberScopeKeys,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Database/Utils/DatabaseTelemetryScope";
import { getDatabaseLastSeenText } from "../../../../App/FeatureSet/Dashboard/src/Components/DatabaseServer/DatabaseLastSeenCell";
import { getDatabaseEngineMetricChartTitle } from "../../../../App/FeatureSet/Dashboard/src/Components/DatabaseServer/DatabaseEngineMetricsSection";
import {
  DATABASE_METRIC_MONITOR_DESCRIPTION_PARAM,
  buildDatabaseMetricMonitorRoute,
  buildDatabaseMetricMonitorViewData,
  getDatabaseMetricMonitorDescription,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Database/Utils/DatabaseMetricMonitorLink";
import {
  DATABASE_WIDE_TABLE_MIN_WIDTH_PX,
  isDatabaseWideTableViewport,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Database/Utils/useDatabaseWideTable";
import AnalyticsModelAPI from "../../../UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI";
import DatabaseServer from "../../../Models/DatabaseModels/DatabaseServer";
import { SpanKind } from "../../../Models/AnalyticsModels/Span";
import AggregatedResult from "../../../Types/BaseDatabase/AggregatedResult";
import AggregationType from "../../../Types/BaseDatabase/AggregationType";
import IncludesNone from "../../../Types/BaseDatabase/IncludesNone";
import {
  DATABASE_CONNECTION_SPAN_NAMES,
  isDatabaseConnectionSpanName,
} from "../../../Types/DatabaseServer/DatabaseConnectionSpan";
import {
  DatabaseServerMetricDefinition,
  findDatabaseServerMetricByName,
} from "../../../Types/DatabaseServer/DatabaseServerMetricCatalog";

/*
 * Regression tests for what the end-to-end run of the Databases product
 * found on its pages, each built from the values it recorded (see the
 * individual cases). The rendered halves are in DatabaseOverviewHeader,
 * DatabaseTelemetryTabs, DatabaseServerComponents and
 * MetricsViewerEntityScopedRows.
 */

jest.mock("../../../UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI", () => {
  return {
    __esModule: true,
    default: {
      aggregate: jest.fn(),
      getList: jest.fn(),
    },
  };
});

interface AggregateRequest {
  modelType: unknown;
  aggregateBy: Record<string, unknown>;
}

type AggregateMock = jest.Mock<Promise<AggregatedResult>, [AggregateRequest]>;

const aggregateMock: AggregateMock =
  AnalyticsModelAPI.aggregate as unknown as AggregateMock;

// The e2e project and pg16's keys (row key, endpoint key).
const PROJECT_ID: string = "21075038-d9f1-4d3a-b878-f64ae861f7be";
const PG16_KEYS: Array<string> = ["35b0817780236296", "4368de1139c723fd"];

afterEach(() => {
  aggregateMock.mockReset();
});

describe("the Overview header's liveness pill", () => {
  const NOW: Date = new Date("2026-09-25T01:12:00.000Z");

  test("reads 'Seen recently' / 'Not seen recently' / 'Never seen', never an engine-metrics word", () => {
    // orders-db (42b6aaae): last seen 01:10, engine metrics never connected.
    const seen: DatabaseLivenessStatus = getDatabaseLivenessStatus(
      new Date("2026-09-25T01:10:00.466Z"),
      NOW,
    );
    const stale: DatabaseLivenessStatus = getDatabaseLivenessStatus(
      new Date("2026-09-24T22:35:00.393Z"),
      NOW,
    );
    const never: DatabaseLivenessStatus = getDatabaseLivenessStatus(null, NOW);

    expect(getDatabaseLivenessLabel(seen)).toBe("Seen recently");
    expect(getDatabaseLivenessTone(seen)).toBe("positive");
    expect(getDatabaseLivenessLabel(stale)).toBe("Not seen recently");
    expect(getDatabaseLivenessTone(stale)).toBe("warning");
    expect(getDatabaseLivenessLabel(never)).toBe("Never seen");
    expect(getDatabaseLivenessTone(never)).toBe("neutral");

    const engineWords: Array<string> = [
      DatabaseEngineMetricsStatus.Connected,
      DatabaseEngineMetricsStatus.Disconnected,
      DatabaseEngineMetricsStatus.NotConnected,
    ].map((status: DatabaseEngineMetricsStatus): string => {
      return getDatabaseEngineMetricsStatusLabel(status).toLowerCase();
    });
    for (const status of [seen, stale, never]) {
      const label: string = getDatabaseLivenessLabel(status).toLowerCase();
      for (const word of engineWords) {
        expect(label).not.toContain(word);
      }
    }
    expect(DATABASE_LIVENESS_DESCRIPTION).toContain("30 minutes");
    expect(getDatabaseLivenessStatus("not a date", NOW)).toBe(
      DatabaseLivenessStatus.NeverSeen,
    );
  });
});

describe("the Overview header's identifier", () => {
  test("its own address, else its primary stored endpoint, else the workload labelled as one", () => {
    // pg16: an address of its own.
    expect(
      getDatabaseHeaderIdentifier(
        { serverAddress: "pg16.rcv-e2e.example.net", serverPort: 5432 },
        ["pg16.rcv-e2e.example.net:5432"],
      ),
    ).toEqual({ label: "endpoint", value: "pg16.rcv-e2e.example.net:5432" });

    // bb622879: a Docker container with the alias a person added.
    const docker: {
      workloadKind: string;
      workloadName: string;
      serverAddress: null;
    } = {
      workloadKind: "Container",
      workloadName: "e2e-receivers-postgres",
      serverAddress: null,
    };
    expect(
      getDatabaseHeaderIdentifier(docker, ["e2e-receivers-postgres:5432"]),
    ).toEqual({ label: "endpoint", value: "e2e-receivers-postgres:5432" });
    expect(getDatabaseHeaderIdentifier(docker, [])).toEqual({
      label: "workload",
      value: "Container/e2e-receivers-postgres",
    });
    expect(getDatabaseHeaderIdentifier({}, [])).toBeNull();
  });
});

describe("a missing database", () => {
  test("the API's `{}` (an empty model) is not found; a row with an id is", () => {
    expect(isDatabaseServerFound(new DatabaseServer())).toBe(false);
    expect(isDatabaseServerFound(null)).toBe(false);
    expect(isDatabaseServerFound({ _id: "  " })).toBe(false);
    const row: DatabaseServer = new DatabaseServer();
    row._id = "3df04aa4-a899-40bb-96f0-e487733aee03";
    expect(isDatabaseServerFound(row)).toBe(true);
  });
});

describe("tracked pods", () => {
  const cluster: { kubernetesClusterIdentifier: string } = {
    kubernetesClusterIdentifier: "e2e-kind",
  };

  test("a Deployment's own key is not a pod (Valkey cache/valkey, MySQL data/mysql)", () => {
    const valkey: Parameters<typeof getDatabaseServerInstanceMemberKeys>[0] = {
      projectId: PROJECT_ID,
      endpoints: [],
      dbSystem: "valkey",
      memberEntityKeys: {
        "1b898749a42b7cb5": "2026-09-25T00:40:00.451Z",
        "242669ec16c90df2": "2026-09-25T00:40:00.451Z",
        e0c435f39e46f31f: "2026-09-24T22:35:00.393Z",
      },
      ...cluster,
      kubernetesNamespace: "cache",
      workloadKind: "Deployment",
      workloadName: "valkey",
    };
    expect(getDatabaseServerMemberScopeKeys(valkey)).toHaveLength(3);
    expect(getDatabaseServerInstanceMemberKeys(valkey)).toEqual([
      "1b898749a42b7cb5",
      "e0c435f39e46f31f",
    ]);

    const mysql: Parameters<typeof getDatabaseServerInstanceMemberKeys>[0] = {
      projectId: PROJECT_ID,
      endpoints: [],
      dbSystem: "mysql",
      memberEntityKeys: {
        "8f6b812d3d3f9656": "2026-09-25T00:40:00.455Z",
        "9763f34bfdef8fde": "2026-09-25T00:40:00.455Z",
      },
      ...cluster,
      kubernetesNamespace: "data",
      workloadKind: "Deployment",
      workloadName: "mysql",
    };
    expect(getDatabaseServerInstanceMemberKeys(mysql)).toEqual([
      "8f6b812d3d3f9656",
    ]);
  });

  test("a StatefulSet's members are all pods (PostgreSQL data/postgres keeps 2)", () => {
    expect(
      getDatabaseServerInstanceMemberKeys({
        projectId: PROJECT_ID,
        endpoints: [],
        dbSystem: "postgresql",
        memberEntityKeys: {
          c876687609203a7c: "2026-09-25T00:45:00.480Z",
          e57f6b7ea222d39c: "2026-09-25T00:45:00.480Z",
        },
        ...cluster,
        kubernetesNamespace: "data",
        workloadKind: "StatefulSet",
        workloadName: "postgres",
      }),
    ).toHaveLength(2);
  });
});

describe("unit words agree with the number", () => {
  test("'1 databases' and '1 threads' read singular; other counts stay plural", () => {
    expect(formatDatabaseMetricValue(1, "databases", "gauge")).toBe(
      "1 database",
    );
    expect(formatDatabaseMetricValue(1, "threads", "gauge")).toBe("1 thread");
    expect(formatDatabaseMetricValue(8, "connections", "gauge")).toBe(
      "8 connections",
    );
    expect(formatDatabaseMetricValue(1, "commits", "counter")).toBe(
      "1 commit/s",
    );
    expect(formatDatabaseMetricValue(1.5, "commits", "counter")).toBe(
      "1.5 commits/s",
    );
    expect(getDatabaseUnitSingular("processes")).toBe("process");
    expect(getDatabaseUnitSingular("misses")).toBe("miss");
    expect(getDatabaseUnitSingular("ops/s")).toBe("ops/s");
    expect(getDatabaseUnitSingular("ms")).toBe("ms");
  });
});

describe("chart axes", () => {
  test("a unit word leaves the tick (it clipped to 'onnections'); short units stay", () => {
    expect(formatDatabaseMetricAxisValue(20, "connections")).toBe("20");
    expect(formatDatabaseMetricAxisValue(2.5, "rollbacks")).toBe("2.5");
    expect(formatDatabaseMetricAxisValue(134217728, "bytes")).toBe("128 MiB");
    expect(formatDatabaseMetricAxisValue(0.85, "fraction")).toBe("85%");
    expect(formatDatabaseMetricAxisValue(12, "ms")).toBe("12 ms");
    // A sub-second lag reads in ms, not "0.0 s" on every tick.
    expect(formatDatabaseMetricAxisValue(0.004, "s")).toBe("4 ms");
    expect(formatDatabaseMetricAxisValue(0.012, "s")).toBe("12 ms");
    expect(formatDatabaseMetricAxisValue(90, "s")).toBe("1.5 min");
    expect(formatDatabaseMetricValue(99, "%", "gauge")).toBe("99%");
    expect(formatDatabaseMetricAxisValue(null, "connections")).toBe("");
    expect(getDatabaseMetricAxisUnitLabel("connections")).toBe("connections");
    expect(getDatabaseMetricAxisUnitLabel("bytes")).toBe("");
    expect(formatDatabaseMetricUnitAxisValue(3, "{connection}")).toBe("3");
    expect(getDatabaseMetricUnitAxisLabel("{connection}")).toBe("connection");
    expect(formatDatabaseMetricUnitAxisValue(2, "1", { isRate: true })).toBe(
      "2/s",
    );
  });

  test("the unit is said once, by the title", () => {
    const backends: DatabaseServerMetricDefinition =
      findDatabaseServerMetricByName("postgresql", "postgresql.backends")!;
    expect(getDatabaseEngineMetricChartTitle(backends)).toBe("Connections");
    const rollbacks: DatabaseServerMetricDefinition =
      findDatabaseServerMetricByName("postgresql", "postgresql.rollbacks")!;
    expect(getDatabaseEngineMetricChartTitle(rollbacks)).toBe(
      `${rollbacks.title} (per second)`,
    );
    expect(
      getDatabaseEngineMetricChartTitle({
        title: "Buffer pool size",
        unit: "pages",
        kind: "gauge",
      }),
    ).toBe("Buffer pool size (pages)");
  });

  test("neighbouring ticks of an idle container differ ('0.0%' five times, '0.000cores')", () => {
    // Docker 'CPU per container' ticks around 0.02-0.03 %.
    const cpuTicks: Array<string> = [0, 0.008, 0.016, 0.024, 0.032].map(
      (value: number): string => {
        return formatDatabaseRuntimeAxisValue(value, "percent");
      },
    );
    expect(cpuTicks).toEqual(["0%", "0.008%", "0.016%", "0.024%", "0.032%"]);
    expect(new Set(cpuTicks).size).toBe(cpuTicks.length);

    // Kubernetes Valkey CPU in cores; the title carries "(cores)".
    const coreTicks: Array<string> = [0.0002, 0.0004, 0.0006, 0.0008].map(
      (value: number): string => {
        return formatDatabaseRuntimeAxisValue(value, "cores");
      },
    );
    expect(coreTicks).toEqual(["0.0002", "0.0004", "0.0006", "0.0008"]);
    expect(
      getDatabaseRuntimeChartTitle(DATABASE_RUNTIME_METRICS.kubernetes.cpu),
    ).toBe("CPU per pod (cores)");
    expect(
      getDatabaseRuntimeChartTitle(DATABASE_RUNTIME_METRICS.docker.memory),
    ).toBe("Memory per container");

    // The tooltip-side values keep enough digits too.
    expect(formatDatabaseRuntimeValue(0.024, "percent")).toBe("0.024%");
    expect(formatDatabaseRuntimeValue(0.0234, "cores")).toBe("0.0234 cores");
    expect(formatDatabaseAxisNumber(2500)).toBe("2.5k");
    expect(formatDatabaseAxisNumber(250)).toBe("250");
  });
});

describe("the 'Queries from applications' chart", () => {
  // Every overview's line fell from 24 to about 12 at its right edge.
  const END: Date = new Date("2026-09-25T01:10:30.000Z");
  const START: Date = new Date("2026-09-25T00:10:30.000Z");

  function minute(offset: number): Date {
    return new Date(
      new Date("2026-09-25T00:10:00.000Z").getTime() + offset * 60 * 1000,
    );
  }

  test("drops the buckets the window does not cover whole (the one still filling)", () => {
    const series: Array<DatabaseTimePoint> = [];
    for (let offset: number = 0; offset <= 60; offset++) {
      series.push({ x: minute(offset), y: offset === 60 ? 12 : 24 });
    }
    const complete: Array<DatabaseTimePoint> = getCompleteBucketSeries(series, {
      start: START,
      end: END,
    });
    // 00:10 began before the window; 01:10 ends after it.
    expect(complete[0]!.x).toEqual(minute(1));
    expect(complete[complete.length - 1]!.x).toEqual(minute(59));
    expect(
      complete.every((point: DatabaseTimePoint): boolean => {
        return point.y === 24;
      }),
    ).toBe(true);
    // Nothing to drop to: a lone partial bucket is kept.
    expect(
      getCompleteBucketSeries([{ x: minute(60), y: 12 }], {
        start: START,
        end: END,
      }),
    ).toHaveLength(1);
  });

  test("the chart drops the partial bucket; the Queries tile still counts it", async () => {
    aggregateMock.mockImplementation(
      (request: AggregateRequest): Promise<AggregatedResult> => {
        const type: unknown = request.aggregateBy["aggregationType"];
        if (type === AggregationType.Count) {
          const query: Record<string, unknown> = request.aggregateBy[
            "query"
          ] as Record<string, unknown>;
          const errorsOnly: boolean = query["statusCode"] !== undefined;
          return Promise.resolve({
            data: [
              { timestamp: minute(58), value: errorsOnly ? 0 : 24 },
              { timestamp: minute(59), value: errorsOnly ? 0 : 24 },
              { timestamp: minute(60), value: errorsOnly ? 0 : 12 },
            ],
          } as unknown as AggregatedResult);
        }
        return Promise.resolve({ data: [] } as unknown as AggregatedResult);
      },
    );

    const metrics: DatabaseQueryMetrics = await fetchDatabaseQueryMetrics({
      projectId: PROJECT_ID,
      keys: PG16_KEYS,
      start: START,
      end: END,
    });

    expect(metrics.total).toBe(60);
    expect(
      metrics.countSeries.map((point: DatabaseTimePoint): number => {
        return point.y;
      }),
    ).toEqual([24, 24]);
  });
});

describe("'Queries' counts queries, not connection spans", () => {
  test("the span query leaves out the shared connection-span names", () => {
    const query: Record<string, unknown> | null = buildDatabaseSpanQuery({
      projectId: PROJECT_ID,
      keys: PG16_KEYS,
      start: new Date("2026-09-25T00:00:00.000Z"),
      end: new Date("2026-09-25T01:00:00.000Z"),
    });
    expect(query!["kind"]).toBe(SpanKind.Client);
    const excluded: IncludesNone = query!["name"] as IncludesNone;
    expect(excluded).toBeInstanceOf(IncludesNone);
    const names: Array<string> = excluded.values as Array<string>;
    // node-postgres' pool and client connects around each of 218 queries.
    expect(names).toContain("pg-pool.connect");
    expect(names).toContain("pg.connect");
    for (const name of DATABASE_CONNECTION_SPAN_NAMES) {
      expect(names).toContain(name);
    }
    // A query span is never excluded.
    expect(names).not.toContain("pg.query:SELECT");
    for (const name of getDatabaseConnectionSpanNameExclusions()) {
      expect(isDatabaseConnectionSpanName(name)).toBe(true);
    }
  });
});

describe("the Metrics tab's list values", () => {
  test("a curated gauge reads as the Overview does: pg16's backends are 7 + 12 = 19, not their average", async () => {
    // postgresql.backends at 01:11 — `postgres` 7, `orders` 12 (ClickHouse).
    aggregateMock.mockResolvedValue({
      data: [
        {
          timestamp: new Date("2026-09-25T01:11:00.000Z"),
          value: 7,
          attributes: {
            "resource.postgresql.database.name": "postgres",
            "resource.server.address": "pg16.rcv-e2e.example.net",
            "resource.server.port": "5432",
          },
        },
        {
          timestamp: new Date("2026-09-25T01:11:00.000Z"),
          value: 12,
          attributes: {
            "resource.postgresql.database.name": "orders",
            "resource.server.address": "pg16.rcv-e2e.example.net",
            "resource.server.port": "5432",
          },
        },
      ],
    } as unknown as AggregatedResult);

    const values: Map<string, DatabaseMetricListValue> =
      await fetchDatabaseMetricListValues({
        projectId: PROJECT_ID,
        keys: PG16_KEYS,
        start: new Date("2026-09-25T00:12:00.000Z"),
        end: new Date("2026-09-25T01:12:00.000Z"),
        dbSystem: "postgresql",
        metricNames: ["postgresql.backends", "db.client.operation.duration"],
      });

    // Only the curated name gets a value; the other keeps the list's own.
    expect(Array.from(values.keys())).toEqual(["postgresql.backends"]);
    const backends: DatabaseMetricListValue = values.get(
      "postgresql.backends",
    )!;
    expect(backends.value).toBe(19);
    expect(backends.isRate).toBe(false);
    expect(backends.caption).toBe("total of series");
    // Read per series: grouped by the database name, not pooled.
    expect(
      aggregateMock.mock.calls[0]![0].aggregateBy["groupByAttributeKeys"],
    ).toContain("resource.postgresql.database.name");
  });

  test("a curated counter is a per-second rate, captioned so", () => {
    const commits: DatabaseServerMetricDefinition =
      findDatabaseServerMetricByName("postgresql", "postgresql.commits")!;
    expect(getDatabaseMetricListCaption(commits)).toBe(
      "per second, all series",
    );
  });

  test("an unscoped database asks nothing", async () => {
    const values: Map<string, DatabaseMetricListValue> =
      await fetchDatabaseMetricListValues({
        projectId: PROJECT_ID,
        keys: [],
        start: new Date("2026-09-25T00:12:00.000Z"),
        end: new Date("2026-09-25T01:12:00.000Z"),
        dbSystem: "postgresql",
        metricNames: ["postgresql.backends"],
      });
    expect(values.size).toBe(0);
    expect(aggregateMock).not.toHaveBeenCalled();
  });
});

describe("the list tables", () => {
  test("Last Seen is relative with the full time on hover", () => {
    const text: { text: string; title: string } = getDatabaseLastSeenText(
      new Date(Date.now() - 5 * 60 * 1000),
    );
    expect(text.text).toContain("minutes ago");
    expect(text.title.length).toBeGreaterThan(0);
    expect(getDatabaseLastSeenText(null).text).toBe("Never");
  });

  test("low-priority columns show by default from 2xl only (a 1440 px laptop is narrower)", () => {
    expect(isDatabaseWideTableViewport(1440)).toBe(false);
    expect(isDatabaseWideTableViewport(DATABASE_WIDE_TABLE_MIN_WIDTH_PX)).toBe(
      true,
    );
    expect(isDatabaseWideTableViewport(null)).toBe(false);
  });
});

describe("'Create monitor' from a database chart", () => {
  test("describes the monitor as created from the database, not the Metric Explorer", () => {
    expect(getDatabaseMetricMonitorDescription("Checkout primary")).toBe(
      "Created from database Checkout primary.",
    );
    expect(getDatabaseMetricMonitorDescription("  ")).toBe("");

    const backends: DatabaseServerMetricDefinition =
      findDatabaseServerMetricByName("postgresql", "postgresql.backends")!;
    const route: string = buildDatabaseMetricMonitorRoute(
      buildDatabaseMetricMonitorViewData({
        spec: {
          metricName: "postgresql.backends",
          title: "Connections",
          definition: backends,
        },
        databaseServerId: "3df04aa4-a899-40bb-96f0-e487733aee03",
        aggregationType: AggregationType.Avg,
      }),
      { databaseName: "PostgreSQL pg16.rcv-e2e.example.net:5432" },
    ).toString();
    const params: URLSearchParams = new URLSearchParams(
      route.substring(route.indexOf("?") + 1),
    );
    expect(params.get(DATABASE_METRIC_MONITOR_DESCRIPTION_PARAM)).toBe(
      "Created from database PostgreSQL pg16.rcv-e2e.example.net:5432.",
    );
  });
});
