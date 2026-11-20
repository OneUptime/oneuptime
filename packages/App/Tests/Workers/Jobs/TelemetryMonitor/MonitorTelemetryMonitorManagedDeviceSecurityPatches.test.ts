import MonitorStep from "Common/Types/Monitor/MonitorStep";
import ObjectID from "Common/Types/ObjectID";
import MetricMonitorResponse from "Common/Types/Monitor/MetricMonitor/MetricMonitorResponse";
import MetricSeriesResult from "Common/Types/Monitor/MetricMonitor/MetricSeriesResult";
import {
  ManagedDeviceAlertTemplate,
  getManagedDeviceAlertTemplateById,
} from "Common/Types/Monitor/ManagedDeviceAlertTemplates";
import {
  MANAGED_DEVICE_SECURITY_PATCH_AGE_METRIC_NAME,
  ManagedDeviceCheckInAttribute,
  ManagedDeviceCheckInDevice,
  ManagedDeviceCheckInReading,
  getManagedDeviceCheckInReadings,
} from "Common/Types/DeviceManagement/ManagedDeviceCheckIn";
import { ManagedDevicePlatform } from "Common/Types/DeviceManagement/ManagedDevicePlatform";
import Includes from "Common/Types/BaseDatabase/Includes";
import Dictionary from "Common/Types/Dictionary";
import { JSONObject } from "Common/Types/JSON";
import { describe, expect, test, beforeEach, afterEach } from "@jest/globals";

/*
 * What a check of a device manager's Security Patch Out of Date reads
 * (#10098, MonitorTelemetryMonitor.monitorMetric): the security patch ages
 * a read of the connection wrote (ManagedDeviceCheckInMetrics), of its
 * Android devices no agent reports, one series per device, each judged on
 * its latest reading - so a device updated is back at the very next read,
 * and a device the Android agent reports is never in it: its host's own
 * Security Patch Out of Date reads the agent's metric.
 *
 * ClickHouse is stood in for by the rows a read writes, read the way the
 * query names them: by the metric's name and the attributes' values.
 */

// Keep the heavy worker module from touching Redis at import time.
jest.mock("Common/Server/Infrastructure/Queue", () => {
  return {
    __esModule: true,
    default: { addJob: jest.fn() },
    QueueName: { Telemetry: "Telemetry" },
  };
});

// The worker transitively loads the native `isolated-vm` addon; stub it.
jest.mock("Common/Server/Utils/VM/VMRunner", () => {
  return { __esModule: true, default: {} };
});

jest.mock("Common/Server/Services/MetricService", () => {
  return {
    __esModule: true,
    default: { aggregateBy: jest.fn(), findBy: jest.fn() },
  };
});

jest.mock("Common/Server/Services/MetricTypeService", () => {
  return { __esModule: true, default: { findBy: jest.fn() } };
});

jest.mock("Common/Server/Services/HostService", () => {
  return {
    __esModule: true,
    default: { getExpectedHostIdentifiers: jest.fn() },
  };
});

import MetricService from "Common/Server/Services/MetricService";
import MetricTypeService from "Common/Server/Services/MetricTypeService";
import HostService from "Common/Server/Services/HostService";
import {
  ManagedDeviceReadingRowInput,
  buildManagedDeviceCheckInRow,
  buildManagedDeviceSecurityPatchRow,
} from "Common/Server/Utils/DeviceManagement/ManagedDeviceCheckInMetrics";
import { monitorMetric } from "../../../../FeatureSet/Workers/Jobs/TelemetryMonitor/MonitorTelemetryMonitor";

const metricAggregateBy: jest.Mock =
  MetricService.aggregateBy as unknown as jest.Mock;
const metricFindBy: jest.Mock = MetricService.findBy as unknown as jest.Mock;
const metricTypeFindBy: jest.Mock =
  MetricTypeService.findBy as unknown as jest.Mock;
const expectedHosts: jest.Mock =
  HostService.getExpectedHostIdentifiers as unknown as jest.Mock;

const DEVICE_KEY: string = ManagedDeviceCheckInAttribute.DeviceName;
const CONNECTION_ID: ObjectID = new ObjectID(
  "55555555-5555-4555-8555-555555555555",
);
const monitorId: ObjectID = ObjectID.generate();
const projectId: ObjectID = ObjectID.generate();

