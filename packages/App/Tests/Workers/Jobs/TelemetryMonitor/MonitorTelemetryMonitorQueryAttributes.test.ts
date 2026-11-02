import Wildcard from "Common/Types/BaseDatabase/Wildcard";
import Dictionary from "Common/Types/Dictionary";
import MonitorStep from "Common/Types/Monitor/MonitorStep";
import ObjectID from "Common/Types/ObjectID";
import { JSONObject } from "Common/Types/JSON";
import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import RollingTime from "Common/Types/RollingTime/RollingTime";
import MetricsAggregationType from "Common/Types/Metrics/MetricsAggregationType";
import MetricQueryConfigData from "Common/Types/Metrics/MetricQueryConfigData";
import MetricMonitorResponse from "Common/Types/Monitor/MetricMonitor/MetricMonitorResponse";

/*
 * WHAT A MONITOR SAYS IT READ.
 *
 * An infrastructure monitor narrows each query to its host, cluster or
 * container here in the worker, where the criteria evaluator cannot see it. The
 * evaluator reads a query's history with the same filters, or it would judge
 * one host against all of them, so every monitor has to say what each query
 * was read with.
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

import MetricService from "Common/Server/Services/MetricService";
import MetricTypeService from "Common/Server/Services/MetricTypeService";
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
  monitorStorageArray,
  monitorVMware,
} from "../../../../FeatureSet/Workers/Jobs/TelemetryMonitor/MonitorTelemetryMonitor";

type MonitorFunction = (data: {
  monitorStep: MonitorStep;
  monitorId: ObjectID;
  projectId: ObjectID;
}) => Promise<MetricMonitorResponse>;

interface MonitorCase {
  name: string;
  run: MonitorFunction;
  // Where the step keeps its settings, and what they name.
  stepKey: string;
  settings: JSONObject;
  // The filter only the worker adds.
  added: Dictionary<unknown>;
}

const CASES: Array<MonitorCase> = [
  {
    name: "Host",
    run: monitorHost,
    stepKey: "hostMonitor",
    settings: { hostIdentifier: "web-1" },
    added: { "resource.host.name": "web-1" },
  },
  {
    name: "Kubernetes",
    run: monitorKubernetes,
    stepKey: "kubernetesMonitor",
    settings: { clusterIdentifier: "prod" },
    added: { "resource.k8s.cluster.name": "prod" },
  },
  {
    name: "Docker",
    run: monitorDocker,
    stepKey: "dockerMonitor",
    settings: { hostIdentifier: "web-1" },
    added: {
      "resource.host.name": "web-1",
      "resource.container.runtime": "docker",
    },
  },
  {
    name: "Podman",
    run: monitorPodman,
    stepKey: "podmanMonitor",
    settings: { hostIdentifier: "web-1" },
    added: {
      "resource.host.name": "web-1",
      "resource.container.runtime": "podman",
    },
  },
  {
    name: "Proxmox",
    run: monitorProxmox,
    stepKey: "proxmoxMonitor",
    settings: { clusterIdentifier: "pve" },
    added: { "resource.proxmox.cluster.name": "pve" },
  },
  {
    name: "VMware",
    run: monitorVMware,
    stepKey: "vmwareMonitor",
    settings: { vcenterIdentifier: "vc-1" },
    added: { "resource.vmware.vcenter.name": "vc-1" },
  },
  {
    name: "IoT",
    run: monitorIoT,
    stepKey: "iotMonitor",
    settings: { fleetIdentifier: "fleet-1" },
    // Matched whatever its case, and handed over as it is matched.
    added: { "resource.iot.fleet.name": new Wildcard<string>(["fleet-1"]) },
  },
  {
    name: "Docker Swarm",
    run: monitorDockerSwarm,
    stepKey: "dockerSwarmMonitor",
    settings: { clusterIdentifier: "swarm-1" },
    added: { "resource.docker.swarm.cluster.name": "swarm-1" },
  },
  {
    name: "Ceph",
    run: monitorCeph,
    stepKey: "cephMonitor",
    settings: { clusterIdentifier: "ceph-1" },
    added: { "resource.ceph.cluster.name": "ceph-1" },
  },
  {
    name: "Storage Array",
    run: monitorStorageArray,
    stepKey: "storageArrayMonitor",
    settings: { arrayIdentifier: "array-1" },
    added: { "resource.storage.array.name": "array-1" },
  },
];

const queryOf: (data: {
  metricName: string;
  attributes?: JSONObject;
}) => MetricQueryConfigData = (data: {
  metricName: string;
  attributes?: JSONObject;
}): MetricQueryConfigData => {
  return {
    metricAliasData: {
      metricVariable: data.metricName,
      title: undefined,
      description: undefined,
      legend: undefined,
      legendUnit: undefined,
    },
    metricQueryData: {
      filterData: {
        metricName: data.metricName,
        aggegationType: MetricsAggregationType.Avg,
        ...(data.attributes ? { attributes: data.attributes } : {}),
      },
    },
  } as unknown as MetricQueryConfigData;
};

const stepOf: (data: {
  stepKey: string;
  settings: JSONObject;
  queryConfigs: Array<MetricQueryConfigData>;
}) => MonitorStep = (data: {
  stepKey: string;
  settings: JSONObject;
  queryConfigs: Array<MetricQueryConfigData>;
}): MonitorStep => {
  const step: MonitorStep = new MonitorStep();

  step.data = {
    id: ObjectID.generate().toString(),
    monitorCriteria: { data: undefined },
    [data.stepKey]: {
      ...data.settings,
      rollingTime: RollingTime.Past5Minutes,
      metricViewConfig: {
        queryConfigs: data.queryConfigs,
        formulaConfigs: [],
      },
    },
  } as unknown as MonitorStep["data"];

  return step;
};

const read: (data: {
  run: MonitorFunction;
  monitorStep: MonitorStep;
}) => Promise<MetricMonitorResponse> = (data: {
  run: MonitorFunction;
  monitorStep: MonitorStep;
}): Promise<MetricMonitorResponse> => {
  return data.run({
    monitorStep: data.monitorStep,
    monitorId: ObjectID.generate(),
    projectId: ObjectID.generate(),
  });
};

describe("what a monitor says it read each query with", () => {
  beforeEach(() => {
    (MetricService.aggregateBy as unknown as jest.Mock<() => unknown>)
      .mockReset()
      .mockResolvedValue({ data: [] });
    (MetricService.findBy as unknown as jest.Mock<() => unknown>)
      .mockReset()
      .mockResolvedValue([]);
    (MetricTypeService.findBy as unknown as jest.Mock<() => unknown>)
      .mockReset()
      .mockResolvedValue([]);
  });

  test.each(CASES)(
    "$name says what it added to the query",
    async (monitor: MonitorCase) => {
      const response: MetricMonitorResponse = await read({
        run: monitor.run,
        monitorStep: stepOf({
          stepKey: monitor.stepKey,
          settings: monitor.settings,
          queryConfigs: [queryOf({ metricName: "a.metric" })],
        }),
      });

      expect(response.queryAttributes).toHaveLength(1);
      expect(response.queryAttributes?.[0]).toMatchObject(monitor.added);
    },
  );

  test.each(CASES)(
    "$name says a query's own filters too, query by query",
    async (monitor: MonitorCase) => {
      const response: MetricMonitorResponse = await read({
        run: monitor.run,
        monitorStep: stepOf({
          stepKey: monitor.stepKey,
          settings: monitor.settings,
          queryConfigs: [
            queryOf({ metricName: "used", attributes: { state: "used" } }),
            queryOf({ metricName: "free", attributes: { state: "free" } }),
          ],
        }),
      });

      expect(response.queryAttributes).toHaveLength(2);
      expect(response.queryAttributes?.[0]).toMatchObject({
        ...monitor.added,
        state: "used",
      });
      expect(response.queryAttributes?.[1]).toMatchObject({
        ...monitor.added,
        state: "free",
      });
    },
  );

  test("a Metrics monitor says what its query filters by", async () => {
    const response: MetricMonitorResponse = await read({
      run: monitorMetric,
      monitorStep: stepOf({
        stepKey: "metricMonitor",
        settings: {},
        queryConfigs: [
          queryOf({ metricName: "a.metric", attributes: { state: "idle" } }),
        ],
      }),
    });

    expect(response.queryAttributes).toEqual([{ state: "idle" }]);
  });

  test("a query read with nothing says nothing, in its place", async () => {
    const response: MetricMonitorResponse = await read({
      run: monitorMetric,
      monitorStep: stepOf({
        stepKey: "metricMonitor",
        settings: {},
        queryConfigs: [
          queryOf({ metricName: "a.metric" }),
          queryOf({ metricName: "b.metric", attributes: { state: "idle" } }),
        ],
      }),
    });

    expect(response.queryAttributes).toEqual([undefined, { state: "idle" }]);
  });

  test("what it says is what the read was given", async () => {
    const response: MetricMonitorResponse = await read({
      run: monitorHost,
      monitorStep: stepOf({
        stepKey: "hostMonitor",
        settings: { hostIdentifier: "web-1" },
        queryConfigs: [queryOf({ metricName: "a.metric" })],
      }),
    });

    const aggregateBy: jest.Mock = MetricService.aggregateBy as never;

    expect(response.queryAttributes?.[0]).toEqual(
      (
        aggregateBy.mock.calls[0]![0] as {
          query: { attributes: JSONObject };
        }
      ).query.attributes,
    );
  });

  // It is written to the monitor's log with the rest of the response.
  test("it survives being written down", async () => {
    const response: MetricMonitorResponse = await read({
      run: monitorHost,
      monitorStep: stepOf({
        stepKey: "hostMonitor",
        settings: { hostIdentifier: "web-1" },
        queryConfigs: [queryOf({ metricName: "a.metric" })],
      }),
    });

    expect(JSON.parse(JSON.stringify(response.queryAttributes))).toEqual([
      { "resource.host.name": "web-1" },
    ]);
  });
});
