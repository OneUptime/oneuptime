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
import MonitorMetricUtil from "../../../../Server/Utils/Monitor/MonitorMetricUtil";
import MonitorStatusTimelineUtil from "../../../../Server/Utils/Monitor/MonitorStatusTimeline";
import MonitorSummaryCapture from "../../../../Server/Utils/Monitor/MonitorSummaryCapture";
import MonitorMaintenanceSuppression from "../../../../Server/Utils/Monitor/MonitorMaintenanceSuppression";
import MonitorDependencySuppression from "../../../../Server/Utils/Monitor/MonitorDependencySuppression";
import AlertService from "../../../../Server/Services/AlertService";
import AlertStateService from "../../../../Server/Services/AlertStateService";
import AlertStateTimelineService from "../../../../Server/Services/AlertStateTimelineService";
import IncidentService from "../../../../Server/Services/IncidentService";
import IncidentStateService from "../../../../Server/Services/IncidentStateService";
import MonitorFeedService from "../../../../Server/Services/MonitorFeedService";
import MonitorProbeService from "../../../../Server/Services/MonitorProbeService";
import MonitorService from "../../../../Server/Services/MonitorService";
import MonitorStatusService from "../../../../Server/Services/MonitorStatusService";
import MonitorStatusTimelineService from "../../../../Server/Services/MonitorStatusTimelineService";
import ProjectService from "../../../../Server/Services/ProjectService";
import UserService from "../../../../Server/Services/UserService";
import Semaphore from "../../../../Server/Infrastructure/Semaphore";
import ProjectScopedReferenceValidator from "../../../../Server/Utils/Database/ProjectScopedReferenceValidator";
import logger from "../../../../Server/Utils/Logger";
import DeviceManagementConnectionAlerts, {
  DeviceManagementConnectionGone,
} from "../../../../Server/Utils/DeviceManagement/DeviceManagementConnectionAlerts";
import {
  DeviceManagementConnectionReadRecord,
  buildDeviceManagementConnectionReadRecordRow,
} from "../../../../Server/Utils/DeviceManagement/DeviceManagementConnectionReadMetrics";
import Alert from "../../../../Models/DatabaseModels/Alert";
import AlertStateTimeline from "../../../../Models/DatabaseModels/AlertStateTimeline";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import MonitorStatusTimeline from "../../../../Models/DatabaseModels/MonitorStatusTimeline";
import AggregateModel from "../../../../Types/BaseDatabase/AggregatedModel";
import AggregatedResult from "../../../../Types/BaseDatabase/AggregatedResult";
import Dictionary from "../../../../Types/Dictionary";
import {
  DeviceManagementConnectionReadOutcome,
  DeviceManagementConnectionReadingAttribute,
} from "../../../../Types/DeviceManagement/DeviceManagementConnectionReading";
import DeviceManagementProvider from "../../../../Types/DeviceManagement/DeviceManagementProvider";
import BadDataException from "../../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../../Types/JSON";
import { LlmConnectionFailureKind } from "../../../../Types/LlmObservability/LlmConnectionTest";
import MetricQueryConfigData from "../../../../Types/Metrics/MetricQueryConfigData";
import MetricsViewConfig from "../../../../Types/Metrics/MetricsViewConfig";
import MetricMonitorResponse from "../../../../Types/Monitor/MetricMonitor/MetricMonitorResponse";
import MetricSeriesResult from "../../../../Types/Monitor/MetricMonitor/MetricSeriesResult";
import {
  MANAGED_DEVICE_CONNECTION_READ_ROLLING_TIME,
  getManagedDeviceAlertTemplateById,
} from "../../../../Types/Monitor/ManagedDeviceAlertTemplates";
import MonitorStep from "../../../../Types/Monitor/MonitorStep";
import MonitorSteps from "../../../../Types/Monitor/MonitorSteps";
import MonitorType from "../../../../Types/Monitor/MonitorType";
import ObjectID from "../../../../Types/ObjectID";
import ProbeApiIngestResponse, {
  PerSeriesCriteriaMatch,
} from "../../../../Types/Probe/ProbeApiIngestResponse";
import RollingTimeUtil from "../../../../Types/RollingTime/RollingTimeUtil";
import FeedMarkdown, { mdText } from "../../../../Utils/Markdown/FeedMarkdown";
import MetricSeriesFingerprint from "../../../../Utils/Metrics/MetricSeriesFingerprint";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * A DEVICE MANAGEMENT CONNECTION TURNED OFF OR DELETED, END TO END THROUGH
 * THE MONITOR CODE (#10286).
 *
 * Connection Stopped Reading's alert lived on after its connection was
 * turned off: nothing reads a connection that is off, the readings before
 * still said it was failing, and a window with none says nothing - silence
 * is not recovery. Here, from the readings its writer writes, through
 * MonitorResourceUtil.monitorResource and the real criteria evaluator:
 *
 *   - a connection whose reads fail opens its alert;
 *   - turned off, it writes its last reading, 0, and its alert is resolved
 *     at once, saying who turned it off;
 *   - its monitor's next check reads that reading as the connection's
 *     newest and opens nothing again, though the failing readings before it
 *     are still in the window - nor does a read that was on its way when it
 *     was turned off;
 *   - once its readings have left the window, a quiet window changes
 *     nothing;
 *   - turned back on, a read that still fails opens a new alert;
 *   - deleted, its monitors - its own and its devices' - are turned off,
 *     what they had open resolved, and a check that still reaches one
 *     opens nothing.
 *
 * Postgres, Redis and the incident machinery are stood in for: alerts are a
 * list that opens and resolves as the services are asked to.
 */

const MINUTE: number = 60 * 1000;
const NOW: Date = new Date(Date.UTC(2026, 10, 20, 15, 0, 30));
const RETENTION_DAYS: number = 30;

const ONLINE: ObjectID = new ObjectID("11111111-1111-4111-8111-111111111111");
const OFFLINE: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");
const MONITOR_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const DEVICE_MONITOR_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333334",
);
const PROJECT: ObjectID = new ObjectID("44444444-4444-4444-8444-444444444444");
const CONNECTION: ObjectID = new ObjectID(
  "55555555-5555-4555-8555-555555555555",
);
const USER: ObjectID = new ObjectID("66666666-6666-4666-8666-666666666666");
const OPEN_STATE: ObjectID = new ObjectID(
  "77777777-7777-4777-8777-777777777771",
);
const RESOLVED_STATE: ObjectID = new ObjectID(
  "77777777-7777-4777-8777-777777777772",
);
const NAME_KEY: string =
  DeviceManagementConnectionReadingAttribute.ConnectionName;
