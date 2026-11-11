import { afterEach, describe, expect, jest, test } from "@jest/globals";
import DataBiConnection from "../../../../Models/DatabaseModels/DataBiConnection";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import DataBiConnectionService from "../../../../Server/Services/DataBiConnectionService";
import AlertSeverityService from "../../../../Server/Services/AlertSeverityService";
import DataDashboardService from "../../../../Server/Services/DataDashboardService";
import IncidentSeverityService from "../../../../Server/Services/IncidentSeverityService";
import MetricService from "../../../../Server/Services/MetricService";
import MonitorService from "../../../../Server/Services/MonitorService";
import MonitorStatusService from "../../../../Server/Services/MonitorStatusService";
import {
  BiToolRead,
  PowerBiConnector,
} from "../../../../Server/Utils/DataObservability/Bi/BiConnectors";
import DataBiRefreshAlerts, {
  getDataBiRefreshMonitorName,
} from "../../../../Server/Utils/DataObservability/Bi/DataBiRefreshAlerts";
import DataBiRefreshCheck, {
  buildBiRefreshMetricRow,
  getBiRefreshMetricRows,
} from "../../../../Server/Utils/DataObservability/Bi/DataBiRefreshCheck";
import DataBiSync from "../../../../Server/Utils/DataObservability/Bi/DataBiSync";
import OpenLineageIngest from "../../../../Server/Utils/DataObservability/OpenLineageIngest";
import MonitorMetricUtil from "../../../../Server/Utils/Monitor/MonitorMetricUtil";
import TelemetryUtil from "../../../../Server/Utils/Telemetry/Telemetry";
import {
  DATA_BI_REFRESH_RECOVERY_WINDOW_IN_MS,
  DataBiAttribute,
  DataBiDatasetRead,
  DataBiFailedRefresh,
  DataBiMetricName,
  getDataBiRefreshFailedValue,
  getLatestFinishedRefresh,
  getNextFailedRefreshes,
  readDataBiFailedRefreshes,
} from "../../../../Types/DataObservability/DataBiRefreshAlert";
import DataBiTool from "../../../../Types/DataObservability/DataBiTool";
import {
  DataBiRefreshStatus,
  DataDashboardRefresh,
  DataDashboardRefreshHistory,
} from "../../../../Types/DataObservability/DataDashboardActivity";
import {
  EvaluateOverTimeType,
  FilterType,
} from "../../../../Types/Monitor/CriteriaFilter";
import {
  buildDataBiRefreshMonitorStep,
  DATA_BI_REFRESH_GROUP_BY_ATTRIBUTES,
} from "../../../../Types/Monitor/DataBiRefreshMonitorStep";
import MonitorStep from "../../../../Types/Monitor/MonitorStep";
import MonitorSteps from "../../../../Types/Monitor/MonitorSteps";
import MonitorType from "../../../../Types/Monitor/MonitorType";
import MetricsAggregationType from "../../../../Types/Metrics/MetricsAggregationType";
import { JSONArray, JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import RollingTime from "../../../../Types/RollingTime/RollingTime";
import ServiceType from "../../../../Types/Telemetry/ServiceType";
import {
  DataSourceHttpRequest,
  DataSourceHttpResponse,
} from "../../../../Server/Utils/DataSource/HttpFetch";

/*
 * Alerts on failed Power BI refreshes: a failed refresh is a state kept on
 * the BI tool until a later refresh completes - each hourly read moves it on,
 * a refresh still running or not read leaves it as it was - written every
 * five minutes as oneuptime.data.bi.refresh_failed, and read by one monitor
 * per tool that opens one alert per dataset. So a failure opens one alert,
 * however many hourly reads see it, and the alert resolves once a later
 * refresh completes.
 */

const HOUR_IN_MS: number = 60 * 60 * 1000;
const FIVE_MINUTES_IN_MS: number = 5 * 60 * 1000;

function refresh(data: {
  status: DataBiRefreshStatus;
  startedAt: string;
  endedAt?: string | null;
  error?: string | null;
}): DataDashboardRefresh {
  return {
    status: data.status,
    startedAt: data.startedAt,
    endedAt: data.endedAt === undefined ? null : data.endedAt,
    type: "Scheduled",
    error: data.error || null,
  };
}

// What the admin list of refreshables says of a dataset: its last refresh alone.
function lastOnly(last: DataDashboardRefresh): DataDashboardRefreshHistory {
  return { last, refreshCount: null, failureCount: null, refreshes: [last] };
}

function dataset(
  datasetId: string,
  history: DataDashboardRefreshHistory | null | undefined,
  name: string = "Sales",
): DataBiDatasetRead {
  return { datasetId, name, workspace: "Finance", refresh: history };
}

const FAILED_AT_TEN: DataDashboardRefresh = refresh({
  status: DataBiRefreshStatus.Failed,
  startedAt: "2026-11-10T10:00:00.000Z",
  endedAt: "2026-11-10T10:04:00.000Z",
  error: "GatewayOffline: the gateway is offline",
});

describe("the refresh a dataset's data is as fresh as", () => {
  test("is the latest that finished: one still running, Disabled or Unknown says nothing", () => {
    const history: DataDashboardRefreshHistory = {
      last: refresh({
        status: DataBiRefreshStatus.InProgress,
        startedAt: "2026-11-10T11:00:00.000Z",
      }),
      refreshCount: 4,
      failureCount: 1,
      refreshes: [
        refresh({
          status: DataBiRefreshStatus.InProgress,
          startedAt: "2026-11-10T11:00:00.000Z",
        }),
        refresh({
          status: DataBiRefreshStatus.Unknown,
          startedAt: "2026-11-10T10:30:00.000Z",
          endedAt: "2026-11-10T10:31:00.000Z",
        }),
        FAILED_AT_TEN,
        refresh({
          status: DataBiRefreshStatus.Completed,
          startedAt: "2026-11-10T09:00:00.000Z",
          endedAt: "2026-11-10T09:05:00.000Z",
        }),
      ],
    };

    expect(getLatestFinishedRefresh(history)).toEqual(FAILED_AT_TEN);
    expect(
      getLatestFinishedRefresh(
        lastOnly(
          refresh({
            status: DataBiRefreshStatus.Disabled,
            startedAt: "2026-11-10T10:00:00.000Z",
          }),
        ),
      ),
    ).toBe(null);
    expect(getLatestFinishedRefresh(null)).toBe(null);
    expect(getLatestFinishedRefresh(undefined)).toBe(null);
  });

  test("is the latest to end, not to start", () => {
    const completedLater: DataDashboardRefresh = refresh({
      status: DataBiRefreshStatus.Completed,
      startedAt: "2026-11-10T09:50:00.000Z",
      endedAt: "2026-11-10T10:30:00.000Z",
    });

    expect(
      getLatestFinishedRefresh({
        last: FAILED_AT_TEN,
        refreshCount: null,
        failureCount: null,
        refreshes: [FAILED_AT_TEN, completedLater],
      }),
    ).toEqual(completedLater);
  });
});

describe("the datasets a Power BI tool keeps failing", () => {
  const now: Date = new Date("2026-11-10T11:00:00.000Z");

  test("a dataset whose last refresh failed, or was cancelled, is kept with its error", () => {
    expect(
      getNextFailedRefreshes({
        previous: [],
        datasets: [
          dataset("ds1", lastOnly(FAILED_AT_TEN)),
          dataset(
            "ds2",
            lastOnly(
              refresh({
                status: DataBiRefreshStatus.Cancelled,
                startedAt: "2026-11-10T10:10:00.000Z",
                endedAt: "2026-11-10T10:12:00.000Z",
              }),
            ),
            "Stock",
          ),
          dataset(
            "ds3",
            lastOnly(
              refresh({
                status: DataBiRefreshStatus.Completed,
                startedAt: "2026-11-10T10:00:00.000Z",
                endedAt: "2026-11-10T10:02:00.000Z",
              }),
            ),
            "Orders",
          ),
        ],
        now,
      }),
    ).toEqual([
      {
        datasetId: "ds1",
        datasetName: "Sales",
        workspace: "Finance",
        status: DataBiRefreshStatus.Failed,
        failedAt: "2026-11-10T10:04:00.000Z",
        error: "GatewayOffline: the gateway is offline",
        recoveredAt: null,
      },
      {
        datasetId: "ds2",
        datasetName: "Stock",
        workspace: "Finance",
        status: DataBiRefreshStatus.Cancelled,
        failedAt: "2026-11-10T10:12:00.000Z",
        error: null,
        recoveredAt: null,
      },
    ]);
  });

  test("a refresh still running, or refreshes not read, leave a failing dataset as it was, by its name now", () => {
    const previous: Array<DataBiFailedRefresh> = getNextFailedRefreshes({
      previous: [],
      datasets: [
        dataset("ds1", lastOnly(FAILED_AT_TEN)),
        dataset("ds2", lastOnly(FAILED_AT_TEN), "Stock"),
      ],
      now,
    });
    const next: Array<DataBiFailedRefresh> = getNextFailedRefreshes({
      previous,
      datasets: [
        dataset(
          "DS1",
          lastOnly(
            refresh({
              status: DataBiRefreshStatus.InProgress,
              startedAt: "2026-11-10T11:30:00.000Z",
            }),
          ),
          "Sales (renamed)",
        ),
        dataset("ds2", undefined, "Stock"),
      ],
      now: new Date("2026-11-10T12:00:00.000Z"),
    });

    expect(next).toEqual([
      { ...previous[0], datasetName: "Sales (renamed)" },
      previous[1],
    ]);
  });

  test("a later completed refresh recovers a failing dataset, kept for an hour more, then not", () => {
    const previous: Array<DataBiFailedRefresh> = getNextFailedRefreshes({
      previous: [],
      datasets: [dataset("ds1", lastOnly(FAILED_AT_TEN))],
      now,
    });
    const completed: DataDashboardRefreshHistory = lastOnly(
      refresh({
        status: DataBiRefreshStatus.Completed,
        startedAt: "2026-11-10T11:10:00.000Z",
        endedAt: "2026-11-10T11:15:00.000Z",
      }),
    );
    const recovered: Array<DataBiFailedRefresh> = getNextFailedRefreshes({
      previous,
      datasets: [dataset("ds1", completed)],
      now: new Date("2026-11-10T12:00:00.000Z"),
    });

    expect(recovered).toEqual([
      { ...previous[0], recoveredAt: "2026-11-10T12:00:00.000Z" },
    ]);

    // The next read still sees it completed: kept from when it recovered, not from now.
    expect(
      getNextFailedRefreshes({
        previous: recovered,
        datasets: [dataset("ds1", completed)],
        now: new Date("2026-11-10T12:59:00.000Z"),
      }),
    ).toEqual(recovered);
    expect(
      getNextFailedRefreshes({
        previous: recovered,
        datasets: [dataset("ds1", completed)],
        now: new Date("2026-11-10T13:00:00.000Z"),
      }),
    ).toEqual([]);
  });

  test("a recovered dataset that fails again is failing again", () => {
    const recovered: DataBiFailedRefresh = {
      datasetId: "ds1",
      datasetName: "Sales",
      workspace: "Finance",
      status: DataBiRefreshStatus.Failed,
      failedAt: "2026-11-10T10:04:00.000Z",
      error: "GatewayOffline",
      recoveredAt: "2026-11-10T11:00:00.000Z",
    };

    expect(
      getNextFailedRefreshes({
        previous: [recovered],
        datasets: [
          dataset(
            "ds1",
            lastOnly(
              refresh({
                status: DataBiRefreshStatus.Failed,
                startedAt: "2026-11-10T11:20:00.000Z",
                endedAt: "2026-11-10T11:21:00.000Z",
                error: "Timeout",
              }),
            ),
          ),
        ],
        now: new Date("2026-11-10T11:30:00.000Z"),
      }),
    ).toEqual([
      {
        ...recovered,
        failedAt: "2026-11-10T11:21:00.000Z",
        error: "Timeout",
        recoveredAt: null,
      },
    ]);
  });

  test("a dataset with no refresh, one gone from the tool, and one recovered but never failing are not kept", () => {
    const previous: Array<DataBiFailedRefresh> = getNextFailedRefreshes({
      previous: [],
      datasets: [
        dataset("ds1", lastOnly(FAILED_AT_TEN)),
        dataset("gone", lastOnly(FAILED_AT_TEN)),
      ],
      now,
    });

    expect(
      getNextFailedRefreshes({
        previous,
        datasets: [
          dataset("ds1", null),
          dataset(
            "fine",
            lastOnly(
              refresh({
                status: DataBiRefreshStatus.Completed,
                startedAt: "2026-11-10T10:00:00.000Z",
                endedAt: "2026-11-10T10:02:00.000Z",
              }),
            ),
          ),
        ],
        now,
      }),
    ).toEqual([]);
  });

  test("what a dataset writes: 1 while it fails, 0 for the hour after it recovered, then nothing", () => {
    const failing: DataBiFailedRefresh = {
      datasetId: "ds1",
      datasetName: "Sales",
      workspace: "Finance",
      status: DataBiRefreshStatus.Failed,
      failedAt: "2026-11-10T10:04:00.000Z",
      error: null,
      recoveredAt: null,
    };
    const recovered: DataBiFailedRefresh = {
      ...failing,
      recoveredAt: "2026-11-10T12:00:00.000Z",
    };

    expect(getDataBiRefreshFailedValue(failing, now)).toBe(1);
    expect(
      getDataBiRefreshFailedValue(
        recovered,
        new Date("2026-11-10T12:59:59.000Z"),
      ),
    ).toBe(0);
    expect(
      getDataBiRefreshFailedValue(
        recovered,
        new Date(
          Date.parse("2026-11-10T12:00:00.000Z") +
            DATA_BI_REFRESH_RECOVERY_WINDOW_IN_MS,
        ),
      ),
    ).toBe(null);
  });

  test("what is kept is read strictly: anything that does not fit is left out", () => {
    expect(
      readDataBiFailedRefreshes([
        {
          datasetId: "DS1",
          datasetName: "Sales",
          workspace: "Finance",
          status: DataBiRefreshStatus.Failed,
          failedAt: "2026-11-10T10:04:00.000Z",
          error: "GatewayOffline",
          recoveredAt: "not a time",
        },
        // The same dataset twice, a refresh that completed, no id, no status.
        { datasetId: "ds1", status: DataBiRefreshStatus.Cancelled },
        { datasetId: "ds2", status: DataBiRefreshStatus.Completed },
        { status: DataBiRefreshStatus.Failed },
        { datasetId: "ds3" },
        "a string",
        null,
      ]),
    ).toEqual([
      {
        datasetId: "ds1",
        datasetName: "Sales",
        workspace: "Finance",
        status: DataBiRefreshStatus.Failed,
        failedAt: "2026-11-10T10:04:00.000Z",
        error: "GatewayOffline",
        recoveredAt: null,
      },
    ]);
    expect(readDataBiFailedRefreshes({ datasetId: "ds1" })).toEqual([]);
    expect(readDataBiFailedRefreshes(null)).toEqual([]);
  });
});

/*
 * A dataset's hours, as OneUptime sees them: the hourly reads of Power BI's
 * refreshables, and every five-minute check between them. The value it
 * writes at each check is what its monitor reads.
 */
function checksAfterReads(
  reads: Array<{ at: string; history: DataDashboardRefreshHistory | null }>,
  checksAfterLastRead: number = 12,
): Array<{ at: Date; value: number | null }> {
  let kept: Array<DataBiFailedRefresh> = [];
  const checks: Array<{ at: Date; value: number | null }> = [];

  reads.forEach(
    (
      read: { at: string; history: DataDashboardRefreshHistory | null },
      index: number,
    ) => {
      const readAt: number = Date.parse(read.at);

      kept = getNextFailedRefreshes({
        previous: kept,
        datasets: [dataset("ds1", read.history)],
        now: new Date(readAt),
      });

      const until: number =
        index + 1 < reads.length
          ? Date.parse(reads[index + 1]!.at)
          : readAt + checksAfterLastRead * FIVE_MINUTES_IN_MS;

      for (
        let at: number = readAt + FIVE_MINUTES_IN_MS;
        at <= until;
        at += FIVE_MINUTES_IN_MS
      ) {
        const value: number | null = kept[0]
          ? getDataBiRefreshFailedValue(kept[0], new Date(at))
          : null;

        checks.push({ at: new Date(at), value });
      }
    },
  );

  return checks;
}

// How many times the checks start finding the dataset failing: each is a new alert.
function alertsOpened(checks: Array<{ value: number | null }>): number {
  return checks.filter(
    (check: { value: number | null }, index: number): boolean => {
      return check.value === 1 && checks[index - 1]?.value !== 1;
    },
  ).length;
}

describe("a failed refresh, hour by hour", () => {
  test("opens one alert, kept open while retries run and fail, and resolves once a refresh completes", () => {
    const checks: Array<{ at: Date; value: number | null }> = checksAfterReads(
      [
        // Fine.
        {
          at: "2026-11-10T09:30:00.000Z",
          history: lastOnly(
            refresh({
              status: DataBiRefreshStatus.Completed,
              startedAt: "2026-11-10T09:00:00.000Z",
              endedAt: "2026-11-10T09:05:00.000Z",
            }),
          ),
        },
        // Failed at 10:04, read at 10:30.
        { at: "2026-11-10T10:30:00.000Z", history: lastOnly(FAILED_AT_TEN) },
        // Read again an hour later: the same failure.
        { at: "2026-11-10T11:30:00.000Z", history: lastOnly(FAILED_AT_TEN) },
        // A retry running: only the last refresh is listed, and it has not ended.
        {
          at: "2026-11-10T12:30:00.000Z",
          history: lastOnly(
            refresh({
              status: DataBiRefreshStatus.Unknown,
              startedAt: "2026-11-10T12:25:00.000Z",
            }),
          ),
        },
        // The retry failed too.
        {
          at: "2026-11-10T13:30:00.000Z",
          history: lastOnly(
            refresh({
              status: DataBiRefreshStatus.Failed,
              startedAt: "2026-11-10T12:25:00.000Z",
              endedAt: "2026-11-10T12:40:00.000Z",
            }),
          ),
        },
        // Completed at 14:10.
        {
          at: "2026-11-10T14:30:00.000Z",
          history: lastOnly(
            refresh({
              status: DataBiRefreshStatus.Completed,
              startedAt: "2026-11-10T14:00:00.000Z",
              endedAt: "2026-11-10T14:10:00.000Z",
            }),
          ),
        },
      ],
      15,
    );
    const valueAt: (at: string) => number | null = (
      at: string,
    ): number | null => {
      return (
        checks.find((check: { at: Date }): boolean => {
          return check.at.toISOString() === at;
        })?.value ?? null
      );
    };

    expect(alertsOpened(checks)).toBe(1);
    // Nothing while it was fine.
    expect(valueAt("2026-11-10T10:00:00.000Z")).toBe(null);
    // Failing from the first check after the read that found it, through every read after.
    expect(valueAt("2026-11-10T10:35:00.000Z")).toBe(1);
    expect(valueAt("2026-11-10T12:45:00.000Z")).toBe(1);
    expect(valueAt("2026-11-10T14:30:00.000Z")).toBe(1);
    // Recovered at the read that found the refresh completed, for an hour.
    expect(valueAt("2026-11-10T14:35:00.000Z")).toBe(0);
    expect(valueAt("2026-11-10T15:25:00.000Z")).toBe(0);
    expect(valueAt("2026-11-10T15:30:00.000Z")).toBe(null);
    expect(
      checks
        .filter((check: { value: number | null }): boolean => {
          return check.value === 1;
        })
        .map((check: { at: Date }): string => {
          return check.at.toISOString();
        }),
    ).toHaveLength(48);
  });

  test("a read that cannot read the refreshes keeps the alert open; a new failure after recovery is a new alert", () => {
    const checks: Array<{ at: Date; value: number | null }> = [];
    let kept: Array<DataBiFailedRefresh> = [];
    const readAt: (
      at: string,
      history: DataDashboardRefreshHistory | undefined,
    ) => void = (
      at: string,
      history: DataDashboardRefreshHistory | undefined,
    ): void => {
      kept = getNextFailedRefreshes({
        previous: kept,
        datasets: [dataset("ds1", history)],
        now: new Date(at),
      });

      for (let step: number = 1; step <= 12; step++) {
        const checkAt: Date = new Date(
          Date.parse(at) + step * FIVE_MINUTES_IN_MS,
        );

        checks.push({
          at: checkAt,
          value: kept[0] ? getDataBiRefreshFailedValue(kept[0], checkAt) : null,
        });
      }
    };

    readAt("2026-11-10T10:30:00.000Z", lastOnly(FAILED_AT_TEN));
    // Power BI refused the list this hour: not read.
    readAt("2026-11-10T11:30:00.000Z", undefined);
    readAt(
      "2026-11-10T12:30:00.000Z",
      lastOnly(
        refresh({
          status: DataBiRefreshStatus.Completed,
          startedAt: "2026-11-10T12:00:00.000Z",
          endedAt: "2026-11-10T12:05:00.000Z",
        }),
      ),
    );
    readAt(
      "2026-11-10T13:30:00.000Z",
      lastOnly(
        refresh({
          status: DataBiRefreshStatus.Failed,
          startedAt: "2026-11-10T13:00:00.000Z",
          endedAt: "2026-11-10T13:01:00.000Z",
        }),
      ),
    );

    expect(
      checks.slice(0, 24).every((check: { value: number | null }) => {
        return check.value === 1;
      }),
    ).toBe(true);
    // Recovered at 12:30: 0 for the hour after, and nothing once the hour is up.
    expect(
      checks.slice(24, 35).every((check: { value: number | null }) => {
        return check.value === 0;
      }),
    ).toBe(true);
    expect(checks[35]).toEqual({
      at: new Date("2026-11-10T13:30:00.000Z"),
      value: null,
    });
    expect(alertsOpened(checks)).toBe(2);
    expect(HOUR_IN_MS).toBe(12 * FIVE_MINUTES_IN_MS);
  });
});

describe("the monitor of a Power BI tool's failed refreshes", () => {
  const step: MonitorStep = buildDataBiRefreshMonitorStep({
    dataBiConnectionId: "11111111-1111-4111-8111-111111111111",
    toolName: "Finance Power BI",
    monitorName: getDataBiRefreshMonitorName("Finance Power BI"),
    onlineMonitorStatusId: new ObjectID("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"),
    offlineMonitorStatusId: new ObjectID(
      "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    ),
    defaultIncidentSeverityId: new ObjectID(
      "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    ),
    defaultAlertSeverityId: new ObjectID(
      "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    ),
  });

  test("reads the tool's datasets, one series per dataset, over two checks", () => {
    const query: JSONObject = JSON.parse(
      JSON.stringify(
        step.data!.metricMonitor!.metricViewConfig.queryConfigs[0],
      ),
    ) as JSONObject;
    const queryData: JSONObject = query["metricQueryData"] as JSONObject;
    const filterData: JSONObject = queryData["filterData"] as JSONObject;

    expect(getDataBiRefreshMonitorName("Finance Power BI")).toBe(
      "Finance Power BI - Failed Refreshes",
    );
    expect(step.data!.metricMonitor!.rollingTime).toBe(
      RollingTime.Past10Minutes,
    );
    expect(filterData["metricName"]).toBe(DataBiMetricName.RefreshFailed);
    expect(filterData["attributes"]).toEqual({
      [DataBiAttribute.ConnectionId]: "11111111-1111-4111-8111-111111111111",
    });
    expect(filterData["aggegationType"]).toBe(MetricsAggregationType.Max);
    expect(queryData["groupByAttributeKeys"]).toEqual([
      DataBiAttribute.DatasetName,
      DataBiAttribute.Workspace,
    ]);
    expect(DATA_BI_REFRESH_GROUP_BY_ATTRIBUTES).toEqual([
      DataBiAttribute.DatasetName,
      DataBiAttribute.Workspace,
    ]);
  });

  test("opens an alert, not an incident, at the first check that finds a dataset failing, and is healthy once every check finds none", () => {
    const criteria: Array<JSONObject> = (
      step.data!.monitorCriteria.data!.monitorCriteriaInstanceArray || []
    ).map((instance: { data?: unknown }) => {
      return JSON.parse(JSON.stringify(instance.data)) as JSONObject;
    });
    const unhealthy: JSONObject = criteria[0]!;
    const healthy: JSONObject = criteria[1]!;
    const unhealthyFilter: JSONObject = (
      unhealthy["filters"] as JSONArray
    )[0] as JSONObject;
    const healthyFilter: JSONObject = (
      healthy["filters"] as JSONArray
    )[0] as JSONObject;

    expect(criteria).toHaveLength(2);
    expect(unhealthy["createAlerts"]).toBe(true);
    expect(unhealthy["createIncidents"]).toBe(false);
    expect((unhealthy["alerts"] as JSONArray).length).toBe(1);
    expect(
      ((unhealthy["alerts"] as JSONArray)[0] as JSONObject)["autoResolveAlert"],
    ).toBe(true);
    expect(((unhealthy["alerts"] as JSONArray)[0] as JSONObject)["title"]).toBe(
      "[Data] Power BI Refresh Failed - Finance Power BI",
    );
    expect(JSON.stringify(unhealthy["monitorStatusId"])).toContain(
      "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    );
    expect(unhealthyFilter["filterType"]).toBe(FilterType.GreaterThan);
    expect(unhealthyFilter["value"]).toBe(0);
    expect(
      (unhealthyFilter["metricMonitorOptions"] as JSONObject)[
        "metricAggregationType"
      ],
    ).toBe(EvaluateOverTimeType.AnyValue);
    expect(JSON.stringify(healthy["monitorStatusId"])).toContain(
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    );
    expect(healthyFilter["filterType"]).toBe(FilterType.LessThanOrEqualTo);
    expect(healthyFilter["value"]).toBe(0);
    expect(
      (healthyFilter["metricMonitorOptions"] as JSONObject)[
        "metricAggregationType"
      ],
    ).toBe(EvaluateOverTimeType.AllValues);
  });
});

describe("the five-minute check of failed refreshes", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  const projectId: ObjectID = new ObjectID(
    "22222222-2222-4222-8222-222222222222",
  );
  const connectionId: ObjectID = new ObjectID(
    "11111111-1111-4111-8111-111111111111",
  );
  const now: Date = new Date("2026-11-10T12:30:00.000Z");
  const failing: DataBiFailedRefresh = {
    datasetId: "ds1",
    datasetName: "Sales",
    workspace: "Finance",
    status: DataBiRefreshStatus.Failed,
    failedAt: "2026-11-10T10:04:00.000Z",
    error: "GatewayOffline",
    recoveredAt: null,
  };

  function connection(refreshes: Array<DataBiFailedRefresh>): DataBiConnection {
    const model: DataBiConnection = new DataBiConnection();

    model._id = connectionId.toString();
    model.projectId = projectId;
    model.name = "Finance Power BI";
    model.failedRefreshes = refreshes as unknown as JSONArray;

    return model;
  }

  test("a row is tagged with the dataset and its tool, OneUptime's own operational data", () => {
    const row: JSONObject = buildBiRefreshMetricRow({
      projectId,
      dataBiConnectionId: connectionId,
      connectionName: "Finance Power BI",
      refresh: failing,
      value: 1,
      at: now,
      retentionDays: 15,
    });

    expect(row["name"]).toBe("oneuptime.data.bi.refresh_failed");
    expect(row["primaryEntityType"]).toBe(ServiceType.DataBiConnection);
    expect(row["primaryEntityId"]).toBe(connectionId.toString());
    expect(row["projectId"]).toBe(projectId.toString());
    expect(row["value"]).toBe(1);
    expect(row["attributes"]).toEqual({
      [DataBiAttribute.ConnectionId]: connectionId.toString(),
      [DataBiAttribute.ConnectionName]: "Finance Power BI",
      [DataBiAttribute.DatasetId]: "ds1",
      [DataBiAttribute.DatasetName]: "Sales",
      [DataBiAttribute.Workspace]: "Finance",
    });
  });

  test("each dataset kept writes what it is now: failing, recovered within the hour, or nothing", () => {
    const rows: Array<JSONObject> = getBiRefreshMetricRows({
      connection: connection([
        failing,
        {
          ...failing,
          datasetId: "ds2",
          datasetName: "Stock",
          recoveredAt: "2026-11-10T12:00:00.000Z",
        },
        {
          ...failing,
          datasetId: "ds3",
          datasetName: "Old",
          recoveredAt: "2026-11-10T11:00:00.000Z",
        },
      ]),
      now,
      retentionDays: 15,
    });

    expect(
      rows.map((row: JSONObject): string => {
        return `${(row["attributes"] as JSONObject)[DataBiAttribute.DatasetName]} ${row["value"]}`;
      }),
    ).toEqual(["Sales 1", "Stock 0"]);
  });

  test("reads the enabled Power BI tools with datasets kept, and writes their rows, stamped now", async () => {
    const findBy: jest.SpyInstance = jest
      .spyOn(DataBiConnectionService, "findBy")
      .mockResolvedValue([
        connection([failing]),
      ]) as unknown as jest.SpyInstance;

    jest.spyOn(MonitorMetricUtil, "getRetentionDays").mockResolvedValue(15);
    const insert: jest.SpyInstance = jest
      .spyOn(MetricService, "insertJsonRows")
      .mockResolvedValue(undefined as never) as unknown as jest.SpyInstance;
    const index: jest.SpyInstance = jest
      .spyOn(TelemetryUtil, "indexMetricNameServiceNameMap")
      .mockResolvedValue(undefined as never) as unknown as jest.SpyInstance;

    expect(await DataBiRefreshCheck.checkAll(now)).toBe(1);

    const query: JSONObject = (
      findBy.mock.calls[0]![0] as { query: JSONObject }
    ).query;

    expect(query["tool"]).toBe(DataBiTool.PowerBI);
    expect(query["isEnabled"]).toBe(true);
    expect(query["failedRefreshes"]).toBeDefined();

    const rows: Array<JSONObject> = insert.mock
      .calls[0]![0] as Array<JSONObject>;

    expect(rows).toHaveLength(1);
    expect(rows[0]!["time"]).toBe("2026-11-10 12:30:00");
    expect(
      Object.keys(
        (index.mock.calls[0]![0] as { metricNameServiceNameMap: JSONObject })
          .metricNameServiceNameMap,
      ),
    ).toEqual([DataBiMetricName.RefreshFailed]);
  });
});

describe("keeping a Power BI tool's monitor in step with its switch", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  const projectId: ObjectID = new ObjectID(
    "22222222-2222-4222-8222-222222222222",
  );
  const connectionId: ObjectID = new ObjectID(
    "11111111-1111-4111-8111-111111111111",
  );
  const monitorId: ObjectID = new ObjectID(
    "33333333-3333-4333-8333-333333333333",
  );
  const props: { userId: ObjectID; tenantId: ObjectID } = {
    userId: new ObjectID("44444444-4444-4444-8444-444444444444"),
    tenantId: projectId,
  };

  function tool(data: {
    tool?: DataBiTool;
    alertOnFailedRefreshes?: boolean;
    refreshMonitorId?: ObjectID;
  }): DataBiConnection {
    const model: DataBiConnection = new DataBiConnection();

    model._id = connectionId.toString();
    model.name = "Finance Power BI";
    model.tool = data.tool || DataBiTool.PowerBI;

    if (data.alertOnFailedRefreshes !== undefined) {
      model.alertOnFailedRefreshes = data.alertOnFailedRefreshes;
    }

    if (data.refreshMonitorId) {
      model.refreshMonitorId = data.refreshMonitorId;
    }

    return model;
  }

  function seedProject(): void {
    jest
      .spyOn(MonitorStatusService, "findOneBy")
      .mockImplementation((async (args: { query: JSONObject }) => {
        const status: { _id: string } = {
          _id:
            args.query["isOperationalState"] === true
              ? "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
              : "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        };

        return { ...status, id: new ObjectID(status._id) };
      }) as never);
    jest.spyOn(IncidentSeverityService, "findOneBy").mockResolvedValue({
      id: new ObjectID("cccccccc-cccc-4ccc-8ccc-cccccccccccc"),
    } as never);
    jest.spyOn(AlertSeverityService, "findOneBy").mockResolvedValue({
      id: new ObjectID("dddddddd-dddd-4ddd-8ddd-dddddddddddd"),
    } as never);
  }

  test("a Power BI tool that alerts gets one Metrics monitor, made as the person who saved it", async () => {
    jest
      .spyOn(DataBiConnectionService, "findOneBy")
      .mockResolvedValue(tool({ alertOnFailedRefreshes: true }));
    seedProject();
    const create: jest.SpyInstance = jest
      .spyOn(MonitorService, "create")
      .mockImplementation((async (args: { data: Monitor }) => {
        args.data.id = monitorId;

        return args.data;
      }) as never) as unknown as jest.SpyInstance;
    const save: jest.SpyInstance = jest
      .spyOn(DataBiConnectionService, "updateColumnsByIdWithoutHooks")
      .mockResolvedValue(undefined as never) as unknown as jest.SpyInstance;

    expect(
      await DataBiRefreshAlerts.sync({
        projectId,
        dataBiConnectionId: connectionId,
        props: props as never,
      }),
    ).toEqual({ monitorId: monitorId.toString() });

    const created: { data: Monitor; props: unknown } = create.mock
      .calls[0]![0] as { data: Monitor; props: unknown };
    const steps: MonitorSteps = created.data.monitorSteps!;
    const query: string = JSON.stringify(
      steps.data!.monitorStepsInstanceArray[0]!.data!.metricMonitor,
    );

    expect(created.props).toBe(props);
    expect(created.data.name).toBe("Finance Power BI - Failed Refreshes");
    expect(created.data.monitorType).toBe(MonitorType.Metrics);
    expect(created.data.projectId?.toString()).toBe(projectId.toString());
    expect(query).toContain(DataBiMetricName.RefreshFailed);
    expect(query).toContain(connectionId.toString());
    expect(save.mock.calls[0]![0]).toEqual({
      id: connectionId,
      data: { refreshMonitorId: monitorId },
    });
  });

  test("saving the tool again keeps its monitor as it is, renamed with the tool", async () => {
    jest
      .spyOn(DataBiConnectionService, "findOneBy")
      .mockResolvedValue(
        tool({ alertOnFailedRefreshes: true, refreshMonitorId: monitorId }),
      );
    const findMonitor: jest.SpyInstance = jest
      .spyOn(MonitorService, "findOneBy")
      .mockResolvedValue({
        id: monitorId,
        name: "Finance Power BI - Failed Refreshes",
      } as never) as unknown as jest.SpyInstance;
    const create: jest.SpyInstance = jest.spyOn(
      MonitorService,
      "create",
    ) as unknown as jest.SpyInstance;
    const update: jest.SpyInstance = jest
      .spyOn(MonitorService, "updateOneById")
      .mockResolvedValue(undefined as never) as unknown as jest.SpyInstance;

    expect(
      await DataBiRefreshAlerts.sync({
        projectId,
        dataBiConnectionId: connectionId,
        props: props as never,
      }),
    ).toEqual({ monitorId: monitorId.toString() });
    expect(create).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();

    findMonitor.mockResolvedValue({
      id: monitorId,
      name: "Old name - Failed Refreshes",
    } as never);

    await DataBiRefreshAlerts.sync({
      projectId,
      dataBiConnectionId: connectionId,
      props: props as never,
    });

    // Only the name: its steps, owners and on-call policies are the person's own now.
    expect(update.mock.calls[0]![0]).toEqual({
      id: monitorId,
      data: { name: "Finance Power BI - Failed Refreshes" },
      props,
    });
  });

  test("a monitor deleted on the Monitors page is made again", async () => {
    jest
      .spyOn(DataBiConnectionService, "findOneBy")
      .mockResolvedValue(
        tool({ alertOnFailedRefreshes: true, refreshMonitorId: monitorId }),
      );
    jest.spyOn(MonitorService, "findOneBy").mockResolvedValue(null);
    seedProject();
    const create: jest.SpyInstance = jest
      .spyOn(MonitorService, "create")
      .mockImplementation((async (args: { data: Monitor }) => {
        args.data.id = new ObjectID("55555555-5555-4555-8555-555555555555");

        return args.data;
      }) as never) as unknown as jest.SpyInstance;

    jest
      .spyOn(DataBiConnectionService, "updateColumnsByIdWithoutHooks")
      .mockResolvedValue(undefined as never);

    expect(
      await DataBiRefreshAlerts.sync({
        projectId,
        dataBiConnectionId: connectionId,
        props: props as never,
      }),
    ).toEqual({ monitorId: "55555555-5555-4555-8555-555555555555" });
    expect(create).toHaveBeenCalledTimes(1);
  });

  test("switching it off removes the monitor, as the person who saved it", async () => {
    jest
      .spyOn(DataBiConnectionService, "findOneBy")
      .mockResolvedValue(
        tool({ alertOnFailedRefreshes: false, refreshMonitorId: monitorId }),
      );
    jest.spyOn(MonitorService, "findOneBy").mockResolvedValue({
      id: monitorId,
      name: "Finance Power BI - Failed Refreshes",
    } as never);
    const remove: jest.SpyInstance = jest
      .spyOn(MonitorService, "deleteOneBy")
      .mockResolvedValue(undefined as never) as unknown as jest.SpyInstance;
    const save: jest.SpyInstance = jest
      .spyOn(DataBiConnectionService, "updateColumnsByIdWithoutHooks")
      .mockResolvedValue(undefined as never) as unknown as jest.SpyInstance;

    expect(
      await DataBiRefreshAlerts.sync({
        projectId,
        dataBiConnectionId: connectionId,
        props: props as never,
      }),
    ).toEqual({ monitorId: null });
    expect(remove.mock.calls[0]![0]).toEqual({
      query: { _id: monitorId, projectId },
      props,
    });
    expect(save.mock.calls[0]![0]).toEqual({
      id: connectionId,
      data: { refreshMonitorId: null },
    });
  });

  test("a tool that is not Power BI never has one", async () => {
    jest
      .spyOn(DataBiConnectionService, "findOneBy")
      .mockResolvedValue(
        tool({ tool: DataBiTool.Metabase, alertOnFailedRefreshes: true }),
      );
    const create: jest.SpyInstance = jest.spyOn(
      MonitorService,
      "create",
    ) as unknown as jest.SpyInstance;

    expect(
      await DataBiRefreshAlerts.sync({
        projectId,
        dataBiConnectionId: connectionId,
        props: props as never,
      }),
    ).toEqual({ monitorId: null });
    expect(create).not.toHaveBeenCalled();
  });

  test("a tool of another project is not found", async () => {
    jest.spyOn(DataBiConnectionService, "findOneBy").mockResolvedValue(null);

    await expect(
      DataBiRefreshAlerts.sync({
        projectId,
        dataBiConnectionId: connectionId,
        props: props as never,
      }),
    ).rejects.toThrow("No such BI tool in this project.");
  });

  test("deleting the tool deletes its monitor", async () => {
    const remove: jest.SpyInstance = jest
      .spyOn(MonitorService, "deleteBy")
      .mockResolvedValue(undefined as never) as unknown as jest.SpyInstance;
    const deleted: DataBiConnection = tool({ refreshMonitorId: monitorId });
    const kept: DataBiConnection = new DataBiConnection();

    deleted.projectId = projectId;
    kept._id = "66666666-6666-4666-8666-666666666666";
    kept.projectId = projectId;
    kept.refreshMonitorId = new ObjectID(
      "77777777-7777-4777-8777-777777777777",
    );

    await (
      DataBiConnectionService as unknown as {
        onDeleteSuccess: (
          onDelete: { carryForward: unknown },
          deletedIds: Array<ObjectID>,
        ) => Promise<unknown>;
      }
    ).onDeleteSuccess({ carryForward: { tools: [deleted, kept] } }, [
      connectionId,
    ]);

    expect(remove).toHaveBeenCalledTimes(1);
    expect((remove.mock.calls[0]![0] as { query: JSONObject }).query).toEqual({
      _id: monitorId,
      projectId,
    });
  });
});

describe("the datasets Power BI's reader returns, and what the sync keeps of them", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  const scan: JSONObject = {
    workspaces: [
      {
        id: "w1",
        name: "Finance",
        isOnDedicatedCapacity: true,
        reports: [
          { id: "R1", name: "Revenue", datasetId: "DS1" },
          { id: "R2", name: "Revenue again", datasetId: "DS1" },
          { id: "R3", name: "Refunds", datasetId: "DS2" },
        ],
        dashboards: [],
        datasets: [
          { id: "DS1", name: "Sales", tables: [] },
          { id: "DS2", name: "Refunds model", tables: [] },
          // Behind no report or dashboard: not read.
          { id: "DS3", name: "Unused", tables: [] },
        ],
      },
    ],
  };

  function transport(
    refreshables: unknown,
  ): (request: DataSourceHttpRequest) => Promise<DataSourceHttpResponse> {
    return async (
      request: DataSourceHttpRequest,
    ): Promise<DataSourceHttpResponse> => {
      const url: string = request.url;
      const answer: (
        body: unknown,
        statusCode?: number,
      ) => DataSourceHttpResponse = (
        body: unknown,
        statusCode: number = 200,
      ): DataSourceHttpResponse => {
        return { statusCode, bodyText: JSON.stringify(body), bodyJson: body };
      };

      if (url.startsWith("https://login.microsoftonline.com/")) {
        return answer({ access_token: "aad" });
      }

      if (url.includes("/admin/workspaces/modified")) {
        return answer([{ id: "w1" }]);
      }

      if (url.includes("/admin/workspaces/getInfo")) {
        return answer({ id: "scan1" });
      }

      if (url.includes("/scanStatus/")) {
        return answer({ status: "Succeeded" });
      }

      if (url.includes("/scanResult/")) {
        return answer(scan);
      }

      if (url.includes("/admin/capacities/refreshables")) {
        return refreshables instanceof Error
          ? answer({ error: { message: refreshables.message } }, 403)
          : answer(refreshables);
      }

      return answer({ activityEventEntities: [], lastResultSet: true });
    };
  }

  test("each dataset behind a report or dashboard, once, with its name, workspace and refreshes", async () => {
    const read: BiToolRead = await PowerBiConnector.read({
      baseUrl: "",
      credentials: { tenantId: "t", clientId: "c", clientSecret: "s" },
      wait: async (): Promise<void> => {},
      now: new Date("2026-11-10T10:30:00.000Z"),
      transport: transport({
        value: [
          {
            id: "ds1",
            lastRefresh: {
              status: "Completed",
              startTime: "2026-11-10T05:00:00Z",
              endTime: "2026-11-10T05:03:00Z",
            },
          },
          {
            id: "DS2",
            lastRefresh: {
              status: "Failed",
              startTime: "2026-11-10T04:00:00Z",
              endTime: "2026-11-10T04:01:00Z",
              serviceExceptionJson: '{"errorCode":"GatewayOffline"}',
            },
          },
        ],
      }),
    });

    expect(
      (read.datasets || []).map((item: DataBiDatasetRead): JSONObject => {
        return {
          datasetId: item.datasetId,
          name: item.name,
          workspace: item.workspace,
          last: item.refresh?.last?.status || null,
          error: item.refresh?.last?.error || null,
        };
      }),
    ).toEqual([
      {
        datasetId: "ds1",
        name: "Sales",
        workspace: "Finance",
        last: DataBiRefreshStatus.Completed,
        error: null,
      },
      {
        datasetId: "ds2",
        name: "Refunds model",
        workspace: "Finance",
        last: DataBiRefreshStatus.Failed,
        error: "GatewayOffline",
      },
    ]);
  });

  test("refreshes that cannot be read are undefined: what was kept stays", async () => {
    const read: BiToolRead = await PowerBiConnector.read({
      baseUrl: "",
      credentials: { tenantId: "t", clientId: "c", clientSecret: "s" },
      wait: async (): Promise<void> => {},
      now: new Date("2026-11-10T10:30:00.000Z"),
      transport: transport(new Error("Unauthorized")),
    });

    expect(
      (read.datasets || []).map((item: DataBiDatasetRead): unknown => {
        return item.refresh;
      }),
    ).toEqual([undefined, undefined]);
  });

  function powerBiTool(
    failedRefreshes?: Array<DataBiFailedRefresh>,
  ): DataBiConnection {
    const model: DataBiConnection = new DataBiConnection();

    model._id = ObjectID.generate().toString();
    model.projectId = ObjectID.generate();
    model.tool = DataBiTool.PowerBI;
    model.credentials = JSON.stringify({
      tenantId: "t",
      clientId: "c",
      clientSecret: "s",
    });

    if (failedRefreshes) {
      model.failedRefreshes = failedRefreshes as unknown as JSONArray;
    }

    return model;
  }

  function mockRead(read: BiToolRead): jest.SpyInstance {
    jest.spyOn(PowerBiConnector, "read").mockResolvedValue(read);
    jest.spyOn(OpenLineageIngest, "readCatalog").mockResolvedValue({
      stores: [],
      assets: [],
      storeNames: new Map(),
    });
    jest.spyOn(DataDashboardService, "findBy").mockResolvedValue([]);

    return jest
      .spyOn(DataBiConnectionService, "updateOneById")
      .mockResolvedValue(undefined as never) as unknown as jest.SpyInstance;
  }

  test("each read keeps on the tool the datasets failing now, by what it read", async () => {
    const was: DataBiFailedRefresh = {
      datasetId: "ds1",
      datasetName: "Sales",
      workspace: "Finance",
      status: DataBiRefreshStatus.Failed,
      failedAt: "2026-11-10T04:01:00.000Z",
      error: "GatewayOffline",
      recoveredAt: null,
    };
    const connection: DataBiConnection = powerBiTool([was]);

    jest
      .spyOn(DataBiConnectionService, "findOneById")
      .mockResolvedValue(connection);
    const update: jest.SpyInstance = mockRead({
      dashboards: [],
      usage: null,
      warnings: [],
      datasets: [
        dataset(
          "ds1",
          lastOnly(
            refresh({
              status: DataBiRefreshStatus.Completed,
              startedAt: "2026-11-10T09:00:00.000Z",
              endedAt: "2026-11-10T09:05:00.000Z",
            }),
          ),
        ),
        dataset("ds2", lastOnly(FAILED_AT_TEN), "Stock"),
      ],
    });

    expect((await DataBiSync.syncConnection(connection.id!)).error).toBe(null);

    const kept: Array<DataBiFailedRefresh> = readDataBiFailedRefreshes(
      (update.mock.calls[0]![0] as { data: JSONObject }).data[
        "failedRefreshes"
      ],
    );

    expect(kept).toHaveLength(2);
    expect({ ...kept[0], recoveredAt: null }).toEqual(was);
    expect(Number.isNaN(Date.parse(kept[0]!.recoveredAt || ""))).toBe(false);
    expect(kept[1]).toEqual({
      datasetId: "ds2",
      datasetName: "Stock",
      workspace: "Finance",
      status: DataBiRefreshStatus.Failed,
      failedAt: "2026-11-10T10:04:00.000Z",
      error: "GatewayOffline: the gateway is offline",
      recoveredAt: null,
    });
  });

  test("none failing is kept as none; a tool that says nothing of datasets keeps what it had", async () => {
    const connection: DataBiConnection = powerBiTool();

    jest
      .spyOn(DataBiConnectionService, "findOneById")
      .mockResolvedValue(connection);
    const update: jest.SpyInstance = mockRead({
      dashboards: [],
      usage: null,
      warnings: [],
      datasets: [],
    });

    await DataBiSync.syncConnection(connection.id!);

    const data: JSONObject = (update.mock.calls[0]![0] as { data: JSONObject })
      .data;

    expect(data["failedRefreshes"]).toBe(null);

    update.mockClear();
    (PowerBiConnector.read as unknown as jest.SpyInstance).mockResolvedValue({
      dashboards: [],
      usage: null,
      warnings: [],
    } as never);

    await DataBiSync.syncConnection(connection.id!);

    expect(
      Object.keys((update.mock.calls[0]![0] as { data: JSONObject }).data),
    ).not.toContain("failedRefreshes");
  });
});
