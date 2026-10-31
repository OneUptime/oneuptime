import MonitorStep from "Common/Types/Monitor/MonitorStep";
import { MonitorStepHostMonitorUtil } from "Common/Types/Monitor/MonitorStepHostMonitor";
import { MonitorStepProxmoxMonitorUtil } from "Common/Types/Monitor/MonitorStepProxmoxMonitor";
import MonitorType from "Common/Types/Monitor/MonitorType";
import ObjectID from "Common/Types/ObjectID";
import RollingTime from "Common/Types/RollingTime/RollingTime";
import MetricsAggregationType from "Common/Types/Metrics/MetricsAggregationType";
import MetricQueryConfigData from "Common/Types/Metrics/MetricQueryConfigData";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * An infrastructure monitor is evaluated on its resource's current value
 * (InfrastructureResourceBinding): a Proxmox cluster renamed since the
 * monitor was saved is followed by the id its step keeps, and a host name
 * typed "Web-01" reads the "web-01" ingest stores. Before, both read
 * nothing, and the monitor said the resource had stopped reporting.
 *
 * Driven through the queue entry point the worker runs, with the datastores
 * replaced.
 */

jest.mock("Common/Server/Infrastructure/Queue", () => {
  return {
    __esModule: true,
    default: { addJob: jest.fn(), getQueue: jest.fn() },
    QueueName: { Telemetry: "Telemetry" },
  };
});

// The worker transitively loads the native `isolated-vm` addon; stub it.
jest.mock("Common/Server/Utils/VM/VMRunner", () => {
  return { __esModule: true, default: {} };
});

jest.mock("Common/Server/Services/MonitorService", () => {
  return {
    __esModule: true,
    default: { findOneById: jest.fn(), findAllBy: jest.fn() },
  };
});

jest.mock("Common/Server/Utils/Monitor/MonitorResource", () => {
  return { __esModule: true, default: { monitorResource: jest.fn() } };
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
    default: { getExpectedHostIdentifiers: jest.fn(), findOneBy: jest.fn() },
  };
});