const CONNECTION_NAME: string = "Esper acme";
const USER_LINK: string =
  mdText`[${"Jane Doe"}](${"https://oneuptime.example/dashboard/p/users/u"})`.toString();
const REFUSED_KEY: string =
  "Esper refused the API key (401 Unauthorized): the key is not valid.";

const GONE: DeviceManagementConnectionGone = {
  connectionId: CONNECTION,
  projectId: PROJECT,
  name: CONNECTION_NAME,
  provider: DeviceManagementProvider.Esper,
  readIntervalInMinutes: 15,
  lastSuccessfulPullAt: new Date(NOW.getTime() - 95 * MINUTE),
  createdAt: new Date(NOW.getTime() - 30 * 24 * 60 * MINUTE),
};

function stepOf(templateId: string): MonitorStep {
  return getManagedDeviceAlertTemplateById(templateId)!.getMonitorStep({
    deviceManagementConnectionId: CONNECTION.toString(),
    onlineMonitorStatusId: ONLINE,
    offlineMonitorStatusId: OFFLINE,
    defaultIncidentSeverityId: ObjectID.generate(),
    defaultAlertSeverityId: ObjectID.generate(),
    monitorName: CONNECTION_NAME,
  });
}

function monitorOf(id: ObjectID, step: MonitorStep, name: string): Monitor {
  const monitor: Monitor = new Monitor();
  monitor.id = id;
  monitor.projectId = PROJECT;
  monitor.name = name;
  monitor.monitorType = MonitorType.Metrics;
  monitor.currentMonitorStatusId = ONLINE;
  monitor.disableActiveMonitoring = false;
  const monitorSteps: MonitorSteps = new MonitorSteps();
  monitorSteps.data = {
    monitorStepsInstanceArray: [step],
    defaultMonitorStatusId: ONLINE,
  };
  monitor.monitorSteps = monitorSteps;

  return monitor;
}

