import AggregatedResult from "Common/Types/BaseDatabase/AggregatedResult";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import MetricQueryConfigData from "Common/Types/Metrics/MetricQueryConfigData";
import MetricsAggregationType from "Common/Types/Metrics/MetricsAggregationType";
import MetricsViewConfig from "Common/Types/Metrics/MetricsViewConfig";
import MetricMonitorResponse from "Common/Types/Monitor/MetricMonitor/MetricMonitorResponse";
import MonitorStep from "Common/Types/Monitor/MonitorStep";
import MonitorType, {
  MonitorTypeHelper,
} from "Common/Types/Monitor/MonitorType";
import { MonitorStepMetricMonitorUtil } from "Common/Types/Monitor/MonitorStepMetricMonitor";
import { MonitorStepKubernetesMonitorUtil } from "Common/Types/Monitor/MonitorStepKubernetesMonitor";
import { MonitorStepDockerMonitorUtil } from "Common/Types/Monitor/MonitorStepDockerMonitor";
import { MonitorStepHostMonitorUtil } from "Common/Types/Monitor/MonitorStepHostMonitor";
import { MonitorStepPodmanMonitorUtil } from "Common/Types/Monitor/MonitorStepPodmanMonitor";
import { MonitorStepDockerSwarmMonitorUtil } from "Common/Types/Monitor/MonitorStepDockerSwarmMonitor";
import { MonitorStepProxmoxMonitorUtil } from "Common/Types/Monitor/MonitorStepProxmoxMonitor";
import { MonitorStepOpenStackMonitorUtil } from "Common/Types/Monitor/MonitorStepOpenStackMonitor";
import { MonitorStepVMwareMonitorUtil } from "Common/Types/Monitor/MonitorStepVMwareMonitor";
import { MonitorStepCephMonitorUtil } from "Common/Types/Monitor/MonitorStepCephMonitor";
import { MonitorStepStorageArrayMonitorUtil } from "Common/Types/Monitor/MonitorStepStorageArrayMonitor";
import { MonitorStepXcpNgMonitorUtil } from "Common/Types/Monitor/MonitorStepXcpNgMonitor";
import { MonitorStepIoTMonitorUtil } from "Common/Types/Monitor/MonitorStepIoTMonitor";
import ObjectID from "Common/Types/ObjectID";
import RollingTime from "Common/Types/RollingTime/RollingTime";
import RollingTimeUtil from "Common/Types/RollingTime/RollingTimeUtil";
import { beforeEach, describe, expect, jest, test } from "@jest/globals";

/*
 * EVERY METRIC-BACKED TELEMETRY CHECK HANDS ITS READS A WINDOW THAT HOLDS
 * ITS START AND NOT ITS END (issue #11334).
 *
 * Metrics and every infrastructure check - Kubernetes, Docker, Host,
 * Podman, Docker Swarm, Proxmox, OpenStack, VMware, Ceph, storage arrays,
 * XCP-ng, IoT - read their rolling time through MetricService. Each must
 * hand every read the check's window as TelemetryCheckWindow builds it:
 * from the rolling time's start up to the due time, not included. The real
 * ClickHouse suite (TelemetryMonitorWindowEdgesClickhouse) counts the record
 * on the edge for Metrics, Host and Kubernetes; this holds every other type
 * to the same window, and a metric-backed type this suite does not know
 * fails it.
 */

jest.mock("Common/Server/Infrastructure/Queue", () => {
  return {
    __esModule: true,
    default: { addJob: jest.fn(), getQueue: jest.fn() },
    QueueName: { Telemetry: "Telemetry" },
  };
});

jest.mock("Common/Server/Utils/VM/VMRunner", () => {
  return { __esModule: true, default: {} };
});

