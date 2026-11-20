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
import ManagedDeviceCheckInSilence from "../../../../Server/Utils/Monitor/ManagedDeviceCheckInSilence";
import SeriesContextEnricher from "../../../../Server/Utils/Monitor/SeriesContextEnricher";
import AlertService from "../../../../Server/Services/AlertService";
import AlertStateService from "../../../../Server/Services/AlertStateService";
import IncidentService from "../../../../Server/Services/IncidentService";
import IncidentStateService from "../../../../Server/Services/IncidentStateService";
import MonitorProbeService from "../../../../Server/Services/MonitorProbeService";
import MonitorService from "../../../../Server/Services/MonitorService";
import MonitorStatusService from "../../../../Server/Services/MonitorStatusService";
import MonitorStatusTimelineService from "../../../../Server/Services/MonitorStatusTimelineService";
import ProjectService from "../../../../Server/Services/ProjectService";
import Semaphore from "../../../../Server/Infrastructure/Semaphore";
import ProjectScopedReferenceValidator from "../../../../Server/Utils/Database/ProjectScopedReferenceValidator";
import logger from "../../../../Server/Utils/Logger";
import DeviceManagementReadRunner from "../../../../Server/Utils/DeviceManagement/DeviceManagementReadRunner";
import { buildDeviceManagementConnectionReadRecordRow } from "../../../../Server/Utils/DeviceManagement/DeviceManagementConnectionReadMetrics";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import MonitorStatusTimeline from "../../../../Models/DatabaseModels/MonitorStatusTimeline";
import AggregateModel from "../../../../Types/BaseDatabase/AggregatedModel";
import AggregatedResult from "../../../../Types/BaseDatabase/AggregatedResult";
import Dictionary from "../../../../Types/Dictionary";
import {
  DeviceManagementConnectionStatus,
  getDeviceManagementConnectionHealth,
} from "../../../../Types/DeviceManagement/DeviceManagementConnectionHealth";
import {
  DeviceManagementConnectionReadOutcome,
  DeviceManagementConnectionReadingAttribute,
  MANAGED_DEVICE_CONNECTION_READ_AGE_METRIC_NAME,
} from "../../../../Types/DeviceManagement/DeviceManagementConnectionReading";
import DeviceManagementProvider from "../../../../Types/DeviceManagement/DeviceManagementProvider";
import { JSONObject } from "../../../../Types/JSON";
import { LlmConnectionFailureKind } from "../../../../Types/LlmObservability/LlmConnectionTest";
import MetricQueryConfigData from "../../../../Types/Metrics/MetricQueryConfigData";
import MetricsViewConfig from "../../../../Types/Metrics/MetricsViewConfig";
import MetricMonitorResponse from "../../../../Types/Monitor/MetricMonitor/MetricMonitorResponse";
import MetricSeriesResult from "../../../../Types/Monitor/MetricMonitor/MetricSeriesResult";
import {
  MANAGED_DEVICE_CONNECTION_READ_ROLLING_TIME,
  getManagedDeviceAlertTemplateById,
  getManagedDeviceConnectionStoppedReadingMinutes,
} from "../../../../Types/Monitor/ManagedDeviceAlertTemplates";
import MonitorStep from "../../../../Types/Monitor/MonitorStep";
import MonitorSteps from "../../../../Types/Monitor/MonitorSteps";
import MonitorType from "../../../../Types/Monitor/MonitorType";
import SeriesDebugHints, {
  SeriesDebugCommand,
} from "../../../../Types/Monitor/SeriesContext/SeriesDebugHints";
import ObjectID from "../../../../Types/ObjectID";
import ProbeApiIngestResponse, {
  PerSeriesCriteriaMatch,
} from "../../../../Types/Probe/ProbeApiIngestResponse";
import RollingTimeUtil from "../../../../Types/RollingTime/RollingTimeUtil";
import MetricSeriesFingerprint from "../../../../Utils/Metrics/MetricSeriesFingerprint";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * Connection Stopped Reading (#10006), end to end through the monitor code,
 * for every device manager: the readings a connection writes - at the end
 * of each read (DeviceManagementReadRunner) and whenever a read of it falls
 * due (DeviceManagementScheduler) - are built by the real writer, the
 * monitor's own query reads the rows it names, as ClickHouse picks them, the
 * connection judged on its newest minute (Min per minute, its aggregation),
 * and MonitorResourceUtil.monitorResource, through the real criteria
 * evaluator, opens one alert for a connection no read of which has worked
 * for longer than its Stale point, and resolves it at the first read that
 * works. A window with no reading at all - the connection turned off, the
 * workers stopped - resolves nothing.
 *
 * Postgres, Redis and the incident and alert machinery are stood in for;
 * what is asserted is what they are asked to do.
 */

const MINUTE: number = 60 * 1000;
const NOW: Date = new Date(Date.UTC(2026, 10, 19, 12, 10, 30));
const RETENTION_DAYS: number = 30;

const ONLINE: ObjectID = new ObjectID("11111111-1111-4111-8111-111111111111");
const OFFLINE: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");
const PROJECT: ObjectID = new ObjectID("44444444-4444-4444-8444-444444444444");
const CONNECTION: ObjectID = new ObjectID(
  "55555555-5555-4555-8555-555555555555",
);
const OTHER_CONNECTION: ObjectID = new ObjectID(
  "66666666-6666-4666-8666-666666666666",
);
const NAME_KEY: string =
  DeviceManagementConnectionReadingAttribute.ConnectionName;

const REFUSED_KEY: string =
  "Esper refused the API key (401 Unauthorized): the key is not valid.";

interface ProviderCase {
  provider: DeviceManagementProvider;
  templateId: string;
  connectionName: string;
  // How its incident is tagged, as its devices' are.
  tag: string;
}

const PROVIDERS: Array<ProviderCase> = [
  {
    provider: DeviceManagementProvider.Esper,
    templateId: "esper-connection-stopped-reading",
    connectionName: "Esper acme",
    tag: "[Esper]",
  },
  {
    provider: DeviceManagementProvider.Intune,
    templateId: "intune-connection-stopped-reading",
    connectionName: "Contoso Intune",
    tag: "[Intune]",
  },
  {
    provider: DeviceManagementProvider.WorkspaceOne,
    templateId: "workspace-one-connection-stopped-reading",
    connectionName: "Workspace ONE as1234",
    tag: "[Workspace ONE]",
  },
  {
    provider: DeviceManagementProvider.Soti,
    templateId: "soti-connection-stopped-reading",
    connectionName: "MobiControl stores",
    tag: "[SOTI]",
  },
];

function connectionStep(
  templateId: string,
  readIntervalInMinutes?: number,
): MonitorStep {
  return getManagedDeviceAlertTemplateById(templateId)!.getMonitorStep({
    deviceManagementConnectionId: CONNECTION.toString(),
    onlineMonitorStatusId: ONLINE,
    offlineMonitorStatusId: OFFLINE,
    defaultIncidentSeverityId: ObjectID.generate(),
    defaultAlertSeverityId: ObjectID.generate(),
    monitorName: "Esper acme - Esper Connection Stopped Reading",
    readIntervalInMinutes,
  });
}

/*
 * One reading as its writer writes it: a read that worked, one that
 * failed, or a read falling due, `minutesAgo` before now.
 */
function reading(data: {
  minutesAgo: number;
  outcome: DeviceManagementConnectionReadOutcome;
  lastSuccessfulReadMinutesAgo?: number | undefined;
  provider?: DeviceManagementProvider | undefined;
  connectionName?: string | undefined;
  connectionId?: ObjectID | undefined;
  readIntervalInMinutes?: number | undefined;
  failureKind?: LlmConnectionFailureKind | undefined;
  lastError?: string | undefined;
}): JSONObject {
  const asOf: Date = new Date(NOW.getTime() - data.minutesAgo * MINUTE);

  return buildDeviceManagementConnectionReadRecordRow(
    {
      projectId: PROJECT,
      connectionId: data.connectionId || CONNECTION,
      reading: {
        connectionName: data.connectionName ?? "Esper acme",
        provider: data.provider || DeviceManagementProvider.Esper,
        readIntervalInMinutes: data.readIntervalInMinutes ?? 15,
        outcome: data.outcome,
        lastSuccessfulReadAt:
          data.lastSuccessfulReadMinutesAgo === undefined
            ? undefined
            : new Date(
                NOW.getTime() - data.lastSuccessfulReadMinutesAgo * MINUTE,
              ),
        createdAt: new Date(NOW.getTime() - 30 * 24 * 60 * MINUTE),
        failureKind: data.failureKind,
        lastError: data.lastError,
        asOf,
      },
    },
    RETENTION_DAYS,
  );
}

/*
 * A connection whose key was refused 80 minutes ago, read every 15 minutes:
 * its last read that worked 95 minutes ago, then a failed read, an hour's
 * wait for its retry (a refused key's), the claim that queued the retry and
 * the retry, failed again.
 */
function failingRows(
  overrides: Partial<Parameters<typeof reading>[0]> = {},
): Array<JSONObject> {
  return [
    reading({
      minutesAgo: 95,
      outcome: DeviceManagementConnectionReadOutcome.Success,
      ...overrides,
    }),
    reading({
      minutesAgo: 80,
      outcome: DeviceManagementConnectionReadOutcome.Failed,
      lastSuccessfulReadMinutesAgo: 95,
      failureKind: LlmConnectionFailureKind.Authentication,
      lastError: REFUSED_KEY,
      ...overrides,
    }),
    reading({
      minutesAgo: 20,
      outcome: DeviceManagementConnectionReadOutcome.Due,
      lastSuccessfulReadMinutesAgo: 95,
      lastError: REFUSED_KEY,
      ...overrides,
    }),
    reading({
      minutesAgo: 19,
      outcome: DeviceManagementConnectionReadOutcome.Failed,
      lastSuccessfulReadMinutesAgo: 95,
      failureKind: LlmConnectionFailureKind.Authentication,
      lastError: REFUSED_KEY,
      ...overrides,
    }),
  ];
}

// Whether a row's attribute holds what a query's filter asks of it.
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
 * the minute's rows taken at their least (the query's aggregation), as
 * MonitorTelemetryMonitor.monitorMetric hands it on.
 */