// One reading as its writer writes it, `minutesAgo` before NOW.
function reading(data: {
  minutesAgo: number;
  outcome: DeviceManagementConnectionReadOutcome;
  lastSuccessfulReadMinutesAgo?: number | undefined;
  failureKind?: LlmConnectionFailureKind | undefined;
  lastError?: string | undefined;
}): JSONObject {
  return buildDeviceManagementConnectionReadRecordRow(
    {
      projectId: PROJECT,
      connectionId: CONNECTION,
      reading: {
        connectionName: CONNECTION_NAME,
        provider: DeviceManagementProvider.Esper,
        readIntervalInMinutes: 15,
        outcome: data.outcome,
        lastSuccessfulReadAt:
          data.lastSuccessfulReadMinutesAgo === undefined
            ? undefined
            : new Date(
                NOW.getTime() - data.lastSuccessfulReadMinutesAgo * MINUTE,
              ),
        createdAt: GONE.createdAt,
        failureKind: data.failureKind,
        lastError: data.lastError,
        asOf: new Date(NOW.getTime() - data.minutesAgo * MINUTE),
      },
    },
    RETENTION_DAYS,
  );
}

// A refused key since 80 minutes ago, read every 15: failing for 95 minutes now.
function failingRows(): Array<JSONObject> {
  return [
    reading({
      minutesAgo: 95,
      outcome: DeviceManagementConnectionReadOutcome.Success,
    }),
    reading({
      minutesAgo: 80,
      outcome: DeviceManagementConnectionReadOutcome.Failed,
      lastSuccessfulReadMinutesAgo: 95,
      failureKind: LlmConnectionFailureKind.Authentication,
      lastError: REFUSED_KEY,
    }),
    reading({
      minutesAgo: 20,
      outcome: DeviceManagementConnectionReadOutcome.Due,
      lastSuccessfulReadMinutesAgo: 95,
      lastError: REFUSED_KEY,
    }),
    reading({
      minutesAgo: 19,
      outcome: DeviceManagementConnectionReadOutcome.Failed,
      lastSuccessfulReadMinutesAgo: 95,
      failureKind: LlmConnectionFailureKind.Authentication,
      lastError: REFUSED_KEY,
    }),
  ];
}

function rowsRead(
  rows: Array<JSONObject>,
  query: MetricQueryConfigData,
): Array<JSONObject> {
  const filter: MetricQueryConfigData["metricQueryData"]["filterData"] =
    query.metricQueryData.filterData;
  const wanted: Dictionary<unknown> = (filter.attributes ||
    {}) as Dictionary<unknown>;

  return rows.filter((row: JSONObject): boolean => {
    const attributes: Dictionary<unknown> = row[
      "attributes"
    ] as Dictionary<unknown>;

    return (
      row["name"] === filter.metricName &&
      Object.entries(wanted).every(([key, value]: [string, unknown]) => {
        return attributes[key] === value;
      })
    );
  });
}

function fingerprintOf(name: string): string {
  return MetricSeriesFingerprint.computeFingerprint({ [NAME_KEY]: name });
}

