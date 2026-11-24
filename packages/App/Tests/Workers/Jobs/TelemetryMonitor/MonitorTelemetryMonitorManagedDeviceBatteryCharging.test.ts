import MonitorStep from "Common/Types/Monitor/MonitorStep";
import ObjectID from "Common/Types/ObjectID";
import MetricMonitorResponse from "Common/Types/Monitor/MetricMonitor/MetricMonitorResponse";
import MetricSeriesResult from "Common/Types/Monitor/MetricMonitor/MetricSeriesResult";
import { getManagedDeviceAlertTemplateById } from "Common/Types/Monitor/ManagedDeviceAlertTemplates";
import {
  MANAGED_DEVICE_BATTERY_CHARGING_METRIC_NAME,
  MANAGED_DEVICE_BATTERY_LEVEL_METRIC_NAME,
  ManagedDeviceCheckInAttribute,
  ManagedDeviceCheckInDevice,
  ManagedDeviceCheckInReading,
  getManagedDeviceCheckInReadings,
} from "Common/Types/DeviceManagement/ManagedDeviceCheckIn";
import DeviceManagementProvider from "Common/Types/DeviceManagement/DeviceManagementProvider";
import { ManagedDevicePlatform } from "Common/Types/DeviceManagement/ManagedDevicePlatform";
import Includes from "Common/Types/BaseDatabase/Includes";
import Dictionary from "Common/Types/Dictionary";
import { JSONObject } from "Common/Types/JSON";
import { describe, expect, test, beforeEach, afterEach } from "@jest/globals";

