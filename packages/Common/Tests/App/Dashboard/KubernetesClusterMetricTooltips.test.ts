import { describe, expect, test } from "@jest/globals";
import {
  expectReadableDescriptionRecord,
  expectTitleExplained,
} from "./MetricDescriptionRules";
import {
  KUBERNETES_CLUSTER_METRIC_DESCRIPTIONS,
  KUBERNETES_COST_METRIC_DESCRIPTIONS,
  KUBERNETES_RIGHT_SIZING_METRIC_DESCRIPTIONS,
  KubernetesClusterMetric,
  KubernetesCostMetric,
  KubernetesRightSizingMetric,
} from "../../../../App/FeatureSet/Dashboard/src/Components/MetricDescriptions/KubernetesClusterMetricDescriptions";
import {
  CPU_HEADROOM_RATIO,
  HOURS_IN_MONTH,
  MEMORY_HEADROOM_RATIO,
  MIN_OBSERVED_HOURS,
  RightSizingObservation,
  RightSizingRecommendation,
  RightSizingVerdict,
  SIGNIFICANCE_RATIO,
  buildRightSizingRecommendation,
} from "../../../Types/Kubernetes/KubernetesRightSizing";
import {
  ExtractedInventoryRecord,
  extractInventoryResource,
} from "../../../Types/Kubernetes/KubernetesInventoryExtractor";
import { JSONObject } from "../../../Types/JSON";
import AggregationIntervalUtil from "../../../Types/BaseDatabase/AggregationIntervalUtil";

/*
 * The (i) texts on the Kubernetes cluster pages: the overview, the Insights
 * network card, the cluster and project Costs pages and the Right-Sizing
 * card. The catalog test holds every module to the shared text rules; this
 * file adds what is specific to these pages - the title each text sits
 * beside, and accuracy anchors that pin a text to what the page actually
 * computes (the 5-minute tile window, the inventory snapshot, the cost
 * engine's idle / unallocated split, the recommender's constants).
 */

const CLUSTER: Record<KubernetesClusterMetric, string> =
  KUBERNETES_CLUSTER_METRIC_DESCRIPTIONS;
const COST: Record<KubernetesCostMetric, string> =
  KUBERNETES_COST_METRIC_DESCRIPTIONS;
const RIGHT_SIZING: Record<KubernetesRightSizingMetric, string> =
  KUBERNETES_RIGHT_SIZING_METRIC_DESCRIPTIONS;

function percentOf(ratio: number): string {
  return `${Math.round(ratio * 100)}%`;
}

type PlainValue =
  | string
  | number
  | boolean
  | Array<PlainValue>
  | { [key: string]: PlainValue };

/*
 * Encode a plain object as the OTLP AnyValue the Kubernetes agent ships
 * inventory objects in, so the real extractor can be run on it.
 */
function toOtlpValue(value: PlainValue): JSONObject {
  if (typeof value === "string") {
    return { stringValue: value };
  }
  if (typeof value === "number") {
    return { intValue: value };
  }
  if (typeof value === "boolean") {
    return { boolValue: value };
  }
  if (Array.isArray(value)) {
    return { arrayValue: { values: value.map(toOtlpValue) } };
  }
  return {
    kvlistValue: {
      values: Object.entries(value).map(
        ([key, entry]: [string, PlainValue]): JSONObject => {
          return { key: key, value: toOtlpValue(entry) };
        },
      ),
    },
  };
}

