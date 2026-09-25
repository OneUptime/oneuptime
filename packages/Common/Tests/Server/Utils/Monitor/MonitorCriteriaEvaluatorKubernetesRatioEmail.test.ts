/*
 * MonitorCriteriaEvaluator reaches the template renderer, which loads the
 * native isolated-vm addon. Nothing here uses the sandbox and the
 * prebuilt binary cannot always dlopen in the test environment.
 */
jest.mock("isolated-vm", () => {
  return {};
});

import Monitor from "../../../../Models/DatabaseModels/Monitor";
import MonitorCriteriaEvaluator from "../../../../Server/Utils/Monitor/MonitorCriteriaEvaluator";
import AggregateModel from "../../../../Types/BaseDatabase/AggregatedModel";
import AggregatedResult from "../../../../Types/BaseDatabase/AggregatedResult";
import { JSONObject } from "../../../../Types/JSON";
import {
  getKubernetesAlertTemplateById,
  KubernetesAlertTemplate,
} from "../../../../Types/Monitor/KubernetesAlertTemplates";
import MetricMonitorResponse, {
  KubernetesResourceBreakdown,
} from "../../../../Types/Monitor/MetricMonitor/MetricMonitorResponse";
import MetricSeriesResult from "../../../../Types/Monitor/MetricMonitor/MetricSeriesResult";
import MonitorEvaluationSummary from "../../../../Types/Monitor/MonitorEvaluationSummary";
import MonitorStep from "../../../../Types/Monitor/MonitorStep";
import MonitorType from "../../../../Types/Monitor/MonitorType";
import ObjectID from "../../../../Types/ObjectID";
import ProbeApiIngestResponse from "../../../../Types/Probe/ProbeApiIngestResponse";
import { describe, expect, test } from "@jest/globals";

/*
 * The email that prompted this: a "High Node Memory Utilization" monitor
 * (k8s.node.memory.usage ÷ k8s.node.allocatable_memory × 100, grouped by
 * node, fires above 85%) sent
 *
 *   Filter Conditions Met: Node Memory Utilization (%) ranged from 86.26%
 *   to 88.82% across all 5 readings, above the 85.00% threshold.
 *   - Metric: k8s.node.allocatable_memory (`k8s.node.allocatable_memory`)
 *   Affected Resources (4 total)
 *   1. Node `gke-...-1nd7` — 257760964608
 *   ...
 *
 * Every number in the list was the node's ALLOCATABLE memory in raw bytes
 * — the ratio's denominator, which was simply the last query the worker
 * scanned — and every node was listed, breaching or not. These tests
 * drive the real template through the public evaluator entry point and
 * pin what the email says now.
 */

const NODE_KEY: string = "resource.k8s.node.name";
const CLUSTER: string = "oneuptime-test";

type NodeSample = {
  node: string;
  usedBytes: Array<number>;
  allocatableBytes: number;
};

const MINUTES: Array<Date> = [0, 1, 2, 3, 4].map((minute: number) => {
  return new Date(Date.UTC(2026, 8, 25, 10, minute, 0));
});

function templateStep(templateId: string): MonitorStep {
  const template: KubernetesAlertTemplate | undefined =
    getKubernetesAlertTemplateById(templateId);

  if (!template) {
    throw new Error(`${templateId} template missing`);
  }

  return template.getMonitorStep({
    clusterIdentifier: CLUSTER,
    onlineMonitorStatusId: ObjectID.generate(),
    offlineMonitorStatusId: ObjectID.generate(),
    defaultIncidentSeverityId: ObjectID.generate(),
    defaultAlertSeverityId: ObjectID.generate(),
    monitorName: "oneuptime-test - High Node Memory Utilization",
  } as unknown as Parameters<KubernetesAlertTemplate["getMonitorStep"]>[0]);
}

function queryRow(input: {
  node: string;
  timestamp: Date;
  value: number;
}): AggregateModel {
  // A per-series query row keeps one raw datapoint's full attribute map.
  return {
    timestamp: input.timestamp,
    value: input.value,
    attributes: {
      [NODE_KEY]: input.node,
      "resource.k8s.cluster.name": CLUSTER,
    },
  } as unknown as AggregateModel;
}

