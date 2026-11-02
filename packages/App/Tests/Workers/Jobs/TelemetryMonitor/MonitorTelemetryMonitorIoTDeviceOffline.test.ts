import MonitorStep from "Common/Types/Monitor/MonitorStep";
import ObjectID from "Common/Types/ObjectID";
import Wildcard from "Common/Types/BaseDatabase/Wildcard";
import MetricMonitorResponse from "Common/Types/Monitor/MetricMonitor/MetricMonitorResponse";
import MetricSeriesResult from "Common/Types/Monitor/MetricMonitor/MetricSeriesResult";
import { getIoTAlertTemplateById } from "Common/Types/Monitor/IotAlertTemplates";
import { describe, expect, test, beforeEach, afterEach } from "@jest/globals";

/*
 * What the Device Offline template judged wrongly (MonitorTelemetryMonitor
 * .monitorIoT):
 *  - a fleet's readings keep the case the device used, and the query matched
 *    the stored fleet name exactly: a device publishing into "warehouse" for
 *    the fleet "Warehouse" was left out, then seeded back as silent;
 *  - every reading in the 30-minute window counted, so a Last Will's 0 kept
 *    a device that had come back offline for up to 30 minutes;
 *  - a read cut at its row limit (a large fleet) held only the newest part
 *    of the window, and the registered devices it did not reach were seeded
 *    as silent and alerted on.
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

jest.mock("Common/Server/Services/IoTFleetService", () => {
  return { __esModule: true, default: { findOneBy: jest.fn() } };
});

jest.mock("Common/Server/Services/IoTDeviceCredentialService", () => {
  return {
    __esModule: true,
    default: { getExpectedDeviceExternalIds: jest.fn() },
  };
});

import MetricService from "Common/Server/Services/MetricService";
import MetricTypeService from "Common/Server/Services/MetricTypeService";
import IoTFleetService from "Common/Server/Services/IoTFleetService";
import IoTDeviceCredentialService from "Common/Server/Services/IoTDeviceCredentialService";
import {
  GROUPED_READ_ROW_LIMIT,
  monitorIoT,
} from "../../../../FeatureSet/Workers/Jobs/TelemetryMonitor/MonitorTelemetryMonitor";

const metricAggregateBy: jest.Mock =
  MetricService.aggregateBy as unknown as jest.Mock;
const metricFindBy: jest.Mock = MetricService.findBy as unknown as jest.Mock;
const metricTypeFindBy: jest.Mock =
  MetricTypeService.findBy as unknown as jest.Mock;
const fleetFindOneBy: jest.Mock =
  IoTFleetService.findOneBy as unknown as jest.Mock;
const expectedDevices: jest.Mock =
  IoTDeviceCredentialService.getExpectedDeviceExternalIds as unknown as jest.Mock;

const monitorId: ObjectID = ObjectID.generate();
const projectId: ObjectID = ObjectID.generate();
const FLEET_ID: string = "66666666-6666-4666-8666-666666666666";

function deviceOfflineStep(fleetIdentifier: string): MonitorStep {
  return getIoTAlertTemplateById("iot-device-offline")!.getMonitorStep({
    fleetIdentifier,
    onlineMonitorStatusId: ObjectID.generate(),
    offlineMonitorStatusId: ObjectID.generate(),
    defaultIncidentSeverityId: ObjectID.generate(),
    defaultAlertSeverityId: ObjectID.generate(),
    monitorName: "Warehouse",
  });
}

function minutesAgo(minutes: number): Date {
  const now: number = Date.now();
  return new Date(now - (now % 60_000) - minutes * 60_000);
}

function row(deviceId: string, minutes: number, value: number): unknown {
  return {
    timestamp: minutesAgo(minutes),
    value,
    attributes: { "device.id": deviceId },
  };
}

function seriesOf(
  response: MetricMonitorResponse,
  deviceId: string,
): MetricSeriesResult | undefined {
  return (response.seriesBreakdown || []).find(
    (series: MetricSeriesResult): boolean => {
      return series.labels["device.id"] === deviceId;
    },
  );
}

beforeEach(() => {
  metricAggregateBy.mockReset().mockResolvedValue({ data: [] });
  metricFindBy.mockReset().mockResolvedValue([]);
  metricTypeFindBy.mockReset().mockResolvedValue([]);
  fleetFindOneBy.mockReset().mockResolvedValue({ _id: FLEET_ID });
  expectedDevices.mockReset().mockResolvedValue([]);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("Device Offline: the fleet matches whatever its case", () => {
  test("the fleet is a case-insensitive exact match, its own wildcards escaped", async () => {
    for (const [fleet, pattern] of [
      ["Warehouse", "Warehouse"],
      ["dock_1%", "dock\\_1\\%"],
    ] as Array<[string, string]>) {
      metricAggregateBy.mockClear();

      await monitorIoT({
        monitorStep: deviceOfflineStep(fleet),
        monitorId,
        projectId,
      });

      const filter: unknown = (
        metricAggregateBy.mock.calls[0]![0] as {
          query: { attributes: Record<string, unknown> };
        }
      ).query.attributes["resource.iot.fleet.name"];

      expect(filter).toBeInstanceOf(Wildcard);
      expect((filter as Wildcard<string>).toPatterns()).toEqual([pattern]);
    }
  });
});

describe("Device Offline: each device is judged on its latest reading", () => {
  test("a device that reported down and then up again is up", async () => {
    metricAggregateBy.mockResolvedValue({
      data: [row("door-1", 20, 0), row("door-1", 2, 1), row("door-2", 5, 0)],
    });

    const response: MetricMonitorResponse = await monitorIoT({
      monitorStep: deviceOfflineStep("Warehouse"),
      monitorId,
      projectId,
    });

    const back: MetricSeriesResult = seriesOf(response, "door-1")!;
    expect(back.aggregatedResults[0]!.data).toHaveLength(1);
    expect(back.aggregatedResults[0]!.data[0]!.value).toBe(1);

    // Still down: its latest reading says so.
    expect(seriesOf(response, "door-2")!.aggregatedResults[0]!.data).toEqual([
      expect.objectContaining({ value: 0 }),
    ]);
  });

  test("a step without the flag keeps every reading of the window", async () => {
    metricAggregateBy.mockResolvedValue({
      data: [row("door-1", 20, 0), row("door-1", 2, 1)],
    });
    const step: MonitorStep = deviceOfflineStep("Warehouse");
    delete step.data!.iotMonitor!.judgeLatestReading;

    const response: MetricMonitorResponse = await monitorIoT({
      monitorStep: step,
      monitorId,
      projectId,
    });

    expect(
      seriesOf(response, "door-1")!.aggregatedResults[0]!.data,
    ).toHaveLength(2);
  });

  test("the template sets it", () => {
    expect(
      deviceOfflineStep("Warehouse").data!.iotMonitor!.judgeLatestReading,
    ).toBe(true);
  });
});

describe("Device Offline: silence is judged only on a whole read", () => {
  test("a registered device missing from a whole read is seeded as silent", async () => {
    metricAggregateBy.mockResolvedValue({ data: [row("door-1", 2, 1)] });
    expectedDevices.mockResolvedValue(["door-1", "door-9"]);

    const response: MetricMonitorResponse = await monitorIoT({
      monitorStep: deviceOfflineStep("Warehouse"),
      monitorId,
      projectId,
    });

    expect(seriesOf(response, "door-9")).toBeDefined();
  });

  test("a read cut at its row limit seeds no silent devices", async () => {
    // A fleet big enough to fill the grouped read, newest rows first.
    metricAggregateBy.mockResolvedValue({
      data: Array.from(
        { length: GROUPED_READ_ROW_LIMIT },
        (_value: unknown, index: number) => {
          return row(`door-${index % 2000}`, Math.floor(index / 2000), 1);
        },
      ),
    });
    expectedDevices.mockResolvedValue(["door-1", "door-99999"]);

    const response: MetricMonitorResponse = await monitorIoT({
      monitorStep: deviceOfflineStep("Warehouse"),
      monitorId,
      projectId,
    });

    expect(response.dataCompleteFrom).toBeDefined();
    expect(fleetFindOneBy).not.toHaveBeenCalled();
    expect(seriesOf(response, "door-99999")).toBeUndefined();
  });
});