function check(
  rows: Array<JSONObject>,
  now: Date = NOW,
): MetricMonitorResponse {
  const view: MetricsViewConfig = MonitorStep.getMetricsViewConfig(step)!;
  const windowStart: number = RollingTimeUtil.convertToStartAndEndDate(
    MANAGED_DEVICE_CONNECTION_READ_ROLLING_TIME,
    now,
  ).startValue.getTime();
  const read: Array<JSONObject> = rowsRead(rows, view.queryConfigs[0]!).filter(
    (row: JSONObject): boolean => {
      return (
        new Date(`${String(row["time"]).replace(" ", "T")}Z`).getTime() >=
        windowStart
      );
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

  const seriesBreakdown: Array<MetricSeriesResult> = Array.from(
    latestByName.entries(),
  ).map(
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
  );

  const metricResult: Array<AggregatedResult> = [
    {
      data: Array.from(latestByName.entries()).map(
        ([name, latest]: [string, { minute: string; value: number }]) => {
          return sample(name, latest);
        },
      ),
    },
  ];

  return {
    projectId: monitor.projectId!,
    monitorId: monitor.id!,
    metricViewConfig: view,
    metricResult: metricResult,
    seriesBreakdown: seriesBreakdown,
    startAndEndDate: RollingTimeUtil.convertToStartAndEndDate(
      MANAGED_DEVICE_CONNECTION_READ_ROLLING_TIME,
      now,
    ),
  };
}

let monitor: Monitor;
let step: MonitorStep;
let closeIncidents: jest.SpyInstance;
let closeAlerts: jest.SpyInstance;
let createAlerts: jest.SpyInstance;
let timelineCreate: jest.SpyInstance;

function useStep(monitorStep: MonitorStep): void {
  step = monitorStep;
  monitor.monitorType = MonitorType.Metrics;
  const monitorSteps: MonitorSteps = new MonitorSteps();
  monitorSteps.data = {
    monitorStepsInstanceArray: [step],
    defaultMonitorStatusId: ONLINE,
  };
  monitor.monitorSteps = monitorSteps;
}

// The series handed to a criteria that opens alerts, with their labels.
function alertedSeries(): Array<PerSeriesCriteriaMatch> {
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

    return input.matchesPerSeries || [];
  });
}

