/*
 * MonitorResource reaches the native isolated-vm addon through the criteria
 * evaluator's sandbox runner. Nothing here runs a sandbox, and the prebuilt
 * binary cannot always dlopen in the test environment.
 */
jest.mock("isolated-vm", () => {
  return {};
});

import MonitorResourceUtil from "../../../../Server/Utils/Monitor/MonitorResource";
import MonitorIncident from "../../../../Server/Utils/Monitor/MonitorIncident";
import MonitorAlert from "../../../../Server/Utils/Monitor/MonitorAlert";
import MonitorLogUtil from "../../../../Server/Utils/Monitor/MonitorLogUtil";
import MonitorProbeLastResults from "../../../../Server/Utils/Monitor/MonitorProbeLastResults";
import MonitorStatusTimelineUtil from "../../../../Server/Utils/Monitor/MonitorStatusTimeline";
import MonitorSummaryCapture from "../../../../Server/Utils/Monitor/MonitorSummaryCapture";
import MonitorMaintenanceSuppression from "../../../../Server/Utils/Monitor/MonitorMaintenanceSuppression";
import MonitorDependencySuppression from "../../../../Server/Utils/Monitor/MonitorDependencySuppression";
import TelemetryUtil from "../../../../Server/Utils/Telemetry/Telemetry";
import GlobalCache from "../../../../Server/Infrastructure/GlobalCache";
import AlertService from "../../../../Server/Services/AlertService";
import AlertStateService from "../../../../Server/Services/AlertStateService";
import GlobalConfigService from "../../../../Server/Services/GlobalConfigService";
import IncidentService from "../../../../Server/Services/IncidentService";
import IncidentStateService from "../../../../Server/Services/IncidentStateService";
import MetricService, {
  MonitorCheckCondition,
  MonitorCheckSummaryRow,
} from "../../../../Server/Services/MetricService";
import MonitorProbeService from "../../../../Server/Services/MonitorProbeService";
import MonitorService from "../../../../Server/Services/MonitorService";
import MonitorStatusService from "../../../../Server/Services/MonitorStatusService";
import MonitorStatusTimelineService from "../../../../Server/Services/MonitorStatusTimelineService";
import ProjectService from "../../../../Server/Services/ProjectService";
import Semaphore from "../../../../Server/Infrastructure/Semaphore";
import ProjectScopedReferenceValidator from "../../../../Server/Utils/Database/ProjectScopedReferenceValidator";
import FindBy from "../../../../Server/Types/AnalyticsDatabase/FindBy";
import logger from "../../../../Server/Utils/Logger";
import Metric from "../../../../Models/AnalyticsModels/Metric";
import Incident from "../../../../Models/DatabaseModels/Incident";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import MonitorStatusTimeline from "../../../../Models/DatabaseModels/MonitorStatusTimeline";
import InBetween from "../../../../Types/BaseDatabase/InBetween";
import OneUptimeDate from "../../../../Types/Date";
import FilterCondition from "../../../../Types/Filter/FilterCondition";
import { JSONObject } from "../../../../Types/JSON";
import {
  CheckOn,
  CriteriaFilter,
  EvaluateOverTimeType,
  FilterType,
} from "../../../../Types/Monitor/CriteriaFilter";
import MonitorCriteria from "../../../../Types/Monitor/MonitorCriteria";
import MonitorCriteriaInstance from "../../../../Types/Monitor/MonitorCriteriaInstance";
import MonitorStep from "../../../../Types/Monitor/MonitorStep";
import MonitorSteps from "../../../../Types/Monitor/MonitorSteps";
import MonitorType from "../../../../Types/Monitor/MonitorType";
import MonitorMetricType from "../../../../Types/Monitor/MonitorMetricType";
import ObjectID from "../../../../Types/ObjectID";
import { ProbeConnectionStatus } from "../../../../Models/DatabaseModels/Probe";
import ProbeMonitorResponse from "../../../../Types/Probe/ProbeMonitorResponse";
import ProbeApiIngestResponse from "../../../../Types/Probe/ProbeApiIngestResponse";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * THE CUSTOMER'S ACCESS POINT (#10355), end to end on the path every probe
 * result takes: MonitorResourceUtil.monitorResource writes the check's
 * series through the real MonitorMetricUtil, judges it through the real
 * criteria evaluator - its counted window read back from what was written,
 * its All Values window too - and acts on it. Postgres and ClickHouse are
 * stood in for by memory: the metric rows the checks write are the rows
 * their windows read, and the incidents the criteria open are the ones
 * they find open.
 *
 * A Ping monitor checks an access point every minute from one probe:
 *
 *   1. Access point is down: Is Online is False on every check of the last
 *      5 minutes. Offline, and an outage incident.
 *   2. Access point is unstable: Is Online changed more than 5 times in the
 *      last hour. Degraded, and an instability incident - which recovers
 *      only once it has changed at most once in the last hour.
 *   3. Access point is online: Is Online is True. The default status.
 *
 * Before #10355 the second could not be written: a flapping access point
 * matched neither "every check failed" nor nothing.
 */