function formulaRow(input: {
  node: string;
  timestamp: Date;
  value: number;
}): AggregateModel {
  // A formula row carries only its group attributes.
  return {
    timestamp: input.timestamp,
    value: input.value,
    attributes: { [NODE_KEY]: input.node },
  } as unknown as AggregateModel;
}

/*
 * What the worker hands the evaluator for this template: per-node series
 * aligned [used_mem, alloc_mem, node_memory_utilization], plus one raw
 * scan per query — the allocatable scan being the one that used to win.
 */
function workerResponse(nodes: Array<NodeSample>): MetricMonitorResponse {
  const seriesBreakdown: Array<MetricSeriesResult> = nodes.map(
    (node: NodeSample): MetricSeriesResult => {
      const used: AggregatedResult = {
        data: MINUTES.map((timestamp: Date, i: number) => {
          return queryRow({
            node: node.node,
            timestamp,
            value: node.usedBytes[i]!,
          });
        }),
      };
      const allocatable: AggregatedResult = {
        data: MINUTES.map((timestamp: Date) => {
          return queryRow({
            node: node.node,
            timestamp,
            value: node.allocatableBytes,
          });
        }),
      };
      const utilization: AggregatedResult = {
        data: MINUTES.map((timestamp: Date, i: number) => {
          return formulaRow({
            node: node.node,
            timestamp,
            value: (node.usedBytes[i]! / node.allocatableBytes) * 100,
          });
        }),
      };

      return {
        fingerprint: `fp-${node.node}`,
        labels: { [NODE_KEY]: node.node } as JSONObject,
        aggregatedResults: [used, allocatable, utilization],
      };
    },
  );

  const scan: (input: {
    alias: string;
    metricName: string;
    friendlyName: string;
    value: (node: NodeSample) => number;
  }) => KubernetesResourceBreakdown = (input: {
    alias: string;
    metricName: string;
    friendlyName: string;
    value: (node: NodeSample) => number;
  }): KubernetesResourceBreakdown => {
    return {
      clusterName: CLUSTER,
      metricName: input.metricName,
      metricFriendlyName: input.friendlyName,
      metricAlias: input.alias,
      metricUnit: "By",
      attributes: { "resource.k8s.cluster.name": CLUSTER },
      affectedResources: nodes.map((node: NodeSample) => {
        return {
          nodeName: node.node,
          metricValue: input.value(node),
          lowestMetricValue: input.value(node),
        };
      }),
    };
  };

  return {
    projectId: ObjectID.generate(),
    monitorId: ObjectID.generate(),
    metricResult: [],
    metricViewConfig: { queryConfigs: [], formulaConfigs: [] },
    seriesBreakdown: seriesBreakdown,
    kubernetesResourceBreakdowns: [
      scan({
        alias: "used_mem",
        metricName: "k8s.node.memory.usage",
        friendlyName: "Node Memory Usage",
        value: (node: NodeSample) => {
          return Math.max(...node.usedBytes);
        },
      }),
      scan({
        alias: "alloc_mem",
        metricName: "k8s.node.allocatable_memory",
        friendlyName: "k8s.node.allocatable_memory",
        value: (node: NodeSample) => {
          return node.allocatableBytes;
        },
      }),
    ],
    nativeUnitsByMetricName: {
      "k8s.node.memory.usage": "bytes",
      "k8s.node.allocatable_memory": "By",
    },
  } as MetricMonitorResponse;
}

async function evaluate(input: {
  templateId: string;
  response: MetricMonitorResponse;
}): Promise<ProbeApiIngestResponse> {
  const monitor: Monitor = new Monitor();
  monitor._id = ObjectID.generate().toString();
  monitor.monitorType = MonitorType.Kubernetes;
  monitor.name = "oneuptime-test - High Node Memory Utilization";

  return MonitorCriteriaEvaluator.processMonitorStep({
    dataToProcess: input.response,
    monitorStep: templateStep(input.templateId),
    monitor: monitor,
    probeApiIngestResponse: {
      monitorId: monitor.id!,
      rootCause: null,
    },
    evaluationSummary: {
      criteriaResults: [],
      events: [],
    } as unknown as MonitorEvaluationSummary,
  });
}

/*
 * Two nodes above 85%, two comfortably below — the shape of the cluster
 * in the reported email, where all four were listed.
 */