function minuteOf(row: JSONObject): string {
  return String(row["time"]).substring(0, 16);
}

/*
 * The worker's answer at a check: the rows the step's query reads in its
 * window, one series per connection name, each judged on its newest minute,
 * the minute's rows taken at their least - as MonitorTelemetryMonitor hands
 * it on.
 */
function check(rows: Array<JSONObject>, now: Date): MetricMonitorResponse {
  const view: MetricsViewConfig = MonitorStep.getMetricsViewConfig(
    monitor.monitorSteps!.data!.monitorStepsInstanceArray[0]!,
  )!;
  const windowStart: number = RollingTimeUtil.convertToStartAndEndDate(
    MANAGED_DEVICE_CONNECTION_READ_ROLLING_TIME,
    now,
  ).startValue.getTime();
  const read: Array<JSONObject> = rowsRead(rows, view.queryConfigs[0]!).filter(
    (row: JSONObject): boolean => {
      const time: number = new Date(
        `${String(row["time"]).replace(" ", "T")}Z`,
      ).getTime();

      return time >= windowStart && time <= now.getTime();
    },
  );
  const latestByName: Map<string, { minute: string; value: number }> = new Map<
    string,
    { minute: string; value: number }
  >();

  for (const row of read) {
    const name: string = (row["attributes"] as Dictionary<string>)[NAME_KEY]!;
    const minute: string = minuteOf(row);
    const value: number = row["value"] as number;
    const earlier: { minute: string; value: number } | undefined =
      latestByName.get(name);

    if (!earlier || minute > earlier.minute) {
      latestByName.set(name, { minute, value });
    } else if (minute === earlier.minute) {
      latestByName.set(name, { minute, value: Math.min(value, earlier.value) });
    }
  }

  const sample: (
    name: string,
    latest: { minute: string; value: number },
  ) => AggregateModel = (
    name: string,
    latest: { minute: string; value: number },
  ): AggregateModel => {
    return {
      timestamp: new Date(`${latest.minute.replace(" ", "T")}:00Z`),
      value: latest.value,
      attributes: { [NAME_KEY]: name },
    } as unknown as AggregateModel;
  };

  const entries: Array<[string, { minute: string; value: number }]> =
    Array.from(latestByName.entries());

  return {
    projectId: PROJECT,
    monitorId: monitor.id!,
    metricViewConfig: view,
    metricResult: [
      {
        data: entries.map(
          ([name, latest]: [string, { minute: string; value: number }]) => {
            return sample(name, latest);
          },
        ),
      },
    ] as Array<AggregatedResult>,
    seriesBreakdown: entries.map(
      ([name, latest]: [
        string,
        { minute: string; value: number },
      ]): MetricSeriesResult => {
        return {
          fingerprint: fingerprintOf(name),
          labels: { [NAME_KEY]: name },
          aggregatedResults: [{ data: [sample(name, latest)] }],
        };
      },
    ),
    startAndEndDate: RollingTimeUtil.convertToStartAndEndDate(
      MANAGED_DEVICE_CONNECTION_READ_ROLLING_TIME,
      now,
    ),
  };
}

let monitor: Monitor;
let deviceMonitor: Monitor;
let rows: Array<JSONObject>;
let openAlerts: Array<Alert>;
let resolvedTimelines: Array<AlertStateTimeline>;
let createAlerts: jest.SpyInstance;
let closeAlerts: jest.SpyInstance;
let monitorUpdates: Array<{ id: string; data: JSONObject }>;

function criteriaIdOf(target: Monitor, index: number): string {
  return target.monitorSteps!.data!.monitorStepsInstanceArray[0]!.data!
    .monitorCriteria.data!.monitorCriteriaInstanceArray[index]!.data!.id!;
}