jest.mock("Common/Server/Services/MetricService", () => {
  return {
    __esModule: true,
    default: {
      aggregateBy: jest.fn(),
      findBy: jest.fn(),
      readSeriesArrivals: jest.fn(),
    },
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

jest.mock("Common/Server/Services/IoTFleetService", () => {
  return { __esModule: true, default: { findOneBy: jest.fn() } };
});

jest.mock("Common/Server/Services/IoTDeviceCredentialService", () => {
  return {
    __esModule: true,
    default: { getExpectedDeviceExternalIds: jest.fn() },
  };
});

jest.mock("Common/Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    },
  };
});

import MetricService from "Common/Server/Services/MetricService";
import MetricTypeService from "Common/Server/Services/MetricTypeService";
import HostService from "Common/Server/Services/HostService";
import IoTFleetService from "Common/Server/Services/IoTFleetService";
import IoTDeviceCredentialService from "Common/Server/Services/IoTDeviceCredentialService";
import {
  monitorCeph,
  monitorDocker,
  monitorDockerSwarm,
  monitorHost,
  monitorIoT,
  monitorKubernetes,
  monitorMetric,
  monitorOpenStack,
  monitorPodman,
  monitorProxmox,
  monitorStorageArray,
  monitorVMware,
  monitorXcpNg,
} from "../../../../FeatureSet/Workers/Jobs/TelemetryMonitor/MonitorTelemetryMonitor";

// The check was due at a monitor's own moment: 10:01:07.123.
const DUE_AT: Date = new Date("2026-11-27T10:01:07.123Z");

const metricAggregateBy: jest.Mock =
  MetricService.aggregateBy as unknown as jest.Mock;
const metricFindBy: jest.Mock = MetricService.findBy as unknown as jest.Mock;
const metricReadSeriesArrivals: jest.Mock =
  MetricService.readSeriesArrivals as unknown as jest.Mock;

function view(): MetricsViewConfig {
  return {
    queryConfigs: [
      {
        metricAliasData: {
          metricVariable: "a",
          title: "Points",
          description: undefined,
          legend: undefined,
          legendUnit: undefined,
        },
        metricQueryData: {
          filterData: {
            metricName: "edge.points",
            attributes: {},
            aggegationType: MetricsAggregationType.Sum,
            aggregateBy: {},
          },
        },
      } as MetricQueryConfigData,
    ],
    formulaConfigs: [],
  };
}

// One metric-backed type's step, over `rollingTime`.
function stepFor(
  monitorType: MonitorType,
  rollingTime: RollingTime,
): MonitorStep {
  const step: MonitorStep = new MonitorStep();
  const metricViewConfig: MetricsViewConfig = view();

  switch (monitorType) {
    case MonitorType.Metrics:
      return step.setMetricMonitor({
        ...MonitorStepMetricMonitorUtil.getDefault(),
        metricViewConfig,
        rollingTime,
      });
    case MonitorType.Kubernetes:
      return step.setKubernetesMonitor({
        ...MonitorStepKubernetesMonitorUtil.getDefault(),
        clusterIdentifier: "prod",
        metricViewConfig,
        rollingTime,
      });
    case MonitorType.Docker:
      return step.setDockerMonitor({
        ...MonitorStepDockerMonitorUtil.getDefault(),
        metricViewConfig,
        rollingTime,
      });
    case MonitorType.Host:
      return step.setHostMonitor({
        ...MonitorStepHostMonitorUtil.getDefault(),
        hostIdentifier: "web-01",
        metricViewConfig,
        rollingTime,
      });
    case MonitorType.Podman:
      return step.setPodmanMonitor({
        ...MonitorStepPodmanMonitorUtil.getDefault(),
        metricViewConfig,
        rollingTime,
      });
    case MonitorType.DockerSwarm:
      return step.setDockerSwarmMonitor({
        ...MonitorStepDockerSwarmMonitorUtil.getDefault(),
        metricViewConfig,
        rollingTime,
      });
    case MonitorType.Proxmox:
      return step.setProxmoxMonitor({
        ...MonitorStepProxmoxMonitorUtil.getDefault(),
        metricViewConfig,
        rollingTime,
      });
    case MonitorType.OpenStack:
      return step.setOpenStackMonitor({
        ...MonitorStepOpenStackMonitorUtil.getDefault(),
        metricViewConfig,
        rollingTime,
      });
    case MonitorType.VMware:
      return step.setVMwareMonitor({
        ...MonitorStepVMwareMonitorUtil.getDefault(),
        metricViewConfig,
        rollingTime,
      });
    case MonitorType.Ceph:
      return step.setCephMonitor({
        ...MonitorStepCephMonitorUtil.getDefault(),
        metricViewConfig,
        rollingTime,
      });
    case MonitorType.StorageArray:
      return step.setStorageArrayMonitor({
        ...MonitorStepStorageArrayMonitorUtil.getDefault(),
        arrayIdentifier: "pure-prod-01",
        metricViewConfig,
        rollingTime,
      });
    case MonitorType.XcpNg:
      return step.setXcpNgMonitor({
        ...MonitorStepXcpNgMonitorUtil.getDefault(),
        poolIdentifier: "1e8b7c4a-3f2d-4b6e-9a1c-0d5e7f9b2a3c",
        metricViewConfig,
        rollingTime,
      });
    case MonitorType.IoTDevice:
      return step.setIoTMonitor({
        ...MonitorStepIoTMonitorUtil.getDefault(),
        fleetIdentifier: "fleet-1",
        metricViewConfig,
        rollingTime,
      });
    default:
      throw new Error(
        `${monitorType} is metric-backed but this suite builds no step for it`,
      );
  }
}

type Reader = (data: {
  monitorStep: MonitorStep;
  monitorId: ObjectID;
  projectId: ObjectID;
  evaluateUntil?: Date | undefined;
}) => Promise<MetricMonitorResponse>;

const READERS: Partial<Record<MonitorType, Reader>> = {
  [MonitorType.Metrics]: monitorMetric,
  [MonitorType.Kubernetes]: monitorKubernetes,
  [MonitorType.Docker]: monitorDocker,
  [MonitorType.Host]: monitorHost,
  [MonitorType.Podman]: monitorPodman,
  [MonitorType.DockerSwarm]: monitorDockerSwarm,
  [MonitorType.Proxmox]: monitorProxmox,
  [MonitorType.OpenStack]: monitorOpenStack,
  [MonitorType.VMware]: monitorVMware,
  [MonitorType.Ceph]: monitorCeph,
  [MonitorType.StorageArray]: monitorStorageArray,
  [MonitorType.XcpNg]: monitorXcpNg,
  [MonitorType.IoTDevice]: monitorIoT,
};

// Every time range a read was handed, from every MetricService call.
function rangesRead(): Array<unknown> {
  const ranges: Array<unknown> = [];

  for (const mock of [metricAggregateBy, metricFindBy]) {
    for (const call of mock.mock.calls) {
      const args: { query?: { time?: unknown } } = call[0] as {
        query?: { time?: unknown };
      };

      if (args?.query && "time" in args.query) {
        ranges.push(args.query.time);
      }
    }
  }

  return ranges;
}

beforeEach(() => {
  jest.clearAllMocks();

  metricAggregateBy.mockResolvedValue({ data: [] } as AggregatedResult);
  metricFindBy.mockResolvedValue([]);
  metricReadSeriesArrivals.mockResolvedValue([]);
  (MetricTypeService.findBy as unknown as jest.Mock).mockResolvedValue([]);
  (
    HostService.getExpectedHostIdentifiers as unknown as jest.Mock
  ).mockResolvedValue([]);
  (IoTFleetService.findOneBy as unknown as jest.Mock).mockResolvedValue(null);
  (
    IoTDeviceCredentialService.getExpectedDeviceExternalIds as unknown as jest.Mock
  ).mockResolvedValue([]);
});

describe("every metric-backed check is known to this suite", () => {
  test("a new metric-backed type cannot slip past it", () => {
    const known: Array<string> = Object.keys(READERS).sort();
    const metricBacked: Array<string> =
      MonitorTypeHelper.getMetricBackedMonitorTypes()
        .map((monitorType: MonitorType): string => {
          return monitorType;
        })
        .sort();

    expect(known).toEqual(metricBacked);
  });
});

describe.each(
  Object.keys(READERS).map((monitorType: string) => {
    return [monitorType];
  }),
)("the %s check", (monitorTypeName: string) => {
  const monitorType: MonitorType = monitorTypeName as MonitorType;
  const reader: Reader = READERS[monitorType]!;

  test.each([
    RollingTime.Past1Minute,
    RollingTime.Past5Minutes,
    RollingTime.Past1Hour,
  ])(
    "reads %s from its start up to the due time, not included",
    async (rollingTime: RollingTime) => {
      const response: MetricMonitorResponse = await reader({
        monitorStep: stepFor(monitorType, rollingTime),
        monitorId: ObjectID.generate(),
        projectId: ObjectID.generate(),
        evaluateUntil: DUE_AT,
      });

      const expectedStartMs: number =
        DUE_AT.getTime() - RollingTimeUtil.getWindowInMs(rollingTime);
      const ranges: Array<unknown> = rangesRead();

      // It read, and every read was handed the check's own window.
      expect(ranges.length).toBeGreaterThan(0);

      for (const range of ranges) {
        expect(range).toBeInstanceOf(InBetween);

        const window: InBetween<Date> = range as InBetween<Date>;

        expect(window.includesEnd).toBe(false);
        expect(new Date(window.startValue).getTime()).toBe(expectedStartMs);
        expect(new Date(window.endValue).getTime()).toBe(DUE_AT.getTime());
      }

      // The window it says it judged is that window, its end left out.
      const judged: InBetween<Date> =
        response.startAndEndDate as InBetween<Date>;

      expect(judged).toBeInstanceOf(InBetween);
      expect(judged.includesEnd).toBe(false);
      expect(new Date(judged.endValue).getTime()).toBe(DUE_AT.getTime());

      // Each aggregate's own bounds are the window's too.
      for (const call of metricAggregateBy.mock.calls) {
        const args: { startTimestamp: Date; endTimestamp: Date } = call[0] as {
          startTimestamp: Date;
          endTimestamp: Date;
        };

        expect(new Date(args.startTimestamp).getTime()).toBe(expectedStartMs);
        expect(new Date(args.endTimestamp).getTime()).toBe(DUE_AT.getTime());
      }
    },
  );
});
