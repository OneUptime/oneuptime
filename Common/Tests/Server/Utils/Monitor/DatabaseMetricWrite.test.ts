import { MetricPointType } from "../../../../Models/AnalyticsModels/Metric";
import MetricType from "../../../../Models/DatabaseModels/MetricType";
import GlobalConfigService from "../../../../Server/Services/GlobalConfigService";
import MetricService from "../../../../Server/Services/MetricService";
import MonitorMetricUtil from "../../../../Server/Utils/Monitor/MonitorMetricUtil";
import TelemetryUtil from "../../../../Server/Utils/Telemetry/Telemetry";
import Dictionary from "../../../../Types/Dictionary";
import { JSONObject } from "../../../../Types/JSON";
import {
  DatabaseMetricDefinition,
  DatabaseMetricGroup,
  getAllDatabaseMetrics,
  getDatabaseMetricsByGroup,
} from "../../../../Types/Monitor/DatabaseMetricCatalog";
import DatabaseMonitorResponse, {
  DatabaseMetricGroupStatus,
  DatabaseMetricGroupUnavailableReason,
} from "../../../../Types/Monitor/DatabaseMonitor/DatabaseMonitorResponse";
import MonitorMetricType from "../../../../Types/Monitor/MonitorMetricType";
import ObjectID from "../../../../Types/ObjectID";
import ProbeMonitorResponse from "../../../../Types/Probe/ProbeMonitorResponse";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

const PROJECT_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);
const MONITOR_ID: ObjectID = new ObjectID(
  "55555555-5555-4555-8555-555555555555",
);
const PROBE_ID: ObjectID = new ObjectID("66666666-6666-4666-8666-666666666666");

function buildDatabaseResponse(input: {
  metrics?: Partial<Record<MonitorMetricType, number>>;
  isOnline?: boolean;
  unavailableGroups?: Array<DatabaseMetricGroupStatus>;
  collectedGroups?: Array<DatabaseMetricGroup>;
}): DatabaseMonitorResponse {
  return {
    isOnline: input.isOnline ?? true,
    responseTimeInMs: 12,
    failureCause: "",
    metrics: input.metrics ?? {},
    collectedGroups: input.collectedGroups ?? [],
    unavailableGroups: input.unavailableGroups ?? [],
    connectionError: null,
    engineVersion: "PostgreSQL 15.18",
  };
}

function buildProbeResponse(
  databaseMonitorResponse: DatabaseMonitorResponse,
): ProbeMonitorResponse {
  return {
    projectId: PROJECT_ID,
    monitorId: MONITOR_ID,
    monitorStepId: ObjectID.generate(),
    probeId: PROBE_ID,
    failureCause: databaseMonitorResponse.failureCause,
    monitoredAt: new Date("2026-09-02T10:00:00.000Z"),
    isOnline: databaseMonitorResponse.isOnline,
    responseTimeInMs: databaseMonitorResponse.responseTimeInMs,
    databaseMonitorResponse: databaseMonitorResponse,
  };
}