// The series handed to a criteria that opens alerts.
function alertedConnections(): Array<string> {
  return createAlerts.mock.calls.flatMap((call: Array<unknown>) => {
    const input: {
      criteriaInstance?: { data?: { createAlerts?: boolean } };
      matchesPerSeries?: Array<PerSeriesCriteriaMatch>;
    } = call[0] as {
      criteriaInstance?: { data?: { createAlerts?: boolean } };
      matchesPerSeries?: Array<PerSeriesCriteriaMatch>;
    };

    if (input.criteriaInstance?.data?.createAlerts !== true) {
      return [];
    }

    return (input.matchesPerSeries || []).map(
      (match: PerSeriesCriteriaMatch): string => {
        return String((match.labels || {})[NAME_KEY]);
      },
    );
  });
}

// Opens one alert for each connection series a check hands to the firing criteria.
function openTheAlertsAChecksRaised(target: Monitor): void {
  for (const name of alertedConnections()) {
    const alert: Alert = new Alert();
    alert.id = ObjectID.generate();
    alert.projectId = PROJECT;
    alert.monitorId = target.id!;
    alert.createdCriteriaId = criteriaIdOf(target, 0);
    alert.seriesFingerprint = fingerprintOf(name);
    openAlerts.push(alert);
  }

  createAlerts.mockClear();
}

async function checkAt(now: Date): Promise<ProbeApiIngestResponse> {
  jest.setSystemTime(now);

  return await MonitorResourceUtil.monitorResource(check(rows, now));
}