describe("the Kubernetes cluster description records read well", () => {
  test("cluster overview texts pass the shared rules", () => {
    expectReadableDescriptionRecord(
      CLUSTER,
      "KUBERNETES_CLUSTER_METRIC_DESCRIPTIONS",
    );
  });

  test("cost texts pass the shared rules", () => {
    expectReadableDescriptionRecord(
      COST,
      "KUBERNETES_COST_METRIC_DESCRIPTIONS",
    );
  });

  test("right-sizing texts pass the shared rules", () => {
    expectReadableDescriptionRecord(
      RIGHT_SIZING,
      "KUBERNETES_RIGHT_SIZING_METRIC_DESCRIPTIONS",
    );
  });

  test("the records cover exactly the metrics the pages show", () => {
    expect(Object.keys(CLUSTER).sort()).toEqual(
      [
        "agentStatus",
        "availability",
        "availabilityChart",
        "clusterHealth",
        "cpu",
        "cpuChart",
        "diskPressure",
        "filesystem",
        "filesystemChart",
        "inventoryCounts",
        "memory",
        "memoryChart",
        "memoryPressure",
        "namespaces",
        "network",
        "networkChart",
        "networkThroughput",
        "nodes",
        "nodesNotReady",
        "pidPressure",
        "podHealth",
        "pods",
        "podsFailed",
        "podsPending",
        "podsRunning",
        "topCpuPods",
        "topMemoryPods",
      ].sort(),
    );

    expect(Object.keys(COST).sort()).toEqual(
      [
        "clusterEfficiency",
        "clusterIdleCost",
        "clusterTotalCost",
        "clusterWorkloadCost",
        "efficiency",
        "fleetIdlePercent",
        "fleetIdleSpend",
        "fleetSpendTrend",
        "fleetTotalSpend",
        "fleetWorkloadSpend",
        "idlePercent",
        "idleSpend",
        "namespaceCpuCost",
        "namespaceMemoryCost",
        "namespaceOtherCost",
        "namespaceStorageCost",
        "namespaceTotalCost",
        "spendTrend",
        "totalSpend",
        "workloadSpend",
        "workloadTotalCost",
      ].sort(),
    );

    expect(Object.keys(RIGHT_SIZING).sort()).toEqual(
      [
        "analyzed",
        "cpuRequest",
        "estimatedSaving",
        "memoryRequest",
        "overprovisioned",
        "potentialSaving",
        "underprovisioned",
      ].sort(),
    );
  });

  test("no text is shared across the three records either", () => {
    const all: Array<string> = [
      ...Object.values(CLUSTER),
      ...Object.values(COST),
      ...Object.values(RIGHT_SIZING),
    ];

    expect(new Set(all).size).toBe(all.length);
  });

  test("every text is short enough for the small tooltip (aim: 260 chars)", () => {
    for (const text of [
      ...Object.values(CLUSTER),
      ...Object.values(COST),
      ...Object.values(RIGHT_SIZING),
    ]) {
      expect({ text, length: text.length <= 260 }).toEqual({
        text,
        length: true,
      });
    }
  });
});

/*
 * The title a customer sees beside each (i), as the pages render it. A title
 * that names a percentile must get a text that explains it.
 */