const START: number = Date.UTC(2026, 10, 23, 8, 0, 30);
const MINUTE: number = 60_000;

const ONLINE: ObjectID = new ObjectID("11111111-1111-4111-8111-111111111111");
const DEGRADED: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");
const OFFLINE: ObjectID = new ObjectID("33333333-3333-4333-8333-333333333333");
const PROBE: ObjectID = new ObjectID("44444444-4444-4444-8444-444444444444");

interface StoredRow {
  projectId: string;
  primaryEntityId: string;
  name: string;
  time: Date;
  value: number | null;
  attributes: JSONObject;
}

interface OpenIncident {
  criteriaId: string;
  title: string;
}

let monitor: Monitor;
let store: Array<StoredRow>;
let openIncidents: Array<OpenIncident>;
let opened: Array<{ title: string; minute: number }>;
let statusAt: Array<{ minute: number; status: string }>;
let summaryReads: number;
let minuteNow: number;

const IS_OFFLINE: CriteriaFilter = {
  checkOn: CheckOn.IsOnline,
  filterType: FilterType.False,
  value: undefined,
};

function changesInTheLastHour(
  countFilterType: FilterType,
  countValue: number,
): CriteriaFilter {
  return {
    ...IS_OFFLINE,
    evaluateOverTime: true,
    evaluateOverTimeOptions: {
      timeValueInMinutes: 60,
      evaluateOverTimeType: EvaluateOverTimeType.StatusChanges,
      countFilterType: countFilterType,
      countValue: countValue,
    },
  };
}

function criteria(input: {
  id: string;
  statusId: ObjectID;
  filters: Array<CriteriaFilter>;
  incidentTitle?: string;
  recoveryFilters?: Array<CriteriaFilter>;
}): MonitorCriteriaInstance {
  const instance: MonitorCriteriaInstance = new MonitorCriteriaInstance();
  instance.data = {
    id: input.id,
    monitorStatusId: input.statusId,
    filterCondition: FilterCondition.All,
    filters: input.filters,
    incidents: input.incidentTitle
      ? [
          {
            id: `${input.id}-incident`,
            title: input.incidentTitle,
            description: "",
            incidentSeverityId: ObjectID.generate(),
            autoResolveIncident: true,
          } as never,
        ]
      : [],
    alerts: [],
    name: input.id,
    description: "",
    changeMonitorStatus: true,
    createIncidents: Boolean(input.incidentTitle),
    createAlerts: false,
    isEnabled: true,
    ...(input.recoveryFilters
      ? {
          recoveryFilters: input.recoveryFilters,
          recoveryFilterCondition: FilterCondition.All,
        }
      : {}),
  };
  return instance;
}

function accessPointStep(): MonitorStep {
  const step: MonitorStep = new MonitorStep();
  step.data!.monitorDestination = undefined;

  const monitorCriteria: MonitorCriteria = new MonitorCriteria();
  monitorCriteria.data = {
    monitorCriteriaInstanceArray: [
      criteria({
        id: "Access point is down",
        statusId: OFFLINE,
        incidentTitle: "Outage: the access point is down",
        filters: [
          {
            ...IS_OFFLINE,
            evaluateOverTime: true,
            evaluateOverTimeOptions: {
              timeValueInMinutes: 5,
              evaluateOverTimeType: EvaluateOverTimeType.AllValues,
            },
          },
        ],
      }),
      criteria({
        id: "Access point is unstable",
        statusId: DEGRADED,
        incidentTitle: "The access point is unstable",
        filters: [changesInTheLastHour(FilterType.GreaterThan, 5)],
        recoveryFilters: [
          changesInTheLastHour(FilterType.LessThanOrEqualTo, 1),
        ],
      }),
      criteria({
        id: "Access point is online",
        statusId: ONLINE,
        filters: [
          {
            checkOn: CheckOn.IsOnline,
            filterType: FilterType.True,
            value: undefined,
          },
        ],
      }),
    ],
  };
  step.data!.monitorCriteria = monitorCriteria;
  return step;
}