const turnOffDependencies: {
  isTelemetryAllowed: () => Promise<boolean>;
  recordConnectionReadings: (
    records: ReadonlyArray<DeviceManagementConnectionReadRecord>,
  ) => Promise<number>;
  now: () => Date;
} = {
  isTelemetryAllowed: async (): Promise<boolean> => {
    return true;
  },
  // As DeviceManagementConnectionReadMetrics.record writes them: a row each.
  recordConnectionReadings: async (
    records: ReadonlyArray<DeviceManagementConnectionReadRecord>,
  ): Promise<number> => {
    for (const record of records) {
      rows.push(
        buildDeviceManagementConnectionReadRecordRow(record, RETENTION_DAYS),
      );
    }

    return records.length;
  },
  now: (): Date => {
    return new Date(NOW.getTime() + MINUTE);
  },
};

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(NOW);

  rows = failingRows();
  openAlerts = [];
  resolvedTimelines = [];
  monitorUpdates = [];
  monitor = monitorOf(
    MONITOR_ID,
    stepOf("esper-connection-stopped-reading"),
    "Esper acme - Esper Connection Stopped Reading",
  );
  deviceMonitor = monitorOf(
    DEVICE_MONITOR_ID,
    stepOf("esper-device-stopped-checking-in"),
    "Esper acme - Esper Android Device Stopped Checking In",
  );

  jest.spyOn(ProjectService, "isProjectBlocked").mockResolvedValue(false);
  jest.spyOn(Semaphore, "lock").mockResolvedValue({} as never);
  jest.spyOn(Semaphore, "release").mockResolvedValue(undefined as never);
  jest.spyOn(MonitorService, "findOneById").mockImplementation((async () => {
    return monitor;
  }) as never);
  // The project's monitors whose steps name the connection.
  jest.spyOn(MonitorService, "findBy").mockImplementation((async () => {
    return [monitor, deviceMonitor];
  }) as never);
  jest.spyOn(MonitorService, "updateOneById").mockImplementation((async (data: {
    id: ObjectID;
    data: JSONObject;
  }) => {
    monitorUpdates.push({ id: data.id.toString(), data: data.data });

    for (const target of [monitor, deviceMonitor]) {
      if (target.id!.toString() === data.id.toString()) {
        target.disableActiveMonitoring = data.data[
          "disableActiveMonitoring"
        ] as boolean;
      }
    }
  }) as never);
  jest
    .spyOn(MonitorFeedService, "createMonitorFeedItem")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(MonitorService, "updateColumnsByIdWithoutHooks")
    .mockResolvedValue(undefined as never);
  jest.spyOn(MonitorProbeService, "findBy").mockResolvedValue([] as never);
  jest
    .spyOn(MonitorStatusService, "findOneBy")
    .mockResolvedValue(null as never);
  jest
    .spyOn(MonitorStatusTimelineService, "findOneBy")
    .mockImplementation(() => {
      const timeline: MonitorStatusTimeline = new MonitorStatusTimeline();
      timeline.monitorStatusId = monitor.currentMonitorStatusId!;
      return Promise.resolve(timeline) as never;
    });
  jest
    .spyOn(ProjectScopedReferenceValidator, "isUsableInProject")
    .mockResolvedValue(true);
  jest
    .spyOn(MonitorStatusTimelineService, "create")
    .mockResolvedValue(new MonitorStatusTimeline() as never);
  jest
    .spyOn(MonitorMetricUtil, "saveMonitorMetrics")
    .mockResolvedValue(undefined);
  jest.spyOn(MonitorLogUtil, "saveMonitorLog").mockReturnValue(undefined);
  jest
    .spyOn(MonitorStatusTimelineUtil, "updateMonitorStatusTimeline")
    .mockResolvedValue(null as never);
  jest
    .spyOn(MonitorMaintenanceSuppression, "getMaintenanceSuppression")
    .mockResolvedValue({
      suppressedSeriesFingerprints: new Set<string>(),
      suppressingDatabaseServerIds: [],
    } as never);
  jest
    .spyOn(MonitorDependencySuppression, "getDependencySuppression")
    .mockResolvedValue({ isSuppressed: false } as never);
  jest.spyOn(MonitorSummaryCapture, "capture").mockResolvedValue(null as never);
  jest
    .spyOn(MonitorIncident, "checkOpenIncidentsAndCloseIfResolved")
    .mockResolvedValue([] as never);
  closeAlerts = jest
    .spyOn(MonitorAlert, "checkOpenAlertsAndCloseIfResolved")
    .mockResolvedValue([] as never);
  jest
    .spyOn(MonitorIncident, "criteriaMetCreateIncidentsAndUpdateMonitorStatus")
    .mockResolvedValue(undefined as never);
  createAlerts = jest
    .spyOn(MonitorAlert, "criteriaMetCreateAlertsAndUpdateMonitorStatus")
    .mockResolvedValue(undefined as never);

  // The alerts: open until a resolved state is written for them.
  jest
    .spyOn(AlertStateService, "getUnresolvedAlertStateIds")
    .mockResolvedValue([OPEN_STATE]);
  jest
    .spyOn(IncidentStateService, "getUnresolvedIncidentStateIds")
    .mockResolvedValue([]);
  jest.spyOn(AlertService, "findBy").mockImplementation((async (data: {
    query: { monitorId?: ObjectID };
  }) => {
    return openAlerts.filter((alert: Alert): boolean => {
      return (
        !data.query.monitorId ||
        alert.monitorId!.toString() === data.query.monitorId.toString()
      );
    });
  }) as never);
  jest.spyOn(IncidentService, "findBy").mockResolvedValue([] as never);
  jest
    .spyOn(AlertStateTimelineService, "getResolvedStateIdForProject")
    .mockResolvedValue(RESOLVED_STATE);
  jest
    .spyOn(AlertStateTimelineService, "create")
    .mockImplementation((async (data: { data: AlertStateTimeline }) => {
      const resolving: Alert | undefined = openAlerts.find((alert: Alert) => {
        return alert.id!.toString() === data.data.alertId!.toString();
      });

      if (!resolving) {
        throw new BadDataException(
          "Alert state cannot be same as previous state.",
        );
      }

      openAlerts = openAlerts.filter((alert: Alert): boolean => {
        return alert !== resolving;
      });
      resolvedTimelines.push(data.data);

      return data.data;
    }) as never);
  jest
    .spyOn(UserService, "getUserMarkdownString")
    .mockResolvedValue(FeedMarkdown.asMarkdown(USER_LINK));

  jest.spyOn(logger, "error").mockImplementation(() => {
    return undefined as never;
  });
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe("a connection turned off, through the monitor code", () => {
  test("its failing reads open its alert; turned off, the alert is resolved at once and stays resolved", async () => {
    // Failing for 95 minutes: past its 55-minute Stale point.
    expect((await checkAt(NOW)).criteriaMetId).toBe(criteriaIdOf(monitor, 0));
    expect(alertedConnections()).toEqual([CONNECTION_NAME]);
    openTheAlertsAChecksRaised(monitor);
    expect(openAlerts).toHaveLength(1);

    // Jane turns the connection off a minute later.
    await DeviceManagementConnectionAlerts.onConnectionsTurnedOff({
      connections: [GONE],
      turnedOffByUserId: USER,
      dependencies: turnOffDependencies,
    });

    // Its alert, resolved at once, saying who turned it off and why.
    expect(openAlerts).toEqual([]);
    expect(resolvedTimelines).toHaveLength(1);
    expect(resolvedTimelines[0]!.alertStateId).toEqual(RESOLVED_STATE);
    expect(resolvedTimelines[0]!.rootCause).toBe(
      `${USER_LINK} turned off the device management connection **Esper acme**. Nothing reads a connection while it is off, so none of its reads is overdue, and this was resolved. If the connection is turned back on and its reads still fail, its monitor opens a new one.`,
    );

    // Its last reading, 0, beside the failing ones still in the window.
    const last: JSONObject = rows[rows.length - 1]!;
    expect(last["value"]).toBe(0);
    expect(
      (last["attributes"] as Dictionary<string>)[
        DeviceManagementConnectionReadingAttribute.ReadOutcome
      ],
    ).toBe(DeviceManagementConnectionReadOutcome.Off);

    // The monitor's next check: healthy on that reading, and nothing opens again.
    const next: ProbeApiIngestResponse = await checkAt(
      new Date(NOW.getTime() + 5 * MINUTE),
    );

    expect(next.criteriaMetId).toBe(criteriaIdOf(monitor, 1));
    expect(alertedConnections()).toEqual([]);
    expect(closeAlerts).toHaveBeenCalled();

    // Its devices' monitor was left as it is: turned off, they are frozen.
    expect(monitorUpdates).toEqual([]);
  });

  test("a read on its way when the connection was turned off, failing, opens nothing again", async () => {
    await checkAt(NOW);
    openTheAlertsAChecksRaised(monitor);

    await DeviceManagementConnectionAlerts.onConnectionsTurnedOff({
      connections: [GONE],
      turnedOffByUserId: USER,
      dependencies: turnOffDependencies,
    });

    /*
     * The read had started before the connection was turned off, and
     * writes its reading as of when it started: older than the last one.
     */
    rows.push(
      reading({
        minutesAgo: 0,
        outcome: DeviceManagementConnectionReadOutcome.Failed,
        lastSuccessfulReadMinutesAgo: 95,
        failureKind: LlmConnectionFailureKind.Authentication,
        lastError: REFUSED_KEY,
      }),
    );

    expect(
      (await checkAt(new Date(NOW.getTime() + 5 * MINUTE))).criteriaMetId,
    ).toBe(criteriaIdOf(monitor, 1));
    expect(alertedConnections()).toEqual([]);
    expect(openAlerts).toEqual([]);
  });

  test("once its readings have left the window, a quiet window changes nothing", async () => {
    await checkAt(NOW);
    openTheAlertsAChecksRaised(monitor);

    await DeviceManagementConnectionAlerts.onConnectionsTurnedOff({
      connections: [GONE],
      turnedOffByUserId: USER,
      dependencies: turnOffDependencies,
    });

    closeAlerts.mockClear();

    const quiet: ProbeApiIngestResponse = await checkAt(
      new Date(NOW.getTime() + 3 * 60 * MINUTE),
    );

    expect(quiet.criteriaMetId).toBeFalsy();
    expect(alertedConnections()).toEqual([]);
    expect(closeAlerts).not.toHaveBeenCalled();
    expect(openAlerts).toEqual([]);
  });

  test("turned back on, a read that still fails opens a new alert", async () => {
    await checkAt(NOW);
    openTheAlertsAChecksRaised(monitor);

    await DeviceManagementConnectionAlerts.onConnectionsTurnedOff({
      connections: [GONE],
      turnedOffByUserId: USER,
      dependencies: turnOffDependencies,
    });

    // An hour later it is turned back on, and its first read still fails.
    rows.push(
      reading({
        minutesAgo: -60,
        outcome: DeviceManagementConnectionReadOutcome.Failed,
        lastSuccessfulReadMinutesAgo: 95,
        failureKind: LlmConnectionFailureKind.Authentication,
        lastError: REFUSED_KEY,
      }),
    );

    const back: ProbeApiIngestResponse = await checkAt(
      new Date(NOW.getTime() + 61 * MINUTE),
    );

    expect(back.criteriaMetId).toBe(criteriaIdOf(monitor, 0));
    expect(alertedConnections()).toEqual([CONNECTION_NAME]);
  });

  test("before, a connection turned off kept its alert open: the failing readings still in the window say it fails", async () => {
    await checkAt(NOW);
    openTheAlertsAChecksRaised(monitor);

    // Turned off as it was before #10286: no reading, nothing resolved.
    const next: ProbeApiIngestResponse = await checkAt(
      new Date(NOW.getTime() + 5 * MINUTE),
    );

    expect(next.criteriaMetId).toBe(criteriaIdOf(monitor, 0));
    expect(openAlerts).toHaveLength(1);
  });
});

