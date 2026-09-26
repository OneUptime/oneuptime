import MonitorStep from "Common/Types/Monitor/MonitorStep";
import ObjectID from "Common/Types/ObjectID";
import Dictionary from "Common/Types/Dictionary";
import { JSONObject } from "Common/Types/JSON";
import { describe, expect, test, beforeEach, afterEach } from "@jest/globals";
import RollingTime from "Common/Types/RollingTime/RollingTime";
import MetricsAggregationType from "Common/Types/Metrics/MetricsAggregationType";
import MetricQueryConfigData from "Common/Types/Metrics/MetricQueryConfigData";
import AggregatedResult from "Common/Types/BaseDatabase/AggregatedResult";
import MetricMonitorResponse, {
  CephAffectedResource,
  CephResourceBreakdown,
  DockerSwarmAffectedResource,
  DockerSwarmResourceBreakdown,
  KubernetesAffectedResource,
  KubernetesResourceBreakdown,
  ProxmoxAffectedResource,
  ProxmoxResourceBreakdown,
  VMwareAffectedResource,
  VMwareResourceBreakdown,
} from "Common/Types/Monitor/MetricMonitor/MetricMonitorResponse";
import MetricSeriesResult from "Common/Types/Monitor/MetricMonitor/MetricSeriesResult";
import PlatformMetricUnitUtil from "Common/Utils/Monitor/PlatformMetricUnitUtil";
import MetricResultUnitConverter from "Common/Utils/Metrics/MetricResultUnitConverter";
import { getKubernetesAlertTemplateById } from "Common/Types/Monitor/KubernetesAlertTemplates";
import { getProxmoxAlertTemplateById } from "Common/Types/Monitor/ProxmoxAlertTemplates";
import { getCephAlertTemplateById } from "Common/Types/Monitor/CephAlertTemplates";
import { getVMwareAlertTemplateById } from "Common/Types/Monitor/VMwareAlertTemplates";
import { getDockerSwarmAlertTemplateById } from "Common/Types/Monitor/DockerSwarmAlertTemplates";
import { getDockerAlertTemplateById } from "Common/Types/Monitor/DockerAlertTemplates";
import { getPodmanAlertTemplateById } from "Common/Types/Monitor/PodmanAlertTemplates";
import { getIoTAlertTemplateById } from "Common/Types/Monitor/IotAlertTemplates";
import { getKubernetesMetricByMetricName } from "Common/Types/Monitor/KubernetesMetricCatalog";
import {
  KubernetesResourceScope,
  MonitorStepKubernetesMonitorUtil,
} from "Common/Types/Monitor/MonitorStepKubernetesMonitor";
import { MonitorStepHostMonitorUtil } from "Common/Types/Monitor/MonitorStepHostMonitor";
import { MonitorStepProxmoxMonitorUtil } from "Common/Types/Monitor/MonitorStepProxmoxMonitor";
import { MonitorStepVMwareMonitorUtil } from "Common/Types/Monitor/MonitorStepVMwareMonitor";
import { MonitorStepCephMonitorUtil } from "Common/Types/Monitor/MonitorStepCephMonitor";
import { MonitorStepDockerSwarmMonitorUtil } from "Common/Types/Monitor/MonitorStepDockerSwarmMonitor";

/*
 * The platform monitors' "Affected Resources" breakdown and unit map.
 *
 * The bug this guards: every platform monitor scanned raw datapoints once
 * per query but kept ONE breakdown that each query overwrote, so the LAST
 * query won. For a ratio template (used ÷ allocatable) that is the
 * denominator — the incident email listed every node's allocatable bytes
 * ("257760964608") under a "> 85%" criteria. The worker now returns one
 * breakdown per query, tagged with the query's alias and the unit its
 * values are in, and hands the criteria evaluator the platform's unit map.
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
  monitorCeph,
  monitorDocker,
  monitorDockerSwarm,
  monitorHost,
  monitorIoT,
  monitorKubernetes,
  monitorMetric,
  monitorPodman,
  monitorProxmox,
  monitorVMware,
} from "../../../../FeatureSet/Workers/Jobs/TelemetryMonitor/MonitorTelemetryMonitor";

const metricAggregateBy: jest.Mock =
  MetricService.aggregateBy as unknown as jest.Mock;
const metricFindBy: jest.Mock = MetricService.findBy as unknown as jest.Mock;
const metricTypeFindBy: jest.Mock =
  MetricTypeService.findBy as unknown as jest.Mock;
const expectedHostIdentifiers: jest.Mock =
  HostService.getExpectedHostIdentifiers as unknown as jest.Mock;

const monitorId: ObjectID = ObjectID.generate();
const projectId: ObjectID = ObjectID.generate();

// Every row in one minute bucket, so a per-series Avg is a plain mean.
const sampleTime: Date = new Date("2026-09-25T10:00:30.000Z");

interface RawRow {
  time: Date;
  value: number;
  attributes: JSONObject;
}

interface FindByArgs {
  query: { name: string; attributes?: Dictionary<string> };
  limit: number;
}

type MonitorFunction = (data: {
  monitorStep: MonitorStep;
  monitorId: ObjectID;
  projectId: ObjectID;
}) => Promise<MetricMonitorResponse>;

function row(value: number, attributes: JSONObject): RawRow {
  return { time: sampleTime, value: value, attributes: attributes };
}

/*
 * Grouped monitors call MetricService.findBy TWICE per query: once for
 * the per-series aggregation (limit LIMIT_PER_PROJECT) and once for the
 * limit-100 breakdown scan. Rows are keyed on the metric name so each
 * query sees its own datapoints. `failScanFor` throws only on the scan,
 * never on the aggregation, which the worker deliberately lets fail loud.
 */
function mockRawRows(input: {
  rowsByMetricName: Dictionary<Array<RawRow>>;
  failScanFor?: Array<string> | undefined;
}): void {
  metricFindBy.mockImplementation(async (args: unknown) => {
    const findArgs: FindByArgs = args as FindByArgs;

    if (
      findArgs.limit === 100 &&
      (input.failScanFor || []).includes(findArgs.query.name)
    ) {
      throw new Error("ClickHouse timeout");
    }

    return input.rowsByMetricName[findArgs.query.name] || [];
  });
}

// The OpenTelemetry-declared unit MetricType stores per metric name.
function mockDeclaredUnits(unitsByMetricName: Dictionary<string>): void {
  metricTypeFindBy.mockResolvedValue(
    Object.keys(unitsByMetricName).map((name: string) => {
      return { name: name, unit: unitsByMetricName[name] };
    }),
  );
}

function queryConfig(input: {
  alias: string;
  metricName: string;
  legendUnit?: string | undefined;
  groupByAttributeKeys?: Array<string> | undefined;
}): MetricQueryConfigData {
  return {
    metricAliasData: {
      metricVariable: input.alias,
      title: input.alias,
      description: input.alias,
      legend: input.alias,
      legendUnit: input.legendUnit,
    },
    metricQueryData: {
      filterData: {
        metricName: input.metricName,
        attributes: {},
        aggegationType: MetricsAggregationType.Avg,
        aggregateBy: {},
      },
      ...(input.groupByAttributeKeys
        ? { groupByAttributeKeys: input.groupByAttributeKeys }
        : {}),
    },
  };
}