function alertedConnections(): Array<string> {
  return alertedSeries()
    .map((match: PerSeriesCriteriaMatch): string => {
      return String((match.labels || {})[NAME_KEY]);
    })
    .sort();
}

function unhealthyId(): string {
  return step.data!.monitorCriteria.data!.monitorCriteriaInstanceArray[0]!.data!
    .id!;
}

function healthyId(): string {
  return step.data!.monitorCriteria.data!.monitorCriteriaInstanceArray[1]!.data!
    .id!;
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(NOW);

  monitor = new Monitor();
  monitor.id = new ObjectID("33333333-3333-4333-8333-333333333333");
  monitor.projectId = PROJECT;
  monitor.name = "Esper acme - Esper Connection Stopped Reading";
  monitor.currentMonitorStatusId = ONLINE;
  useStep(connectionStep("esper-connection-stopped-reading"));

  jest.spyOn(ProjectService, "isProjectBlocked").mockResolvedValue(false);
  jest.spyOn(Semaphore, "lock").mockResolvedValue({} as never);
  jest.spyOn(Semaphore, "release").mockResolvedValue(undefined as never);
  jest.spyOn(MonitorService, "findOneById").mockResolvedValue(monitor as never);
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
  timelineCreate = jest
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
  closeIncidents = jest
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

  jest
    .spyOn(AlertStateService, "getUnresolvedAlertStateIds")
    .mockResolvedValue([]);
  jest
    .spyOn(IncidentStateService, "getUnresolvedIncidentStateIds")
    .mockResolvedValue([]);
  jest.spyOn(AlertService, "findBy").mockResolvedValue([] as never);
  jest.spyOn(IncidentService, "findBy").mockResolvedValue([] as never);

  jest.spyOn(logger, "error").mockImplementation(() => {
    return undefined as never;
  });
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe.each(PROVIDERS)(
  "$templateId, from a connection's readings to its alert",
  (provider: ProviderCase) => {
    beforeEach(() => {
      useStep(connectionStep(provider.templateId));
    });

    function rowsOf(
      rows: (
        overrides: Partial<Parameters<typeof reading>[0]>,
      ) => Array<JSONObject>,
    ): Array<JSONObject> {
      return rows({
        provider: provider.provider,
        connectionName: provider.connectionName,
      });
    }

    test("a connection failing for longer than its Stale point fires one alert, named after it", async () => {
      const response: ProbeApiIngestResponse =
        await MonitorResourceUtil.monitorResource(check(rowsOf(failingRows)));

      expect(response.criteriaMetId).toBe(unhealthyId());
      expect(alertedConnections()).toEqual([provider.connectionName]);

      // Its title names the service as its devices' alerts do, and the connection.
      const alert: { title: string; description: string } =
        step.data!.monitorCriteria.data!.monitorCriteriaInstanceArray[0]!.data!
          .alerts[0]!;
      expect(alert.title).toBe(`${provider.tag} Connection stopped reading`);
      expect(
        SeriesContextEnricher.enrichTitle({
          title: alert.title,
          seriesLabels: alertedSeries()[0]!.labels!,
        }),
      ).toContain(`Connection: ${provider.connectionName}`);
    });

    test("its first debug step lists the connection's last readings, the newest naming the error its read failed with", () => {
      const rows: Array<JSONObject> = rowsOf(failingRows);
      const commands: Array<SeriesDebugCommand> =
        SeriesDebugHints.getDebugCommands({
          monitorType: MonitorType.Metrics,
          seriesLabels: { [NAME_KEY]: provider.connectionName },
        });

      expect(commands.length).toBeGreaterThan(0);
      expect(commands[0]!.purpose).toContain("last error");

      // What the command asks for, read back from it: the readings it lists.
      const quoted: RegExpMatchArray | null = commands[0]!.command.match(
        /^oneuptime metric list --query '(.*)' --sort '\{"time":"DESC"\}' --limit 5 --fields time,value,attributes$/,
      );
      expect(quoted).not.toBeNull();
      const query: {
        name: string;
        attributes: Dictionary<string>;
      } = JSON.parse(quoted![1]!.split(`'\\''`).join("'"));

      expect(query.name).toBe(MANAGED_DEVICE_CONNECTION_READ_AGE_METRIC_NAME);

      const listed: Array<JSONObject> = rows
        .filter((row: JSONObject): boolean => {
          const attributes: Dictionary<string> = row[
            "attributes"
          ] as Dictionary<string>;

          return (
            row["name"] === query.name &&
            Object.entries(query.attributes).every(
              ([key, value]: [string, string]) => {
                return attributes[key] === value;
              },
            )
          );
        })
        .sort((left: JSONObject, right: JSONObject): number => {
          return String(right["time"]).localeCompare(String(left["time"]));
        });

      expect(listed).toHaveLength(4);
      expect(
        (listed[0]!["attributes"] as Dictionary<string>)[
          DeviceManagementConnectionReadingAttribute.LastError
        ],
      ).toBe(REFUSED_KEY);
      expect(
        (listed[0]!["attributes"] as Dictionary<string>)[
          DeviceManagementConnectionReadingAttribute.FailureKind
        ],
      ).toBe(LlmConnectionFailureKind.Authentication);
    });

    test("the alert's description carries that command, once it is about the connection", () => {
      const alert: { description: string } =
        step.data!.monitorCriteria.data!.monitorCriteriaInstanceArray[0]!.data!
          .alerts[0]!;
      const description: string = SeriesContextEnricher.enrichDescription({
        description: alert.description,
        seriesLabels: { [NAME_KEY]: provider.connectionName },
        monitorType: MonitorType.Metrics,
      });

      expect(description).toContain("View error");
      expect(description).toContain("oneuptime metric list --query");
      expect(description).toContain(
        MANAGED_DEVICE_CONNECTION_READ_AGE_METRIC_NAME,
      );
    });

    test("a read that works resolves it: the connection's newest minute reads 0", async () => {
      const rows: Array<JSONObject> = [
        ...rowsOf(failingRows),
        // The key replaced: the claim that queued the read, and the read, in one minute.
        reading({
          minutesAgo: 2,
          outcome: DeviceManagementConnectionReadOutcome.Due,
          lastSuccessfulReadMinutesAgo: 97,
          provider: provider.provider,
          connectionName: provider.connectionName,
          lastError: REFUSED_KEY,
        }),
        reading({
          minutesAgo: 2,
          outcome: DeviceManagementConnectionReadOutcome.Success,
          provider: provider.provider,
          connectionName: provider.connectionName,
        }),
      ];

      const response: ProbeApiIngestResponse =
        await MonitorResourceUtil.monitorResource(check(rows));

      expect(response.criteriaMetId).toBe(healthyId());
      expect(alertedConnections()).toEqual([]);
      expect(closeAlerts).toHaveBeenCalled();
    });

    test("a window with no reading at all - turned off, or the workers stopped - resolves nothing", async () => {
      const response: ProbeApiIngestResponse =
        await MonitorResourceUtil.monitorResource(check([]));

      expect(response.criteriaMetId).toBeFalsy();
      expect(closeAlerts).not.toHaveBeenCalled();
      expect(closeIncidents).not.toHaveBeenCalled();
      expect(timelineCreate).not.toHaveBeenCalled();
      expect(alertedConnections()).toEqual([]);
    });
  },
);

describe("Connection Stopped Reading: when it fires", () => {
  test("a read that fails once and works at its retry never alerts", async () => {
    const rows: Array<JSONObject> = [
      reading({
        minutesAgo: 35,
        outcome: DeviceManagementConnectionReadOutcome.Success,
      }),
      // Esper did not answer: tried again after 15 minutes.
      reading({
        minutesAgo: 20,
        outcome: DeviceManagementConnectionReadOutcome.Failed,
        lastSuccessfulReadMinutesAgo: 35,
        failureKind: LlmConnectionFailureKind.Unavailable,
        lastError: "OneUptime could not reach Esper: connect ETIMEDOUT.",
      }),
      reading({
        minutesAgo: 5,
        outcome: DeviceManagementConnectionReadOutcome.Due,
        lastSuccessfulReadMinutesAgo: 35,
        lastError: "OneUptime could not reach Esper: connect ETIMEDOUT.",
      }),
    ];

    // 30 minutes without a read that worked, at the newest reading: under 55.
    const response: ProbeApiIngestResponse =
      await MonitorResourceUtil.monitorResource(check(rows));

    expect(response.criteriaMetId).toBe(healthyId());
    expect(alertedConnections()).toEqual([]);
  });

  test("a connection whose reads stop finishing alerts from the reads that fall due", async () => {
    // Its last read that worked 70 minutes ago; every read since lost before it ended.
    const rows: Array<JSONObject> = [
      reading({
        minutesAgo: 70,
        outcome: DeviceManagementConnectionReadOutcome.Success,
      }),
      ...[55, 40, 25, 10].map((minutesAgo: number): JSONObject => {
        return reading({
          minutesAgo,
          outcome: DeviceManagementConnectionReadOutcome.Due,
          lastSuccessfulReadMinutesAgo: 70,
        });
      }),
    ];

    const response: ProbeApiIngestResponse =
      await MonitorResourceUtil.monitorResource(check(rows));

    expect(response.criteriaMetId).toBe(unhealthyId());
    expect(alertedConnections()).toEqual(["Esper acme"]);
  });

  test("its wait follows the connection's read interval: three intervals and ten minutes", async () => {
    // Read every hour: 190 minutes.
    useStep(connectionStep("esper-connection-stopped-reading", 60));
    expect(getManagedDeviceConnectionStoppedReadingMinutes(60)).toBe(190);

    const quietFor: (minutes: number) => Array<JSONObject> = (
      minutes: number,
    ): Array<JSONObject> => {
      return [
        reading({
          minutesAgo: 1,
          outcome: DeviceManagementConnectionReadOutcome.Failed,
          lastSuccessfulReadMinutesAgo: minutes + 1,
          readIntervalInMinutes: 60,
          failureKind: LlmConnectionFailureKind.Unavailable,
          lastError: "Esper answered 503.",
        }),
      ];
    };

    expect(
      (await MonitorResourceUtil.monitorResource(check(quietFor(150))))
        .criteriaMetId,
    ).toBe(healthyId());
    expect(alertedConnections()).toEqual([]);

    expect(
      (await MonitorResourceUtil.monitorResource(check(quietFor(200))))
        .criteriaMetId,
    ).toBe(unhealthyId());
    expect(alertedConnections()).toEqual(["Esper acme"]);
  });

  test("it fires when the connection's Status turns Stale, and not before", () => {
    // The chip and the template count the same minutes, at every interval.
    for (const interval of [5, 10, 15, 30, 60]) {
      const threshold: number =
        getManagedDeviceConnectionStoppedReadingMinutes(interval);
      const healthAt: (
        quietMinutes: number,
      ) => DeviceManagementConnectionStatus = (
        quietMinutes: number,
      ): DeviceManagementConnectionStatus => {
        return getDeviceManagementConnectionHealth(
          {
            isEnabled: true,
            lastPulledAt: new Date(NOW.getTime() - quietMinutes * MINUTE),
            lastSuccessfulPullAt: new Date(
              NOW.getTime() - quietMinutes * MINUTE,
            ),
            readIntervalInMinutes: interval,
          },
          NOW,
        ).status;
      };

      expect([interval, healthAt(threshold)]).toEqual([
        interval,
        DeviceManagementConnectionStatus.Healthy,
      ]);
      expect([interval, healthAt(threshold + 1)]).toEqual([
        interval,
        DeviceManagementConnectionStatus.Stale,
      ]);
    }
  });

  test("its window always holds a reading: the longest a connection waits between two is an hour", () => {
    const window: number =
      RollingTimeUtil.convertToStartAndEndDate(
        MANAGED_DEVICE_CONNECTION_READ_ROLLING_TIME,
        NOW,
      ).endValue.getTime() -
      RollingTimeUtil.convertToStartAndEndDate(
        MANAGED_DEVICE_CONNECTION_READ_ROLLING_TIME,
        NOW,
      ).startValue.getTime();

    for (const interval of [5, 10, 15, 30, 60]) {
      for (const failureKind of Object.values(LlmConnectionFailureKind)) {
        const wait: number =
          DeviceManagementReadRunner.nextPullAt({
            now: NOW,
            intervalInMinutes: interval,
            outcome: "failed",
            failureKind,
          }).getTime() - NOW.getTime();

        // The next reading - the claim that queues the retry - within the hour.
        expect(wait).toBeLessThanOrEqual(60 * MINUTE);
        expect(2 * wait).toBeLessThanOrEqual(window);
      }

      const afterARead: number =
        DeviceManagementReadRunner.nextPullAt({
          now: NOW,
          intervalInMinutes: interval,
          outcome: "success",
        }).getTime() - NOW.getTime();

      expect(2 * afterARead).toBeLessThanOrEqual(window);
    }
  });

  test("another connection's readings are never this monitor's", async () => {
    const rows: Array<JSONObject> = failingRows({
      connectionId: OTHER_CONNECTION,
      connectionName: "Esper globex",
    });

    // Its readings say nothing of this connection: a quiet window here.
    const response: ProbeApiIngestResponse =
      await MonitorResourceUtil.monitorResource(check(rows));

    expect(response.criteriaMetId).toBeFalsy();
    expect(alertedConnections()).toEqual([]);
    expect(closeAlerts).not.toHaveBeenCalled();
  });

  test("a connection renamed while it fails alerts under its new name; the old name's alert resolves once its last reading leaves the window", async () => {
    const renamed: string = "Esper acme (stores)";
    const rows: Array<JSONObject> = [
      ...failingRows().slice(0, 3),
      reading({
        minutesAgo: 1,
        outcome: DeviceManagementConnectionReadOutcome.Failed,
        lastSuccessfulReadMinutesAgo: 95,
        connectionName: renamed,
        failureKind: LlmConnectionFailureKind.Authentication,
        lastError: REFUSED_KEY,
      }),
    ];

    await MonitorResourceUtil.monitorResource(check(rows));

    expect(alertedConnections()).toContain(renamed);

    // Two hours on: only the new name's readings are in the window.
    const later: Date = new Date(NOW.getTime() + 125 * MINUTE);
    jest.setSystemTime(later);
    closeAlerts.mockClear();
    createAlerts.mockClear();

    await MonitorResourceUtil.monitorResource(
      check(
        [
          ...rows,
          reading({
            minutesAgo: -120,
            outcome: DeviceManagementConnectionReadOutcome.Failed,
            lastSuccessfulReadMinutesAgo: 95,
            connectionName: renamed,
            failureKind: LlmConnectionFailureKind.Authentication,
            lastError: REFUSED_KEY,
          }),
        ],
        later,
      ),
    );

    expect(alertedConnections()).toEqual([renamed]);
    expect(closeAlerts).toHaveBeenCalled();

    const breaching: Record<string, Set<string>> | undefined = (
      closeAlerts.mock.calls[0]![0] as {
        breachingSeriesFingerprintsByCriteriaId?: Record<string, Set<string>>;
      }
    ).breachingSeriesFingerprintsByCriteriaId;

    expect(breaching![unhealthyId()]!.has(fingerprintOf(renamed))).toBe(true);
    expect(breaching![unhealthyId()]!.has(fingerprintOf("Esper acme"))).toBe(
      false,
    );
  });
});

describe("silence is not recovery for a connection's own reading", () => {
  test("a check of the connection's reading with none at all is quiet", () => {
    const response: MetricMonitorResponse = check([]);

    expect(ManagedDeviceCheckInSilence.readsCheckIns(response)).toBe(true);
    expect(ManagedDeviceCheckInSilence.isQuietWindow(response)).toBe(true);
    expect(
      MonitorResourceUtil.isSilentInfrastructureWindow({
        monitor,
        dataToProcess: response,
      }),
    ).toBe(true);
  });

  test("one reading is not", () => {
    const response: MetricMonitorResponse = check([
      reading({
        minutesAgo: 3,
        outcome: DeviceManagementConnectionReadOutcome.Success,
      }),
    ]);

    expect(ManagedDeviceCheckInSilence.isQuietWindow(response)).toBe(false);
  });
});