const TITLED: Array<[string, string]> = [
  ["Availability", CLUSTER.availability],
  ["CPU", CLUSTER.cpu],
  ["Memory", CLUSTER.memory],
  ["Filesystem", CLUSTER.filesystem],
  ["Network", CLUSTER.network],
  ["Availability", CLUSTER.availabilityChart],
  ["CPU", CLUSTER.cpuChart],
  ["Memory", CLUSTER.memoryChart],
  ["Filesystem", CLUSTER.filesystemChart],
  ["Network", CLUSTER.networkChart],
  ["Cluster inventory counts", CLUSTER.inventoryCounts],
  ["Running", CLUSTER.podsRunning],
  ["Pending", CLUSTER.podsPending],
  ["Failed", CLUSTER.podsFailed],
  ["Nodes Not Ready", CLUSTER.nodesNotReady],
  ["Cluster Health", CLUSTER.clusterHealth],
  ["Nodes", CLUSTER.nodes],
  ["Pods", CLUSTER.pods],
  ["Namespaces", CLUSTER.namespaces],
  ["Agent Status", CLUSTER.agentStatus],
  ["Memory Pressure", CLUSTER.memoryPressure],
  ["Disk Pressure", CLUSTER.diskPressure],
  ["PID Pressure", CLUSTER.pidPressure],
  ["Pod Health", CLUSTER.podHealth],
  ["CPU Usage", CLUSTER.topCpuPods],
  ["Memory Usage", CLUSTER.topMemoryPods],
  ["Network", CLUSTER.networkThroughput],
  ["Total Spend", COST.totalSpend],
  ["Workload Spend", COST.workloadSpend],
  ["Idle Spend", COST.idleSpend],
  ["Idle %", COST.idlePercent],
  ["Spend", COST.spendTrend],
  ["CPU", COST.namespaceCpuCost],
  ["Memory", COST.namespaceMemoryCost],
  ["Storage", COST.namespaceStorageCost],
  ["Other", COST.namespaceOtherCost],
  ["Total", COST.namespaceTotalCost],
  ["Total", COST.workloadTotalCost],
  ["Efficiency", COST.efficiency],
  ["Total Spend", COST.fleetTotalSpend],
  ["Workload Spend", COST.fleetWorkloadSpend],
  ["Idle Spend", COST.fleetIdleSpend],
  ["Idle %", COST.fleetIdlePercent],
  ["Kubernetes Spend", COST.fleetSpendTrend],
  ["Workload", COST.clusterWorkloadCost],
  ["Idle", COST.clusterIdleCost],
  ["Total", COST.clusterTotalCost],
  ["Efficiency", COST.clusterEfficiency],
  ["Potential Saving", RIGHT_SIZING.potentialSaving],
  ["Over-provisioned", RIGHT_SIZING.overprovisioned],
  ["Under-provisioned", RIGHT_SIZING.underprovisioned],
  ["Analyzed", RIGHT_SIZING.analyzed],
  ["CPU Request", RIGHT_SIZING.cpuRequest],
  ["Memory Request", RIGHT_SIZING.memoryRequest],
  ["Est. Saving", RIGHT_SIZING.estimatedSaving],
];

describe("each title is explained by the text beside it", () => {
  test.each(TITLED)("%s", (title: string, text: string) => {
    expectTitleExplained(title, text);
  });

  test("every description appears beside some title", () => {
    const shown: Set<string> = new Set(
      TITLED.map((pair: [string, string]): string => {
        return pair[1];
      }),
    );

    for (const text of [
      ...Object.values(CLUSTER),
      ...Object.values(COST),
      ...Object.values(RIGHT_SIZING),
    ]) {
      expect(shown.has(text)).toBe(true);
    }
  });
});