function isMet(value: number | null, condition: MonitorCheckCondition): boolean {
  if (value === null) {
    return false;
  }

  switch (condition.comparison) {
    case "gt":
      return value > condition.threshold;
    case "gte":
      return value >= condition.threshold;
    case "lt":
      return value < condition.threshold;
    case "lte":
      return value <= condition.threshold;
    case "eq":
      return value === condition.threshold;
    default:
      return value !== condition.threshold;
  }
}

// What summarizeMonitorChecks's statement computes, over the rows in memory.
function summarize(
  data: Parameters<typeof MetricService.summarizeMonitorChecks>[0],
): Array<MonitorCheckSummaryRow> {
  const groups: Map<string, Array<StoredRow>> = new Map<
    string,
    Array<StoredRow>
  >();

  for (const row of store) {
    if (
      row.projectId !== data.projectId.toString() ||
      row.primaryEntityId !== data.monitorId.toString() ||
      row.name !== data.metricName ||
      row.value === null ||
      row.time.getTime() < data.windowStart.getTime() ||
      row.time.getTime() > data.windowEnd.getTime() ||
      !Object.entries(data.attributes || {}).every(
        ([key, value]: [string, string]): boolean => {
          return row.attributes[key] === value;
        },
      )
    ) {
      continue;
    }

    const key: string = data.groupByAttributeKeys
      .map((attribute: string): string => {
        return String(row.attributes[attribute] ?? "");
      })
      .join("|");

    groups.set(key, [...(groups.get(key) || []), row]);
  }

  return Array.from(groups.values()).map(
    (rows: Array<StoredRow>): MonitorCheckSummaryRow => {
      const sorted: Array<StoredRow> = [...rows].sort(
        (a: StoredRow, b: StoredRow): number => {
          return a.time.getTime() - b.time.getTime();
        },
      );
      const states: Array<boolean> = sorted.map((row: StoredRow): boolean => {
        return isMet(row.value, data.condition);
      });

      const group: Record<string, string> = {};
      for (const attribute of data.groupByAttributeKeys) {
        group[attribute] = String(sorted[0]!.attributes[attribute] ?? "");
      }

      return {
        group: group,
        checkCount: sorted.length,
        matchCount: states.filter(Boolean).length,
        changeCount: states.filter((state: boolean, index: number): boolean => {
          return index > 0 && state !== states[index - 1];
        }).length,
        firstAt: sorted[0]!.time,
        lastAt: sorted[sorted.length - 1]!.time,
        firstMatched: states[0]!,
        lastMatched: states[states.length - 1]!,
      };
    },
  );
}

function statusName(statusId: ObjectID | undefined): string {
  switch (statusId?.toString()) {
    case ONLINE.toString():
      return "Online";
    case DEGRADED.toString():
      return "Degraded";
    case OFFLINE.toString():
      return "Offline";
    default:
      return "none";
  }
}

// One check, at minute `minute` after the start.
async function ping(minute: number, isOnline: boolean): Promise<void> {
  minuteNow = minute;
  jest.setSystemTime(new Date(START + minute * MINUTE));

  const dataToProcess: ProbeMonitorResponse = {
    projectId: monitor.projectId!,
    monitorId: monitor.id!,
    monitorStepId:
      monitor.monitorSteps!.data!.monitorStepsInstanceArray[0]!.id,
    probeId: PROBE,
    failureCause: isOnline ? "" : "Request timed out",
    monitoredAt: OneUptimeDate.getCurrentDate(),
    isOnline: isOnline,
    isTimeout: !isOnline,
    ...(isOnline ? { responseTimeInMs: 12 } : {}),
  } as ProbeMonitorResponse;

  const response: ProbeApiIngestResponse =
    await MonitorResourceUtil.monitorResource(dataToProcess);

  expect(response).toBeDefined();

  statusAt.push({
    minute: minute,
    status: statusName(monitor.currentMonitorStatusId),
  });
}

