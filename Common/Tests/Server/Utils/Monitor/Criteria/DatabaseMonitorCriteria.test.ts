import DatabaseMonitorCriteria from "../../../../../Server/Utils/Monitor/Criteria/DatabaseMonitorCriteria";
import EvaluateOverTime, {
  OverTimeCriteriaValue,
} from "../../../../../Server/Utils/Monitor/Criteria/EvaluateOverTime";
import {
  CheckOn,
  CriteriaFilter,
  EvaluateOverTimeType,
  FilterType,
} from "../../../../../Types/Monitor/CriteriaFilter";
import {
  DatabaseMetricDefinition,
  DatabaseMetricGroup,
  getAllDatabaseMetrics,
} from "../../../../../Types/Monitor/DatabaseMetricCatalog";
import DatabaseMonitorResponse, {
  DatabaseMetricGroupStatus,
  DatabaseMetricGroupUnavailableReason,
} from "../../../../../Types/Monitor/DatabaseMonitor/DatabaseMonitorResponse";
import MonitorMetricType from "../../../../../Types/Monitor/MonitorMetricType";
import ProbeMonitorResponse from "../../../../../Types/Probe/ProbeMonitorResponse";
import ObjectID from "../../../../../Types/ObjectID";

/*
 * `metrics` defaults to {} so "the metric was not collected" is the default
 * state a test has to opt out of, matching the collector: a metric is present
 * only when the probe actually read it.
 */
function buildDataToProcess(input: {
  isOnline?: boolean;
  responseTimeInMs?: number;
  failureCause?: string;
  connectionError?: string | null;
  metrics?: Partial<Record<MonitorMetricType, number>>;
  collectedGroups?: Array<DatabaseMetricGroup>;
  unavailableGroups?: Array<DatabaseMetricGroupStatus>;
}): ProbeMonitorResponse {
  const databaseResponse: DatabaseMonitorResponse = {
    isOnline: input.isOnline ?? true,
    responseTimeInMs: input.responseTimeInMs ?? 12,
    failureCause: input.failureCause ?? "",
    metrics: input.metrics ?? {},
    collectedGroups: input.collectedGroups ?? [],
    unavailableGroups: input.unavailableGroups ?? [],
    connectionError: input.connectionError ?? null,
  };

  return {
    projectId: ObjectID.generate(),
    monitorId: ObjectID.generate(),
    monitorStepId: ObjectID.generate(),
    probeId: ObjectID.generate(),
    failureCause: input.failureCause ?? "",
    isOnline: input.isOnline ?? true,
    responseTimeInMs: input.responseTimeInMs ?? 12,
    databaseMonitorResponse: databaseResponse,
    monitoredAt: new Date(),
  };
}

async function evaluate(
  dataToProcess: ProbeMonitorResponse,
  criteriaFilter: CriteriaFilter,
): Promise<string | null> {
  return DatabaseMonitorCriteria.isMonitorInstanceCriteriaFilterMet({
    dataToProcess,
    criteriaFilter,
  });
}

function metricFilter(
  metricType: MonitorMetricType,
  filterType: FilterType,
  value: string | number | undefined,
): CriteriaFilter {
  return {
    checkOn: CheckOn.DatabaseMetric,
    filterType: filterType,
    value: value,
    databaseMonitorOptions: { metricType: metricType },
  };
}