describe("accuracy: the golden tiles and the charts under them", () => {
  /*
   * The tiles average only the last few minutes of the selected range
   * (TILE_WINDOW_MINUTES in the page, pinned against the source in the App
   * wiring test); a tile text that said "over the selected range" would
   * promise a number the page never computes.
   */
  test.each(["cpu", "memory", "filesystem", "network"] as const)(
    "the %s tile says it averages the last 5 minutes of the range",
    (key: KubernetesClusterMetric) => {
      expect(CLUSTER[key]).toContain("last 5 minutes of the selected range");
    },
  );

  /*
   * meanInRecentWindow keeps the points whose bucket START is inside the
   * last 5 minutes and falls back to the whole range when none is (pinned in
   * the App wiring test). Each of the four tile texts has to say so - and say
   * when it happens, which the next test pins against the bucket widths.
   */
  test.each(["cpu", "memory", "filesystem", "network"] as const)(
    "the %s tile says when it shows the whole range instead",
    (key: KubernetesClusterMetric) => {
      expect(CLUSTER[key]).toContain(
        "often the whole range on ranges over 12 hours or without recent data",
      );
    },
  );

  /*
   * Buckets are stamped with their start. Up to 12 hours they are at most 5
   * minutes wide, so one always starts inside the 5-minute tile window; past
   * 12 hours they are 15 minutes or wider, so for most of each bucket no
   * point starts inside the window and the tile falls back to the whole
   * range. That is the "over 12 hours" the texts quote.
   */
  test("past 12 hours, buckets outgrow the 5-minute tile window", () => {
    const TILE_WINDOW_MS: number = 5 * 60 * 1000;
    const end: Date = new Date("2026-09-24T12:00:00.000Z");
    const bucketMsFor: (hours: number) => number = (hours: number): number => {
      return AggregationIntervalUtil.getAggregationIntervalMs(
        AggregationIntervalUtil.getAggregationIntervalForWindow({
          startDate: new Date(end.getTime() - hours * 60 * 60 * 1000),
          endDate: end,
        }),
      );
    };

    for (const hours of [0.5, 1, 3, 6, 12]) {
      expect({ hours, fits: bucketMsFor(hours) <= TILE_WINDOW_MS }).toEqual({
        hours,
        fits: true,
      });
    }

    for (const hours of [12.5, 24, 72, 168]) {
      expect({ hours, fits: bucketMsFor(hours) <= TILE_WINDOW_MS }).toEqual({
        hours,
        fits: false,
      });
    }
  });

  test("availability covers the whole range, not the last 5 minutes", () => {
    expect(CLUSTER.availability).toContain("selected range");
    expect(CLUSTER.availability).not.toContain("5 minutes");
    // It measures the agent reporting, not the customer's apps.
    expect(CLUSTER.availability).toContain("heartbeat");
    expect(CLUSTER.availability).toContain("not whether your apps were up");
    // Trailing buckets still in the ingest window are excluded.
    expect(CLUSTER.availability).toContain("may still be arriving");
  });

  test("CPU is a share of allocatable CPU, not of node capacity or of cores", () => {
    expect(CLUSTER.cpu).toContain("allocatable CPU");
    expect(CLUSTER.cpuChart).toContain("allocatable CPU");
    // The chart has no series at all when allocatable is not reported.
    expect(CLUSTER.cpuChart).toContain("empty");
  });

  test("memory is an absolute total across nodes that includes cache", () => {
    expect(CLUSTER.memory).toContain("added together");
    expect(CLUSTER.memory).toContain("cache");
    expect(CLUSTER.memoryChart).toContain("bytes");
    expect(CLUSTER.memoryChart).toContain("cache");
    // Not a percentage - there is no denominator.
    expect(CLUSTER.memory).not.toContain("%");
  });

  /*
   * kubeletstats reports k8s.node.filesystem.usage / .available once per
   * node (the kubelet's root filesystem, no mountpoint or device attribute),
   * so the page's per-(node, mount) join collapses to one fraction per node
   * and the tile is an unweighted average across nodes - not across disks.
   */
  test("filesystem is an unweighted average of per-node disk fullness", () => {
    expect(CLUSTER.filesystem).toContain(
      "Used space divided by used plus free space on each node's disk",
    );
    expect(CLUSTER.filesystem).toContain("averaged across nodes");
    expect(CLUSTER.filesystem).toContain("nearly full node can hide");
    expect(CLUSTER.filesystem).not.toContain("across disks");
    expect(CLUSTER.filesystemChart).toContain("averaged across the nodes");
    expect(CLUSTER.filesystemChart).not.toContain("across the disks");
  });

  test("network is received plus sent, summed over nodes and interfaces", () => {
    expect(CLUSTER.network).toContain("received plus sent");
    expect(CLUSTER.network).toContain("every node and network interface");
    expect(CLUSTER.networkChart).toContain("(In)");
    expect(CLUSTER.networkChart).toContain("(Out)");
    expect(CLUSTER.networkChart).toContain("byte counters");
    expect(CLUSTER.networkThroughput).toContain("received and transmitted");
    expect(CLUSTER.networkThroughput).toContain("byte counters");
  });

  test.each([
    "availabilityChart",
    "cpuChart",
    "memoryChart",
    "filesystemChart",
    "networkChart",
    "networkThroughput",
  ] as const)(
    "the %s text describes one point per interval",
    (key: KubernetesClusterMetric) => {
      expect(CLUSTER[key]).toContain("each interval");
    },
  );
});

