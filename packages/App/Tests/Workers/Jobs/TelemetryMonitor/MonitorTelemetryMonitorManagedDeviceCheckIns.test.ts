import MonitorStep from "Common/Types/Monitor/MonitorStep";
import ObjectID from "Common/Types/ObjectID";
import MetricMonitorResponse from "Common/Types/Monitor/MetricMonitor/MetricMonitorResponse";
import MetricSeriesResult from "Common/Types/Monitor/MetricMonitor/MetricSeriesResult";
import { getManagedDeviceAlertTemplateById } from "Common/Types/Monitor/ManagedDeviceAlertTemplates";
import { MANAGED_DEVICE_CHECK_IN_AGE_METRIC_NAME } from "Common/Types/DeviceManagement/ManagedDeviceCheckIn";
import AggregatedResult from "Common/Types/BaseDatabase/AggregatedResult";
import { describe, expect, test, beforeEach, afterEach } from "@jest/globals";

/*
 * What a check of Esper Device Stopped Checking In reads (#9835,
 * MonitorTelemetryMonitor.monitorMetric): one connection's readings of the
 * devices no agent reports, one series per device - and each device judged
 * on its latest reading, so a device that checked in again is back at the
 * very next read, and one that went quiet alerts at the read that finds it.
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
import { monitorMetric } from "../../../../FeatureSet/Workers/Jobs/TelemetryMonitor/MonitorTelemetryMonitor";

const metricAggregateBy: jest.Mock =
  MetricService.aggregateBy as unknown as jest.Mock;
const metricFindBy: jest.Mock = MetricService.findBy as unknown as jest.Mock;
const metricTypeFindBy: jest.Mock =
  MetricTypeService.findBy as unknown as jest.Mock;
const expectedHosts: jest.Mock =
  HostService.getExpectedHostIdentifiers as unknown as jest.Mock;

const DEVICE_KEY: string = "oneuptime.managed_device.name";
const CONNECTION_ID: string = "55555555-5555-4555-8555-555555555555";
const monitorId: ObjectID = ObjectID.generate();
const projectId: ObjectID = ObjectID.generate();

function checkInStep(): MonitorStep {
  return getManagedDeviceAlertTemplateById(
    "esper-device-stopped-checking-in",
  )!.getMonitorStep({
    deviceManagementConnectionId: CONNECTION_ID,
    onlineMonitorStatusId: ObjectID.generate(),
    offlineMonitorStatusId: ObjectID.generate(),
    defaultIncidentSeverityId: ObjectID.generate(),
    defaultAlertSeverityId: ObjectID.generate(),
    monitorName: "Esper acme - Esper Device Stopped Checking In",
  });
}

function minutesAgo(minutes: number): Date {
  const now: number = Date.now();
  return new Date(now - (now % 60_000) - minutes * 60_000);
}

// A read's reading of one device, as the grouped read returns its rows.
function reading(
  device: string,
  readMinutesAgo: number,
  quiet: number,
): unknown {
  return {
    timestamp: minutesAgo(readMinutesAgo),
    value: quiet,
    attributes: { [DEVICE_KEY]: device },
  };
}

function seriesOf(
  response: MetricMonitorResponse,
  device: string,
): MetricSeriesResult | undefined {
  return (response.seriesBreakdown || []).find(
    (series: MetricSeriesResult): boolean => {
      return series.labels[DEVICE_KEY] === device;
    },
  );
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

describe("what a check of the check-ins reads", () => {
  test("one connection's readings of the devices no agent reports, grouped by device, over two hours", async () => {
    await monitorMetric({ monitorStep: checkInStep(), monitorId, projectId });

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

    expect(call.query.name).toBe(MANAGED_DEVICE_CHECK_IN_AGE_METRIC_NAME);
    expect(call.query.attributes).toEqual({
      "oneuptime.managed_device.connection.id": CONNECTION_ID,
      "oneuptime.managed_device.is_host": "false",
    });
    expect(call.groupByAttributeKeys).toEqual([DEVICE_KEY]);
    expect(call.endTimestamp.getTime() - call.startTimestamp.getTime()).toBe(
      2 * 60 * 60 * 1000,
    );
  });

  test("never seeds silent hosts from Hosts: devices are not hosts there", async () => {
    metricAggregateBy.mockResolvedValue({
      data: [reading("ESP-ID-AAAAW", 3, 75)],
    });

    await monitorMetric({ monitorStep: checkInStep(), monitorId, projectId });

    expect(expectedHosts).not.toHaveBeenCalled();
  });
});

describe("each device is judged on its latest reading", () => {
  test("a device back since its last alerting read is back; one gone quiet since its last good read is quiet", async () => {
    metricAggregateBy.mockResolvedValue({
      data: [
        // Quiet for 75 minutes an hour ago, checked in since.
        reading("ESP-ID-AAAAW", 60, 75),
        reading("ESP-ID-AAAAW", 45, 2),
        // Fine an hour ago, quiet for 70 minutes now.
        reading("ESP-ID-AAAAX", 75, 5),
        reading("ESP-ID-AAAAX", 5, 70),
      ],
    });

    const response: MetricMonitorResponse = await monitorMetric({
      monitorStep: checkInStep(),
      monitorId,
      projectId,
    });

    expect(valuesOf(seriesOf(response, "ESP-ID-AAAAW"))).toEqual([2]);
    expect(valuesOf(seriesOf(response, "ESP-ID-AAAAX"))).toEqual([70]);
  });

  test("a step without the flag keeps every reading of the window, as before", async () => {
    metricAggregateBy.mockResolvedValue({
      data: [reading("ESP-ID-AAAAW", 60, 75), reading("ESP-ID-AAAAW", 45, 2)],
    });
    const step: MonitorStep = checkInStep();
    delete step.data!.metricMonitor!.judgeLatestReading;

    const response: MetricMonitorResponse = await monitorMetric({
      monitorStep: step,
      monitorId,
      projectId,
    });

    expect(valuesOf(seriesOf(response, "ESP-ID-AAAAW"))).toEqual([75, 2]);
  });

  test("an ungrouped step that asks is judged on its latest reading too", async () => {
    metricAggregateBy.mockResolvedValue({
      data: [
        { timestamp: minutesAgo(30), value: 75 },
        { timestamp: minutesAgo(15), value: 4 },
      ],
    });
    const step: MonitorStep = checkInStep();
    delete step.data!.metricMonitor!.metricViewConfig.queryConfigs[0]!
      .metricQueryData.groupByAttributeKeys;

    const response: MetricMonitorResponse = await monitorMetric({
      monitorStep: step,
      monitorId,
      projectId,
    });

    expect(response.seriesBreakdown).toBeUndefined();
    expect(
      (response.metricResult as Array<AggregatedResult>)[0]!.data.map(
        (row: { value: number }): number => {
          return row.value;
        },
      ),
    ).toEqual([4]);
  });

  test("a window with no reading at all stays empty, for the silence rule to read", async () => {
    const response: MetricMonitorResponse = await monitorMetric({
      monitorStep: checkInStep(),
      monitorId,
      projectId,
    });

    expect(response.seriesBreakdown).toEqual([]);
    expect(
      (response.metricResult as Array<AggregatedResult>).every(
        (result: AggregatedResult): boolean => {
          return result.data.length === 0;
        },
      ),
    ).toBe(true);
  });
});