/*
 * What a check of Workspace ONE's or SOTI's Low Battery reads (#10288,
 * MonitorTelemetryMonitor.monitorMetric): each device's battery and, beside
 * it, whether it is on its charger, as a read of the connection wrote them
 * (ManagedDeviceCheckInMetrics) - two queries of the same devices, grouped
 * by device, so each device is ONE series holding both, each judged on its
 * latest reading. A device its service says neither of is a series whose
 * charging slot is empty, which the criteria count as off its charger.
 *
 * ClickHouse is stood in for by the rows a read writes, read the way each
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
  buildManagedDeviceBatteryRow,
  buildManagedDeviceChargingRow,
  buildManagedDeviceCheckInRow,
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

function lowBatteryStep(
  templateId: string = "workspace-one-low-battery",
): MonitorStep {
  return getManagedDeviceAlertTemplateById(templateId)!.getMonitorStep({
    deviceManagementConnectionId: CONNECTION_ID.toString(),
    onlineMonitorStatusId: ObjectID.generate(),
    offlineMonitorStatusId: ObjectID.generate(),
    defaultIncidentSeverityId: ObjectID.generate(),
    defaultAlertSeverityId: ObjectID.generate(),
    monitorName: "Stores West - Low Battery",
  });
}

function minutesAgo(minutes: number): Date {
  const now: number = Date.now();
  return new Date(now - (now % 60_000) - minutes * 60_000);
}

// A device at `batteryLevel`, on its charger or not as its service said.
function device(
  name: string,
  batteryLevel: number,
  isCharging: boolean | undefined,
): ManagedDeviceCheckInDevice {
  return {
    providerDeviceId: `id-${name}`,
    deviceName: name,
    serialNumber: `SERIAL-${name}`,
    platform: ManagedDevicePlatform.Android,
    lastCheckInAt: minutesAgo(30),
    batteryLevel,
    details: isCharging === undefined ? {} : { isCharging },
  };
}

// The rows a read writes for these devices, `readMinutesAgo` ago.
function rowsOfARead(data: {
  devices: Array<ManagedDeviceCheckInDevice>;
  readMinutesAgo: number;
  provider?: string | undefined;
}): Array<JSONObject> {
  const asOf: Date = minutesAgo(data.readMinutesAgo);
  const provider: string =
    data.provider || DeviceManagementProvider.WorkspaceOne;
  const readings: Array<ManagedDeviceCheckInReading> =
    getManagedDeviceCheckInReadings({
      devices: data.devices,
      hostNames: new Set<string>(),
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

    return [
      buildManagedDeviceCheckInRow(input),
      buildManagedDeviceBatteryRow(input),
      buildManagedDeviceChargingRow(input),
    ].filter((row: JSONObject | undefined): row is JSONObject => {
      return Boolean(row);
    });
  });
}

// ClickHouse's answer to each grouped read: the rows the query names, each a sample.
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

// A series' values of the step's `index`-th query: 0 the battery, 1 the charging.
function valuesOf(
  series: MetricSeriesResult | undefined,
  index: number,
): Array<number> {
  return (series?.aggregatedResults[index]?.data || []).map(
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

describe("what a check of Low Battery with the charging state reads", () => {
  test("the battery and the charging state of the same devices, grouped by device, over two hours", async () => {
    await monitorMetric({
      monitorStep: lowBatteryStep(),
      monitorId,
      projectId,
    });

    const calls: Array<{
      query: { name: string; attributes: Record<string, unknown> };
      groupByAttributeKeys: Array<string>;
      startTimestamp: Date;
      endTimestamp: Date;
    }> = metricAggregateBy.mock.calls.map((call: Array<unknown>) => {
      return call[0] as {
        query: { name: string; attributes: Record<string, unknown> };
        groupByAttributeKeys: Array<string>;
        startTimestamp: Date;
        endTimestamp: Date;
      };
    });

    expect(
      calls.map((call: { query: { name: string } }): string => {
        return call.query.name;
      }),
    ).toEqual([
      MANAGED_DEVICE_BATTERY_LEVEL_METRIC_NAME,
      MANAGED_DEVICE_BATTERY_CHARGING_METRIC_NAME,
    ]);

    for (const call of calls) {
      expect(call.query.attributes).toEqual({
        "oneuptime.managed_device.connection.id": CONNECTION_ID.toString(),
        "oneuptime.managed_device.is_host": "false",
        "oneuptime.managed_device.provider":
          DeviceManagementProvider.WorkspaceOne,
      });
      expect(call.groupByAttributeKeys).toEqual([DEVICE_KEY]);
      expect(call.endTimestamp.getTime() - call.startTimestamp.getTime()).toBe(
        2 * 60 * 60 * 1000,
      );
    }

    // Devices are not hosts in Hosts: nothing is seeded from there.
    expect(expectedHosts).not.toHaveBeenCalled();
  });
});

describe("from a read's rows to the series a check judges", () => {
  test("each device is one series with its battery and its charging state; one that says neither has an empty charging slot", async () => {
    answerFrom(
      rowsOfARead({
        devices: [
          device("WH-SCANNER-07", 12, true),
          device("WH-SCANNER-08", 15, false),
          device("STORE-IPHONE-1", 12, undefined),
        ],
        readMinutesAgo: 3,
      }),
    );

    const response: MetricMonitorResponse = await monitorMetric({
      monitorStep: lowBatteryStep(),
      monitorId,
      projectId,
    });

    expect(
      (response.seriesBreakdown || [])
        .map((series: MetricSeriesResult): string => {
          return String(series.labels[DEVICE_KEY]);
        })
        .sort(),
    ).toEqual(["STORE-IPHONE-1", "WH-SCANNER-07", "WH-SCANNER-08"]);

    expect(valuesOf(seriesOf(response, "WH-SCANNER-07"), 0)).toEqual([12]);
    expect(valuesOf(seriesOf(response, "WH-SCANNER-07"), 1)).toEqual([1]);
    expect(valuesOf(seriesOf(response, "WH-SCANNER-08"), 0)).toEqual([15]);
    expect(valuesOf(seriesOf(response, "WH-SCANNER-08"), 1)).toEqual([0]);
    expect(valuesOf(seriesOf(response, "STORE-IPHONE-1"), 0)).toEqual([12]);
    expect(valuesOf(seriesOf(response, "STORE-IPHONE-1"), 1)).toEqual([]);
  });

  test("a scanner docked since its last read is judged on its latest of each", async () => {
    answerFrom([
      ...rowsOfARead({
        devices: [device("WH-SCANNER-08", 15, false)],
        readMinutesAgo: 45,
      }),
      ...rowsOfARead({
        devices: [device("WH-SCANNER-08", 16, true)],
        readMinutesAgo: 5,
      }),
    ]);

    const response: MetricMonitorResponse = await monitorMetric({
      monitorStep: lowBatteryStep(),
      monitorId,
      projectId,
    });

    expect(valuesOf(seriesOf(response, "WH-SCANNER-08"), 0)).toEqual([16]);
    expect(valuesOf(seriesOf(response, "WH-SCANNER-08"), 1)).toEqual([1]);
  });

  test("SOTI's reads the same, for its connection", async () => {
    answerFrom(
      rowsOfARead({
        devices: [
          device("WH-SCANNER-07", 9, true),
          device("WH-SCANNER-09", 8, undefined),
        ],
        readMinutesAgo: 3,
        provider: DeviceManagementProvider.Soti,
      }),
    );

    const response: MetricMonitorResponse = await monitorMetric({
      monitorStep: lowBatteryStep("soti-low-battery"),
      monitorId,
      projectId,
    });

    expect(valuesOf(seriesOf(response, "WH-SCANNER-07"), 1)).toEqual([1]);
    expect(valuesOf(seriesOf(response, "WH-SCANNER-09"), 1)).toEqual([]);
  });
});