describe("accuracy: inventory-snapshot numbers ignore the time range", () => {
  test.each([
    "clusterHealth",
    "nodes",
    "pods",
    "namespaces",
    "inventoryCounts",
    "podHealth",
  ] as const)(
    "%s says it comes from the latest inventory",
    (key: KubernetesClusterMetric) => {
      expect(CLUSTER[key]).toContain("latest inventory");
    },
  );

  const IGNORES_PICKER: Array<[KubernetesClusterMetric, string]> = [
    ["clusterHealth", "not the selected range"],
    ["nodes", "not the selected range"],
    ["pods", "not limited to the selected range"],
    ["inventoryCounts", "ignore the time range picker"],
    ["podHealth", "Not tied to the time range"],
  ];

  test.each(IGNORES_PICKER)(
    "%s says the time picker does not change it",
    (key: KubernetesClusterMetric, phrase: string) => {
      expect(CLUSTER[key]).toContain(phrase);
    },
  );

  test("cluster health spells out the page's exact rule", () => {
    // Unhealthy: failed pods or not-ready nodes.
    expect(CLUSTER.clusterHealth).toContain(
      "Unhealthy if any pod has failed or any node is not ready",
    );
    // Degraded: pending pods or any node pressure.
    expect(CLUSTER.clusterHealth).toContain(
      "Degraded if any pod is pending or a node reports memory, disk or process pressure",
    );
    expect(CLUSTER.clusterHealth).toContain("otherwise Healthy");
  });

  test("the chips that feed the health rule say which state they cause", () => {
    expect(CLUSTER.podsPending).toContain("marks the cluster Degraded");
    expect(CLUSTER.podsFailed).toContain("marks the cluster Unhealthy");
    expect(CLUSTER.nodesNotReady).toContain("marks the cluster Unhealthy");
  });

  test("pods count every phase, and the container count excludes init containers", () => {
    expect(CLUSTER.pods).toContain("in any phase");
    expect(CLUSTER.inventoryCounts).toContain("pods in any phase");
    expect(CLUSTER.inventoryCounts).toContain(
      "init containers are not counted",
    );
  });

  /*
   * Run the real inventory extractor: the counts on the page are sums of the
   * columns it writes, so the words have to match what it does with a node
   * whose kubelet went silent and with a pod's init containers.
   */
  test("a node whose Ready condition is Unknown (kubelet silent) counts as not ready", () => {
    const record: ExtractedInventoryRecord | null = extractInventoryResource({
      resourceType: "nodes",
      logBody: JSON.stringify(
        toOtlpValue({
          kind: "Node",
          metadata: { name: "node-a", uid: "node-a-uid" },
          status: { conditions: [{ type: "Ready", status: "Unknown" }] },
        }),
      ),
      lastSeenAt: new Date(),
    });

    expect(record?.resource.isReady).toBe(false);
    expect(CLUSTER.nodesNotReady).toContain("has stopped reporting");
    expect(CLUSTER.nodesNotReady).toContain("Ready check is not passing");
  });

  test("the container count is spec.containers only - init containers are left out", () => {
    const record: ExtractedInventoryRecord | null = extractInventoryResource({
      resourceType: "pods",
      logBody: JSON.stringify(
        toOtlpValue({
          kind: "Pod",
          metadata: { name: "api-7d9f", namespace: "shop", uid: "api-uid" },
          spec: {
            initContainers: [{ name: "migrate", image: "busybox" }],
            containers: [
              { name: "api", image: "nginx" },
              { name: "proxy", image: "envoy" },
            ],
          },
          status: { phase: "Running" },
        }),
      ),
      lastSeenAt: new Date(),
    });

    expect(record?.resource.containerCount).toBe(2);
    expect(CLUSTER.inventoryCounts).toContain(
      "init containers are not counted",
    );
  });

  test("the agent status names the disconnect threshold", () => {
    expect(CLUSTER.agentStatus).toContain("about 15 minutes");
    expect(CLUSTER.agentStatus).toContain("keep their last reported values");
  });

  test("each node pressure condition is explained on its own", () => {
    expect(CLUSTER.memoryPressure).toContain("low on memory");
    expect(CLUSTER.diskPressure).toContain("low on disk space");
    expect(CLUSTER.pidPressure).toContain("processes (PIDs)");

    for (const text of [
      CLUSTER.memoryPressure,
      CLUSTER.diskPressure,
      CLUSTER.pidPressure,
    ]) {
      expect(text).toContain("evict");
    }
  });

  test("pod health names all four phases the bar draws", () => {
    for (const phase of ["Running", "Succeeded", "Pending", "Failed"]) {
      expect(CLUSTER.podHealth).toContain(phase);
    }
  });
});