describe("DatabaseMonitorCriteria.isMonitorInstanceCriteriaFilterMet", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("DatabaseIsOnline", () => {
    test("online + True -> met", async () => {
      const result: string | null = await evaluate(
        buildDataToProcess({ isOnline: true }),
        {
          checkOn: CheckOn.DatabaseIsOnline,
          filterType: FilterType.True,
          value: undefined,
        },
      );
      expect(result).toBeTruthy();
    });

    test("online + False -> not met", async () => {
      const result: string | null = await evaluate(
        buildDataToProcess({ isOnline: true }),
        {
          checkOn: CheckOn.DatabaseIsOnline,
          filterType: FilterType.False,
          value: undefined,
        },
      );
      expect(result).toBeNull();
    });

    test("offline + False -> met", async () => {
      const result: string | null = await evaluate(
        buildDataToProcess({
          isOnline: false,
          connectionError: "connection refused",
        }),
        {
          checkOn: CheckOn.DatabaseIsOnline,
          filterType: FilterType.False,
          value: undefined,
        },
      );
      expect(result).toBeTruthy();
    });

    /*
     * The whole point of the degradation contract: every group failed, yet
     * the handshake succeeded, so the monitor is online and the offline
     * criteria must not fire.
     */
    test("every group unavailable but reachable + False -> not met", async () => {
      const result: string | null = await evaluate(
        buildDataToProcess({
          isOnline: true,
          unavailableGroups: [
            {
              group: DatabaseMetricGroup.Connections,
              reason: DatabaseMetricGroupUnavailableReason.MissingPermission,
              message: "pg_stat_activity requires the pg_monitor role.",
              remediation: "GRANT pg_monitor TO monitoring_user;",
            },
            {
              group: DatabaseMetricGroup.Replication,
              reason: DatabaseMetricGroupUnavailableReason.MissingPermission,
              message: "pg_stat_replication requires the pg_monitor role.",
            },
          ],
        }),
        {
          checkOn: CheckOn.DatabaseIsOnline,
          filterType: FilterType.False,
          value: undefined,
        },
      );
      expect(result).toBeNull();
    });
  });

  describe("DatabaseMetric", () => {
    test("percent metric 95 > 90 -> met and names the metric", async () => {
      const result: string | null = await evaluate(
        buildDataToProcess({
          metrics: {
            [MonitorMetricType.DatabaseConnectionsUsedPercent]: 95,
          },
        }),
        metricFilter(
          MonitorMetricType.DatabaseConnectionsUsedPercent,
          FilterType.GreaterThan,
          "90",
        ),
      );

      expect(result).toContain("Connections Used");
      expect(result).toContain("95");
    });

    test("percent metric 40 > 90 -> not met", async () => {
      const result: string | null = await evaluate(
        buildDataToProcess({
          metrics: {
            [MonitorMetricType.DatabaseConnectionsUsedPercent]: 40,
          },
        }),
        metricFilter(
          MonitorMetricType.DatabaseConnectionsUsedPercent,
          FilterType.GreaterThan,
          "90",
        ),
      );

      expect(result).toBeNull();
    });

    test("seconds metric exactly at the threshold is not greater than it", async () => {
      const result: string | null = await evaluate(
        buildDataToProcess({
          metrics: {
            [MonitorMetricType.DatabaseReplicationLagSeconds]: 300,
          },
        }),
        metricFilter(
          MonitorMetricType.DatabaseReplicationLagSeconds,
          FilterType.GreaterThan,
          "300",
        ),
      );

      expect(result).toBeNull();
    });

    test("seconds metric exactly at the threshold is greater than or equal to it", async () => {
      const result: string | null = await evaluate(
        buildDataToProcess({
          metrics: {
            [MonitorMetricType.DatabaseReplicationLagSeconds]: 300,
          },
        }),
        metricFilter(
          MonitorMetricType.DatabaseReplicationLagSeconds,
          FilterType.GreaterThanOrEqualTo,
          "300",
        ),
      );

      expect(result).toContain("Replication Lag");
    });

    /*
     * A cumulative counter reading zero is a real measurement - it must be
     * compared, not mistaken for the absent case below.
     */
    test("cumulative counter at zero is compared, not treated as absent", async () => {
      const result: string | null = await evaluate(
        buildDataToProcess({
          metrics: { [MonitorMetricType.DatabaseQueriesTotal]: 0 },
        }),
        metricFilter(
          MonitorMetricType.DatabaseQueriesTotal,
          FilterType.EqualTo,
          "0",
        ),
      );

      expect(result).toBeTruthy();
    });

    /*
     * THE degradation guarantee. A metric the probe could not read is absent
     * from the map, and an absent metric may never satisfy a filter - a
     * revoked grant must not raise an incident about a healthy database.
     * Written as a sweep so a metric added to the catalog later cannot skip
     * it.
     */
    test.each(
      getAllDatabaseMetrics().map((definition: DatabaseMetricDefinition) => {
        return [definition.friendlyName, definition.metricType] as [
          string,
          MonitorMetricType,
        ];
      }),
    )(
      "%s is not met by any comparison when it was not collected",
      async (_friendlyName: string, metricType: MonitorMetricType) => {
        const dataToProcess: ProbeMonitorResponse = buildDataToProcess({
          unavailableGroups: [
            {
              group: DatabaseMetricGroup.Connections,
              reason: DatabaseMetricGroupUnavailableReason.MissingPermission,
              message: "The monitoring login cannot read this view.",
              remediation: "GRANT pg_monitor TO monitoring_user;",
            },
          ],
        });

        const filterTypes: Array<FilterType> = [
          FilterType.GreaterThan,
          FilterType.LessThan,
          FilterType.EqualTo,
          FilterType.NotEqualTo,
          FilterType.GreaterThanOrEqualTo,
          FilterType.LessThanOrEqualTo,
        ];

        for (const filterType of filterTypes) {
          const result: string | null = await evaluate(
            dataToProcess,
            metricFilter(metricType, filterType, "0"),
          );

          expect(result).toBeNull();
        }
      },
    );

    test("no databaseMonitorOptions -> null", async () => {
      const result: string | null = await evaluate(
        buildDataToProcess({
          metrics: {
            [MonitorMetricType.DatabaseConnectionsUsedPercent]: 95,
          },
        }),
        {
          checkOn: CheckOn.DatabaseMetric,
          filterType: FilterType.GreaterThan,
          value: "90",
        },
      );

      expect(result).toBeNull();
    });

    test("metricType outside the database catalog -> null", async () => {
      const result: string | null = await evaluate(
        buildDataToProcess({
          metrics: { [MonitorMetricType.CPUUsagePercent]: 95 },
        }),
        metricFilter(
          MonitorMetricType.CPUUsagePercent,
          FilterType.GreaterThan,
          "90",
        ),
      );

      expect(result).toBeNull();
    });

    test("missing threshold -> null", async () => {
      const result: string | null = await evaluate(
        buildDataToProcess({
          metrics: {
            [MonitorMetricType.DatabaseConnectionsUsedPercent]: 95,
          },
        }),
        metricFilter(
          MonitorMetricType.DatabaseConnectionsUsedPercent,
          FilterType.GreaterThan,
          undefined,
        ),
      );

      expect(result).toBeNull();
    });

    test("no database response at all -> null", async () => {
      const dataToProcess: ProbeMonitorResponse = buildDataToProcess({});
      delete dataToProcess.databaseMonitorResponse;

      const result: string | null = await evaluate(
        dataToProcess,
        metricFilter(
          MonitorMetricType.DatabaseConnectionsUsedPercent,
          FilterType.GreaterThan,
          "0",
        ),
      );

      expect(result).toBeNull();
    });
  });

  describe("DatabaseCollectionError", () => {
    const degradedGroups: Array<DatabaseMetricGroupStatus> = [
      {
        group: DatabaseMetricGroup.Locks,
        reason: DatabaseMetricGroupUnavailableReason.MissingPermission,
        message: "pg_locks requires the pg_monitor role.",
        remediation: "GRANT pg_monitor TO monitoring_user;",
      },
    ];

    test("no unavailable groups + IsEmpty -> met", async () => {
      const result: string | null = await evaluate(buildDataToProcess({}), {
        checkOn: CheckOn.DatabaseCollectionError,
        filterType: FilterType.IsEmpty,
        value: undefined,
      });

      expect(result).toBeTruthy();
    });

    test("no unavailable groups + IsNotEmpty -> not met", async () => {
      const result: string | null = await evaluate(buildDataToProcess({}), {
        checkOn: CheckOn.DatabaseCollectionError,
        filterType: FilterType.IsNotEmpty,
        value: undefined,
      });

      expect(result).toBeNull();
    });

    test("unavailable group + IsNotEmpty -> met and reports the group", async () => {
      const result: string | null = await evaluate(
        buildDataToProcess({ unavailableGroups: degradedGroups }),
        {
          checkOn: CheckOn.DatabaseCollectionError,
          filterType: FilterType.IsNotEmpty,
          value: undefined,
        },
      );

      expect(result).toContain(DatabaseMetricGroup.Locks);
      expect(result).toContain("pg_monitor");
    });

    test("unavailable group + IsEmpty -> not met", async () => {
      const result: string | null = await evaluate(
        buildDataToProcess({ unavailableGroups: degradedGroups }),
        {
          checkOn: CheckOn.DatabaseCollectionError,
          filterType: FilterType.IsEmpty,
          value: undefined,
        },
      );

      expect(result).toBeNull();
    });

    test("Contains matches the joined message", async () => {
      const result: string | null = await evaluate(
        buildDataToProcess({ unavailableGroups: degradedGroups }),
        {
          checkOn: CheckOn.DatabaseCollectionError,
          filterType: FilterType.Contains,
          value: "pg_locks",
        },
      );

      expect(result).toBeTruthy();
    });

    test("Contains does not match an unrelated needle", async () => {
      const result: string | null = await evaluate(
        buildDataToProcess({ unavailableGroups: degradedGroups }),
        {
          checkOn: CheckOn.DatabaseCollectionError,
          filterType: FilterType.Contains,
          value: "replication",
        },
      );

      expect(result).toBeNull();
    });
  });

  /*
   * The over-time window is read from the metric store, so it is spied here
   * to keep these deterministic. The seam is the same one the server monitor
   * criteria tests use.
   */
  describe("evaluate over time", () => {
    function usable(
      value: Array<number | boolean> | number | boolean,
    ): OverTimeCriteriaValue {
      return { earlyReturn: null, value: value };
    }

    function mockOverTime(
      result: OverTimeCriteriaValue,
    ): ReturnType<typeof jest.spyOn> {
      return jest
        .spyOn(EvaluateOverTime, "getOverTimeValueForCriteriaFilter")
        .mockResolvedValue(result) as ReturnType<typeof jest.spyOn>;
    }

    function overTimeMetricFilter(
      metricType: MonitorMetricType,
      value: string,
    ): CriteriaFilter {
      return {
        checkOn: CheckOn.DatabaseMetric,
        filterType: FilterType.GreaterThan,
        value: value,
        databaseMonitorOptions: { metricType: metricType },
        evaluateOverTime: true,
        evaluateOverTimeOptions: {
          timeValueInMinutes: 5,
          evaluateOverTimeType: EvaluateOverTimeType.AllValues,
        },
      };
    }

    test("compares the window instead of the value from this one check", async () => {
      mockOverTime(usable([95, 96]));

      const result: string | null = await evaluate(
        buildDataToProcess({
          metrics: {
            [MonitorMetricType.DatabaseConnectionsUsedPercent]: 10,
          },
        }),
        overTimeMetricFilter(
          MonitorMetricType.DatabaseConnectionsUsedPercent,
          "90",
        ),
      );

      expect(result).toContain("95");
      expect(result).toContain("96");
    });

    test("a window that cannot back the filter is honoured verbatim", async () => {
      mockOverTime({
        earlyReturn: {
          result: "Database Metric has no data over the last 5 minutes.",
        },
        value: undefined,
      });

      const result: string | null = await evaluate(
        buildDataToProcess({
          metrics: {
            [MonitorMetricType.DatabaseConnectionsUsedPercent]: 99,
          },
        }),
        overTimeMetricFilter(
          MonitorMetricType.DatabaseConnectionsUsedPercent,
          "90",
        ),
      );

      expect(result).toBe(
        "Database Metric has no data over the last 5 minutes.",
      );
    });

    /*
     * The regression this seam exists for: an unusable window must not fall
     * through to the reading that arrived with this single check, or "all
     * values over the last 5 minutes" fires off one bad sample.
     */
    test("an unusable window does not fall back to this check's breaching value", async () => {
      mockOverTime({ earlyReturn: { result: null }, value: undefined });

      const result: string | null = await evaluate(
        buildDataToProcess({
          metrics: {
            [MonitorMetricType.DatabaseConnectionsUsedPercent]: 99,
          },
        }),
        overTimeMetricFilter(
          MonitorMetricType.DatabaseConnectionsUsedPercent,
          "90",
        ),
      );

      expect(result).toBeNull();
    });

    /*
     * Reachability is exempt from that early return: an unreachable database
     * must still be able to take the monitor offline while its window is
     * still filling up.
     */
    test("Database Is Online still evaluates when the window is unusable", async () => {
      mockOverTime({ earlyReturn: { result: null }, value: undefined });

      const result: string | null = await evaluate(
        buildDataToProcess({ isOnline: false }),
        {
          checkOn: CheckOn.DatabaseIsOnline,
          filterType: FilterType.False,
          value: undefined,
          evaluateOverTime: true,
          evaluateOverTimeOptions: {
            timeValueInMinutes: 5,
            evaluateOverTimeType: EvaluateOverTimeType.AllValues,
          },
        },
      );

      expect(result).toBeTruthy();
    });

    test("the filter is passed through so the window resolves the named series", async () => {
      const spy: ReturnType<typeof jest.spyOn> = mockOverTime(usable([95]));

      await evaluate(
        buildDataToProcess({
          metrics: {
            [MonitorMetricType.DatabaseConnectionsUsedPercent]: 95,
          },
        }),
        overTimeMetricFilter(
          MonitorMetricType.DatabaseConnectionsUsedPercent,
          "90",
        ),
      );

      expect(spy).toHaveBeenCalledWith(
        expect.objectContaining({
          criteriaFilter: expect.objectContaining({
            databaseMonitorOptions: {
              metricType: MonitorMetricType.DatabaseConnectionsUsedPercent,
            },
          }),
        }),
      );
    });

    /*
     * An absent metric is decided before the window is compared: a monitor
     * whose grant was revoked mid-window must stop firing, not keep alerting
     * off history.
     */
    test("an absent metric is still not met even with a breaching window", async () => {
      mockOverTime(usable([95, 96]));

      const result: string | null = await evaluate(
        buildDataToProcess({}),
        overTimeMetricFilter(
          MonitorMetricType.DatabaseConnectionsUsedPercent,
          "90",
        ),
      );

      expect(result).toBeNull();
    });
  });

  test("unrelated checkOn -> null", async () => {
    const result: string | null = await evaluate(buildDataToProcess({}), {
      checkOn: CheckOn.ResponseBody,
      filterType: FilterType.Contains,
      value: "x",
    });

    expect(result).toBeNull();
  });
});