const templateArgs: {
  onlineMonitorStatusId: ObjectID;
  offlineMonitorStatusId: ObjectID;
  defaultIncidentSeverityId: ObjectID;
  defaultAlertSeverityId: ObjectID;
  monitorName: string;
} = {
  onlineMonitorStatusId: ObjectID.generate(),
  offlineMonitorStatusId: ObjectID.generate(),
  defaultIncidentSeverityId: ObjectID.generate(),
  defaultAlertSeverityId: ObjectID.generate(),
  monitorName: "Prod",
};

function kubernetesTemplateStep(templateId: string): MonitorStep {
  return getKubernetesAlertTemplateById(templateId)!.getMonitorStep({
    ...templateArgs,
    clusterIdentifier: "prod-cluster",
  });
}

function stepQueryAliases(step: MonitorStep): Array<string | undefined> {
  return MonitorStep.getMetricsViewConfig(step)!.queryConfigs.map(
    (config: MetricQueryConfigData) => {
      return config.metricAliasData?.metricVariable;
    },
  );
}

function valuesOf(result: AggregatedResult | undefined): Array<number> {
  return (result?.data || []).map((d: { value: number }) => {
    return d.value;
  });
}

beforeEach(() => {
  metricAggregateBy.mockReset().mockResolvedValue({ data: [] });
  metricFindBy.mockReset().mockResolvedValue([]);
  metricTypeFindBy.mockReset().mockResolvedValue([]);
  expectedHostIdentifiers.mockReset().mockResolvedValue([]);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("Kubernetes: one breakdown per query", () => {
  const nodeA: JSONObject = {
    "resource.k8s.cluster.name": "prod-cluster",
    "resource.k8s.node.name": "node-a",
  };
  const nodeB: JSONObject = {
    "resource.k8s.cluster.name": "prod-cluster",
    "resource.k8s.node.name": "node-b",
  };
  const allocatable: number = 257760964608;

  function mockNodeMemory(failScanFor?: Array<string>): void {
    mockRawRows({
      rowsByMetricName: {
        "k8s.node.memory.usage": [
          row(230e9, nodeA),
          row(225e9, nodeA),
          row(100e9, nodeB),
        ],
        "k8s.node.allocatable_memory": [
          row(allocatable, nodeA),
          row(allocatable, nodeB),
        ],
      },
      failScanFor: failScanFor,
    });
    mockDeclaredUnits({
      "k8s.node.memory.usage": "By",
      "k8s.node.allocatable_memory": "By",
    });
  }

  test("k8s-high-memory returns the numerator AND the denominator scan, in query order, tagged", async () => {
    mockNodeMemory();

    const step: MonitorStep = kubernetesTemplateStep("k8s-high-memory");
    expect(stepQueryAliases(step)).toEqual(["used_mem", "alloc_mem"]);

    const response: MetricMonitorResponse = await monitorKubernetes({
      monitorStep: step,
      monitorId,
      projectId,
    });

    // The legacy single field — the one the last query overwrote — is gone.
    expect(response.kubernetesResourceBreakdown).toBeUndefined();

    const breakdowns: Array<KubernetesResourceBreakdown> =
      response.kubernetesResourceBreakdowns!;
    expect(breakdowns).toHaveLength(2);

    expect(
      breakdowns.map((breakdown: KubernetesResourceBreakdown) => {
        return [breakdown.metricAlias, breakdown.metricName];
      }),
    ).toEqual([
      ["used_mem", "k8s.node.memory.usage"],
      ["alloc_mem", "k8s.node.allocatable_memory"],
    ]);

    for (const breakdown of breakdowns) {
      /*
       * Whatever the catalog says (another change is adding
       * allocatable_memory to it), else the declared "By". Either way a
       * bytes unit, never undefined — the email must not print a bare
       * 12-digit number.
       */
      const expectedUnit: string | undefined =
        PlatformMetricUnitUtil.getMetricUnit({
          platform: "kubernetes",
          metricName: breakdown.metricName,
          declaredUnit: "By",
        });
      expect(breakdown.metricUnit).toBe(expectedUnit);
      expect(["bytes", "By"]).toContain(breakdown.metricUnit);

      expect(breakdown.clusterName).toBe("prod-cluster");
      expect(breakdown.metricFriendlyName).toBe(
        getKubernetesMetricByMetricName(breakdown.metricName)?.friendlyName ||
          breakdown.metricName,
      );
      expect(breakdown.attributes["resource.k8s.cluster.name"]).toBe(
        "prod-cluster",
      );
    }

    // The numerator's scan holds the USED bytes, highest and lowest per node.
    expect(breakdowns[0]!.affectedResources).toEqual([
      {
        podName: undefined,
        namespace: undefined,
        nodeName: "node-a",
        containerName: undefined,
        workloadType: undefined,
        workloadName: undefined,
        metricValue: 230e9,
        lowestMetricValue: 225e9,
      },
      {
        podName: undefined,
        namespace: undefined,
        nodeName: "node-b",
        containerName: undefined,
        workloadType: undefined,
        workloadName: undefined,
        metricValue: 100e9,
        lowestMetricValue: 100e9,
      },
    ]);

    expect(
      breakdowns[1]!.affectedResources.map(
        (resource: KubernetesAffectedResource) => {
          return `${resource.nodeName}=${resource.metricValue}`;
        },
      ),
    ).toEqual([`node-a=${allocatable}`, `node-b=${allocatable}`]);

    // The criteria evaluator gets a unit for both queries of the ratio.
    expect(response.nativeUnitsByMetricName).toEqual({
      "k8s.node.memory.usage": PlatformMetricUnitUtil.getMetricUnit({
        platform: "kubernetes",
        metricName: "k8s.node.memory.usage",
        declaredUnit: "By",
      }),
      "k8s.node.allocatable_memory": PlatformMetricUnitUtil.getMetricUnit({
        platform: "kubernetes",
        metricName: "k8s.node.allocatable_memory",
        declaredUnit: "By",
      }),
    });

    // The per-node formula is still the utilization percentage.
    const formulaByNode: Dictionary<Array<number>> = {};
    for (const series of response.seriesBreakdown!) {
      formulaByNode[series.labels["resource.k8s.node.name"] as string] =
        valuesOf(series.aggregatedResults[2]);
    }

    expect(Object.keys(formulaByNode).sort()).toEqual(["node-a", "node-b"]);
    expect(formulaByNode["node-a"]).toHaveLength(1);
    expect(formulaByNode["node-a"]![0]).toBeCloseTo(
      (227.5e9 / allocatable) * 100,
      6,
    );
    expect(formulaByNode["node-b"]![0]).toBeCloseTo(
      (100e9 / allocatable) * 100,
      6,
    );
  });

  test("a query whose raw scan throws still yields the other query's breakdown", async () => {
    mockNodeMemory(["k8s.node.memory.usage"]);

    const response: MetricMonitorResponse = await monitorKubernetes({
      monitorStep: kubernetesTemplateStep("k8s-high-memory"),
      monitorId,
      projectId,
    });

    expect(
      response.kubernetesResourceBreakdowns!.map(
        (breakdown: KubernetesResourceBreakdown) => {
          return breakdown.metricAlias;
        },
      ),
    ).toEqual(["alloc_mem"]);

    // The failed scan decorates nothing; the evaluation itself is intact.
    expect(response.seriesBreakdown).toHaveLength(2);
    expect(response.metricResult).toHaveLength(3);
  });

  test("no breakdown field at all when no scan returned rows", async () => {
    const response: MetricMonitorResponse = await monitorKubernetes({
      monitorStep: kubernetesTemplateStep("k8s-high-memory"),
      monitorId,
      projectId,
    });

    expect(response.kubernetesResourceBreakdowns).toBeUndefined();
    expect(response.kubernetesResourceBreakdown).toBeUndefined();
  });

  test("the catalog unit beats the declared unit: k8s.node.cpu.utilization is cores, not the declared '1'", async () => {
    mockDeclaredUnits({ "k8s.node.cpu.utilization": "1" });
    mockRawRows({
      rowsByMetricName: {
        "k8s.node.cpu.utilization": [
          row(1.4, { "resource.k8s.node.name": "a" }),
        ],
      },
    });

    const step: MonitorStep = new MonitorStep();
    step.setKubernetesMonitor({
      ...MonitorStepKubernetesMonitorUtil.getDefault(),
      clusterIdentifier: "prod-cluster",
      resourceScope: KubernetesResourceScope.Node,
      metricViewConfig: {
        queryConfigs: [
          queryConfig({
            alias: "node_cpu",
            metricName: "k8s.node.cpu.utilization",
          }),
        ],
        formulaConfigs: [],
      },
    });

    const response: MetricMonitorResponse = await monitorKubernetes({
      monitorStep: step,
      monitorId,
      projectId,
    });

    expect(response.nativeUnitsByMetricName).toEqual({
      "k8s.node.cpu.utilization": "cores",
    });
    expect(response.kubernetesResourceBreakdowns![0]!.metricUnit).toBe("cores");
  });

  test("a metric the catalog does not know keeps its declared unit; one with no unit anywhere is left out", async () => {
    mockDeclaredUnits({ "my.custom.latency": "ms" });

    const step: MonitorStep = new MonitorStep();
    step.setKubernetesMonitor({
      ...MonitorStepKubernetesMonitorUtil.getDefault(),
      clusterIdentifier: "prod-cluster",
      metricViewConfig: {
        queryConfigs: [
          queryConfig({ alias: "latency", metricName: "my.custom.latency" }),
          queryConfig({ alias: "mystery", metricName: "my.custom.mystery" }),
        ],
        formulaConfigs: [],
      },
    });

    const response: MetricMonitorResponse = await monitorKubernetes({
      monitorStep: step,
      monitorId,
      projectId,
    });

    expect(response.nativeUnitsByMetricName).toEqual({
      "my.custom.latency": "ms",
    });
  });

  test("an HPA row is named by its HPA rather than collapsing into its namespace", async () => {
    mockRawRows({
      rowsByMetricName: {
        "k8s.hpa.current_replicas": [
          row(10, {
            "resource.k8s.namespace.name": "shop",
            "resource.k8s.hpa.name": "checkout",
          }),
          row(4, {
            "resource.k8s.namespace.name": "shop",
            "resource.k8s.hpa.name": "cart",
          }),
        ],
      },
    });

    const step: MonitorStep = new MonitorStep();
    step.setKubernetesMonitor({
      ...MonitorStepKubernetesMonitorUtil.getDefault(),
      clusterIdentifier: "prod-cluster",
      metricViewConfig: {
        queryConfigs: [
          queryConfig({
            alias: "replicas",
            metricName: "k8s.hpa.current_replicas",
          }),
        ],
        formulaConfigs: [],
      },
    });

    const response: MetricMonitorResponse = await monitorKubernetes({
      monitorStep: step,
      monitorId,
      projectId,
    });

    expect(
      response.kubernetesResourceBreakdowns![0]!.affectedResources.map(
        (resource: KubernetesAffectedResource) => {
          return [resource.workloadType, resource.workloadName];
        },
      ),
    ).toEqual([
      ["HorizontalPodAutoscaler", "checkout"],
      ["HorizontalPodAutoscaler", "cart"],
    ]);
  });
});

describe("Proxmox: one breakdown per query", () => {
  test("pve-node-high-memory returns used AND total, tagged, with highest and lowest per node", async () => {
    const pve1: JSONObject = {
      id: "node/pve1",
      "pve.scope": "node",
      "pve.type": "node",
      "resource.proxmox.cluster.name": "pve-prod",
    };

    mockRawRows({
      rowsByMetricName: {
        pve_memory_usage_bytes: [row(60e9, pve1), row(50e9, pve1)],
        pve_memory_size_bytes: [row(64e9, pve1), row(64e9, pve1)],
      },
    });
    mockDeclaredUnits({
      pve_memory_usage_bytes: "bytes",
      pve_memory_size_bytes: "bytes",
    });

    const step: MonitorStep = getProxmoxAlertTemplateById(
      "pve-node-high-memory",
    )!.getMonitorStep({ ...templateArgs, clusterIdentifier: "pve-prod" });

    const response: MetricMonitorResponse = await monitorProxmox({
      monitorStep: step,
      monitorId,
      projectId,
    });

    expect(response.proxmoxResourceBreakdown).toBeUndefined();

    const breakdowns: Array<ProxmoxResourceBreakdown> =
      response.proxmoxResourceBreakdowns!;

    expect(
      breakdowns.map((breakdown: ProxmoxResourceBreakdown) => {
        return [breakdown.metricAlias, breakdown.metricName];
      }),
    ).toEqual([
      ["used_mem", "pve_memory_usage_bytes"],
      ["total_mem", "pve_memory_size_bytes"],
    ]);

    for (const breakdown of breakdowns) {
      expect(breakdown.clusterName).toBe("pve-prod");
      expect(breakdown.metricUnit).toBe(
        PlatformMetricUnitUtil.getMetricUnit({
          platform: "proxmox",
          metricName: breakdown.metricName,
          declaredUnit: "bytes",
        }),
      );
      expect(breakdown.metricUnit).toBe("bytes");
    }

    expect(breakdowns[0]!.affectedResources).toEqual([
      {
        resourceId: "node/pve1",
        resourceName: undefined,
        resourceType: "node",
        scope: "node",
        nodeName: undefined,
        metricValue: 60e9,
        lowestMetricValue: 50e9,
      },
    ]);

    expect(response.nativeUnitsByMetricName).toEqual({
      pve_memory_usage_bytes: "bytes",
      pve_memory_size_bytes: "bytes",
    });
  });
});

describe("Ceph: one breakdown per query", () => {
  test("ceph-pool-near-full returns stored AND max_avail, tagged, with a numeric pool_id read as a string", async () => {
    mockRawRows({
      rowsByMetricName: {
        ceph_pool_stored: [
          row(900, { pool_id: 3 }),
          row(800, { pool_id: 3 }),
          row(10, { pool_id: 0 }),
        ],
        ceph_pool_max_avail: [row(100, { pool_id: 3 }), row(5, { pool_id: 0 })],
      },
    });

    const step: MonitorStep = getCephAlertTemplateById(
      "ceph-pool-near-full",
    )!.getMonitorStep({ ...templateArgs, clusterIdentifier: "ceph-prod" });

    const response: MetricMonitorResponse = await monitorCeph({
      monitorStep: step,
      monitorId,
      projectId,
    });

    expect(response.cephResourceBreakdown).toBeUndefined();

    const breakdowns: Array<CephResourceBreakdown> =
      response.cephResourceBreakdowns!;

    expect(
      breakdowns.map((breakdown: CephResourceBreakdown) => {
        return [breakdown.metricAlias, breakdown.metricName];
      }),
    ).toEqual([
      ["pool_stored", "ceph_pool_stored"],
      ["pool_max_avail", "ceph_pool_max_avail"],
    ]);

    for (const breakdown of breakdowns) {
      expect(breakdown.clusterName).toBe("ceph-prod");
      // No MetricType row: the catalog alone names the unit.
      expect(breakdown.metricUnit).toBe(
        PlatformMetricUnitUtil.getMetricUnit({
          platform: "ceph",
          metricName: breakdown.metricName,
        }),
      );
    }

    expect(breakdowns[0]!.affectedResources).toEqual([
      {
        daemon: undefined,
        poolId: "3",
        poolName: undefined,
        hostname: undefined,
        metricValue: 900,
        lowestMetricValue: 800,
      },
      // pool 0 is a real pool, not a missing id.
      {
        daemon: undefined,
        poolId: "0",
        poolName: undefined,
        hostname: undefined,
        metricValue: 10,
        lowestMetricValue: 10,
      },
    ]);
  });
});

describe("VMware and Docker Swarm: single-query templates", () => {
  test("a VMware template yields one breakdown tagged with its alias and the catalog unit", async () => {
    const esx01: JSONObject = {
      "resource.vmware.vcenter.name": "vcsa-prod",
      "resource.vcenter.datacenter.name": "DC1",
      "resource.vcenter.host.name": "esx-01",
    };

    mockRawRows({
      rowsByMetricName: {
        "vcenter.host.cpu.utilization": [row(97.5, esx01), row(40, esx01)],
      },
    });
    mockDeclaredUnits({ "vcenter.host.cpu.utilization": "%" });

    const step: MonitorStep = getVMwareAlertTemplateById(
      "vmware-host-cpu-saturation",
    )!.getMonitorStep({ ...templateArgs, vcenterIdentifier: "vcsa-prod" });

    const response: MetricMonitorResponse = await monitorVMware({
      monitorStep: step,
      monitorId,
      projectId,
    });

    expect(response.vmwareResourceBreakdown).toBeUndefined();

    const breakdowns: Array<VMwareResourceBreakdown> =
      response.vmwareResourceBreakdowns!;
    expect(breakdowns).toHaveLength(1);
    expect(breakdowns[0]!.metricAlias).toBe(stepQueryAliases(step)[0]);
    expect(breakdowns[0]!.vcenterName).toBe("vcsa-prod");
    expect(breakdowns[0]!.metricUnit).toBe("%");
    expect(breakdowns[0]!.affectedResources).toHaveLength(1);
    expect(breakdowns[0]!.affectedResources[0]!.hostName).toBe("esx-01");
    expect(breakdowns[0]!.affectedResources[0]!.metricValue).toBe(97.5);
    expect(breakdowns[0]!.affectedResources[0]!.lowestMetricValue).toBe(40);

    expect(response.nativeUnitsByMetricName).toEqual({
      "vcenter.host.cpu.utilization": "%",
    });
  });

  test("a Docker Swarm template yields one breakdown tagged, and its unit is the catalog's % despite a declared '1'", async () => {
    const task: JSONObject = {
      "resource.docker.swarm.cluster.name": "swarm-prod",
      "resource.container.name": "web.1.abc123",
      "resource.container.image.name": "nginx:1.27",
      "docker.swarm.node.name": "worker-1",
      "docker.swarm.service.name": "web",
    };

    mockRawRows({
      rowsByMetricName: {
        "container.cpu.utilization": [row(90, task), row(70, task)],
      },
    });
    mockDeclaredUnits({ "container.cpu.utilization": "1" });

    const step: MonitorStep = getDockerSwarmAlertTemplateById(
      "docker-swarm-high-cpu",
    )!.getMonitorStep({ ...templateArgs, clusterIdentifier: "swarm-prod" });

    const response: MetricMonitorResponse = await monitorDockerSwarm({
      monitorStep: step,
      monitorId,
      projectId,
    });

    expect(response.dockerSwarmResourceBreakdown).toBeUndefined();

    const breakdowns: Array<DockerSwarmResourceBreakdown> =
      response.dockerSwarmResourceBreakdowns!;
    expect(breakdowns).toHaveLength(1);
    expect(breakdowns[0]!.metricAlias).toBe("container_cpu");
    expect(breakdowns[0]!.clusterName).toBe("swarm-prod");
    expect(breakdowns[0]!.metricUnit).toBe("%");
    expect(breakdowns[0]!.affectedResources).toEqual([
      {
        containerName: "web.1.abc123",
        containerImage: "nginx:1.27",
        nodeName: "worker-1",
        serviceName: "web",
        metricValue: 90,
        lowestMetricValue: 70,
      },
    ]);

    expect(response.nativeUnitsByMetricName).toEqual({
      "container.cpu.utilization": "%",
    });
  });
});

describe("nativeUnitsByMetricName for the container, host and IoT monitors", () => {
  test("Docker: container.cpu.utilization is '%' from the catalog, not the declared '1'", async () => {
    mockDeclaredUnits({ "container.cpu.utilization": "1" });

    const response: MetricMonitorResponse = await monitorDocker({
      monitorStep: getDockerAlertTemplateById(
        "docker-high-cpu",
      )!.getMonitorStep({ ...templateArgs, hostIdentifier: "docker-host-1" }),
      monitorId,
      projectId,
    });

    expect(response.nativeUnitsByMetricName).toEqual({
      "container.cpu.utilization": "%",
    });
  });

  test("Docker: query results still convert FROM the declared unit, never the catalog's", async () => {
    mockDeclaredUnits({ "container.cpu.utilization": "1" });

    const converterSpy: jest.SpiedFunction<
      typeof MetricResultUnitConverter.convertQueryResultsToDisplayUnit
    > = jest.spyOn(
      MetricResultUnitConverter,
      "convertQueryResultsToDisplayUnit",
    );

    await monitorDocker({
      monitorStep: getDockerAlertTemplateById(
        "docker-high-cpu",
      )!.getMonitorStep({ ...templateArgs, hostIdentifier: "docker-host-1" }),
      monitorId,
      projectId,
    });

    expect(converterSpy).toHaveBeenCalledTimes(1);

    const declaredUnits: Map<string, string> =
      converterSpy.mock.calls[0]![0].nativeUnitByMetricName;
    expect(declaredUnits).toBeInstanceOf(Map);
    expect(Array.from(declaredUnits.entries())).toEqual([
      ["container.cpu.utilization", "1"],
    ]);
  });

  test("Host: system.memory.usage declared 'By' reads as the catalog's bytes", async () => {
    mockDeclaredUnits({
      "system.memory.usage": "By",
      "system.cpu.load_average.1m": "{thread}",
    });

    const step: MonitorStep = new MonitorStep();
    step.setHostMonitor({
      ...MonitorStepHostMonitorUtil.getDefault(),
      hostIdentifier: "web-01",
      metricViewConfig: {
        queryConfigs: [
          queryConfig({ alias: "mem", metricName: "system.memory.usage" }),
          // Catalog "count" names no dimension: defer to the declared unit.
          queryConfig({
            alias: "load",
            metricName: "system.cpu.load_average.1m",
          }),
        ],
        formulaConfigs: [],
      },
    });

    const response: MetricMonitorResponse = await monitorHost({
      monitorStep: step,
      monitorId,
      projectId,
    });

    expect(response.nativeUnitsByMetricName).toEqual({
      "system.memory.usage": "bytes",
      "system.cpu.load_average.1m": "{thread}",
    });
  });

  test("Podman: container.memory.percent is '%' from the catalog, not the declared '1'", async () => {
    mockDeclaredUnits({ "container.memory.percent": "1" });

    const response: MetricMonitorResponse = await monitorPodman({
      monitorStep: getPodmanAlertTemplateById(
        "podman-high-memory",
      )!.getMonitorStep({ ...templateArgs, hostIdentifier: "podman-host-1" }),
      monitorId,
      projectId,
    });

    expect(response.nativeUnitsByMetricName).toEqual({
      "container.memory.percent": "%",
    });
  });

  test("IoT: a catalog 'ratio' becomes UCUM '1'; a metric without a catalog unit keeps the declared one", async () => {
    mockDeclaredUnits({ iot_device_up: "{device}" });

    const cpu: MetricMonitorResponse = await monitorIoT({
      monitorStep: getIoTAlertTemplateById("iot-high-cpu")!.getMonitorStep({
        ...templateArgs,
        fleetIdentifier: "fleet-1",
      }),
      monitorId,
      projectId,
    });

    expect(cpu.nativeUnitsByMetricName).toEqual({
      iot_cpu_usage_ratio: "1",
    });

    const offline: MetricMonitorResponse = await monitorIoT({
      monitorStep: getIoTAlertTemplateById(
        "iot-device-offline",
      )!.getMonitorStep({ ...templateArgs, fleetIdentifier: "fleet-1" }),
      monitorId,
      projectId,
    });

    expect(offline.nativeUnitsByMetricName).toEqual({
      iot_device_up: "{device}",
    });
  });

  test("Metrics: a generic monitor keeps the declared units exactly as before", async () => {
    mockDeclaredUnits({
      "container.cpu.utilization": "1",
      "http.server.duration": "ms",
    });

    const step: MonitorStep = new MonitorStep();
    step.setMetricMonitor({
      rollingTime: RollingTime.Past5Minutes,
      metricViewConfig: {
        queryConfigs: [
          queryConfig({
            alias: "cpu",
            metricName: "container.cpu.utilization",
          }),
          queryConfig({ alias: "latency", metricName: "HTTP.Server.Duration" }),
          queryConfig({ alias: "unknown", metricName: "no.unit.anywhere" }),
        ],
        formulaConfigs: [],
      },
    });

    const response: MetricMonitorResponse = await monitorMetric({
      monitorStep: step,
      monitorId,
      projectId,
    });

    // No catalog for a generic monitor: the declared "1" is NOT turned into "%".
    expect(response.nativeUnitsByMetricName).toEqual({
      "container.cpu.utilization": "1",
      "http.server.duration": "ms",
    });
  });
});

/*
 * The breakdown scan used to carry its own inline copy of each platform's
 * attribute → resource mapping. It now uses PlatformResourceIdentity, the
 * one copy the criteria evaluator reads too. These are the old inline
 * mappings, verbatim in behaviour, so the refactor is checked against what
 * the worker actually produced before it — not against the new code.
 */
type LegacyResource = JSONObject & { metricValue: number };

function legacyValue(value: unknown): number {
  return typeof value === "number" ? value : Number(value) || 0;
}

function legacyKeepHighest(
  rows: Array<RawRow>,
  toResource: (attrs: JSONObject) => { key: string; resource: JSONObject },
): Array<LegacyResource> {
  const map: Map<string, LegacyResource> = new Map();

  for (const raw of rows) {
    const { key, resource } = toResource(raw.attributes || {});
    const metricValue: number = legacyValue(raw.value);
    const existing: LegacyResource | undefined = map.get(key);

    if (!existing || metricValue > existing.metricValue) {
      map.set(key, { ...resource, metricValue: metricValue });
    }
  }

  return Array.from(map.values());
}

function legacyKubernetes(rows: Array<RawRow>): Array<LegacyResource> {
  const map: Map<string, LegacyResource> = new Map();

  for (const raw of rows) {
    const a: JSONObject = raw.attributes || {};
    const podName: string | undefined = a["resource.k8s.pod.name"] as string;
    const namespace: string | undefined = a[
      "resource.k8s.namespace.name"
    ] as string;
    const nodeName: string | undefined = a["resource.k8s.node.name"] as string;
    const containerName: string | undefined = a[
      "resource.k8s.container.name"
    ] as string;

    let workloadType: string | undefined = undefined;
    let workloadName: string | undefined = undefined;

    if (a["resource.k8s.deployment.name"]) {
      workloadType = "Deployment";
      workloadName = a["resource.k8s.deployment.name"] as string;
    } else if (a["resource.k8s.statefulset.name"]) {
      workloadType = "StatefulSet";
      workloadName = a["resource.k8s.statefulset.name"] as string;
    } else if (a["resource.k8s.daemonset.name"]) {
      workloadType = "DaemonSet";
      workloadName = a["resource.k8s.daemonset.name"] as string;
    } else if (a["resource.k8s.job.name"]) {
      workloadType = "Job";
      workloadName = a["resource.k8s.job.name"] as string;
    } else if (a["resource.k8s.cronjob.name"]) {
      workloadType = "CronJob";
      workloadName = a["resource.k8s.cronjob.name"] as string;
    } else if (a["resource.k8s.replicaset.name"]) {
      workloadType = "ReplicaSet";
      workloadName = a["resource.k8s.replicaset.name"] as string;
    }

    const key: string = [
      podName || "",
      namespace || "",
      nodeName || "",
      containerName || "",
      workloadName || "",
    ].join("|");

    const metricValue: number = legacyValue(raw.value);
    const existing: LegacyResource | undefined = map.get(key);

    if (!existing) {
      map.set(key, {
        podName: podName || undefined,
        namespace: namespace || undefined,
        nodeName: nodeName || undefined,
        containerName: containerName || undefined,
        workloadType: workloadType || undefined,
        workloadName: workloadName || undefined,
        metricValue: metricValue,
        lowestMetricValue: metricValue,
      } as LegacyResource);
    } else {
      existing["lowestMetricValue"] = Math.min(
        (existing["lowestMetricValue"] as number) ?? existing.metricValue,
        metricValue,
      );
      existing.metricValue = Math.max(existing.metricValue, metricValue);
    }
  }

  return Array.from(map.values());
}

function legacyProxmox(rows: Array<RawRow>): Array<LegacyResource> {
  return legacyKeepHighest(rows, (a: JSONObject) => {
    const resourceId: string | undefined = a["id"] as string;
    const resourceName: string | undefined = a["name"] as string;
    const nodeName: string | undefined = a["node"] as string;
    return {
      key: [resourceId || "", resourceName || "", nodeName || ""].join("|"),
      resource: {
        resourceId: resourceId || undefined,
        resourceName: resourceName || undefined,
        resourceType: (a["pve.type"] as string) || undefined,
        scope: (a["pve.scope"] as string) || undefined,
        nodeName: nodeName || undefined,
      },
    };
  });
}

function legacyVMware(rows: Array<RawRow>): Array<LegacyResource> {
  return legacyKeepHighest(rows, (a: JSONObject) => {
    const readAttr: (key: string) => string | undefined = (
      key: string,
    ): string | undefined => {
      const value: unknown = a[key];
      return typeof value === "string" && value.length > 0 ? value : undefined;
    };

    const datacenterName: string | undefined = readAttr(
      "resource.vcenter.datacenter.name",
    );
    const clusterName: string | undefined = readAttr(
      "resource.vcenter.cluster.name",
    );
    const hostName: string | undefined = readAttr("resource.vcenter.host.name");
    const vmName: string | undefined =
      readAttr("resource.vcenter.vm.name") ||
      readAttr("resource.vcenter.vm_template.name");
    const vmId: string | undefined =
      readAttr("resource.vcenter.vm.id") ||
      readAttr("resource.vcenter.vm_template.id");
    const datastoreName: string | undefined = readAttr(
      "resource.vcenter.datastore.name",
    );
    const resourcePoolName: string | undefined = readAttr(
      "resource.vcenter.resource_pool.name",
    );
    const resourcePoolPath: string | undefined = readAttr(
      "resource.vcenter.resource_pool.inventory_path",
    );

    return {
      key: [
        datacenterName || "",
        clusterName || "",
        hostName || "",
        vmId || "",
        vmName || "",
        datastoreName || "",
        resourcePoolPath || resourcePoolName || "",
      ].join("|"),
      resource: {
        datacenterName,
        clusterName,
        hostName,
        vmName,
        vmId,
        datastoreName,
        resourcePoolName,
        resourcePoolPath,
      },
    };
  });
}

function legacyDockerSwarm(rows: Array<RawRow>): Array<LegacyResource> {
  return legacyKeepHighest(rows, (a: JSONObject) => {
    const containerName: string | undefined = a[
      "resource.container.name"
    ] as string;
    const containerImage: string | undefined = a[
      "resource.container.image.name"
    ] as string;
    const nodeName: string | undefined = a["docker.swarm.node.name"] as string;
    const serviceName: string | undefined = a[
      "docker.swarm.service.name"
    ] as string;
    return {
      key: [
        containerName || "",
        containerImage || "",
        nodeName || "",
        serviceName || "",
      ].join("|"),
      resource: {
        containerName: containerName || undefined,
        containerImage: containerImage || undefined,
        nodeName: nodeName || undefined,
        serviceName: serviceName || undefined,
      },
    };
  });
}

function legacyCeph(rows: Array<RawRow>): Array<LegacyResource> {
  return legacyKeepHighest(rows, (a: JSONObject) => {
    const daemon: string | undefined = a["ceph_daemon"] as string;
    const poolIdRaw: unknown = a["pool_id"];
    const poolId: string | undefined =
      poolIdRaw !== undefined && poolIdRaw !== null
        ? String(poolIdRaw)
        : undefined;
    const poolName: string | undefined = a["name"] as string;
    const hostname: string | undefined = a["hostname"] as string;
    return {
      key: [daemon || "", poolId || "", poolName || "", hostname || ""].join(
        "|",
      ),
      resource: {
        daemon: daemon || undefined,
        poolId: poolId || undefined,
        poolName: poolName || undefined,
        hostname: hostname || undefined,
      },
    };
  });
}

/*
 * The old non-Kubernetes scans kept only the highest value, so parity is
 * checked on identity + metricValue; lowestMetricValue is the addition.
 */
function withoutLowest(
  resources: Array<{
    metricValue: number;
    lowestMetricValue?: number | undefined;
  }>,
): Array<JSONObject> {
  return resources.map(
    (resource: {
      metricValue: number;
      lowestMetricValue?: number | undefined;
    }) => {
      const copy: JSONObject = { ...(resource as unknown as JSONObject) };
      delete copy["lowestMetricValue"];
      return copy;
    },
  );
}

async function scanOnce(input: {
  monitor: MonitorFunction;
  step: MonitorStep;
  rows: Array<RawRow>;
}): Promise<MetricMonitorResponse> {
  metricFindBy.mockResolvedValue(input.rows);

  const response: MetricMonitorResponse = await input.monitor({
    monitorStep: input.step,
    monitorId,
    projectId,
  });

  // Ungrouped: the only raw fetch is the limit-100 breakdown scan.
  expect(metricFindBy).toHaveBeenCalledTimes(1);
  expect((metricFindBy.mock.calls[0]![0] as FindByArgs).limit).toBe(100);

  return response;
}

describe("identity parity with the pre-refactor inline mappings", () => {
  test("Kubernetes: container, pod and workload rows", async () => {
    const rows: Array<RawRow> = [
      row(0.8, {
        "resource.k8s.namespace.name": "shop",
        "resource.k8s.pod.name": "checkout-7d9f-2xk",
        "resource.k8s.container.name": "app",
        "resource.k8s.node.name": "node-a",
        "resource.k8s.deployment.name": "checkout",
        "resource.k8s.replicaset.name": "checkout-7d9f",
      }),
      row(0.3, {
        "resource.k8s.namespace.name": "shop",
        "resource.k8s.pod.name": "checkout-7d9f-2xk",
        "resource.k8s.container.name": "app",
        "resource.k8s.node.name": "node-a",
        "resource.k8s.deployment.name": "checkout",
        "resource.k8s.replicaset.name": "checkout-7d9f",
      }),
      row(0.5, {
        "resource.k8s.namespace.name": "shop",
        "resource.k8s.pod.name": "checkout-7d9f-2xk",
        "resource.k8s.container.name": "istio-proxy",
        "resource.k8s.node.name": "node-a",
        "resource.k8s.deployment.name": "checkout",
      }),
      row(2, {
        "resource.k8s.namespace.name": "data",
        "resource.k8s.pod.name": "db-0",
        "resource.k8s.statefulset.name": "db",
      }),
      row(1, {
        "resource.k8s.namespace.name": "ops",
        "resource.k8s.pod.name": "backup-28123",
        "resource.k8s.job.name": "backup-28123",
        "resource.k8s.cronjob.name": "backup",
      }),
      row(3, {
        "resource.k8s.namespace.name": "kube-system",
        "resource.k8s.pod.name": "fluentd-abcde",
        "resource.k8s.daemonset.name": "fluentd",
        "resource.k8s.node.name": "",
      }),
      row(7, { "resource.k8s.node.name": "node-b" }),
      row(9, {}),
    ];

    const step: MonitorStep = new MonitorStep();
    step.setKubernetesMonitor({
      ...MonitorStepKubernetesMonitorUtil.getDefault(),
      clusterIdentifier: "prod-cluster",
      metricViewConfig: {
        queryConfigs: [
          queryConfig({ alias: "cpu", metricName: "k8s.container.cpu" }),
        ],
        formulaConfigs: [],
      },
    });

    const response: MetricMonitorResponse = await scanOnce({
      monitor: monitorKubernetes,
      step,
      rows,
    });

    // Kubernetes already tracked the lowest value, so parity is exact.
    expect(
      response.kubernetesResourceBreakdowns![0]!.affectedResources,
    ).toEqual(legacyKubernetes(rows));
  });

  test("Proxmox: node, guest and storage rows", async () => {
    const rows: Array<RawRow> = [
      row(0.9, { id: "node/pve1", "pve.scope": "node", "pve.type": "node" }),
      row(0.95, { id: "node/pve1", "pve.scope": "node", "pve.type": "node" }),
      row(0.4, { id: "qemu/100", "pve.scope": "guest", "pve.type": "qemu" }),
      row(1, { id: "qemu/100", name: "web-vm", node: "pve1" }),
      row(0.7, {
        id: "storage/pve1/local",
        "pve.scope": "storage",
        "pve.type": "storage",
      }),
    ];

    const step: MonitorStep = new MonitorStep();
    step.setProxmoxMonitor({
      ...MonitorStepProxmoxMonitorUtil.getDefault(),
      clusterIdentifier: "pve-prod",
      metricViewConfig: {
        queryConfigs: [
          queryConfig({ alias: "cpu", metricName: "pve_cpu_usage_ratio" }),
        ],
        formulaConfigs: [],
      },
    });

    const response: MetricMonitorResponse = await scanOnce({
      monitor: monitorProxmox,
      step,
      rows,
    });

    const affected: Array<ProxmoxAffectedResource> =
      response.proxmoxResourceBreakdowns![0]!.affectedResources;
    expect(withoutLowest(affected)).toEqual(legacyProxmox(rows));
    expect(affected[0]!.lowestMetricValue).toBe(0.9);
  });

  test("VMware: host, VM, VM template, datastore and resource pool rows", async () => {
    const rows: Array<RawRow> = [
      row(80, {
        "resource.vcenter.datacenter.name": "DC1",
        "resource.vcenter.cluster.name": "prod",
        "resource.vcenter.host.name": "esx-01",
      }),
      row(90, {
        "resource.vcenter.datacenter.name": "DC1",
        "resource.vcenter.cluster.name": "prod",
        "resource.vcenter.host.name": "esx-01",
      }),
      row(55, {
        "resource.vcenter.datacenter.name": "DC1",
        "resource.vcenter.host.name": "esx-01",
        "resource.vcenter.vm.name": "db-01",
        "resource.vcenter.vm.id": "5029-db01",
        "resource.vcenter.resource_pool.name": "batch",
        "resource.vcenter.resource_pool.inventory_path":
          "/DC1/host/prod/Resources/batch",
      }),
      row(1073741824, {
        "resource.vcenter.datacenter.name": "DC1",
        "resource.vcenter.host.name": "esx-01",
        "resource.vcenter.vm_template.name": "ubuntu-golden",
        "resource.vcenter.vm_template.id": "5029-tmpl",
      }),
      row(70, {
        "resource.vcenter.datacenter.name": "DC1",
        "resource.vcenter.datastore.name": "vsan-ds-01",
      }),
      row(12, {
        "resource.vcenter.datacenter.name": "DC1",
        "resource.vcenter.resource_pool.name": "batch",
        "resource.vcenter.host.name": "",
      }),
    ];

    const step: MonitorStep = new MonitorStep();
    step.setVMwareMonitor({
      ...MonitorStepVMwareMonitorUtil.getDefault(),
      vcenterIdentifier: "vcsa-prod",
      metricViewConfig: {
        queryConfigs: [
          queryConfig({
            alias: "x",
            metricName: "vcenter.host.cpu.utilization",
          }),
        ],
        formulaConfigs: [],
      },
    });

    const response: MetricMonitorResponse = await scanOnce({
      monitor: monitorVMware,
      step,
      rows,
    });

    const affected: Array<VMwareAffectedResource> =
      response.vmwareResourceBreakdowns![0]!.affectedResources;
    expect(withoutLowest(affected)).toEqual(legacyVMware(rows));
    expect(affected[0]!.metricValue).toBe(90);
    expect(affected[0]!.lowestMetricValue).toBe(80);
  });

  test("Docker Swarm: task rows with and without the swarm labels", async () => {
    const rows: Array<RawRow> = [
      row(60, {
        "resource.container.name": "web.1.abc",
        "resource.container.image.name": "nginx:1.27",
        "docker.swarm.node.name": "worker-1",
        "docker.swarm.service.name": "web",
      }),
      row(95, {
        "resource.container.name": "web.1.abc",
        "resource.container.image.name": "nginx:1.27",
        "docker.swarm.node.name": "worker-1",
        "docker.swarm.service.name": "web",
      }),
      row(20, {
        "resource.container.name": "api.2.def",
        "resource.container.image.name": "api:3",
      }),
      // The bare key is NOT the identity; this row is anonymous.
      row(5, { "container.name": "legacy.1.xyz" }),
    ];

    const step: MonitorStep = new MonitorStep();
    step.setDockerSwarmMonitor({
      ...MonitorStepDockerSwarmMonitorUtil.getDefault(),
      clusterIdentifier: "swarm-prod",
      metricViewConfig: {
        queryConfigs: [
          queryConfig({
            alias: "cpu",
            metricName: "container.cpu.utilization",
          }),
        ],
        formulaConfigs: [],
      },
    });

    const response: MetricMonitorResponse = await scanOnce({
      monitor: monitorDockerSwarm,
      step,
      rows,
    });

    const affected: Array<DockerSwarmAffectedResource> =
      response.dockerSwarmResourceBreakdowns![0]!.affectedResources;
    expect(withoutLowest(affected)).toEqual(legacyDockerSwarm(rows));
    expect(affected[0]!.lowestMetricValue).toBe(60);
  });

  test("Ceph: daemon, numeric and string pool_id, and metadata rows", async () => {
    const rows: Array<RawRow> = [
      row(3, { ceph_daemon: "osd.3" }),
      row(8, { ceph_daemon: "osd.3" }),
      row(1, { ceph_daemon: "mon.a", hostname: "ceph-mon-1" }),
      row(500, { pool_id: 7 }),
      row(600, { pool_id: "7" }),
      row(1, { pool_id: 0 }),
      row(1, { pool_id: 7, name: "rbd" }),
    ];

    const step: MonitorStep = new MonitorStep();
    step.setCephMonitor({
      ...MonitorStepCephMonitorUtil.getDefault(),
      clusterIdentifier: "ceph-prod",
      metricViewConfig: {
        queryConfigs: [
          queryConfig({ alias: "x", metricName: "ceph_osd_apply_latency_ms" }),
        ],
        formulaConfigs: [],
      },
    });

    const response: MetricMonitorResponse = await scanOnce({
      monitor: monitorCeph,
      step,
      rows,
    });

    const affected: Array<CephAffectedResource> =
      response.cephResourceBreakdowns![0]!.affectedResources;
    expect(withoutLowest(affected)).toEqual(legacyCeph(rows));

    // A numeric 7 and a string "7" are the same pool.
    const pool7: CephAffectedResource | undefined = affected.find(
      (resource: CephAffectedResource) => {
        return resource.poolId === "7" && !resource.poolName;
      },
    );
    expect(pool7!.metricValue).toBe(600);
    expect(pool7!.lowestMetricValue).toBe(500);
  });
});

describe("lowestMetricValue across every platform", () => {
  const cases: Array<{
    name: string;
    monitor: MonitorFunction;
    step: () => MonitorStep;
    attributes: JSONObject;
    breakdowns: (response: MetricMonitorResponse) =>
      | Array<{
          affectedResources: Array<{
            metricValue: number;
            lowestMetricValue?: number | undefined;
          }>;
        }>
      | undefined;
  }> = [
    {
      name: "Kubernetes",
      monitor: monitorKubernetes,
      step: (): MonitorStep => {
        const step: MonitorStep = new MonitorStep();
        step.setKubernetesMonitor({
          ...MonitorStepKubernetesMonitorUtil.getDefault(),
          clusterIdentifier: "c",
          metricViewConfig: {
            queryConfigs: [queryConfig({ alias: "a", metricName: "m" })],
            formulaConfigs: [],
          },
        });
        return step;
      },
      attributes: { "resource.k8s.node.name": "node-a" },
      breakdowns: (response: MetricMonitorResponse) => {
        return response.kubernetesResourceBreakdowns;
      },
    },
    {
      name: "Proxmox",
      monitor: monitorProxmox,
      step: (): MonitorStep => {
        const step: MonitorStep = new MonitorStep();
        step.setProxmoxMonitor({
          ...MonitorStepProxmoxMonitorUtil.getDefault(),
          clusterIdentifier: "c",
          metricViewConfig: {
            queryConfigs: [queryConfig({ alias: "a", metricName: "m" })],
            formulaConfigs: [],
          },
        });
        return step;
      },
      attributes: { id: "node/pve1" },
      breakdowns: (response: MetricMonitorResponse) => {
        return response.proxmoxResourceBreakdowns;
      },
    },
    {
      name: "VMware",
      monitor: monitorVMware,
      step: (): MonitorStep => {
        const step: MonitorStep = new MonitorStep();
        step.setVMwareMonitor({
          ...MonitorStepVMwareMonitorUtil.getDefault(),
          vcenterIdentifier: "c",
          metricViewConfig: {
            queryConfigs: [queryConfig({ alias: "a", metricName: "m" })],
            formulaConfigs: [],
          },
        });
        return step;
      },
      attributes: { "resource.vcenter.host.name": "esx-01" },
      breakdowns: (response: MetricMonitorResponse) => {
        return response.vmwareResourceBreakdowns;
      },
    },
    {
      name: "Docker Swarm",
      monitor: monitorDockerSwarm,
      step: (): MonitorStep => {
        const step: MonitorStep = new MonitorStep();
        step.setDockerSwarmMonitor({
          ...MonitorStepDockerSwarmMonitorUtil.getDefault(),
          clusterIdentifier: "c",
          metricViewConfig: {
            queryConfigs: [queryConfig({ alias: "a", metricName: "m" })],
            formulaConfigs: [],
          },
        });
        return step;
      },
      attributes: { "resource.container.name": "web.1.abc" },
      breakdowns: (response: MetricMonitorResponse) => {
        return response.dockerSwarmResourceBreakdowns;
      },
    },
    {
      name: "Ceph",
      monitor: monitorCeph,
      step: (): MonitorStep => {
        const step: MonitorStep = new MonitorStep();
        step.setCephMonitor({
          ...MonitorStepCephMonitorUtil.getDefault(),
          clusterIdentifier: "c",
          metricViewConfig: {
            queryConfigs: [queryConfig({ alias: "a", metricName: "m" })],
            formulaConfigs: [],
          },
        });
        return step;
      },
      attributes: { ceph_daemon: "osd.1" },
      breakdowns: (response: MetricMonitorResponse) => {
        return response.cephResourceBreakdowns;
      },
    },
  ];

  for (const testCase of cases) {
    test(`${testCase.name}: a resource that dipped to 0 once keeps both its highest and its lowest sample`, async () => {
      // Newest first, as the scan sorts: Ready (1), NotReady (0), Ready (1).
      metricFindBy.mockResolvedValue([
        row(1, testCase.attributes),
        row(0, testCase.attributes),
        row(1, testCase.attributes),
      ]);

      const response: MetricMonitorResponse = await testCase.monitor({
        monitorStep: testCase.step(),
        monitorId,
        projectId,
      });

      const breakdowns:
        | Array<{
            affectedResources: Array<{
              metricValue: number;
              lowestMetricValue?: number | undefined;
            }>;
          }>
        | undefined = testCase.breakdowns(response);

      expect(breakdowns).toHaveLength(1);
      expect(breakdowns![0]!.affectedResources).toHaveLength(1);
      expect(breakdowns![0]!.affectedResources[0]!.metricValue).toBe(1);
      expect(breakdowns![0]!.affectedResources[0]!.lowestMetricValue).toBe(0);
    });
  }
});

describe("series breakdown is unaffected by the breakdown refactor", () => {
  test("Proxmox ratio: the per-node formula still divides used by total", async () => {
    const pve1: JSONObject = { id: "node/pve1", "pve.scope": "node" };
    const pve2: JSONObject = { id: "node/pve2", "pve.scope": "node" };

    mockRawRows({
      rowsByMetricName: {
        pve_memory_usage_bytes: [row(60, pve1), row(10, pve2)],
        pve_memory_size_bytes: [row(64, pve1), row(64, pve2)],
      },
    });

    const response: MetricMonitorResponse = await monitorProxmox({
      monitorStep: getProxmoxAlertTemplateById(
        "pve-node-high-memory",
      )!.getMonitorStep({ ...templateArgs, clusterIdentifier: "pve-prod" }),
      monitorId,
      projectId,
    });

    const byNode: Dictionary<number> = {};
    for (const series of response.seriesBreakdown!) {
      const formula: AggregatedResult | undefined = series.aggregatedResults[2];
      byNode[series.labels["id"] as string] = valuesOf(formula)[0]!;
    }

    expect(byNode["node/pve1"]).toBeCloseTo((60 / 64) * 100, 6);
    expect(byNode["node/pve2"]).toBeCloseTo((10 / 64) * 100, 6);
    expect(
      response.seriesBreakdown!.every((series: MetricSeriesResult) => {
        return series.aggregatedResults.length === 3;
      }),
    ).toBe(true);
  });
});