describe("accuracy: top resource consumers", () => {
  test("both lists read each pod's latest minute from the past hour, not the picker", () => {
    for (const text of [CLUSTER.topCpuPods, CLUSTER.topMemoryPods]) {
      expect(text).toContain("latest minute of data from the past hour");
      expect(text).toContain("not the time range picker");
      expect(text).toContain("The 5 pods");
    }
  });

  test("the denominator is the allocatable capacity of each pod's own node", () => {
    expect(CLUSTER.topCpuPods).toContain(
      "allocatable CPU of the node each runs on",
    );
    expect(CLUSTER.topMemoryPods).toContain(
      "allocatable memory of the node each runs on",
    );
  });

  test("the CPU list admits the value is in cores when allocatable is unknown", () => {
    expect(CLUSTER.topCpuPods).toContain("the value is in cores");
  });
});

describe("accuracy: costs", () => {
  test("the cluster page folds unallocated cost into idle, and says so", () => {
    expect(COST.workloadSpend).toContain(
      "total spend minus idle and unallocated capacity",
    );
    expect(COST.idleSpend).toContain("unallocated");
  });

  test("the project page counts only idle capacity as idle, and says so", () => {
    expect(COST.fleetWorkloadSpend).toContain(
      "Total spend minus idle capacity",
    );
    expect(COST.fleetWorkloadSpend).toContain(
      "unallocated is counted here rather than as idle",
    );
    expect(COST.fleetIdleSpend).toContain("Unallocated cost is not included");
    expect(COST.clusterWorkloadCost).toContain(
      "total cost minus idle capacity",
    );
  });

  test("totals include idle capacity", () => {
    expect(COST.totalSpend).toContain("including capacity no workload used");
    expect(COST.fleetTotalSpend).toContain(
      "including capacity no workload used",
    );
    expect(COST.spendTrend).toContain("idle capacity included");
    expect(COST.fleetSpendTrend).toContain("idle capacity included");
  });

  test("the trend explains why points grow with the range (bucketed sums)", () => {
    expect(COST.spendTrend).toContain(
      "adds up the cost records that start in that interval",
    );
    expect(COST.spendTrend).toContain("taller points");
    expect(COST.fleetSpendTrend).toContain("taller points");
  });

  test("the idle % texts name the bar's thresholds", () => {
    expect(COST.idlePercent).toContain("amber at 25% and red at 40%");
    expect(COST.fleetIdlePercent).toContain("amber at 25% and red at 40%");
  });

  test("each Total column says what its share is a share of", () => {
    expect(COST.namespaceTotalCost).toContain(
      "share of the cluster's total spend, idle capacity included",
    );
    expect(COST.workloadTotalCost).toContain(
      "share of workload spend, which leaves idle capacity out",
    );
    expect(COST.clusterTotalCost).toContain(
      "share of spend across all clusters",
    );
  });

  test("efficiency is used-versus-requested, can pass 100%, and names the pill colours", () => {
    expect(COST.efficiency).toContain("requested CPU and memory");
    expect(COST.efficiency).toContain("above 100% means more was used");
    expect(COST.efficiency).toContain("Green from 70%, red below 40%");
    expect(COST.clusterEfficiency).toContain("Green from 70%, red below 40%");
    // The project table's average includes the idle rows.
    expect(COST.clusterEfficiency).toContain("idle-capacity records included");
  });

  test("other = total minus the three named components", () => {
    expect(COST.namespaceOtherCost).toContain("not CPU, memory or storage");
  });
});