// The status the monitor had after each minute's check, as runs: "Online x60".
function statusRuns(): Array<string> {
  const runs: Array<string> = [];
  let last: string | null = null;
  let count: number = 0;

  for (const entry of statusAt) {
    if (entry.status === last) {
      count++;
      continue;
    }

    if (last !== null) {
      runs.push(`${last} x${count}`);
    }

    last = entry.status;
    count = 1;
  }

  if (last !== null) {
    runs.push(`${last} x${count}`);
  }

  return runs;
}

describe("A flapping access point is unstable, and one that is down is an outage (#10355)", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date(START));

    store = [];
    openIncidents = [];
    opened = [];
    statusAt = [];
    summaryReads = 0;
    minuteNow = 0;

    monitor = new Monitor();
    monitor.id = new ObjectID("55555555-5555-4555-8555-555555555555");
    monitor.projectId = new ObjectID("66666666-6666-4666-8666-666666666666");
    monitor.name = "Office access point";
    monitor.monitorType = MonitorType.Ping;
    monitor.monitoringInterval = "* * * * *";
    monitor.currentMonitorStatusId = ONLINE;

    const monitorSteps: MonitorSteps = new MonitorSteps();
    monitorSteps.data = {
      monitorStepsInstanceArray: [accessPointStep()],
      defaultMonitorStatusId: ONLINE,
    };
    monitor.monitorSteps = monitorSteps;

    // ClickHouse, in memory: what the checks write is what their windows read.
    jest
      .spyOn(MetricService, "insertJsonRows")
      .mockImplementation(async (rows: Array<JSONObject>): Promise<void> => {
        for (const row of rows) {
          store.push({
            projectId: row["projectId"] as string,
            primaryEntityId: row["primaryEntityId"] as string,
            name: row["name"] as string,
            time: OneUptimeDate.fromString(row["time"] as string),
            value: (row["value"] as number | null) ?? null,
            attributes: (row["attributes"] as JSONObject) || {},
          });
        }
      });
    jest
      .spyOn(MetricService, "findBy")
      .mockImplementation(
        async (findBy: FindBy<Metric>): Promise<Array<Metric>> => {
          const query: JSONObject = findBy.query as unknown as JSONObject;
          const time: InBetween<Date> = query[
            "time"
          ] as unknown as InBetween<Date>;
          const attributes: JSONObject =
            (query["attributes"] as JSONObject) || {};

          return store
            .filter((row: StoredRow): boolean => {
              return (
                row.name === query["name"] &&
                row.primaryEntityId === query["primaryEntityId"]!.toString() &&
                row.time.getTime() >= time.startValue.getTime() &&
                row.time.getTime() <= time.endValue.getTime() &&
                Object.entries(attributes).every(
                  ([key, value]: [string, unknown]): boolean => {
                    return row.attributes[key] === value;
                  },
                )
              );
            })
            .map((row: StoredRow): Metric => {
              const metric: Metric = new Metric();
              metric.value = row.value ?? undefined;
              metric.time = row.time;
              metric.attributes = row.attributes;
              return metric;
            });
        },
      );
    jest
      .spyOn(MetricService, "summarizeMonitorChecks")
      .mockImplementation(
        async (
          data: Parameters<typeof MetricService.summarizeMonitorChecks>[0],
        ): Promise<Array<MonitorCheckSummaryRow>> => {
          summaryReads++;
          return summarize(data);
        },
      );
    jest
      .spyOn(GlobalConfigService, "findOneBy")
      .mockResolvedValue(null as never);
    jest
      .spyOn(TelemetryUtil, "indexMetricNameServiceNameMap")
      .mockResolvedValue(undefined as never);

    // The probe that checks it, connected.
    jest
      .spyOn(MonitorProbeLastResults, "storeResultAndReadProbes")
      .mockImplementation(async () => {
        return {
          probes: [
            {
              monitorProbeId: ObjectID.generate(),
              probeId: PROBE,
              isEnabled: true,
              probeName: "Oslo",
              probeConnectionStatus: ProbeConnectionStatus.Connected,
              resultForJudgedStep: undefined,
            },
          ],
          isResultStored: true,
        } as never;
      });

    // Postgres, in memory: the status the monitor has, and what is open.
    jest
      .spyOn(MonitorStatusTimelineUtil, "updateMonitorStatusTimeline")
      .mockImplementation(async (input: unknown) => {
        const statusId: ObjectID | undefined = (
          input as { criteriaInstance: MonitorCriteriaInstance }
        ).criteriaInstance.data?.monitorStatusId;

        if (statusId) {
          monitor.currentMonitorStatusId = statusId;
        }

        return null as never;
      });
    jest
      .spyOn(MonitorStatusTimelineService, "create")
      .mockImplementation(async (input: unknown) => {
        monitor.currentMonitorStatusId = (
          input as { data: MonitorStatusTimeline }
        ).data.monitorStatusId;
        return new MonitorStatusTimeline() as never;
      });
    jest
      .spyOn(MonitorStatusTimelineService, "findOneBy")
      .mockImplementation(async () => {
        const timeline: MonitorStatusTimeline = new MonitorStatusTimeline();
        timeline.monitorStatusId = monitor.currentMonitorStatusId!;
        return timeline as never;
      });
    jest
      .spyOn(
        MonitorIncident,
        "criteriaMetCreateIncidentsAndUpdateMonitorStatus",
      )
      .mockImplementation(async (input: unknown) => {
        const criteriaInstance: MonitorCriteriaInstance = (
          input as { criteriaInstance: MonitorCriteriaInstance }
        ).criteriaInstance;
        const criteriaId: string = criteriaInstance.data!.id.toString();

        if (
          criteriaInstance.data?.createIncidents &&
          !openIncidents.some((incident: OpenIncident): boolean => {
            return incident.criteriaId === criteriaId;
          })
        ) {
          const title: string = criteriaInstance.data.incidents[0]!.title;
          openIncidents.push({ criteriaId: criteriaId, title: title });
          opened.push({ title: title, minute: minuteNow });
        }
      });
    jest
      .spyOn(MonitorIncident, "checkOpenIncidentsAndCloseIfResolved")
      .mockImplementation(async (input: unknown) => {
        // Auto Resolve: what the criteria acted on this check keeps open.
        const matched: MonitorCriteriaInstance | null = (
          input as { criteriaInstance: MonitorCriteriaInstance | null }
        ).criteriaInstance;

        openIncidents = openIncidents.filter(
          (incident: OpenIncident): boolean => {
            return incident.criteriaId === matched?.data?.id?.toString();
          },
        );

        return [] as never;
      });
    jest.spyOn(IncidentService, "findBy").mockImplementation(async () => {
      return openIncidents.map((incident: OpenIncident): Incident => {
        const record: Incident = new Incident();
        record.createdCriteriaId = incident.criteriaId;
        return record;
      }) as never;
    });

    jest.spyOn(ProjectService, "isProjectBlocked").mockResolvedValue(false);
    jest.spyOn(Semaphore, "lock").mockResolvedValue({} as never);
    jest.spyOn(Semaphore, "release").mockResolvedValue(undefined as never);
    jest.spyOn(MonitorService, "findOneById").mockImplementation(() => {
      return Promise.resolve(monitor) as never;
    });
    jest
      .spyOn(MonitorService, "updateColumnsByIdWithoutHooks")
      .mockResolvedValue(undefined as never);
    jest.spyOn(MonitorProbeService, "findBy").mockResolvedValue([] as never);
    jest
      .spyOn(MonitorStatusService, "findOneBy")
      .mockResolvedValue(null as never);
    jest
      .spyOn(ProjectScopedReferenceValidator, "isUsableInProject")
      .mockResolvedValue(true);
    jest.spyOn(MonitorLogUtil, "saveMonitorLog").mockReturnValue(undefined);
    jest
      .spyOn(MonitorMaintenanceSuppression, "getMaintenanceSuppression")
      .mockResolvedValue({
        suppressedSeriesFingerprints: new Set<string>(),
        suppressingDatabaseServerIds: [],
      } as never);
    jest
      .spyOn(MonitorDependencySuppression, "getDependencySuppression")
      .mockResolvedValue({ isSuppressed: false } as never);
    jest
      .spyOn(MonitorSummaryCapture, "capture")
      .mockResolvedValue(null as never);
    jest
      .spyOn(MonitorAlert, "checkOpenAlertsAndCloseIfResolved")
      .mockResolvedValue([] as never);
    jest
      .spyOn(MonitorAlert, "criteriaMetCreateAlertsAndUpdateMonitorStatus")
      .mockResolvedValue(undefined as never);
    jest
      .spyOn(AlertStateService, "getUnresolvedAlertStateIds")
      .mockResolvedValue([]);
    jest
      .spyOn(IncidentStateService, "getUnresolvedIncidentStateIds")
      .mockResolvedValue([]);
    jest.spyOn(AlertService, "findBy").mockResolvedValue([] as never);
    jest.spyOn(GlobalCache, "getStringArray").mockResolvedValue(null);
    jest.spyOn(GlobalCache, "setStringArray").mockResolvedValue(undefined);
    jest.spyOn(GlobalCache, "deleteKey").mockResolvedValue(undefined);

    jest.spyOn(logger, "error").mockImplementation(() => {
      return undefined as never;
    });
    jest.spyOn(logger, "warn").mockImplementation(() => {
      return undefined as never;
    });
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  test("an hour online, twenty minutes of flapping, ten minutes down, then online again", async () => {
    let minute: number = 0;

    // An hour online: nothing happens.
    for (; minute < 60; minute++) {
      await ping(minute, true);
    }

    expect(opened).toEqual([]);

    // Twenty minutes of flapping: up on even minutes, down on odd ones.
    for (; minute < 80; minute++) {
      await ping(minute, minute % 2 === 0);
    }

    /*
     * At minute 66 it has changed six times in the last hour (60 to 61, 61
     * to 62, ... 65 to 66): unstable, though never down for long.
     */
    expect(opened).toEqual([
      { title: "The access point is unstable", minute: 66 },
    ]);
    expect(statusAt[65]!.status).toBe("Online");
    expect(statusAt[66]!.status).toBe("Degraded");

    // Ten minutes down: every check of 5 minutes failed - an outage.
    for (; minute < 90; minute++) {
      await ping(minute, false);
    }

    // Minutes 79 to 84 all failed: the outage comes first in the list.
    expect(opened).toEqual([
      { title: "The access point is unstable", minute: 66 },
      { title: "Outage: the access point is down", minute: 84 },
    ]);
    expect(statusAt[83]!.status).toBe("Degraded");
    expect(statusAt[84]!.status).toBe("Offline");
    // The outage took over: the instability incident resolved.
    expect(
      openIncidents.map((incident: OpenIncident): string => {
        return incident.title;
      }),
    ).toEqual(["Outage: the access point is down"]);

    // Back online for good.
    for (; minute < 160; minute++) {
      await ping(minute, true);
    }

    expect(statusRuns()).toEqual([
      "Online x66",
      "Degraded x18",
      "Offline x6",
      /*
       * Back up, but it changed more than 5 times in the last hour: still
       * unstable - a new instability incident - until minute 134, when the
       * flapping has aged out of the hour but for five changes. Its
       * recovery condition then holds it until it has changed at most once
       * in the hour, at minute 139.
       */
      "Degraded x49",
      "Online x21",
    ]);

    expect(opened).toEqual([
      { title: "The access point is unstable", minute: 66 },
      { title: "Outage: the access point is down", minute: 84 },
      { title: "The access point is unstable", minute: 90 },
    ]);
    expect(openIncidents).toEqual([]);

    // The counted windows were read from the database's summary.
    expect(summaryReads).toBeGreaterThan(0);
  });

  test("a down access point is an outage, never unstable", async () => {
    for (let minute: number = 0; minute < 60; minute++) {
      await ping(minute, true);
    }

    for (let minute: number = 60; minute < 70; minute++) {
      await ping(minute, false);
    }

    // Minutes 60 to 65 all failed; one change, online to offline, is no flapping.
    expect(opened).toEqual([
      { title: "Outage: the access point is down", minute: 65 },
    ]);
    expect(statusAt[64]!.status).toBe("Online");
    expect(statusAt[65]!.status).toBe("Offline");
  });

  test("the counted window of a monitor that counts a series' checks waits for its own row to be readable", async () => {
    const saved: jest.SpyInstance = jest.spyOn(
      MetricService,
      "insertJsonRows",
    );

    await ping(0, true);

    const seriesWrite: Array<unknown> | undefined = saved.mock.calls.find(
      (call: Array<unknown>): boolean => {
        return (call[0] as Array<JSONObject>).some((row: JSONObject) => {
          return row["name"] === MonitorMetricType.IsOnline;
        });
      },
    );

    expect(seriesWrite?.[1]).toEqual({
      clickhouseSettings: { wait_for_async_insert: 1 },
    });
  });
});
