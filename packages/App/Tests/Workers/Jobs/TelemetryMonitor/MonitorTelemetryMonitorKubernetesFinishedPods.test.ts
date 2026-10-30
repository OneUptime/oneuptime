import MonitorStep from "Common/Types/Monitor/MonitorStep";
import ObjectID from "Common/Types/ObjectID";
import IncludesNone from "Common/Types/BaseDatabase/IncludesNone";
import AggregatedResult from "Common/Types/BaseDatabase/AggregatedResult";
import MetricMonitorResponse from "Common/Types/Monitor/MetricMonitor/MetricMonitorResponse";
import { getKubernetesAlertTemplateById } from "Common/Types/Monitor/KubernetesAlertTemplates";
import { describe, expect, test, beforeEach, afterEach } from "@jest/globals";

/*
 * "High Node CPU/Memory Request Commitment" sums `k8s.container.*_request`
 * per node, and the k8s_cluster receiver reports a request for every
 * container of every pod the API still holds - a Job's pod that ran to
 * completion included. The scheduler counts only pods that have not
 * finished, so a node that had run a few Jobs read as committed past 90%.
 * The worker now reads which pods are Succeeded or Failed (`k8s.pod.phase`
 * 3 or 4) and leaves their containers out of the request queries
 * (KubernetesFinishedPods).
 */

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
import { monitorKubernetes } from "../../../../FeatureSet/Workers/Jobs/TelemetryMonitor/MonitorTelemetryMonitor";

const metricAggregateBy: jest.Mock =
  MetricService.aggregateBy as unknown as jest.Mock;
const metricFindBy: jest.Mock = MetricService.findBy as unknown as jest.Mock;
const metricTypeFindBy: jest.Mock =
  MetricTypeService.findBy as unknown as jest.Mock;

const monitorId: ObjectID = ObjectID.generate();
const projectId: ObjectID = ObjectID.generate();
const CLUSTER: string = "prod";

interface Row {
  name: string;
  value: number;
  time: Date;
  attributes: Record<string, string>;
}

interface QueryArgs {
  query: {
    name: string;
    value?: unknown;
    attributes?: Record<string, unknown>;
  };
  groupByAttributeKeys?: Array<string>;
}

let rows: Array<Row> = [];

function requestRow(podUid: string, cores: number): Row {
  return {
    name: "k8s.container.cpu_request",
    value: cores,
    time: new Date(Date.now() - 60_000),
    attributes: {
      "resource.k8s.cluster.name": CLUSTER,
      "resource.k8s.node.name": "node-1",
      "resource.k8s.namespace.name": "default",
      "resource.k8s.pod.uid": podUid,
      "resource.k8s.container.name": "main",
    },
  };
}

function allocatableRow(cores: number): Row {
  return {
    name: "k8s.node.allocatable_cpu",
    value: cores,
    time: new Date(Date.now() - 60_000),
    attributes: {
      "resource.k8s.cluster.name": CLUSTER,
      "resource.k8s.node.name": "node-1",
    },
  };
}

// The rows a query's attributes select, as the analytics query compiles them.
function selects(
  attributes: Record<string, unknown> | undefined,
  row: Row,
): boolean {
  return Object.entries(attributes || {}).every(
    ([key, filter]: [string, unknown]): boolean => {
      const stored: string = row.attributes[key] || "";

      if (filter instanceof IncludesNone) {
        return !filter.values.map(String).includes(stored);
      }

      return stored === filter;
    },
  );
}

function step(templateId: string): MonitorStep {
  return getKubernetesAlertTemplateById(templateId)!.getMonitorStep({
    clusterIdentifier: CLUSTER,
    onlineMonitorStatusId: ObjectID.generate(),
    offlineMonitorStatusId: ObjectID.generate(),
    defaultIncidentSeverityId: ObjectID.generate(),
    defaultAlertSeverityId: ObjectID.generate(),
    monitorName: "Cluster",
  });
}

function phaseReads(): Array<QueryArgs> {
  return metricAggregateBy.mock.calls
    .map((call: Array<unknown>) => {
      return call[0] as QueryArgs;
    })
    .filter((args: QueryArgs) => {
      return args.query.name === "k8s.pod.phase";
    });
}

// The per-series reads of a metric, grouped in SQL by the template's keys.
function readsOf(metricName: string): Array<QueryArgs> {
  return metricAggregateBy.mock.calls
    .map((call: Array<unknown>) => {
      return call[0] as QueryArgs;
    })
    .filter((args: QueryArgs) => {
      return args.query.name === metricName;
    });
}

/*
 * A grouped read as ClickHouse answers it: the rows the query's attributes
 * select, summed per group and minute (the request templates aggregate with
 * Sum).
 */