describe("accuracy: right-sizing numbers come from the recommender's constants", () => {
  test("the saving is projected to the recommender's month", () => {
    expect(RIGHT_SIZING.potentialSaving).toContain(
      `${HOURS_IN_MONTH}-hour month`,
    );
    expect(RIGHT_SIZING.estimatedSaving).toContain(
      `${HOURS_IN_MONTH}-hour month`,
    );
    // Increases are not netted against the headline saving.
    expect(RIGHT_SIZING.potentialSaving).toContain("not subtracted");
  });

  test("the verdict band is the recommender's significance ratio", () => {
    const band: string = percentOf(SIGNIFICANCE_RATIO);

    /*
     * Over: recommended / request < 1 - band, i.e. the recommendation is
     * more than the band below the request.
     */
    expect(RIGHT_SIZING.overprovisioned).toContain(`more than ${band} below`);
    expect(RIGHT_SIZING.underprovisioned).toContain(`more than ${band} above`);
    expect(RIGHT_SIZING.cpuRequest).toContain(`within ${band}`);
  });

  /*
   * A request is a reservation, not a cap: CPU throttling and OOM kills at a
   * container's own ceiling come from its LIMIT. A container using more than
   * it requested is slowed when the node is busy and is among the first the
   * kernel or kubelet kills or evicts when node memory runs short.
   */
  test("under-provisioned describes what a too-small request risks, not a limit", () => {
    expect(RIGHT_SIZING.underprovisioned).toContain(
      "use more than they reserve",
    );
    expect(RIGHT_SIZING.underprovisioned).toContain("busy node can slow them");
    expect(RIGHT_SIZING.underprovisioned).toContain("killed or evicted");
    expect(RIGHT_SIZING.underprovisioned).not.toContain("throttling");
  });

  test("the headroom is the recommender's headroom", () => {
    expect(RIGHT_SIZING.overprovisioned).toContain(
      `${percentOf(CPU_HEADROOM_RATIO)} headroom`,
    );
    expect(RIGHT_SIZING.cpuRequest).toContain(
      `${percentOf(CPU_HEADROOM_RATIO)} headroom`,
    );
    expect(RIGHT_SIZING.memoryRequest).toContain(
      `${percentOf(MEMORY_HEADROOM_RATIO)} headroom`,
    );
  });

  test("CPU is sized from a 95th percentile, and the text explains it", () => {
    expect(RIGHT_SIZING.cpuRequest).toContain("95th percentile");
    expect(RIGHT_SIZING.cpuRequest).toContain("95% of hourly readings");
  });

  test("memory is sized from a peak, and says where peaks come from", () => {
    expect(RIGHT_SIZING.memoryRequest).toContain("highest memory peak");
    expect(RIGHT_SIZING.memoryRequest).toContain("Prometheus");
  });

  test("both request columns name the minimum history", () => {
    expect(RIGHT_SIZING.cpuRequest).toContain(`${MIN_OBSERVED_HOURS} hours`);
    expect(RIGHT_SIZING.memoryRequest).toContain(`${MIN_OBSERVED_HOURS} hours`);
  });

  test("analyzed counts a workload's container once, not per replica", () => {
    expect(RIGHT_SIZING.analyzed).toContain("counts once");
    expect(RIGHT_SIZING.analyzed).toContain("replicas");
    expect(RIGHT_SIZING.analyzed).toContain("already right-sized");
  });
});

/*
 * The texts say how the verdicts and the saving are decided; the recommender
 * is pure, so run it and check the words against what it actually does.
 */