jest.mock("Common/Server/Services/ProxmoxClusterService", () => {
  return { __esModule: true, default: { findOneBy: jest.fn() } };
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

import MonitorService from "Common/Server/Services/MonitorService";
import MonitorResourceUtil from "Common/Server/Utils/Monitor/MonitorResource";
import MetricService from "Common/Server/Services/MetricService";
import MetricTypeService from "Common/Server/Services/MetricTypeService";
import HostService from "Common/Server/Services/HostService";
import ProxmoxClusterService from "Common/Server/Services/ProxmoxClusterService";
import ReceivingCoverage from "Common/Server/Utils/Telemetry/ReceivingCoverage";
import { processTelemetryMonitorEvaluationFromQueue } from "../../../../FeatureSet/Workers/Jobs/TelemetryMonitor/MonitorTelemetryMonitor";

const monitorId: ObjectID = ObjectID.generate();
const projectId: ObjectID = ObjectID.generate();
const CLUSTER_ID: string = "22222222-2222-4222-8222-222222222222";
const HOST_ID: string = "33333333-3333-4333-8333-333333333333";

const findOneById: jest.Mock =
  MonitorService.findOneById as unknown as jest.Mock;
const monitorResource: jest.Mock =
  MonitorResourceUtil.monitorResource as unknown as jest.Mock;
const metricAggregateBy: jest.Mock =
  MetricService.aggregateBy as unknown as jest.Mock;
const metricFindBy: jest.Mock = MetricService.findBy as unknown as jest.Mock;
const metricTypeFindBy: jest.Mock =
  MetricTypeService.findBy as unknown as jest.Mock;
const expectedHosts: jest.Mock =
  HostService.getExpectedHostIdentifiers as unknown as jest.Mock;
const findHost: jest.Mock = HostService.findOneBy as unknown as jest.Mock;
const findCluster: jest.Mock =
  ProxmoxClusterService.findOneBy as unknown as jest.Mock;

function queryConfig(metricName: string): MetricQueryConfigData {
  return {
    metricAliasData: {
      metricVariable: "a",
      title: "a",
      description: "a",
      legend: "a",
      legendUnit: undefined,
    },
    metricQueryData: {
      filterData: {
        metricName,
        attributes: {},
        aggegationType: MetricsAggregationType.Avg,
        aggregateBy: {},
      },
    },
  };
}

function hostStep(hostIdentifier: string): MonitorStep {
  const step: MonitorStep = new MonitorStep();
  step.setHostMonitor({
    ...MonitorStepHostMonitorUtil.getDefault(),
    hostIdentifier,
    rollingTime: RollingTime.Past5Minutes,
    metricViewConfig: {
      queryConfigs: [queryConfig("system.cpu.utilization")],
      formulaConfigs: [],
    },
  });
  return step;
}

function proxmoxStep(config: {
  clusterIdentifier: string;
  resourceId?: string;
}): MonitorStep {
  const step: MonitorStep = new MonitorStep();
  step.setProxmoxMonitor({
    ...MonitorStepProxmoxMonitorUtil.getDefault(),
    ...config,
    rollingTime: RollingTime.Past5Minutes,
    metricViewConfig: {
      queryConfigs: [queryConfig("pve_up")],
      formulaConfigs: [],
    },
  });
  return step;
}

function givenMonitor(monitorType: MonitorType, step: MonitorStep): void {
  findOneById.mockResolvedValue({
    id: monitorId,
    _id: monitorId.toString(),
    projectId,
    monitorType,
    monitorSteps: { data: { monitorStepsInstanceArray: [step] } },
  });
}

async function runOnce(): Promise<void> {
  await processTelemetryMonitorEvaluationFromQueue({
    monitorId: monitorId.toString(),
    projectId: projectId.toString(),
    queuedAt: new Date(),
  });
}

// The attributes of every metric read the check made.
function readAttributes(): Array<Record<string, unknown>> {
  return [...metricAggregateBy.mock.calls, ...metricFindBy.mock.calls].map(
    (call: Array<unknown>) => {
      return ((call[0] as { query: { attributes?: Record<string, unknown> } })
        .query.attributes || {}) as Record<string, unknown>;
    },
  );
}

beforeEach(() => {
  ReceivingCoverage.clearCache();
  findOneById.mockReset();
  monitorResource.mockReset().mockResolvedValue({});
  metricAggregateBy.mockReset().mockResolvedValue({ data: [] });
  metricFindBy.mockReset().mockResolvedValue([]);
  metricTypeFindBy.mockReset().mockResolvedValue([]);
  expectedHosts.mockReset().mockResolvedValue([]);
  findHost.mockReset().mockResolvedValue(null);
  findCluster.mockReset().mockResolvedValue(null);
  jest
    .spyOn(ReceivingCoverage, "planTelemetryEvaluation")
    .mockResolvedValue({ evaluate: true, isIngestBehind: false } as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("An infrastructure check reads its resource's current value", () => {
  test("a Proxmox cluster renamed since the monitor was saved is read by its new name", async () => {
    findCluster.mockImplementation(async (data: unknown) => {
      const query: Record<string, unknown> = (
        data as { query: Record<string, unknown> }
      ).query;

      return String(query["_id"]) === CLUSTER_ID &&
        String(query["projectId"]) === projectId.toString()
        ? { _id: CLUSTER_ID, name: "pve-production" }
        : null;
    });
    givenMonitor(
      MonitorType.Proxmox,
      proxmoxStep({ clusterIdentifier: "pve-prod", resourceId: CLUSTER_ID }),
    );

    await runOnce();

    expect(monitorResource).toHaveBeenCalledTimes(1);
    const reads: Array<Record<string, unknown>> = readAttributes();
    expect(reads.length).toBeGreaterThan(0);
    for (const attributes of reads) {
      expect(attributes["resource.proxmox.cluster.name"]).toBe(
        "pve-production",
      );
    }
  });

  test("a host name typed in another case reads the host name ingest stores", async () => {
    findHost.mockImplementation(async () => {
      return { _id: HOST_ID, hostIdentifier: "web-01" };
    });
    givenMonitor(MonitorType.Host, hostStep("Web-01"));

    await runOnce();

    expect(monitorResource).toHaveBeenCalledTimes(1);
    const reads: Array<Record<string, unknown>> = readAttributes();
    expect(reads.length).toBeGreaterThan(0);
    for (const attributes of reads) {
      expect(attributes["resource.host.name"]).toBe("web-01");
    }
  });

  test("a resource that cannot be read leaves the check on the step's own value", async () => {
    findCluster.mockRejectedValue(new Error("connection refused"));
    givenMonitor(
      MonitorType.Proxmox,
      proxmoxStep({ clusterIdentifier: "pve-prod", resourceId: CLUSTER_ID }),
    );

    await runOnce();

    expect(monitorResource).toHaveBeenCalledTimes(1);
    for (const attributes of readAttributes()) {
      expect(attributes["resource.proxmox.cluster.name"]).toBe("pve-prod");
    }
  });
});
