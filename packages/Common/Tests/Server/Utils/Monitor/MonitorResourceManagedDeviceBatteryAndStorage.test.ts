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
  buildManagedDeviceBatteryRow,
  buildManagedDeviceCheckInRow,
  buildManagedDeviceSecurityPatchRow,
  buildManagedDeviceStorageRow,
} from "../../../../Server/Utils/DeviceManagement/ManagedDeviceCheckInMetrics";
import {
  ManagedDeviceSyncPlan,
  planManagedDeviceSync,
} from "../../../../Server/Utils/DeviceManagement/ManagedDeviceSync";
import { ProviderDevice } from "../../../../Server/Utils/DeviceManagement/DeviceManagementTypes";
import { parseEsperDevice } from "../../../../Server/Utils/DeviceManagement/Esper/EsperParsers";
import {
  parseIntuneBatteryLevel,
  parseIntuneDevice,
} from "../../../../Server/Utils/DeviceManagement/Intune/IntuneParsers";
import { parseWorkspaceOneDevice } from "../../../../Server/Utils/DeviceManagement/WorkspaceOne/WorkspaceOneParsers";
import { parseSotiDevice } from "../../../../Server/Utils/DeviceManagement/Soti/SotiParsers";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import MonitorStatusTimeline from "../../../../Models/DatabaseModels/MonitorStatusTimeline";
import AggregateModel from "../../../../Types/BaseDatabase/AggregatedModel";
import AggregatedResult from "../../../../Types/BaseDatabase/AggregatedResult";
import Includes from "../../../../Types/BaseDatabase/Includes";
import Dictionary from "../../../../Types/Dictionary";
import DeviceManagementProvider from "../../../../Types/DeviceManagement/DeviceManagementProvider";
import {
  MANAGED_DEVICE_BATTERY_LEVEL_METRIC_NAME,
  MANAGED_DEVICE_STORAGE_USED_METRIC_NAME,
  ManagedDeviceCheckInAttribute,
  ManagedDeviceCheckInDevice,
  ManagedDeviceCheckInReading,
  getManagedDeviceCheckInReadings,
} from "../../../../Types/DeviceManagement/ManagedDeviceCheckIn";
import { JSONObject } from "../../../../Types/JSON";
import MetricQueryConfigData from "../../../../Types/Metrics/MetricQueryConfigData";
import MetricsAggregationType from "../../../../Types/Metrics/MetricsAggregationType";
import MetricsViewConfig from "../../../../Types/Metrics/MetricsViewConfig";
import MetricMonitorResponse from "../../../../Types/Monitor/MetricMonitor/MetricMonitorResponse";
import MetricSeriesResult from "../../../../Types/Monitor/MetricMonitor/MetricSeriesResult";
import { getHostAlertTemplateById } from "../../../../Types/Monitor/HostAlertTemplates";
import { getManagedDeviceAlertTemplateById } from "../../../../Types/Monitor/ManagedDeviceAlertTemplates";
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
import {
  buildEsperAppleDevice,
  buildEsperDevice,
} from "../DeviceManagement/EsperFixtures";
import {
  buildIntuneDevice,
  buildIntuneHardwareInformation,
  buildIntuneIpad,
  buildIntuneIphone,
} from "../DeviceManagement/FakeIntuneGraph";
import {
  buildWorkspaceOneAndroid,
  buildWorkspaceOneDevice,
  buildWorkspaceOneWindows,
} from "../DeviceManagement/FakeWorkspaceOneApi";
import {
  buildSotiDevice,
  buildSotiIpad,
} from "../DeviceManagement/FakeSotiApi";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * Low Battery and Storage Nearly Full for the devices each device manager
 * imports (#10008), end to end through the monitor code: each service's own
 * device payload, shaped as its API reference documents it (the fixtures
 * the connectors' tests share), is read by its real parser, written as a
 * read writes it (planManagedDeviceSync, getManagedDeviceCheckInReadings
 * and the real row builders), read back by the template's own query as
 * ClickHouse picks rows, each device judged on its newest minute, and
 * MonitorResourceUtil.monitorResource, through the real criteria evaluator,
 * opens one alert per device under 20% battery, or more than 90% full.
 *
 * A device the Android agent reports is marked a host, and none of its
 * rows is the template's; its host's own Low Battery and Storage Nearly
 * Full read the agent's metrics, which none of the import's rows are. So a
 * device is alerted on once, never twice.
 *
 * Postgres, Redis and the incident and alert machinery are stood in for;
 * what is asserted is what they are asked to do.
 */

const NOW: Date = new Date(Date.UTC(2026, 10, 19, 12, 10, 30));
const READ_AT: Date = new Date(Date.UTC(2026, 10, 19, 12, 0, 0));
const RETENTION: Date = new Date(Date.UTC(2026, 11, 19, 12, 0, 0));
const MINUTE: number = 60 * 1000;

const ONLINE: ObjectID = new ObjectID("11111111-1111-4111-8111-111111111111");
const OFFLINE: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");
const PROJECT: ObjectID = new ObjectID("44444444-4444-4444-8444-444444444444");
const CONNECTION: ObjectID = new ObjectID(
  "55555555-5555-4555-8555-555555555555",
);
const DEVICE_KEY: string = ManagedDeviceCheckInAttribute.DeviceName;

// A device a service listed, and when it last checked in.
interface ListedDevice {
  device: ProviderDevice;
  lastCheckInAt: Date | null;
}

/*
 * One read's rows for these devices, as ManagedDeviceCheckInMetrics.record
 * writes them: the devices as the sync stores them, their readings, and
 * each reading's check-in, patch, battery and storage rows. `hosts` are
 * the devices the Android agent reports.
 */
function rowsOfARead(data: {
  provider: DeviceManagementProvider;
  listed: Array<ListedDevice>;
  hosts?: Array<string> | undefined;
  readAt?: Date | undefined;
}): Array<JSONObject> {
  const readAt: Date = data.readAt || READ_AT;
  const checkIns: Map<string, Date> = new Map<string, Date>();

  for (const entry of data.listed) {
    if (entry.lastCheckInAt) {
      checkIns.set(entry.device.providerDeviceId, entry.lastCheckInAt);
    }
  }

  const plan: ManagedDeviceSyncPlan = planManagedDeviceSync({
    stored: [],
    devices: data.listed.map((entry: ListedDevice): ProviderDevice => {
      return entry.device;
    }),
    groups: new Map(),
    isGroupListComplete: true,
    isDeviceListComplete: true,
    checkIns,
    now: readAt,
  });

  // The rows the sync stores, as the check-ins' writer reads them.
  const stored: Array<ManagedDeviceCheckInDevice> = plan.creates.map(
    (create: ManagedDeviceSyncPlan["creates"][number]) => {
      return {
        providerDeviceId: create.providerDeviceId,
        platform: create.fields.platform,
        deviceName: create.fields.deviceName,
        alias: create.fields.alias,
        serialNumber: create.fields.serialNumber,
        groupName: create.fields.groupName,
        groupPath: create.fields.groupPath,
        providerState: create.fields.providerState,
        lastCheckInAt: create.lastCheckInAt,
        securityPatchLevel: create.fields.securityPatchLevel,
        batteryLevel: create.fields.batteryLevel,
        details: create.fields.details,
      };
    },
  );

  const readings: Array<ManagedDeviceCheckInReading> =
    getManagedDeviceCheckInReadings({
      devices: stored,
      hostNames: new Set<string>(
        (data.hosts || []).map((host: string): string => {
          return host.toLowerCase();
        }),
      ),
      asOf: readAt,
      provider: data.provider,
    });
  const rows: Array<JSONObject> = [];

  for (const reading of readings) {
    const input: ManagedDeviceReadingRowInput = {
      projectId: PROJECT,
      connectionId: CONNECTION,
      provider: data.provider,
      reading,
      asOf: readAt,
      retentionDate: RETENTION,
    };

    rows.push(buildManagedDeviceCheckInRow(input));

    for (const optional of [
      buildManagedDeviceSecurityPatchRow(input),
      buildManagedDeviceBatteryRow(input),
      buildManagedDeviceStorageRow(input),
    ]) {
      if (optional) {
        rows.push(optional);
      }
    }
  }

  return rows;
}

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
 * series per device, each judged on its newest minute, the minute's rows
 * taken as the query aggregates them (Min for a battery, Max for storage).
 */
function check(rows: Array<JSONObject>): MetricMonitorResponse {
  const view: MetricsViewConfig = MonitorStep.getMetricsViewConfig(step)!;
  const query: MetricQueryConfigData = view.queryConfigs[0]!;
  const read: Array<JSONObject> = rowsRead(rows, query);
  const takesTheLeast: boolean =
    query.metricQueryData.filterData.aggegationType ===
    MetricsAggregationType.Min;
  const latest: Map<string, { minute: string; value: number }> = new Map<
    string,
    { minute: string; value: number }
  >();

  for (const row of read) {
    const name: string = (row["attributes"] as Dictionary<string>)[DEVICE_KEY]!;
    const minute: string = String(row["time"]).substring(0, 16);
    const value: number = row["value"] as number;
    const earlier: { minute: string; value: number } | undefined =
      latest.get(name);

    if (!earlier || minute > earlier.minute) {
      latest.set(name, { minute, value });
    } else if (minute === earlier.minute) {
      latest.set(name, {
        minute,
        value: takesTheLeast
          ? Math.min(value, earlier.value)
          : Math.max(value, earlier.value),
      });
    }
  }

  const sample: (
    name: string,
    entry: { minute: string; value: number },
  ) => AggregateModel = (
    name: string,
    entry: { minute: string; value: number },
  ): AggregateModel => {
    return {
      timestamp: new Date(`${entry.minute.replace(" ", "T")}:00Z`),
      value: entry.value,
      attributes: { [DEVICE_KEY]: name },
    } as unknown as AggregateModel;
  };

  const entries: Array<[string, { minute: string; value: number }]> =
    Array.from(latest.entries());

  return {
    projectId: monitor.projectId!,
    monitorId: monitor.id!,
    metricViewConfig: view,
    metricResult: [
      {
        data: entries.map(
          ([name, entry]: [string, { minute: string; value: number }]) => {
            return sample(name, entry);
          },
        ),
      } as AggregatedResult,
    ],
    seriesBreakdown: entries.map(
      ([name, entry]: [
        string,
        { minute: string; value: number },
      ]): MetricSeriesResult => {
        return {
          fingerprint: fingerprintOf(name),
          labels: { [DEVICE_KEY]: name },
          aggregatedResults: [{ data: [sample(name, entry)] }],
        };
      },
    ),
    startAndEndDate: RollingTimeUtil.convertToStartAndEndDate(
      RollingTime.Past2Hours,
      NOW,
    ),
  };
}

let monitor: Monitor;
let step: MonitorStep;
let closeAlerts: jest.SpyInstance;
let createAlerts: jest.SpyInstance;

function useTemplate(templateId: string): void {
  step = getManagedDeviceAlertTemplateById(templateId)!.getMonitorStep({
    deviceManagementConnectionId: CONNECTION.toString(),
    onlineMonitorStatusId: ONLINE,
    offlineMonitorStatusId: OFFLINE,
    defaultIncidentSeverityId: ObjectID.generate(),
    defaultAlertSeverityId: ObjectID.generate(),
    monitorName: `acme - ${templateId}`,
  });
  monitor.monitorType = MonitorType.Metrics;
  const monitorSteps: MonitorSteps = new MonitorSteps();
  monitorSteps.data = {
    monitorStepsInstanceArray: [step],
    defaultMonitorStatusId: ONLINE,
  };
  monitor.monitorSteps = monitorSteps;
}

async function alertedFor(
  templateId: string,
  rows: Array<JSONObject>,
): Promise<Array<string>> {
  useTemplate(templateId);
  createAlerts.mockClear();
  closeAlerts.mockClear();

  await MonitorResourceUtil.monitorResource(check(rows));

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

// The value a device's newest row of a metric says.
function valueOf(
  rows: Array<JSONObject>,
  metricName: string,
  device: string,
): number | undefined {
  const row: JSONObject | undefined = rows.find((candidate: JSONObject) => {
    return (
      candidate["name"] === metricName &&
      (candidate["attributes"] as Dictionary<string>)[DEVICE_KEY] === device
    );
  });

  return row ? (row["value"] as number) : undefined;
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(NOW);

  monitor = new Monitor();
  monitor.id = new ObjectID("33333333-3333-4333-8333-333333333333");
  monitor.projectId = PROJECT;
  monitor.name = "acme";
  monitor.currentMonitorStatusId = ONLINE;

  jest.spyOn(ProjectService, "isProjectBlocked").mockResolvedValue(false);
  jest.spyOn(Semaphore, "lock").mockResolvedValue({} as never);
  jest.spyOn(Semaphore, "release").mockResolvedValue(undefined as never);
  jest.spyOn(MonitorService, "findOneById").mockImplementation((() => {
    return Promise.resolve(monitor);
  }) as never);
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

const RECENTLY: Date = new Date(READ_AT.getTime() - 4 * MINUTE);

// An Esper Android device, its free storage in megabytes as Esper keeps it.
function esperAndroid(data: {
  id: string;
  name: string;
  batteryLevel: number;
  freeMegabytes: number;
}): ListedDevice {
  const raw: JSONObject = buildEsperDevice({
    id: data.id,
    name: data.name,
    serial: `SERIAL-${data.name}`,
    batteryLevel: data.batteryLevel,
  });
  (raw["memory_stats"] as JSONObject)["available_internal_storage"] =
    data.freeMegabytes;

  return { device: parseEsperDevice(raw)!, lastCheckInAt: RECENTLY };
}

describe("Esper: battery and storage, from its device list to the alert", () => {
  // 32 GiB of storage (memory_info: "32", GB, its binary prefix GiB).
  const rows: () => Array<JSONObject> = (): Array<JSONObject> => {
    return rowsOfARead({
      provider: DeviceManagementProvider.Esper,
      listed: [
        // 12%: about to die. 18200 MB free: 44% used.
        esperAndroid({
          id: "aaaaaaaa-0000-4000-8000-000000000001",
          name: "ESP-ID-LOWBT",
          batteryLevel: 12,
          freeMegabytes: 18200,
        }),
        // 88%, but 1500 MB free of 32 GiB: 95.4% used.
        esperAndroid({
          id: "aaaaaaaa-0000-4000-8000-000000000002",
          name: "ESP-ID-FULL1",
          batteryLevel: 88,
          freeMegabytes: 1500,
        }),
        // At 20% exactly, and 3277 MB free: 90% used, on the line - neither fires.
        esperAndroid({
          id: "aaaaaaaa-0000-4000-8000-000000000003",
          name: "ESP-ID-EDGE1",
          batteryLevel: 20,
          freeMegabytes: 3277,
        }),
        // Esper's Apple battery as Apple writes it, a fraction: 15%.
        {
          device: parseEsperDevice(
            buildEsperAppleDevice({
              id: "aaaaaaaa-0000-4000-8000-000000000004",
              name: "ESP-ID-IPAD1",
              batteryLevel: 0.15,
            }),
          )!,
          lastCheckInAt: RECENTLY,
        },
      ],
    });
  };

  test("the readings are what Esper reported, in percent", () => {
    const read: Array<JSONObject> = rows();

    expect(
      valueOf(read, MANAGED_DEVICE_BATTERY_LEVEL_METRIC_NAME, "ESP-ID-LOWBT"),
    ).toBe(12);
    expect(
      valueOf(read, MANAGED_DEVICE_BATTERY_LEVEL_METRIC_NAME, "ESP-ID-IPAD1"),
    ).toBe(15);
    expect(
      valueOf(read, MANAGED_DEVICE_STORAGE_USED_METRIC_NAME, "ESP-ID-FULL1"),
    ).toBe(95.4);
    expect(
      valueOf(read, MANAGED_DEVICE_STORAGE_USED_METRIC_NAME, "ESP-ID-LOWBT"),
    ).toBe(44.5);
    // The iPad's own bytes: 31.5 GB free of 64 GB.
    expect(
      valueOf(read, MANAGED_DEVICE_STORAGE_USED_METRIC_NAME, "ESP-ID-IPAD1"),
    ).toBe(50.8);
  });

  test("Esper Low Battery: one alert for each device under 20%, the iPad among them", async () => {
    expect(await alertedFor("esper-low-battery", rows())).toEqual([
      "ESP-ID-IPAD1",
      "ESP-ID-LOWBT",
    ]);
  });

  test("Esper Storage Nearly Full: one alert for the device more than 90% full", async () => {
    expect(await alertedFor("esper-storage-nearly-full", rows())).toEqual([
      "ESP-ID-FULL1",
    ]);
  });

  test("a device charged since its last read resolves: its newest minute says 20% or more", async () => {
    const earlier: Array<JSONObject> = rowsOfARead({
      provider: DeviceManagementProvider.Esper,
      listed: [
        esperAndroid({
          id: "aaaaaaaa-0000-4000-8000-000000000001",
          name: "ESP-ID-LOWBT",
          batteryLevel: 12,
          freeMegabytes: 18200,
        }),
      ],
      readAt: new Date(READ_AT.getTime() - 15 * MINUTE),
    });
    const charged: Array<JSONObject> = rowsOfARead({
      provider: DeviceManagementProvider.Esper,
      listed: [
        esperAndroid({
          id: "aaaaaaaa-0000-4000-8000-000000000001",
          name: "ESP-ID-LOWBT",
          batteryLevel: 64,
          freeMegabytes: 18200,
        }),
      ],
    });

    useTemplate("esper-low-battery");
    const response: ProbeApiIngestResponse =
      await MonitorResourceUtil.monitorResource(
        check([...earlier, ...charged]),
      );

    expect(response.criteriaMetId).toBe(
      step.data!.monitorCriteria.data!.monitorCriteriaInstanceArray[1]!.data!
        .id,
    );
    expect(closeAlerts).toHaveBeenCalled();
  });
});

/*
 * Intune's device list says no battery; a read asks each iPhone and iPad
 * alone (#10287), through beta's hardwareInformation, and sets what it
 * says on the device before the sync writes it - as here.
 */
function intuneAppleDevice(data: {
  raw: JSONObject;
  hardware: JSONObject;
}): ListedDevice {
  const read: { device: ProviderDevice; lastSyncAt: Date | null } =
    parseIntuneDevice(data.raw, READ_AT)!;

  read.device.batteryLevel = parseIntuneBatteryLevel({
    "@odata.context":
      "https://graph.microsoft.com/beta/$metadata#deviceManagement/managedDevices(id,hardwareInformation)/$entity",
    id: data.raw["id"],
    hardwareInformation: buildIntuneHardwareInformation(data.hardware),
  });

  return { device: read.device, lastCheckInAt: read.lastSyncAt };
}

describe("Microsoft Intune: battery and storage, from Graph to the alert", () => {
  const rows: () => Array<JSONObject> = (): Array<JSONObject> => {
    const listed: Array<ListedDevice> = [
      // 12 GB free of 255 GB: 95.3% used.
      buildIntuneDevice({
        id: "0f7c8c6b-0c2a-4d6e-9a1b-000000000001",
        deviceName: "DESKTOP-FULL01",
        serialNumber: "SERIAL-FULL01",
        freeStorageSpaceInBytes: 12000000000,
      }),
      // 141.7 GB free: 44.4% used.
      buildIntuneDevice({
        id: "0f7c8c6b-0c2a-4d6e-9a1b-000000000002",
        deviceName: "DESKTOP-OK0001",
        serialNumber: "SERIAL-OK0001",
      }),
      // Graph's free space before the device said it: 0, which is no figure.
      buildIntuneDevice({
        id: "0f7c8c6b-0c2a-4d6e-9a1b-000000000003",
        deviceName: "DESKTOP-NEW001",
        serialNumber: "SERIAL-NEW001",
        freeStorageSpaceInBytes: 0,
      }),
    ].map((raw: JSONObject): ListedDevice => {
      const read: { device: ProviderDevice; lastSyncAt: Date | null } =
        parseIntuneDevice(raw, READ_AT)!;

      return { device: read.device, lastCheckInAt: read.lastSyncAt };
    });

    listed.push(
      // An iPhone Intune last heard at 15%.
      intuneAppleDevice({
        raw: buildIntuneIphone({
          lastSyncDateTime: new Date(
            READ_AT.getTime() - 40 * MINUTE,
          ).toISOString(),
        }),
        hardware: { productName: "iPhone15,4", batteryLevelPercentage: 15 },
      }),
      // An iPad at 64.5%.
      intuneAppleDevice({
        raw: buildIntuneIpad({
          lastSyncDateTime: new Date(
            READ_AT.getTime() - 90 * MINUTE,
          ).toISOString(),
        }),
        hardware: { productName: "iPad12,1", batteryLevelPercentage: 64.5 },
      }),
      // An iPhone Intune may not read the Device Information of: no level.
      intuneAppleDevice({
        raw: buildIntuneIphone({
          id: "7d6c5b4a-3f2e-4d1c-8b0a-000000000002",
          deviceName: "Store 413 iPhone",
          serialNumber: "F2LXK1GHJKL1",
          imei: "353093105432110",
          lastSyncDateTime: new Date(
            READ_AT.getTime() - 20 * MINUTE,
          ).toISOString(),
        }),
        hardware: { batteryLevelPercentage: null },
      }),
    );

    return rowsOfARead({ provider: DeviceManagementProvider.Intune, listed });
  };

  test("a PC's battery is never said, so none of its rows is a battery's", () => {
    const read: Array<JSONObject> = rows();

    for (const pc of ["DESKTOP-FULL01", "DESKTOP-OK0001", "DESKTOP-NEW001"]) {
      expect(
        valueOf(read, MANAGED_DEVICE_BATTERY_LEVEL_METRIC_NAME, pc),
      ).toBeUndefined();
    }

    expect(
      valueOf(
        read,
        MANAGED_DEVICE_BATTERY_LEVEL_METRIC_NAME,
        "Store 413 iPhone",
      ),
    ).toBeUndefined();
  });

  test("Intune Low Battery: one alert for the iPhone at 15%, none for the iPad at 65% nor for a device with no level", async () => {
    const read: Array<JSONObject> = rows();

    expect(
      valueOf(
        read,
        MANAGED_DEVICE_BATTERY_LEVEL_METRIC_NAME,
        "Store 412 iPhone",
      ),
    ).toBe(15);
    expect(
      read.filter((row: JSONObject): boolean => {
        return row["name"] === MANAGED_DEVICE_BATTERY_LEVEL_METRIC_NAME;
      }),
    ).toHaveLength(2);
    expect(await alertedFor("intune-low-battery", read)).toEqual([
      "Store 412 iPhone",
    ]);
  });

  test("the iPhone back over 20% at its next check-in resolves it", async () => {
    const charged: Array<JSONObject> = rowsOfARead({
      provider: DeviceManagementProvider.Intune,
      listed: [
        intuneAppleDevice({
          raw: buildIntuneIphone({
            lastSyncDateTime: new Date(
              READ_AT.getTime() - 5 * MINUTE,
            ).toISOString(),
          }),
          hardware: { batteryLevelPercentage: 81.25 },
        }),
      ],
    });

    expect(
      valueOf(
        charged,
        MANAGED_DEVICE_BATTERY_LEVEL_METRIC_NAME,
        "Store 412 iPhone",
      ),
    ).toBe(81);
    expect(await alertedFor("intune-low-battery", charged)).toEqual([]);
  });

  test("Intune Storage Nearly Full: one alert for the full laptop, none for one that never said its free space", async () => {
    const read: Array<JSONObject> = rows();

    expect(
      valueOf(read, MANAGED_DEVICE_STORAGE_USED_METRIC_NAME, "DESKTOP-FULL01"),
    ).toBe(95.3);
    expect(
      valueOf(read, MANAGED_DEVICE_STORAGE_USED_METRIC_NAME, "DESKTOP-NEW001"),
    ).toBeUndefined();
    expect(await alertedFor("intune-storage-nearly-full", read)).toEqual([
      "DESKTOP-FULL01",
    ]);
  });
});

describe("Workspace ONE: battery and storage, from its device search to the alert", () => {
  const rows: () => Array<JSONObject> = (): Array<JSONObject> => {
    const listed: Array<ListedDevice> = [
      // An iPhone's battery as iOS writes it, a fraction: 12%.
      buildWorkspaceOneDevice({ BatteryLevel: "0.12" }),
      // A scanner at 15%, 2.5 GB free of 64 GB: 96.1% used.
      buildWorkspaceOneAndroid({
        BatteryLevel: "15%",
        DeviceCapacity: 64,
        AvailableDeviceCapacity: 2.5,
      }),
      // A desktop: no battery to say.
      buildWorkspaceOneWindows({ BatteryLevel: "" }),
    ].map((raw: JSONObject): ListedDevice => {
      const read: { device: ProviderDevice; lastSeenAt: Date | null } =
        parseWorkspaceOneDevice(raw, READ_AT)!;

      return { device: read.device, lastCheckInAt: read.lastSeenAt };
    });

    return rowsOfARead({
      provider: DeviceManagementProvider.WorkspaceOne,
      listed,
    });
  };

  test("Workspace ONE Low Battery: the iPhone and the scanner, never the desktop", async () => {
    const read: Array<JSONObject> = rows();

    expect(
      valueOf(read, MANAGED_DEVICE_BATTERY_LEVEL_METRIC_NAME, "DESKTOP-7KQ2M1"),
    ).toBeUndefined();
    expect(await alertedFor("workspace-one-low-battery", read)).toEqual([
      "Store 0412 Front Counter",
      "WH-SCANNER-07",
    ]);
  });

  test("Workspace ONE Storage Nearly Full: the scanner", async () => {
    const read: Array<JSONObject> = rows();

    expect(
      valueOf(read, MANAGED_DEVICE_STORAGE_USED_METRIC_NAME, "WH-SCANNER-07"),
    ).toBe(96.1);
    expect(await alertedFor("workspace-one-storage-nearly-full", read)).toEqual(
      ["WH-SCANNER-07"],
    );
  });
});

describe("SOTI MobiControl: battery and storage, from its device list to the alert", () => {
  const rows: (hosts?: Array<string>) => Array<JSONObject> = (
    hosts: Array<string> = [],
  ): Array<JSONObject> => {
    const listed: Array<ListedDevice> = [
      // A scanner at 9%, 1 GB free of 31.7 GB: 96.8% used.
      buildSotiDevice({
        BatteryStatus: 9,
        Memory: {
          AvailableExternalStorage: 0,
          AvailableMemory: 1879048192,
          AvailableSDCardStorage: 0,
          AvailableStorage: 1000000000,
          TotalExternalStorage: 0,
          TotalMemory: 3758096384,
          TotalSDCardStorage: 0,
          TotalStorage: 31675383808,
        },
      }),
      // An iPad without the agent: MobiControl says no whole storage, 0.
      buildSotiIpad({
        BatteryStatus: 100,
        Memory: {
          AvailableStorage: 14682259456,
          TotalStorage: 0,
        },
      }),
    ].map((raw: JSONObject): ListedDevice => {
      const read: { device: ProviderDevice; lastCheckInAt: Date | null } =
        parseSotiDevice(raw, READ_AT)!;

      return { device: read.device, lastCheckInAt: read.lastCheckInAt };
    });

    return rowsOfARead({
      provider: DeviceManagementProvider.Soti,
      listed,
      hosts,
    });
  };

  test("SOTI Low Battery and Storage Nearly Full: the scanner, and nothing of the iPad's storage", async () => {
    const read: Array<JSONObject> = rows();

    expect(
      valueOf(read, MANAGED_DEVICE_STORAGE_USED_METRIC_NAME, "Lobby iPad"),
    ).toBeUndefined();
    expect(await alertedFor("soti-low-battery", read)).toEqual([
      "WH-SCANNER-07",
    ]);
    expect(await alertedFor("soti-storage-nearly-full", read)).toEqual([
      "WH-SCANNER-07",
    ]);
  });

  test("no double alerts: the scanner the Android agent reports is its host's alone", async () => {
    const read: Array<JSONObject> = rows(["WH-SCANNER-07"]);

    // Its rows are written, marked a host...
    const scannerRows: Array<JSONObject> = read.filter((row: JSONObject) => {
      return (
        (row["attributes"] as Dictionary<string>)[DEVICE_KEY] ===
        "WH-SCANNER-07"
      );
    });
    expect(scannerRows.length).toBeGreaterThanOrEqual(3);
    for (const row of scannerRows) {
      expect(
        (row["attributes"] as Dictionary<string>)[
          ManagedDeviceCheckInAttribute.IsHost
        ],
      ).toBe("true");
    }

    // ...so the device manager's templates read none of them...
    expect(await alertedFor("soti-low-battery", read)).toEqual([]);
    expect(await alertedFor("soti-storage-nearly-full", read)).toEqual([]);

    /*
     * ...and its host's own Low Battery and Storage Nearly Full read the
     * agent's metrics by the host's name: none of the import's rows,
     * though they carry the host's name too.
     */
    for (const hostTemplateId of [
      "android-low-battery",
      "android-storage-nearly-full",
    ]) {
      const hostStep: MonitorStep = getHostAlertTemplateById(
        hostTemplateId,
      )!.getMonitorStep({
        hostIdentifier: "wh-scanner-07",
        onlineMonitorStatusId: ONLINE,
        offlineMonitorStatusId: OFFLINE,
        defaultIncidentSeverityId: ObjectID.generate(),
        defaultAlertSeverityId: ObjectID.generate(),
        monitorName: "WH-SCANNER-07",
      });

      for (const hostQuery of hostStep.data!.hostMonitor!.metricViewConfig
        .queryConfigs) {
        expect(
          rowsRead(read, hostQuery, { "resource.host.name": "wh-scanner-07" }),
        ).toEqual([]);
      }
    }

    expect(
      scannerRows.every((row: JSONObject): boolean => {
        return (
          (row["attributes"] as Dictionary<string>)["resource.host.name"] ===
          "wh-scanner-07"
        );
      }),
    ).toBe(true);
  });

  test("a window with no battery reading of any device - the connection stopped reading - resolves nothing", async () => {
    useTemplate("soti-low-battery");

    const response: ProbeApiIngestResponse =
      await MonitorResourceUtil.monitorResource(check([]));

    expect(response.criteriaMetId).toBeFalsy();
    expect(closeAlerts).not.toHaveBeenCalled();
  });
});