describe("accuracy: the right-sizing texts match the recommender's behaviour", () => {
  const OBSERVED_HOURS: number = 48;

  function cpuOnly(
    request: number,
    p95Usage: number,
  ): RightSizingRecommendation {
    const observation: RightSizingObservation = {
      namespace: "shop",
      controllerKind: "Deployment",
      controllerName: "api",
      containerName: "api",
      sampleCount: OBSERVED_HOURS,
      cpuCoreRequestAverage: request,
      cpuCoreUsageP95: p95Usage,
      cpuCost: 10,
      ramBytesRequestAverage: 0,
      ramBytesUsagePeak: 0,
      ramCost: 0,
    };

    return buildRightSizingRecommendation(observation, OBSERVED_HOURS);
  }

  test("recommendation = observed 95th-percentile demand plus the headroom", () => {
    const recommendation: RightSizingRecommendation = cpuOnly(1, 0.5);

    // 0.5 cores * 1.25, rounded up to the 10m step.
    expect(recommendation.cpu.recommended).toBeCloseTo(0.63, 5);
    expect(recommendation.cpu.observedDemand).toBe(0.5);
  });

  test("over-provisioned: the recommendation is more than the band BELOW the request", () => {
    // 0.63 is 37% below a 1-core request.
    expect(cpuOnly(1, 0.5).cpu.verdict).toBe(
      RightSizingVerdict.Overprovisioned,
    );
    // A request only 10% above the recommendation is right-sized.
    expect(cpuOnly(0.7, 0.5).cpu.verdict).toBe(RightSizingVerdict.Optimal);
  });

  test("under-provisioned: the recommendation is more than the band ABOVE the request", () => {
    // Recommendation 0.63 vs a 0.5 request: 26% above.
    expect(cpuOnly(0.5, 0.5).cpu.verdict).toBe(
      RightSizingVerdict.Underprovisioned,
    );
    // 0.63 vs 0.56: 12.5% above - inside the band, right-sized.
    expect(cpuOnly(0.56, 0.5).cpu.verdict).toBe(RightSizingVerdict.Optimal);
  });

  test("the saving is the window's change scaled to a 730-hour month", () => {
    const recommendation: RightSizingRecommendation = cpuOnly(1, 0.5);
    // $10 of CPU over the window, request cut from 1 to 0.63 cores.
    const windowSaving: number = 10 * (1 - 0.63);

    expect(recommendation.estimatedMonthlySavings).toBeCloseTo(
      (windowSaving * HOURS_IN_MONTH) / OBSERVED_HOURS,
      5,
    );
    expect(recommendation.estimatedMonthlyIncrease).toBe(0);
  });

  test("an under-provisioned container shows an increase, never a negative saving", () => {
    const recommendation: RightSizingRecommendation = cpuOnly(0.5, 0.5);

    expect(recommendation.estimatedMonthlySavings).toBe(0);
    expect(recommendation.estimatedMonthlyIncrease).toBeGreaterThan(0);
  });

  test("without a memory peak, memory is unavailable (the '-' the text mentions)", () => {
    expect(cpuOnly(1, 0.5).memory.verdict).toBe(RightSizingVerdict.Unavailable);
  });

  test("with less than the minimum history, nothing is sized", () => {
    const observation: RightSizingObservation = {
      namespace: "shop",
      controllerKind: "Deployment",
      controllerName: "api",
      containerName: "api",
      sampleCount: MIN_OBSERVED_HOURS - 1,
      cpuCoreRequestAverage: 1,
      cpuCoreUsageP95: 0.5,
      cpuCost: 10,
      ramBytesRequestAverage: 0,
      ramBytesUsagePeak: 0,
      ramCost: 0,
    };

    expect(
      buildRightSizingRecommendation(observation, MIN_OBSERVED_HOURS - 1).cpu
        .verdict,
    ).toBe(RightSizingVerdict.Unavailable);
  });
});