describe("MonitorMetricUtil Database Health metric write path", () => {
  let insertedRows: Array<JSONObject>;
  let indexedMaps: Array<Dictionary<MetricType>>;

  beforeEach(() => {
    insertedRows = [];
    indexedMaps = [];

    jest
      .spyOn(GlobalConfigService, "findOneBy")
      .mockResolvedValue(null as never);
    jest
      .spyOn(MetricService, "insertJsonRows")
      .mockImplementation(async (rows: Array<JSONObject>): Promise<void> => {
        insertedRows.push(...rows);
      });
    jest
      .spyOn(TelemetryUtil, "indexMetricNameServiceNameMap")
      .mockImplementation(
        async (data: {
          projectId: ObjectID;
          metricNameServiceNameMap: Dictionary<MetricType>;
        }): Promise<void> => {
          indexedMaps.push(data.metricNameServiceNameMap);
        },
      );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  async function save(response: ProbeMonitorResponse): Promise<void> {
    await MonitorMetricUtil.saveMonitorMetrics({
      monitorId: MONITOR_ID,
      projectId: PROJECT_ID,
      dataToProcess: response,
      monitorName: "Orders Primary",
      probeName: "Frankfurt Probe",
    });
  }

  function rowsByName(name: MonitorMetricType): Array<JSONObject> {
    return insertedRows.filter((row: JSONObject) => {
      return row["name"] === name;
    });
  }

  function databaseRows(): Array<JSONObject> {
    const databaseMetricNames: Set<string> = new Set<string>(
      getAllDatabaseMetrics().map((definition: DatabaseMetricDefinition) => {
        return definition.metricType.toString();
      }),
    );

    return insertedRows.filter((row: JSONObject) => {
      return databaseMetricNames.has(String(row["name"]));
    });
  }

  test("writes one row per collected metric, keyed by its own metric type", async () => {
    await save(
      buildProbeResponse(
        buildDatabaseResponse({
          metrics: {
            [MonitorMetricType.DatabaseConnectionsTotal]: 42,
            [MonitorMetricType.DatabaseConnectionsUsedPercent]: 21,
          },
          collectedGroups: [DatabaseMetricGroup.Connections],
        }),
      ),
    );

    expect(databaseRows()).toHaveLength(2);
    expect(rowsByName(MonitorMetricType.DatabaseConnectionsTotal)).toHaveLength(
      1,
    );
    expect(
      rowsByName(MonitorMetricType.DatabaseConnectionsTotal)[0]?.["value"],
    ).toBe(42);
    expect(
      rowsByName(MonitorMetricType.DatabaseConnectionsUsedPercent)[0]?.[
        "value"
      ],
    ).toBe(21);
  });

  test("carries only monitor, project and probe identity on database rows", async () => {
    await save(
      buildProbeResponse(
        buildDatabaseResponse({
          metrics: { [MonitorMetricType.DatabaseCacheHitPercent]: 99 },
        }),
      ),
    );

    const row: JSONObject | undefined = rowsByName(
      MonitorMetricType.DatabaseCacheHitPercent,
    )[0];

    expect(row?.["primaryEntityId"]).toBe(MONITOR_ID.toString());
    expect(row?.["metricPointType"]).toBe(MetricPointType.Sum);
    expect(row?.["attributes"]).toEqual({
      monitorId: MONITOR_ID.toString(),
      projectId: PROJECT_ID.toString(),
      probeId: PROBE_ID.toString(),
      monitorName: "Orders Primary",
      probeName: "Frankfurt Probe",
    });
  });

  test("writes no row for a metric the check did not collect", async () => {
    await save(
      buildProbeResponse(
        buildDatabaseResponse({
          metrics: { [MonitorMetricType.DatabaseConnectionsTotal]: 7 },
        }),
      ),
    );

    for (const definition of getAllDatabaseMetrics()) {
      if (
        definition.metricType === MonitorMetricType.DatabaseConnectionsTotal
      ) {
        continue;
      }

      expect(rowsByName(definition.metricType)).toEqual([]);
    }
  });

  /*
   * The degradation contract: a group the monitoring login cannot read must
   * leave its series with no datapoint at all. A zero here would read as a
   * healthy measurement and silently resolve whatever it was meant to catch.
   */
  test("writes nothing - not zero - for the metrics of an unavailable group", async () => {
    const lockMetrics: Array<DatabaseMetricDefinition> =
      getDatabaseMetricsByGroup(DatabaseMetricGroup.Locks);

    expect(lockMetrics.length).toBeGreaterThan(0);

    await save(
      buildProbeResponse(
        buildDatabaseResponse({
          metrics: { [MonitorMetricType.DatabaseConnectionsTotal]: 15 },
          collectedGroups: [DatabaseMetricGroup.Connections],
          unavailableGroups: [
            {
              group: DatabaseMetricGroup.Locks,
              reason: DatabaseMetricGroupUnavailableReason.MissingPermission,
              message: "The monitoring login cannot read lock statistics.",
              remediation: "GRANT pg_monitor TO monitoring_user;",
            },
          ],
        }),
      ),
    );

    for (const definition of lockMetrics) {
      expect(rowsByName(definition.metricType)).toEqual([]);
    }

    expect(
      rowsByName(MonitorMetricType.DatabaseConnectionsTotal)[0]?.["value"],
    ).toBe(15);
  });

  test("keeps a measured zero, which is a real value for every catalog metric", async () => {
    await save(
      buildProbeResponse(
        buildDatabaseResponse({
          metrics: {
            [MonitorMetricType.DatabaseReplicationLagSeconds]: 0,
            [MonitorMetricType.DatabaseMetricGroupsFailed]: 0,
          },
        }),
      ),
    );

    expect(
      rowsByName(MonitorMetricType.DatabaseReplicationLagSeconds)[0]?.["value"],
    ).toBe(0);
    expect(
      rowsByName(MonitorMetricType.DatabaseMetricGroupsFailed)[0]?.["value"],
    ).toBe(0);
  });

  test("still records availability and response time when no metric was collected", async () => {
    await save(buildProbeResponse(buildDatabaseResponse({ metrics: {} })));

    expect(databaseRows()).toEqual([]);
    expect(rowsByName(MonitorMetricType.IsOnline)[0]?.["value"]).toBe(1);
    expect(rowsByName(MonitorMetricType.ResponseTime)[0]?.["value"]).toBe(12);
  });

  test("records the outage when the connection itself failed", async () => {
    const offline: DatabaseMonitorResponse = buildDatabaseResponse({
      isOnline: false,
      metrics: {},
    });
    offline.connectionError = "Connection refused.";
    offline.failureCause = "Connection refused.";

    const probeResponse: ProbeMonitorResponse = buildProbeResponse(offline);

    await save(probeResponse);

    expect(databaseRows()).toEqual([]);
    expect(rowsByName(MonitorMetricType.IsOnline)[0]?.["value"]).toBe(0);
  });

  test("writes every catalog series on a fully collected check", async () => {
    const metrics: Partial<Record<MonitorMetricType, number>> = {};
    let nextValue: number = 1;

    for (const definition of getAllDatabaseMetrics()) {
      metrics[definition.metricType] = nextValue;
      nextValue = nextValue + 1;
    }

    await save(buildProbeResponse(buildDatabaseResponse({ metrics: metrics })));

    expect(databaseRows()).toHaveLength(getAllDatabaseMetrics().length);

    for (const definition of getAllDatabaseMetrics()) {
      expect(rowsByName(definition.metricType)).toHaveLength(1);
    }
  });

  test("registers each series with the catalog's own description and unit", async () => {
    const percentMetric: DatabaseMetricDefinition | undefined =
      getAllDatabaseMetrics().find((definition: DatabaseMetricDefinition) => {
        return (
          definition.metricType ===
          MonitorMetricType.DatabaseConnectionsUsedPercent
        );
      });

    expect(percentMetric).toBeDefined();

    await save(
      buildProbeResponse(
        buildDatabaseResponse({
          metrics: {
            [MonitorMetricType.DatabaseConnectionsUsedPercent]: 55,
          },
        }),
      ),
    );

    expect(indexedMaps).toHaveLength(1);
    const metricMap: Dictionary<MetricType> = indexedMaps[0]!;
    const registered: MetricType | undefined =
      metricMap[MonitorMetricType.DatabaseConnectionsUsedPercent];

    expect(registered?.unit).toBe(percentMetric!.unit);
    expect(registered?.description).toBe(percentMetric!.description);
  });

  test("skips a non-finite value rather than writing a bogus datapoint", async () => {
    await save(
      buildProbeResponse(
        buildDatabaseResponse({
          metrics: {
            [MonitorMetricType.DatabaseSizeBytes]: Number.NaN,
            [MonitorMetricType.DatabaseDeadTuples]: Number.POSITIVE_INFINITY,
            [MonitorMetricType.DatabaseQueriesTotal]: 900,
          },
        }),
      ),
    );

    expect(databaseRows()).toHaveLength(1);
    expect(
      rowsByName(MonitorMetricType.DatabaseQueriesTotal)[0]?.["value"],
    ).toBe(900);
  });

  test("leaves database series untouched for a check that carries no database payload", async () => {
    await save({
      projectId: PROJECT_ID,
      monitorId: MONITOR_ID,
      monitorStepId: ObjectID.generate(),
      probeId: PROBE_ID,
      failureCause: "",
      monitoredAt: new Date("2026-09-02T10:00:00.000Z"),
      isOnline: true,
      responseTimeInMs: 80,
    });

    expect(databaseRows()).toEqual([]);
    expect(rowsByName(MonitorMetricType.ResponseTime)[0]?.["value"]).toBe(80);
  });
});
