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
import {
  ManagedDeviceReadingRowInput,
  buildManagedDeviceCheckInRow,
  buildManagedDeviceSecurityPatchRow,
} from "../../../../Server/Utils/DeviceManagement/ManagedDeviceCheckInMetrics";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import MonitorStatusTimeline from "../../../../Models/DatabaseModels/MonitorStatusTimeline";
import AggregateModel from "../../../../Types/BaseDatabase/AggregatedModel";
import AggregatedResult from "../../../../Types/BaseDatabase/AggregatedResult";
import Includes from "../../../../Types/BaseDatabase/Includes";
import Dictionary from "../../../../Types/Dictionary";
import {
  ManagedDeviceCheckInAttribute,
  ManagedDeviceCheckInDevice,
  ManagedDeviceCheckInReading,
  getManagedDeviceCheckInReadings,
} from "../../../../Types/DeviceManagement/ManagedDeviceCheckIn";
import { ManagedDevicePlatform } from "../../../../Types/DeviceManagement/ManagedDevicePlatform";
import { JSONObject } from "../../../../Types/JSON";
import {
  ManagedDeviceAlertTemplate,
  getManagedDeviceAlertTemplateById,
} from "../../../../Types/Monitor/ManagedDeviceAlertTemplates";
import { getHostAlertTemplateById } from "../../../../Types/Monitor/HostAlertTemplates";
import MetricQueryConfigData from "../../../../Types/Metrics/MetricQueryConfigData";
import MetricsViewConfig from "../../../../Types/Metrics/MetricsViewConfig";
import MetricMonitorResponse from "../../../../Types/Monitor/MetricMonitor/MetricMonitorResponse";
import MetricSeriesResult from "../../../../Types/Monitor/MetricMonitor/MetricSeriesResult";
import MonitorStep from "../../../../Types/Monitor/MonitorStep";
import MonitorSteps from "../../../../Types/Monitor/MonitorSteps";
import MonitorType from "../../../../Types/Monitor/MonitorType";
import ObjectID from "../../../../Types/ObjectID";
import ProbeApiIngestResponse, {
  PerSeriesCriteriaMatch,
} from "../../../../Types/Probe/ProbeApiIngestResponse";
import RollingTime from "../../../../Types/RollingTime/RollingTime";
import RollingTimeUtil from "../../../../Types/RollingTime/RollingTimeUtil";
import MetricSeriesFingerprint from "../../../../Utils/Metrics/MetricSeriesFingerprint";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * Security Patch Out of Date for the Android devices a device manager
 * imports (#10098), end to end through the monitor code: a read of the
 * connection writes each device's rows (ManagedDeviceCheckInMetrics), the
 * monitor's query reads the rows it names - as ClickHouse does, by the
 * metric's name and the attributes' values - each device judged on its
 * latest reading, and MonitorResourceUtil.monitorResource, through the real
 * criteria evaluator, opens one alert per device more than 90 days behind.
 *
 * A device the Android agent reports is a host: the read marks its rows so,
 * the template reads only the devices that are not, and its host's own
 * Security Patch Out of Date reads the agent's metric by the host's name,
 * which none of the import's rows carry. So it is alerted on once, never
 * twice. A device updated resolves at the next read; a window with no
 * reading of any device - the connection stopped reading - resolves nothing.
 *
 * Postgres, Redis and the incident and alert machinery are stood in for;
 * what is asserted is what they are asked to do.
 */

const NOW: Date = new Date(Date.UTC(2026, 10, 19, 12, 10, 30));
const READ_AT: Date = new Date(Date.UTC(2026, 10, 19, 12, 0, 0));
const RETENTION: Date = new Date(Date.UTC(2026, 11, 19, 12, 0, 0));

const ONLINE: ObjectID = new ObjectID("11111111-1111-4111-8111-111111111111");
const OFFLINE: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");
const PROJECT: ObjectID = new ObjectID("44444444-4444-4444-8444-444444444444");
const CONNECTION: ObjectID = new ObjectID(
  "55555555-5555-4555-8555-555555555555",
);
const DEVICE_KEY: string = ManagedDeviceCheckInAttribute.DeviceName;

function patchStep(templateId: string): MonitorStep {
  return getManagedDeviceAlertTemplateById(templateId)!.getMonitorStep({
    deviceManagementConnectionId: CONNECTION.toString(),
    onlineMonitorStatusId: ONLINE,
    offlineMonitorStatusId: OFFLINE,
    defaultIncidentSeverityId: ObjectID.generate(),
    defaultAlertSeverityId: ObjectID.generate(),
    monitorName: "Esper acme - Esper Security Patch Out of Date",
  });
}

// An Esper Android device, as a read finds it.
function device(
  name: string,
  securityPatchLevel: string | undefined,
  overrides: Partial<ManagedDeviceCheckInDevice> = {},
): ManagedDeviceCheckInDevice {
  return {
    providerDeviceId: `id-${name}`,
    deviceName: name,
    serialNumber: `SERIAL-${name}`,
    platform: ManagedDevicePlatform.Android,
    lastCheckInAt: new Date(READ_AT.getTime() - 4 * 60 * 1000),
    securityPatchLevel,
    ...overrides,
  };
}

/*
 * The rows one read of the connection writes for these devices, as
 * ManagedDeviceCheckInMetrics.record writes them: a check-in each, and a
 * security patch reading for each Android device with a level. `hosts`
 * are the devices the Android agent reports (hosts in Hosts). Every row
 * names the connection's service: Esper's, unless another is given.
 */
function rowsOfARead(data: {
  devices: Array<ManagedDeviceCheckInDevice>;
  hosts?: Array<string> | undefined;
  readAt?: Date | undefined;
  provider?: string | undefined;
}): Array<JSONObject> {
  const readAt: Date = data.readAt || READ_AT;
  const provider: string = data.provider || "esper";
  const readings: Array<ManagedDeviceCheckInReading> =
    getManagedDeviceCheckInReadings({
      devices: data.devices,
      hostNames: new Set<string>(
        (data.hosts || []).map((host: string): string => {
          return host.toLowerCase();
        }),
      ),
      asOf: readAt,
      provider,
    });
  const rows: Array<JSONObject> = [];

  for (const reading of readings) {
    const input: ManagedDeviceReadingRowInput = {
      projectId: PROJECT,
      connectionId: CONNECTION,
      provider,
      reading,
      asOf: readAt,
      retentionDate: RETENTION,
    };

    rows.push(buildManagedDeviceCheckInRow(input));

    const patch: JSONObject | undefined =
      buildManagedDeviceSecurityPatchRow(input);

    if (patch) {
      rows.push(patch);
    }
  }

  return rows;
}

// Whether a row's attribute holds what a query's filter asks of it.
function matches(value: unknown, wanted: unknown): boolean {
  if (wanted instanceof Includes) {
    return (wanted.values as Array<unknown>).includes(value);
  }

  return value === wanted;
}

// The rows a query reads, as ClickHouse picks them: by name and attributes.
function rowsRead(
  rows: Array<JSONObject>,
  query: MetricQueryConfigData,
  extraAttributes: Dictionary<string> = {},
): Array<JSONObject> {
  const filter: MetricQueryConfigData["metricQueryData"]["filterData"] =
    query.metricQueryData.filterData;
  const wanted: Dictionary<unknown> = {
    ...((filter.attributes || {}) as Dictionary<unknown>),
    ...extraAttributes,
  };

  return rows.filter((row: JSONObject): boolean => {
    const attributes: Dictionary<unknown> = row[
      "attributes"
    ] as Dictionary<unknown>;

    return (
      row["name"] === filter.metricName &&
      Object.entries(wanted).every(([key, value]: [string, unknown]) => {
        return matches(attributes[key], value);
      })
    );
  });
}

function fingerprintOf(device: string): string {
  return MetricSeriesFingerprint.computeFingerprint({ [DEVICE_KEY]: device });
}

/*
 * The worker's answer at a check: the rows the step's query reads, one
 * series per device, each device judged on its latest reading
 * (judgeLatestReading), as MonitorTelemetryMonitor.monitorMetric hands it on.
 */
function check(
  rows: Array<JSONObject>,
  now: Date = NOW,
): MetricMonitorResponse {
  const view: MetricsViewConfig = MonitorStep.getMetricsViewConfig(step)!;
  const read: Array<JSONObject> = rowsRead(rows, view.queryConfigs[0]!);
  const latestByDevice: Map<string, JSONObject> = new Map<string, JSONObject>();

  for (const row of read) {
    const name: string = (row["attributes"] as Dictionary<string>)[DEVICE_KEY]!;
    const earlier: JSONObject | undefined = latestByDevice.get(name);

    if (!earlier || String(row["time"]) >= String(earlier["time"])) {
      latestByDevice.set(name, row);
    }
  }

  const sample: (row: JSONObject) => AggregateModel = (
    row: JSONObject,
  ): AggregateModel => {
    return {
      timestamp: new Date(`${String(row["time"]).replace(" ", "T")}Z`),
      value: row["value"] as number,
      attributes: {
        [DEVICE_KEY]: (row["attributes"] as Dictionary<string>)[DEVICE_KEY],
      },
    } as unknown as AggregateModel;
  };

  const seriesBreakdown: Array<MetricSeriesResult> = Array.from(
    latestByDevice.entries(),
  ).map(([name, row]: [string, JSONObject]): MetricSeriesResult => {
    return {
      fingerprint: fingerprintOf(name),
      labels: { [DEVICE_KEY]: name },
      aggregatedResults: [{ data: [sample(row)] }],
    };
  });

  const metricResult: Array<AggregatedResult> = [
    { data: Array.from(latestByDevice.values()).map(sample) },
  ];

  return {
    projectId: monitor.projectId!,
    monitorId: monitor.id!,
    metricViewConfig: view,
    metricResult: metricResult,
    seriesBreakdown: seriesBreakdown,
    startAndEndDate: RollingTimeUtil.convertToStartAndEndDate(
      RollingTime.Past2Hours,
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

// The devices handed to a criteria that opens alerts.
function alertedDevices(): Array<string> {
  return createAlerts.mock.calls
    .flatMap((call: Array<unknown>) => {
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
          return String((match.labels || {})[DEVICE_KEY]);
        },
      );
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
  monitor.name = "Esper acme - Esper Security Patch Out of Date";
  monitor.currentMonitorStatusId = OFFLINE;
  useStep(patchStep("esper-security-patch-out-of-date"));

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

describe("Esper Security Patch Out of Date, from a read's rows to its alerts", () => {
  test("one alert for each imported device more than 90 days behind, none for the others", async () => {
    const rows: Array<JSONObject> = rowsOfARead({
      devices: [
        // 897 days behind.
        device("ESP-ID-AAAAW", "2024-06-05"),
        // 91 days behind: one day past the rule.
        device("ESP-ID-AAAAX", "2026-08-20"),
        // Exactly 90 days: up to date, as Inventory says.
        device("ESP-ID-AAAAY", "2026-08-21"),
        // 18 days.
        device("ESP-ID-AAAAZ", "2026-11-01"),
      ],
    });

    const response: ProbeApiIngestResponse =
      await MonitorResourceUtil.monitorResource(check(rows));

    expect(response.criteriaMetId).toBe(unhealthyId());
    expect(alertedDevices()).toEqual(["ESP-ID-AAAAW", "ESP-ID-AAAAX"]);
  });

  test("a device that runs the Android agent is never this monitor's: its host alerts, once", async () => {
    const agentDevice: ManagedDeviceCheckInDevice = device(
      "ESP-ID-AGENT",
      "2024-06-05",
    );
    const rows: Array<JSONObject> = rowsOfARead({
      devices: [agentDevice, device("ESP-ID-AAAAW", "2024-06-05")],
      hosts: ["ESP-ID-AGENT"],
    });

    // The read still writes the agent's device's patch reading, marked a host.
    const agentRows: Array<JSONObject> = rows.filter((row: JSONObject) => {
      return (
        (row["attributes"] as Dictionary<string>)[DEVICE_KEY] === "ESP-ID-AGENT"
      );
    });
    expect(agentRows).toHaveLength(2);
    for (const row of agentRows) {
      expect(
        (row["attributes"] as Dictionary<string>)[
          ManagedDeviceCheckInAttribute.IsHost
        ],
      ).toBe("true");
    }

    await MonitorResourceUtil.monitorResource(check(rows));

    // This monitor alerts for the device no agent reports, and not the other.
    expect(alertedDevices()).toEqual(["ESP-ID-AAAAW"]);

    /*
     * The host's own template reads the agent's metric by the host's name:
     * not one of the import's rows, though they carry the host's name too,
     * so the device is not read twice there either.
     */
    const hostStep: MonitorStep = getHostAlertTemplateById(
      "android-security-patch-out-of-date",
    )!.getMonitorStep({
      hostIdentifier: "esp-id-agent",
      onlineMonitorStatusId: ONLINE,
      offlineMonitorStatusId: OFFLINE,
      defaultIncidentSeverityId: ObjectID.generate(),
      defaultAlertSeverityId: ObjectID.generate(),
      monitorName: "ESP-ID-AGENT",
    });
    const hostQuery: MetricQueryConfigData =
      hostStep.data!.hostMonitor!.metricViewConfig.queryConfigs[0]!;

    expect(
      rowsRead(rows, hostQuery, { "resource.host.name": "esp-id-agent" }),
    ).toEqual([]);
    // The import's rows do carry the host's name: only the metric keeps them apart.
    expect(
      agentRows.every((row: JSONObject): boolean => {
        return (
          (row["attributes"] as Dictionary<string>)["resource.host.name"] ===
          "esp-id-agent"
        );
      }),
    ).toBe(true);
  });

  test("a device with the agent that leaves Hosts (archived) is this monitor's again, at the next read", async () => {
    const rows: Array<JSONObject> = rowsOfARead({
      devices: [device("ESP-ID-AGENT", "2024-06-05")],
      // No longer a host: the read writes it as a device no agent reports.
      hosts: [],
    });

    await MonitorResourceUtil.monitorResource(check(rows));

    expect(alertedDevices()).toEqual(["ESP-ID-AGENT"]);
  });

  test("an iPhone, and an Android device whose level is not known, are never read", async () => {
    const rows: Array<JSONObject> = rowsOfARead({
      devices: [
        device("IPHONE-1", "2024-06-05", {
          platform: ManagedDevicePlatform.IOS,
        }),
        device("ESP-ID-NOLEVEL", undefined),
        device("ESP-ID-AAAAW", "2024-06-05"),
      ],
    });

    await MonitorResourceUtil.monitorResource(check(rows));

    expect(alertedDevices()).toEqual(["ESP-ID-AAAAW"]);
  });

  test("each device on its latest reading: one updated since the last read resolves, one that crossed the rule at midnight alerts", async () => {
    // Two reads either side of midnight, UTC: the day the age is counted in.
    const now: Date = new Date("2026-11-20T00:10:30.000Z");
    const beforeMidnight: Date = new Date("2026-11-19T23:45:00.000Z");
    const afterMidnight: Date = new Date("2026-11-20T00:00:00.000Z");
    jest.setSystemTime(now);

    const rows: Array<JSONObject> = [
      // Behind at the last read, updated since.
      ...rowsOfARead({
        devices: [device("ESP-ID-AAAAW", "2024-06-05")],
        readAt: beforeMidnight,
      }),
      ...rowsOfARead({
        devices: [device("ESP-ID-AAAAW", "2026-11-05")],
        readAt: afterMidnight,
      }),
      // 90 days old before midnight - up to date - and 91 after it.
      ...rowsOfARead({
        devices: [device("ESP-ID-AAAAX", "2026-08-21")],
        readAt: beforeMidnight,
      }),
      ...rowsOfARead({
        devices: [device("ESP-ID-AAAAX", "2026-08-21")],
        readAt: afterMidnight,
      }),
    ];

    const ages: Array<number> = rows
      .filter((row: JSONObject): boolean => {
        return (
          (row["attributes"] as Dictionary<string>)[DEVICE_KEY] ===
            "ESP-ID-AAAAX" &&
          row["name"] === "oneuptime.managed_device.security_patch.age"
        );
      })
      .map((row: JSONObject): number => {
        return row["value"] as number;
      });
    expect(ages).toEqual([90, 91]);

    await MonitorResourceUtil.monitorResource(check(rows, now));

    expect(alertedDevices()).toEqual(["ESP-ID-AAAAX"]);
  });

  test("every device updated resolves the open alerts", async () => {
    const response: ProbeApiIngestResponse =
      await MonitorResourceUtil.monitorResource(
        check(
          rowsOfARead({
            devices: [
              device("ESP-ID-AAAAW", "2026-11-05"),
              device("ESP-ID-AAAAX", "2026-10-01"),
            ],
          }),
        ),
      );

    expect(response.criteriaMetId).toBe(healthyId());
    expect(alertedDevices()).toEqual([]);
    expect(closeAlerts).toHaveBeenCalled();
  });

  test("a device that left the fleet no longer breaches: its alert resolves while the others read on", async () => {
    await MonitorResourceUtil.monitorResource(
      check(rowsOfARead({ devices: [device("ESP-ID-AAAAX", "2026-11-05")] })),
    );

    expect(closeAlerts).toHaveBeenCalled();

    const breaching: Record<string, Set<string>> | undefined = (
      closeAlerts.mock.calls[0]![0] as {
        breachingSeriesFingerprintsByCriteriaId?: Record<string, Set<string>>;
      }
    ).breachingSeriesFingerprintsByCriteriaId;

    expect(breaching?.[unhealthyId()]).toBeDefined();
    expect(breaching![unhealthyId()]!.has(fingerprintOf("ESP-ID-AAAAW"))).toBe(
      false,
    );
  });

  test("a window with no patch reading of any device - the connection stopped reading - resolves nothing", async () => {
    const response: ProbeApiIngestResponse =
      await MonitorResourceUtil.monitorResource(check([]));

    expect(response.criteriaMetId).toBeFalsy();
    expect(closeAlerts).not.toHaveBeenCalled();
    expect(closeIncidents).not.toHaveBeenCalled();
    expect(timelineCreate).not.toHaveBeenCalled();
    expect(alertedDevices()).toEqual([]);
  });

  test("a fleet read with only its check-ins - no device has a patch level - is no reading here either", async () => {
    const rows: Array<JSONObject> = rowsOfARead({
      devices: [
        device("ESP-ID-AAAAW", undefined),
        device("IPHONE-1", "2024-06-05", {
          platform: ManagedDevicePlatform.IOS,
        }),
      ],
    });

    // The check-ins are there; the patch query reads none of them.
    expect(rows).toHaveLength(2);

    const response: ProbeApiIngestResponse =
      await MonitorResourceUtil.monitorResource(check(rows));

    expect(response.criteriaMetId).toBeFalsy();
    expect(closeAlerts).not.toHaveBeenCalled();
  });
});

describe("every device manager's template, through the same code", () => {
  test.each([
    ["intune-security-patch-out-of-date"],
    ["workspace-one-security-patch-out-of-date"],
    ["soti-security-patch-out-of-date"],
  ])(
    "%s alerts once per device behind, never for the agent's",
    async (templateId: string) => {
      useStep(patchStep(templateId));

      // The rows its own service's connection writes: each names the service.
      const rows: Array<JSONObject> = rowsOfARead({
        devices: [
          device("DEVICE-BEHIND", "2025-01-05"),
          device("DEVICE-CURRENT", "2026-11-05"),
          device("DEVICE-AGENT", "2025-01-05"),
        ],
        hosts: ["DEVICE-AGENT"],
        provider: getManagedDeviceAlertTemplateById(templateId)!.provider,
      });

      const response: ProbeApiIngestResponse =
        await MonitorResourceUtil.monitorResource(check(rows));

      expect(response.criteriaMetId).toBe(unhealthyId());
      expect(alertedDevices()).toEqual(["DEVICE-BEHIND"]);
    },
  );

  /*
   * A monitor made before the template read its service reads the
   * connection alone, and alerts on the same devices: every reading of the
   * connection names its service.
   */
  test.each([
    ["esper-security-patch-out-of-date"],
    ["intune-security-patch-out-of-date"],
    ["workspace-one-security-patch-out-of-date"],
    ["soti-security-patch-out-of-date"],
  ])(
    "%s made before it read its service alerts on the same devices",
    async (templateId: string) => {
      const template: ManagedDeviceAlertTemplate =
        getManagedDeviceAlertTemplateById(templateId)!;

      useStep(
        template.getEarlierMonitorSteps!({
          deviceManagementConnectionId: CONNECTION.toString(),
          onlineMonitorStatusId: ONLINE,
          offlineMonitorStatusId: OFFLINE,
          defaultIncidentSeverityId: ObjectID.generate(),
          defaultAlertSeverityId: ObjectID.generate(),
          monitorName: "Stores West - Security Patch Out of Date",
        })[0]!,
      );

      const response: ProbeApiIngestResponse =
        await MonitorResourceUtil.monitorResource(
          check(
            rowsOfARead({
              devices: [
                device("DEVICE-BEHIND", "2025-01-05"),
                device("DEVICE-CURRENT", "2026-11-05"),
              ],
              provider: template.provider,
            }),
          ),
        );

      expect(response.criteriaMetId).toBe(unhealthyId());
      expect(alertedDevices()).toEqual(["DEVICE-BEHIND"]);
    },
  );
});