function groupedSum(args: QueryArgs): {
  data: Array<Record<string, unknown>>;
} {
  const keys: Array<string> = args.groupByAttributeKeys || [];
  const groups: Map<string, Record<string, unknown>> = new Map();

  for (const row of rows) {
    if (row.name !== args.query.name || !selects(args.query.attributes, row)) {
      continue;
    }

    const labels: Record<string, string> = {};

    for (const key of keys) {
      labels[key] = row.attributes[key] || "";
    }

    const minute: number = Math.floor(row.time.getTime() / 60_000) * 60_000;
    const groupKey: string = `${JSON.stringify(labels)}|${minute}`;
    const group: Record<string, unknown> | undefined = groups.get(groupKey);

    if (group) {
      group["value"] = (group["value"] as number) + row.value;
    } else {
      groups.set(groupKey, {
        timestamp: new Date(minute),
        value: row.value,
        attributes: labels,
      });
    }
  }

  return { data: Array.from(groups.values()) };
}

// The request commitment the formula computed for node-1.
function commitment(response: MetricMonitorResponse): number | undefined {
  const formula: AggregatedResult | undefined = response.metricResult[2];
  const values: Array<number> = (formula?.data || []).map(
    (point: { value: number }) => {
      return point.value;
    },
  );
  return values.length > 0 ? Math.max(...values) : undefined;
}

beforeEach(() => {
  rows = [
    requestRow("running-1", 1),
    requestRow("running-2", 1),
    // Two Job pods that have finished, still declaring their requests.
    requestRow("finished-1", 1.5),
    requestRow("finished-2", 0.5),
    allocatableRow(4),
  ];

  metricAggregateBy.mockReset().mockImplementation(async (args: unknown) => {
    const query: QueryArgs["query"] = (args as QueryArgs).query;

    if (query.name === "k8s.pod.phase") {
      return {
        data: [
          {
            timestamp: new Date(),
            value: 3,
            attributes: { "resource.k8s.pod.uid": "finished-1" },
          },
          {
            timestamp: new Date(),
            value: 4,
            attributes: { "resource.k8s.pod.uid": "finished-2" },
          },
        ],
      };
    }

    return groupedSum(args as QueryArgs);
  });
  // The breakdown's scan of raw rows.
  metricFindBy.mockReset().mockImplementation(async (args: unknown) => {
    const query: QueryArgs["query"] = (args as QueryArgs).query;

    return rows.filter((row: Row) => {
      return row.name === query.name && selects(query.attributes, row);
    });
  });
  metricTypeFindBy.mockReset().mockResolvedValue([]);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("Node request commitment leaves finished pods out", () => {
  test("the requests of Succeeded and Failed pods no longer count against the node", async () => {
    const response: MetricMonitorResponse = await monitorKubernetes({
      monitorStep: step("k8s-node-cpu-request-utilization"),
      monitorId,
      projectId,
    });

    // 2 of 4 cores requested by the running pods: 50%, not 100%.
    expect(commitment(response)).toBe(50);
  });

  test("the phases are read once, for the cluster, as Succeeded or Failed per pod", async () => {
    await monitorKubernetes({
      monitorStep: step("k8s-node-cpu-request-utilization"),
      monitorId,
      projectId,
    });

    const reads: Array<QueryArgs> = phaseReads();
    expect(reads).toHaveLength(1);
    expect(reads[0]!.query.attributes).toEqual({
      "resource.k8s.cluster.name": CLUSTER,
    });
    expect(reads[0]!.query.value).toMatchObject({
      startValue: 3,
      endValue: 4,
    });
    expect(reads[0]!.groupByAttributeKeys).toEqual(["resource.k8s.pod.uid"]);
  });

  test("only the request query is narrowed, not node allocatable", async () => {
    await monitorKubernetes({
      monitorStep: step("k8s-node-memory-request-utilization"),
      monitorId,
      projectId,
    });

    const request: Record<string, unknown> = readsOf(
      "k8s.container.memory_request",
    )[0]!.query.attributes!;
    const excluded: unknown = request["resource.k8s.pod.uid"];

    expect(excluded).toBeInstanceOf(IncludesNone);
    expect((excluded as IncludesNone).values).toEqual([
      "finished-1",
      "finished-2",
    ]);
    expect(
      readsOf("k8s.node.allocatable_memory")[0]!.query.attributes![
        "resource.k8s.pod.uid"
      ],
    ).toBeUndefined();
  });

  test("a template that reads no request metric reads no phases", async () => {
    await monitorKubernetes({
      monitorStep: step("k8s-high-memory"),
      monitorId,
      projectId,
    });

    expect(phaseReads()).toHaveLength(0);
  });

  test("when no pod has finished, or the phases cannot be read, every request counts", async () => {
    metricAggregateBy.mockImplementation(async (args: unknown) => {
      if ((args as QueryArgs).query.name === "k8s.pod.phase") {
        throw new Error("ClickHouse is down");
      }

      return groupedSum(args as QueryArgs);
    });

    const response: MetricMonitorResponse = await monitorKubernetes({
      monitorStep: step("k8s-node-cpu-request-utilization"),
      monitorId,
      projectId,
    });

    expect(
      readsOf("k8s.container.cpu_request")[0]!.query.attributes![
        "resource.k8s.pod.uid"
      ],
    ).toBeUndefined();
    expect(commitment(response)).toBe(100);
  });
});