function patchStep(
  templateId: string = "esper-security-patch-out-of-date",
): MonitorStep {
  return getManagedDeviceAlertTemplateById(templateId)!.getMonitorStep({
    deviceManagementConnectionId: CONNECTION_ID.toString(),
    onlineMonitorStatusId: ObjectID.generate(),
    offlineMonitorStatusId: ObjectID.generate(),
    defaultIncidentSeverityId: ObjectID.generate(),
    defaultAlertSeverityId: ObjectID.generate(),
    monitorName: "Esper acme - Esper Security Patch Out of Date",
  });
}

function minutesAgo(minutes: number): Date {
  const now: number = Date.now();
  return new Date(now - (now % 60_000) - minutes * 60_000);
}

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
    lastCheckInAt: minutesAgo(30),
    securityPatchLevel,
    ...overrides,
  };
}

// The rows a read writes for these devices, `readMinutesAgo` ago.
function rowsOfARead(data: {
  devices: Array<ManagedDeviceCheckInDevice>;
  hosts?: Array<string> | undefined;
  readMinutesAgo: number;
  // The connection's service, which every row names: Esper's when not given.
  provider?: string | undefined;
}): Array<JSONObject> {
  const asOf: Date = minutesAgo(data.readMinutesAgo);
  const provider: string = data.provider || "esper";
  const readings: Array<ManagedDeviceCheckInReading> =
    getManagedDeviceCheckInReadings({
      devices: data.devices,
      hostNames: new Set<string>(
        (data.hosts || []).map((host: string): string => {
          return host.toLowerCase();
        }),
      ),
      asOf,
      provider,
    });

  return readings.flatMap((reading: ManagedDeviceCheckInReading) => {
    const input: ManagedDeviceReadingRowInput = {
      projectId,
      connectionId: CONNECTION_ID,
      provider,
      reading,
      asOf,
      retentionDate: new Date(asOf.getTime() + 30 * 24 * 60 * 60_000),
    };
    const patch: JSONObject | undefined =
      buildManagedDeviceSecurityPatchRow(input);

    return patch
      ? [buildManagedDeviceCheckInRow(input), patch]
      : [buildManagedDeviceCheckInRow(input)];
  });
}

// ClickHouse's answer to the grouped read: the rows the query names, each a sample.
function answerFrom(rows: Array<JSONObject>): void {
  metricAggregateBy.mockImplementation(
    async (call: {
      query: { name: string; attributes: Dictionary<unknown> };
      groupByAttributeKeys: Array<string>;
    }) => {
      const wanted: Dictionary<unknown> = call.query.attributes || {};
      const data: Array<unknown> = rows
        .filter((row: JSONObject): boolean => {
          const attributes: Dictionary<unknown> = row[
            "attributes"
          ] as Dictionary<unknown>;

          return (
            row["name"] === call.query.name &&
            Object.entries(wanted).every(([key, value]: [string, unknown]) => {
              return value instanceof Includes
                ? (value.values as Array<unknown>).includes(attributes[key])
                : attributes[key] === value;
            })
          );
        })
        .map((row: JSONObject) => {
          const attributes: Dictionary<unknown> = row[
            "attributes"
          ] as Dictionary<unknown>;
          const grouped: Dictionary<unknown> = {};

          for (const key of call.groupByAttributeKeys || []) {
            grouped[key] = attributes[key];
          }

          return {
            timestamp: new Date(`${String(row["time"]).replace(" ", "T")}Z`),
            value: row["value"],
            attributes: grouped,
          };
        });

      return { data };
    },
  );
}

function seriesOf(
  response: MetricMonitorResponse,
  name: string,
): MetricSeriesResult | undefined {
  return (response.seriesBreakdown || []).find(
    (series: MetricSeriesResult): boolean => {
      return series.labels[DEVICE_KEY] === name;
    },
  );
}

function devicesOf(response: MetricMonitorResponse): Array<string> {
  return (response.seriesBreakdown || [])
    .map((series: MetricSeriesResult): string => {
      return String(series.labels[DEVICE_KEY]);
    })
    .sort();
}