const NODES: Array<NodeSample> = [
  {
    node: "gke-gke-test-cluster-default-pool-662f6819-1nd7",
    allocatableBytes: 257760964608,
    // 86.26% .. 88.82% of allocatable
    usedBytes: [222344608010, 224000000000, 226000000000, 228000000000, 228943289000],
  },
  {
    node: "gke-gke-test-cluster-default-pool-662f6819-7qrq",
    allocatableBytes: 257760956416,
    // ~86.5% .. ~87.4%
    usedBytes: [223000000000, 224500000000, 225000000000, 225000000000, 225300000000],
  },
  {
    node: "gke-gke-test-cluster-db-pool-3e2bfa3b-3am6",
    allocatableBytes: 191483559936,
    // ~52%
    usedBytes: [99000000000, 99500000000, 100000000000, 100000000000, 99800000000],
  },
  {
    node: "gke-gke-test-cluster-db-pool-3e2bfa3b-rqyt",
    allocatableBytes: 191483551744,
    // ~41%
    usedBytes: [78000000000, 78500000000, 79000000000, 79000000000, 78800000000],
  },
];

describe("Kubernetes ratio-template email: High Node Memory Utilization", () => {
  test("lists only the breaching nodes, valued in % — never allocatable bytes", async () => {
    const response: ProbeApiIngestResponse = await evaluate({
      templateId: "k8s-high-memory",
      response: workerResponse(NODES),
    });

    const rootCause: string = response.rootCause || "";

    expect(rootCause).toContain("**Affected Resources** (2 total)");
    expect(rootCause).toContain(
      "1. **Node** `gke-gke-test-cluster-default-pool-662f6819-1nd7` — **88.82%**",
    );
    expect(rootCause).toContain(
      "2. **Node** `gke-gke-test-cluster-default-pool-662f6819-7qrq` — **87.41%**",
    );

    // The healthy nodes are not "affected".
    expect(rootCause).not.toContain("3e2bfa3b-3am6");
    expect(rootCause).not.toContain("3e2bfa3b-rqyt");

    // No raw byte counts anywhere in the email.
    expect(rootCause).not.toContain("257760964608");
    expect(rootCause).not.toContain("257760956416");
    expect(rootCause).not.toMatch(/\b\d{10,}\b/);
  });

  test("names the formula the criteria compared, not the denominator", async () => {
    const response: ProbeApiIngestResponse = await evaluate({
      templateId: "k8s-high-memory",
      response: workerResponse(NODES),
    });

    const rootCause: string = response.rootCause || "";

    expect(rootCause).toContain("- Cluster: oneuptime-test");
    expect(rootCause).toContain("- Metric: Node Memory Utilization (%)");
    expect(rootCause).toContain("- Formula: `(used_mem / alloc_mem) * 100`");
    expect(rootCause).toContain("`used_mem` = ");
    expect(rootCause).toContain("(`k8s.node.memory.usage`)");
    expect(rootCause).toContain("`alloc_mem` = ");
    expect(rootCause).not.toContain(
      "- Metric: k8s.node.allocatable_memory (`k8s.node.allocatable_memory`)",
    );
  });

  test("the analysis names the worst node at its utilization", async () => {
    const response: ProbeApiIngestResponse = await evaluate({
      templateId: "k8s-high-memory",
      response: workerResponse(NODES),
    });

    const rootCause: string = response.rootCause || "";

    expect(rootCause).toContain(
      "Node memory utilization has exceeded the configured threshold.",
    );
    expect(rootCause).toContain(
      "Node `gke-gke-test-cluster-default-pool-662f6819-1nd7` memory usage is at **88.82%**.",
    );
    expect(rootCause).not.toContain("Kubernetes metric `k8s.node.allocatable_memory`");
  });

  test("the Filter Conditions Met sentence and the list agree on units", async () => {
    const response: ProbeApiIngestResponse = await evaluate({
      templateId: "k8s-high-memory",
      response: workerResponse(NODES),
    });

    const rootCause: string = response.rootCause || "";

    expect(rootCause).toMatch(
      /\*\*Filter Conditions Met\*\*: Node Memory Utilization \(%\) .*88\.82%.*85\.00% threshold/,
    );
  });
});