describe("a connection deleted, through the monitor code", () => {
  test("its monitors are turned off, what they had open resolved, and a check that still reaches one opens nothing", async () => {
    await checkAt(NOW);
    openTheAlertsAChecksRaised(monitor);

    // And a device of the connection had stopped checking in.
    const deviceAlert: Alert = new Alert();
    deviceAlert.id = ObjectID.generate();
    deviceAlert.projectId = PROJECT;
    deviceAlert.monitorId = DEVICE_MONITOR_ID;
    deviceAlert.createdCriteriaId = criteriaIdOf(deviceMonitor, 0);
    openAlerts.push(deviceAlert);

    await DeviceManagementConnectionAlerts.onConnectionsDeleted({
      connections: [GONE],
      deletedByUserId: USER,
    });

    expect(openAlerts).toEqual([]);
    expect(
      resolvedTimelines.map((timeline: AlertStateTimeline): string => {
        return timeline.rootCause!;
      }),
    ).toEqual([
      `${USER_LINK} deleted the device management connection **Esper acme**, and its devices with it. Nothing is read for the monitor that opened this any more, so its monitoring was turned off, and this was resolved.`,
      `${USER_LINK} deleted the device management connection **Esper acme**, and its devices with it. Nothing is read for the monitor that opened this any more, so its monitoring was turned off, and this was resolved.`,
    ]);
    expect(monitorUpdates).toEqual([
      {
        id: MONITOR_ID.toString(),
        data: { disableActiveMonitoring: true },
      },
      {
        id: DEVICE_MONITOR_ID.toString(),
        data: { disableActiveMonitoring: true },
      },
    ]);

    // The readings still in its window reach a monitor that is off: refused, nothing opens.
    await expect(
      MonitorResourceUtil.monitorResource(
        check(rows, new Date(NOW.getTime() + 5 * MINUTE)),
      ),
    ).rejects.toThrow(BadDataException);
    expect(alertedConnections()).toEqual([]);
    expect(openAlerts).toEqual([]);
  });
});