function valuesOf(series: MetricSeriesResult | undefined): Array<number> {
  return (series?.aggregatedResults[0]?.data || []).map(
    (row: { value: number }): number => {
      return row.value;
    },
  );
}

beforeEach(() => {
  metricAggregateBy.mockReset().mockResolvedValue({ data: [] });
  metricFindBy.mockReset().mockResolvedValue([]);
  metricTypeFindBy.mockReset().mockResolvedValue([]);
  expectedHosts.mockReset().mockResolvedValue([]);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("what a check of the security patches reads", () => {
  test("one connection's patch ages of the Android devices no agent reports, grouped by device, over two hours", async () => {
    await monitorMetric({ monitorStep: patchStep(), monitorId, projectId });

    const call: {
      query: { name: string; attributes: Record<string, unknown> };
      groupByAttributeKeys: Array<string>;
      startTimestamp: Date;
      endTimestamp: Date;
    } = metricAggregateBy.mock.calls[0]![0] as {
      query: { name: string; attributes: Record<string, unknown> };
      groupByAttributeKeys: Array<string>;
      startTimestamp: Date;
      endTimestamp: Date;
    };

    expect(call.query.name).toBe(MANAGED_DEVICE_SECURITY_PATCH_AGE_METRIC_NAME);
    expect(call.query.attributes).toEqual({
      "oneuptime.managed_device.connection.id": CONNECTION_ID.toString(),
      "oneuptime.managed_device.is_host": "false",
      // Its service too, which every reading of the connection names.
      "oneuptime.managed_device.provider": "esper",
      "oneuptime.managed_device.platform": "android",
    });
    expect(call.groupByAttributeKeys).toEqual([DEVICE_KEY]);
    expect(call.endTimestamp.getTime() - call.startTimestamp.getTime()).toBe(
      2 * 60 * 60 * 1000,
    );
  });

  test("never seeds silent hosts from Hosts: devices are not hosts there", async () => {
    answerFrom(
      rowsOfARead({
        devices: [device("ESP-ID-AAAAW", "2024-06-05")],
        readMinutesAgo: 3,
      }),
    );

    await monitorMetric({ monitorStep: patchStep(), monitorId, projectId });

    expect(expectedHosts).not.toHaveBeenCalled();
  });
});

describe("from a read's rows to the series a check judges", () => {
  test("every Android device a read wrote a patch age for, and no iPhone, no device without a level, no device the agent reports", async () => {
    answerFrom(
      rowsOfARead({
        devices: [
          device("ESP-ID-AAAAW", "2024-06-05"),
          device("ESP-ID-AAAAX", "2026-11-01"),
          device("ESP-ID-NOLEVEL", undefined),
          device("IPHONE-1", "2024-06-05", {
            platform: ManagedDevicePlatform.IOS,
          }),
          device("ESP-ID-AGENT", "2024-06-05"),
        ],
        hosts: ["ESP-ID-AGENT"],
        readMinutesAgo: 3,
      }),
    );

    const response: MetricMonitorResponse = await monitorMetric({
      monitorStep: patchStep(),
      monitorId,
      projectId,
    });

    expect(devicesOf(response)).toEqual(["ESP-ID-AAAAW", "ESP-ID-AAAAX"]);
    expect(valuesOf(seriesOf(response, "ESP-ID-AAAAW"))[0]).toBeGreaterThan(90);
    expect(valuesOf(seriesOf(response, "ESP-ID-AAAAX"))[0]).toBeLessThan(90);
  });

  test("a device updated since its last behind read is judged on its update", async () => {
    answerFrom([
      ...rowsOfARead({
        devices: [device("ESP-ID-AAAAW", "2024-06-05")],
        readMinutesAgo: 60,
      }),
      ...rowsOfARead({
        devices: [device("ESP-ID-AAAAW", "2026-11-05")],
        readMinutesAgo: 45,
      }),
    ]);

    const response: MetricMonitorResponse = await monitorMetric({
      monitorStep: patchStep(),
      monitorId,
      projectId,
    });

    const values: Array<number> = valuesOf(seriesOf(response, "ESP-ID-AAAAW"));

    expect(values).toHaveLength(1);
    expect(values[0]).toBeLessThanOrEqual(90);
  });

  test("a device that starts running the agent leaves the check at the read that finds its host", async () => {
    answerFrom([
      ...rowsOfARead({
        devices: [device("ESP-ID-AAAAW", "2024-06-05")],
        readMinutesAgo: 60,
      }),
      ...rowsOfARead({
        devices: [device("ESP-ID-AAAAW", "2024-06-05")],
        hosts: ["ESP-ID-AAAAW"],
        readMinutesAgo: 15,
      }),
    ]);

    const response: MetricMonitorResponse = await monitorMetric({
      monitorStep: patchStep(),
      monitorId,
      projectId,
    });

    // Only the reading from before the agent: it ages out of the window.
    expect(valuesOf(seriesOf(response, "ESP-ID-AAAAW"))).toHaveLength(1);
    expect(
      metricAggregateBy.mock.calls.every((call: Array<unknown>): boolean => {
        return (
          (call[0] as { query: { attributes: Dictionary<unknown> } }).query
            .attributes["oneuptime.managed_device.is_host"] === "false"
        );
      }),
    ).toBe(true);
  });

  test("a window with no patch reading at all stays empty, for the silence rule to read", async () => {
    answerFrom(
      rowsOfARead({
        devices: [device("ESP-ID-NOLEVEL", undefined)],
        readMinutesAgo: 3,
      }),
    );

    const response: MetricMonitorResponse = await monitorMetric({
      monitorStep: patchStep(),
      monitorId,
      projectId,
    });

    expect(response.seriesBreakdown).toEqual([]);
  });

  test.each([
    ["intune-security-patch-out-of-date"],
    ["workspace-one-security-patch-out-of-date"],
    ["soti-security-patch-out-of-date"],
  ])("%s reads the same, for its connection", async (templateId: string) => {
    const provider: string =
      getManagedDeviceAlertTemplateById(templateId)!.provider;

    // Its own service's connection's rows: each names the service.
    answerFrom(
      rowsOfARead({
        devices: [
          device("DEVICE-BEHIND", "2025-01-05"),
          device("DEVICE-AGENT", "2025-01-05"),
        ],
        hosts: ["DEVICE-AGENT"],
        readMinutesAgo: 3,
        provider,
      }),
    );

    const response: MetricMonitorResponse = await monitorMetric({
      monitorStep: patchStep(templateId),
      monitorId,
      projectId,
    });

    expect(devicesOf(response)).toEqual(["DEVICE-BEHIND"]);
  });

  /*
   * A monitor made before its template read the service reads the
   * connection alone: the same rows, as every row names the service.
   */
  test.each([
    ["esper-security-patch-out-of-date"],
    ["intune-security-patch-out-of-date"],
    ["workspace-one-security-patch-out-of-date"],
    ["soti-security-patch-out-of-date"],
  ])(
    "%s made before it read its service reads the same rows",
    async (templateId: string) => {
      const template: ManagedDeviceAlertTemplate =
        getManagedDeviceAlertTemplateById(templateId)!;
      const earlierStep: MonitorStep = template.getEarlierMonitorSteps!({
        deviceManagementConnectionId: CONNECTION_ID.toString(),
        onlineMonitorStatusId: ObjectID.generate(),
        offlineMonitorStatusId: ObjectID.generate(),
        defaultIncidentSeverityId: ObjectID.generate(),
        defaultAlertSeverityId: ObjectID.generate(),
        monitorName: "Stores West - Security Patch Out of Date",
      })[0]!;

      answerFrom(
        rowsOfARead({
          devices: [
            device("DEVICE-BEHIND", "2025-01-05"),
            device("DEVICE-CURRENT", "2026-11-05"),
          ],
          readMinutesAgo: 3,
          provider: template.provider,
        }),
      );

      const now: MetricMonitorResponse = await monitorMetric({
        monitorStep: patchStep(templateId),
        monitorId,
        projectId,
      });
      const before: MetricMonitorResponse = await monitorMetric({
        monitorStep: earlierStep,
        monitorId,
        projectId,
      });

      expect(devicesOf(before)).toEqual(devicesOf(now));
      expect(devicesOf(now)).toEqual(["DEVICE-BEHIND", "DEVICE-CURRENT"]);
    },
  );
});
