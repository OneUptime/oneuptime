import MonitorStep from "Common/Types/Monitor/MonitorStep";
import ObjectID from "Common/Types/ObjectID";
import Dictionary from "Common/Types/Dictionary";
import RollingTime from "Common/Types/RollingTime/RollingTime";
import MetricsAggregationType from "Common/Types/Metrics/MetricsAggregationType";
import MonitorStepIoTMonitor, {
  IoTResourceScope,
} from "Common/Types/Monitor/MonitorStepIoTMonitor";
import { buildIoTMonitorConfig } from "Common/Types/Monitor/IotAlertTemplates";
import { describe, expect, test, beforeEach, afterEach } from "@jest/globals";

/*
 * What an IoT Device monitor's resource filters do to the query the worker
 * runs (MonitorTelemetryMonitor.monitorIoT): every filter that is set becomes
 * its own equality on the datapoints, next to the fleet, so a datapoint has to
 * match all of them. Device ID does not win over the others. The IoT form
 * once said it did - a sentence copied from the Proxmox form, whose worker
 * really does let the guest ID win - and now says this instead
 * (IoTMonitorStepFormFilters.test.tsx).
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
import { monitorIoT } from "../../../../FeatureSet/Workers/Jobs/TelemetryMonitor/MonitorTelemetryMonitor";

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

interface QueryArgs {
  query: { name: string; attributes?: Dictionary<string> };
}

function iotStep(input: {
  resourceFilters: MonitorStepIoTMonitor["resourceFilters"];
  groupByDevice?: boolean | undefined;
}): MonitorStep {
  const config: MonitorStepIoTMonitor = buildIoTMonitorConfig({
    fleetIdentifier: "warehouse-sensors",
    metricName: "iot_battery_percent",
    metricAlias: "battery",
    rollingTime: RollingTime.Past5Minutes,
    aggregationType: MetricsAggregationType.Min,
    groupByAttributeKey: input.groupByDevice ? "device.id" : undefined,
  });

  config.resourceFilters = input.resourceFilters;

  const step: MonitorStep = new MonitorStep();
  step.setIoTMonitor(config);
  return step;
}

// The attributes of the one query the worker ran, aggregated or raw.
function queriedAttributes(mock: jest.Mock): Dictionary<string> | undefined {
  expect(mock).toHaveBeenCalledTimes(1);
  return (mock.mock.calls[0]![0] as QueryArgs).query.attributes;
}

beforeEach(() => {
  metricAggregateBy.mockReset().mockResolvedValue({ data: [] });
  metricFindBy.mockReset().mockResolvedValue([]);
  metricTypeFindBy.mockReset().mockResolvedValue([]);
  fleetFindOneBy.mockReset().mockResolvedValue(null);
  expectedDevices.mockReset().mockResolvedValue([]);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("monitorIoT: every resource filter that is set must match", () => {
  test("Device ID, Device Type and Resource Scope are all on the query, next to the fleet", async () => {
    await monitorIoT({
      monitorStep: iotStep({
        resourceFilters: {
          deviceId: "sensor-001",
          deviceType: "sensor",
          scope: IoTResourceScope.Device,
        },
      }),
      monitorId,
      projectId,
    });

    expect(queriedAttributes(metricAggregateBy)).toEqual({
      "resource.iot.fleet.name": "warehouse-sensors",
      "device.id": "sensor-001",
      "iot.device.type": "sensor",
      "iot.scope": "device",
    });
  });

  test("a Device ID does not drop a Device Type that names another type", async () => {
    await monitorIoT({
      monitorStep: iotStep({
        resourceFilters: { deviceId: "gateway-7", deviceType: "sensor" },
      }),
      monitorId,
      projectId,
    });

    const attributes: Dictionary<string> | undefined =
      queriedAttributes(metricAggregateBy);

    /*
     * Both are equalities on the same datapoints: a gateway's datapoints
     * carry iot.device.type "gateway", so this query matches nothing.
     */
    expect(attributes?.["device.id"]).toBe("gateway-7");
    expect(attributes?.["iot.device.type"]).toBe("sensor");
  });

  test("a device-grouped monitor reads its rows with every filter too", async () => {
    await monitorIoT({
      monitorStep: iotStep({
        resourceFilters: {
          deviceId: "sensor-001",
          scope: IoTResourceScope.Device,
        },
        groupByDevice: true,
      }),
      monitorId,
      projectId,
    });

    expect(metricAggregateBy).not.toHaveBeenCalled();
    expect(queriedAttributes(metricFindBy)).toEqual({
      "resource.iot.fleet.name": "warehouse-sensors",
      "device.id": "sensor-001",
      "iot.scope": "device",
    });
  });

  test("each filter on its own narrows the query by itself", async () => {
    const cases: Array<{
      resourceFilters: MonitorStepIoTMonitor["resourceFilters"];
      key: string;
      value: string;
    }> = [
      {
        resourceFilters: { deviceId: "sensor-001" },
        key: "device.id",
        value: "sensor-001",
      },
      {
        resourceFilters: { deviceType: "camera" },
        key: "iot.device.type",
        value: "camera",
      },
      {
        resourceFilters: { scope: IoTResourceScope.Fleet },
        key: "iot.scope",
        value: "fleet",
      },
    ];

    for (const entry of cases) {
      metricAggregateBy.mockClear();

      await monitorIoT({
        monitorStep: iotStep({ resourceFilters: entry.resourceFilters }),
        monitorId,
        projectId,
      });

      expect(queriedAttributes(metricAggregateBy)).toEqual({
        "resource.iot.fleet.name": "warehouse-sensors",
        [entry.key]: entry.value,
      });
    }
  });

  test("no filter set: the fleet alone scopes the query", async () => {
    await monitorIoT({
      monitorStep: iotStep({ resourceFilters: {} }),
      monitorId,
      projectId,
    });

    expect(queriedAttributes(metricAggregateBy)).toEqual({
      "resource.iot.fleet.name": "warehouse-sensors",
    });
  });

  test("with a filter set, silent registered devices are not seeded: they may be outside it", async () => {
    await monitorIoT({
      monitorStep: iotStep({
        resourceFilters: { deviceType: "sensor" },
        groupByDevice: true,
      }),
      monitorId,
      projectId,
    });

    expect(fleetFindOneBy).not.toHaveBeenCalled();
    expect(expectedDevices).not.toHaveBeenCalled();
  });
});
