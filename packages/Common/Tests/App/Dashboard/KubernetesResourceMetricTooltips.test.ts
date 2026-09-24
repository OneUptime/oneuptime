import { describe, expect, test } from "@jest/globals";
import {
  KUBERNETES_RESOURCE_METRIC_DESCRIPTIONS,
  KubernetesResourceMetric,
} from "../../../../App/FeatureSet/Dashboard/src/Components/MetricDescriptions/KubernetesResourceMetricDescriptions";
import {
  expectReadableDescriptionRecord,
  expectTitleExplained,
} from "./MetricDescriptionRules";

/*
 * The (i) tooltips on the Kubernetes resource pages: the list tables, the
 * Overview summary fields of every resource's detail page, the node's
 * Network Throughput chart and a pod's container cards.
 *
 * The same column title means different things from page to page - "CPU" is
 * a node's own usage on the Nodes list, a share of the NODE's allocatable
 * CPU on the Pods list, and a SUM of those shares on a Deployment row - so
 * beyond the shared readability rules these pin what each text promises
 * against what the page actually computes (see the notes in
 * KubernetesResourceMetricDescriptions.ts).
 */

const D: Record<KubernetesResourceMetric, string> =
  KUBERNETES_RESOURCE_METRIC_DESCRIPTIONS;

// Every title a customer sees beside an (i), with the text it opens.
const TITLES: Array<[string, KubernetesResourceMetric]> = [
  // Built-in list columns.
  ["CPU", "nodeCpu"],
  ["Memory", "nodeMemory"],
  ["CPU", "podCpu"],
  ["Memory", "podMemory"],
  ["CPU", "containerCpu"],
  ["Memory", "containerMemory"],
  ["CPU", "deploymentCpu"],
  ["Memory", "deploymentMemory"],
  ["CPU", "statefulSetCpu"],
  ["Memory", "statefulSetMemory"],
  ["CPU", "daemonSetCpu"],
  ["Memory", "daemonSetMemory"],
  ["CPU", "jobCpu"],
  ["Memory", "jobMemory"],
  ["CPU", "cronJobCpu"],
  ["Memory", "cronJobMemory"],
  ["CPU", "namespaceCpu"],
  ["Memory", "namespaceMemory"],
  // Custom list columns.
  ["Containers", "podContainers"],
  ["Restarts", "containerRestarts"],
  ["Ready", "deploymentReady"],
  ["Ready", "statefulSetReady"],
  ["Ready", "daemonSetReady"],
  ["Min Replicas", "hpaMinReplicas"],
  ["Max Replicas", "hpaMaxReplicas"],
  ["Current", "hpaCurrentReplicas"],
  ["Desired", "hpaDesiredReplicas"],
  ["Capacity", "pvcCapacity"],
  ["Capacity", "pvCapacity"],
  // Detail summary fields and headers.
  ["CPU (Capacity / Allocatable)", "nodeCpuCapacity"],
  ["Memory (Capacity / Allocatable)", "nodeMemoryCapacity"],
  ["Pods (Capacity)", "nodePodCapacity"],
  ["Network Throughput", "nodeNetworkThroughput"],
  ["Restarts", "podRestarts"],
  ["Rollout Status", "deploymentRolloutStatus"],
  ["Desired Replicas", "deploymentDesiredReplicas"],
  ["Ready Replicas", "deploymentReadyReplicas"],
  ["Available", "deploymentAvailableReplicas"],
  ["Unavailable", "deploymentUnavailableReplicas"],
  ["Replicas", "statefulSetReplicas"],
  ["Ready Replicas", "statefulSetReadyReplicas"],
  ["Desired Scheduled", "daemonSetDesiredScheduled"],
  ["Current Scheduled", "daemonSetCurrentScheduled"],
  ["Number Ready", "daemonSetNumberReady"],
  ["Number Available", "daemonSetNumberAvailable"],
  ["Completions", "jobCompletions"],
  ["Parallelism", "jobParallelism"],
  ["Backoff Limit", "jobBackoffLimit"],
  ["Active", "jobActive"],
  ["Succeeded", "jobSucceeded"],
  ["Failed", "jobFailed"],
  ["Active Jobs", "cronJobActiveJobs"],
  ["Successful Jobs History Limit", "cronJobSuccessfulJobsHistoryLimit"],
  ["Failed Jobs History Limit", "cronJobFailedJobsHistoryLimit"],
  ["Requested Storage", "pvcRequestedStorage"],
  ["Metrics", "hpaMetrics"],
  ["Recommendation (app)", "vpaRecommendation"],
  // A pod's container cards.
  ["State", "containerState"],
  ["Ready", "containerReady"],
  ["Requests", "containerRequests"],
  ["Limits", "containerLimits"],
];

const AVERAGE_PATTERN: RegExp = /averag/i;
const SENTENCE_END: RegExp = /[.!?](\s|$)/g;
const ALLOCATABLE_GLOSS: RegExp =
  /allocatable (CPU|memory)( on its node)? \(what the node can hand out to pods\)/;

const LIST_LATEST_CPU: Array<KubernetesResourceMetric> = [
  "nodeCpu",
  "podCpu",
  "containerCpu",
];

const LIST_LATEST_MEMORY: Array<KubernetesResourceMetric> = [
  "nodeMemory",
  "podMemory",
  "containerMemory",
];

// Workloads are matched to their pods by name only (see bugsFound).
const WORKLOAD_SUMS: Array<KubernetesResourceMetric> = [
  "deploymentCpu",
  "deploymentMemory",
  "statefulSetCpu",
  "statefulSetMemory",
  "daemonSetCpu",
  "daemonSetMemory",
  "jobCpu",
  "jobMemory",
  "cronJobCpu",
  "cronJobMemory",
];

const NAMESPACE_SUMS: Array<KubernetesResourceMetric> = [
  "namespaceCpu",
  "namespaceMemory",
];

const ALL_SUMS: Array<KubernetesResourceMetric> = [
  ...WORKLOAD_SUMS,
  ...NAMESPACE_SUMS,
];

const CPU_SUMS: Array<KubernetesResourceMetric> = ALL_SUMS.filter(
  (key: KubernetesResourceMetric): boolean => {
    return key.endsWith("Cpu");
  },
);

const MEMORY_SUMS: Array<KubernetesResourceMetric> = ALL_SUMS.filter(
  (key: KubernetesResourceMetric): boolean => {
    return key.endsWith("Memory");
  },
);

describe("Kubernetes resource metric descriptions", () => {
  test("every text is a short, finished, jargon-explaining sentence, and no two metrics share one", () => {
    expectReadableDescriptionRecord(
      KUBERNETES_RESOURCE_METRIC_DESCRIPTIONS,
      "KUBERNETES_RESOURCE_METRIC_DESCRIPTIONS",
    );
  });

  test("every text is one or two sentences", () => {
    const tooLong: Array<string> = [];

    for (const [key, text] of Object.entries(D)) {
      // A sentence ends at . ! or ? followed by a space or the end.
      const sentences: number = (text.match(SENTENCE_END) || []).length;

      if (sentences < 1 || sentences > 2) {
        tooLong.push(`${key}: ${sentences} sentences`);
      }
    }

    expect(tooLong).toEqual([]);
  });

  test("every title on the pages is explained by its text", () => {
    for (const [title, key] of TITLES) {
      expectTitleExplained(title, D[key]);
    }
  });

  test("the title table covers every description exactly once", () => {
    const keys: Array<KubernetesResourceMetric> = TITLES.map(
      (entry: [string, KubernetesResourceMetric]): KubernetesResourceMetric => {
        return entry[1];
      },
    );

    expect(new Set(keys).size).toBe(keys.length);
    expect([...keys].sort()).toEqual(Object.keys(D).sort());
  });

  test("no text talks down or sells", () => {
    for (const text of Object.values(D)) {
      expect(text).not.toMatch(
        /\b(simply|just|obviously|easily|powerful|seamless|blazing)\b/i,
      );
    }
  });
});

describe("list CPU and Memory: a single latest reading, never an average", () => {
  test.each([...LIST_LATEST_CPU, ...LIST_LATEST_MEMORY])(
    "%s says it turns N/A after 15 minutes without a reading",
    (key: KubernetesResourceMetric) => {
      expect(D[key]).toContain("N/A");
      expect(D[key]).toContain("15 minutes");
      expect(D[key]).toMatch(/most recent/);
    },
  );

  test.each(LIST_LATEST_CPU)(
    "%s says it is the latest sample, not an average",
    (key: KubernetesResourceMetric) => {
      expect(D[key]).toContain("latest sample, not an average");
    },
  );

  test("no list text claims an average anywhere else", () => {
    for (const key of [
      ...LIST_LATEST_CPU,
      ...LIST_LATEST_MEMORY,
      ...ALL_SUMS,
    ]) {
      const withoutDisclaimer: string = D[key].replace("not an average", "");

      expect(withoutDisclaimer).not.toMatch(AVERAGE_PATTERN);
    }
  });

  test("none of them follows a time picker - the lists have none", () => {
    for (const key of [
      ...LIST_LATEST_CPU,
      ...LIST_LATEST_MEMORY,
      ...ALL_SUMS,
    ]) {
      expect(D[key]).not.toMatch(/selected (time )?range/);
    }
  });
});

describe("what each CPU percentage is a share of", () => {
  test("a node's CPU is measured against its own allocatable CPU", () => {
    expect(D.nodeCpu).toContain("share of its allocatable CPU");
    expect(D.nodeCpu).toContain("reservation");
  });

  test("a pod's CPU is a share of its NODE, not of its own request or limit", () => {
    expect(D.podCpu).toContain("allocatable CPU on its node");
    expect(D.podCpu).toContain("not of the pod's own CPU request or limit");
  });

  test("a container's CPU is a share of its node, not of its own limit", () => {
    expect(D.containerCpu).toContain("allocatable CPU on its node");
    expect(D.containerCpu).toContain("not of its own CPU limit");
  });

  test("no per-resource CPU text claims to be a share of a request or limit", () => {
    for (const key of LIST_LATEST_CPU) {
      expect(D[key]).not.toMatch(
        /share of (its|the pod's) (CPU )?(request|limit)/,
      );
    }
  });
});

describe("what each memory percentage is a share of", () => {
  test("a node's memory is against its allocatable memory, falling back to its total", () => {
    expect(D.nodeMemory).toContain("allocatable memory");
    expect(D.nodeMemory).toContain(
      "total memory when allocatable is not reported",
    );
    expect(D.nodeMemory).toContain("file cache");
  });

  test("a pod's memory is against the limits its containers set, falling back to its node", () => {
    expect(D.podMemory).toContain(
      "sum of the memory limits its containers set",
    );
    expect(D.podMemory).toContain(
      "node's allocatable memory (what the node can hand out to pods) when none sets a limit",
    );
  });

  test("a container's memory is against its own limit, or shown as an amount", () => {
    expect(D.containerMemory).toContain("share of its memory limit");
    expect(D.containerMemory).toContain(
      "Without a limit only the amount is shown",
    );
  });

  test.each(LIST_LATEST_MEMORY)(
    "%s says the capped percentage stops at 100%%",
    (key: KubernetesResourceMetric) => {
      expect(D[key]).toMatch(/(stops at|up to) 100%/);
    },
  );
});

describe("workload and namespace columns are sums over pods", () => {
  test.each(ALL_SUMS)(
    "%s says the pods are added up and the total can pass 100%%",
    (key: KubernetesResourceMetric) => {
      expect(D[key]).toMatch(/added up|summed|the sum of/);
      expect(D[key]).toContain("can pass 100%");
    },
  );

  test.each(ALL_SUMS)(
    "%s counts only pods that reported in the last 15 minutes",
    (key: KubernetesResourceMetric) => {
      expect(D[key]).toContain("15 minutes");
    },
  );

  test.each(CPU_SUMS)(
    "%s sums each pod's share of ITS OWN node",
    (key: KubernetesResourceMetric) => {
      expect(D[key]).toMatch(/share of its (own )?node's allocatable CPU/);
    },
  );

  test.each(MEMORY_SUMS)(
    "%s gives both the amount and the summed share of node memory",
    (key: KubernetesResourceMetric) => {
      expect(D[key]).toContain("total amount");
      expect(D[key]).toContain("node's allocatable memory");
    },
  );

  /*
   * "Allocatable" is Kubernetes jargon, and each list page shows only its own
   * CPU and Memory columns - so every text that divides by it says what it
   * is, in the same words.
   */
  test.each([
    ...ALL_SUMS,
    "podCpu",
    "podMemory",
    "containerCpu",
  ] as Array<KubernetesResourceMetric>)(
    "%s says what allocatable means",
    (key: KubernetesResourceMetric) => {
      expect(D[key]).toMatch(ALLOCATABLE_GLOSS);
    },
  );

  test.each(WORKLOAD_SUMS)(
    "%s is honest that same-named workloads in other namespaces are added in",
    (key: KubernetesResourceMetric) => {
      expect(D[key]).toMatch(/same-named \w+ in other namespaces/);
    },
  );

  test.each(NAMESPACE_SUMS)(
    "%s groups by namespace, so it makes no same-name caveat",
    (key: KubernetesResourceMetric) => {
      expect(D[key]).not.toContain("same-named");
      expect(D[key]).toContain("every pod in this namespace");
    },
  );

  test("the bar is capped, the number is not", () => {
    expect(D.deploymentCpu).toContain("the bar stops there");
    expect(D.namespaceCpu).toContain("the bar stops there");
  });

  test("jobs and CronJobs explain why they are usually N/A", () => {
    expect(D.jobCpu).toContain("N/A soon after the job ends");
    expect(D.jobMemory).toContain("N/A soon after the job ends");
    expect(D.cronJobCpu).toContain("N/A between runs");
    expect(D.cronJobMemory).toContain("N/A between runs");
  });

  test("every workload's texts name their own kind", () => {
    expect(D.deploymentCpu).toContain("deployment's pods");
    expect(D.statefulSetCpu).toContain("StatefulSet's pods");
    expect(D.daemonSetCpu).toContain("DaemonSet's pods");
    expect(D.jobCpu).toContain("job's pods");
    expect(D.cronJobCpu).toContain("CronJob's runs");
    expect(D.deploymentMemory).toContain("deployment's pods");
    expect(D.statefulSetMemory).toContain("StatefulSet's pods");
    expect(D.daemonSetMemory).toContain("DaemonSet's pods");
    expect(D.jobMemory).toContain("job's pods");
    expect(D.cronJobMemory).toContain("CronJob's runs");
  });
});

describe("Kubernetes units and jargon are explained where they appear", () => {
  test("CPU quantities explain the m suffix", () => {
    expect(D.nodeCpuCapacity).toContain("m suffix means thousandths of a core");
    expect(D.containerRequests).toContain(
      "m suffix means thousandths of a core",
    );
    expect(D.vpaRecommendation).toContain("millicores (m)");
  });

  test("memory and storage quantities explain Ki, Mi and Gi", () => {
    expect(D.nodeMemoryCapacity).toContain(
      "kibibytes, mebibytes and gibibytes",
    );
    expect(D.pvcCapacity).toContain("Gi means gibibytes");
    expect(D.pvCapacity).toContain("Gi is gibibytes");
  });

  test("capacity and allocatable are told apart", () => {
    for (const key of [
      "nodeCpuCapacity",
      "nodeMemoryCapacity",
    ] as Array<KubernetesResourceMetric>) {
      expect(D[key]).toMatch(/^Capacity is the node's total/);
      expect(D[key]).toContain("allocatable is what");
    }
  });

  test("limits say what happens when they are crossed", () => {
    expect(D.containerLimits).toContain("throttled");
    expect(D.containerLimits).toContain("OOMKilled");
    expect(D.containerRequests).toContain("placed on a node");
  });

  test("readiness and availability are defined", () => {
    expect(D.deploymentReadyReplicas).toContain("readiness checks");
    expect(D.deploymentAvailableReplicas).toContain("minReadySeconds");
    expect(D.daemonSetNumberAvailable).toContain("minReadySeconds");
    expect(D.containerReady).toContain("readiness check");
  });

  test("the HPA target explains that Utilization is a share of CPU requests", () => {
    expect(D.hpaMetrics).toContain("cpu (Utilization: 70)");
    expect(D.hpaMetrics).toContain("70% of the pods' CPU requests");
  });

  test("a PVC's capacity can differ from what it requested", () => {
    expect(D.pvcCapacity).toContain("more than was requested");
    expect(D.pvcCapacity).toContain("N/A until the claim is bound");
    expect(D.pvcRequestedStorage).toContain(
      "provisioned capacity can be larger",
    );
  });
});

describe("detail fields describe what the page reads", () => {
  test("a pod's restart total leaves init containers out, as the page does", () => {
    expect(D.podRestarts).toContain("not counting init containers");
    expect(D.podContainers).toContain("not counting init containers");
  });

  test("the rollout status names the exact rule the badge uses", () => {
    expect(D.deploymentRolloutStatus).toContain(
      "ready pods matches the desired count and none are unavailable",
    );
    expect(D.deploymentRolloutStatus).toContain(
      "bar shows ready pods out of desired",
    );
  });

  test("Unavailable says it only appears when above zero", () => {
    expect(D.deploymentUnavailableReplicas).toContain(
      "Shown only when above zero",
    );
  });

  test("the colour of a ready badge is explained where it is coloured", () => {
    expect(D.statefulSetReadyReplicas).toContain("Green when all are ready");
    expect(D.daemonSetNumberReady).toContain("Green when all are");
  });

  test("a job's zero spec values are explained, since the page shows 0 when unset", () => {
    expect(D.jobCompletions).toContain("0 means no count was set");
    expect(D.jobParallelism).toContain("0 means the job is effectively paused");
    expect(D.jobBackoffLimit).toContain("6 unless the job sets another value");
  });

  test("CronJob Active Jobs is honest that it is not read correctly yet", () => {
    /*
     * The parser reads CronJob status.active - a LIST of job references -
     * with parseInt, so the field is always 0 (see bugsFound). The text must
     * not promise a live count.
     */
    expect(D.cronJobActiveJobs).toContain("shows 0 even during a run");
    expect(D.cronJobActiveJobs).toContain("Jobs list");
  });

  test("network throughput says it is a per-second rate over the chart's range", () => {
    expect(D.nodeNetworkThroughput).toContain("Bytes per second");
    expect(D.nodeNetworkThroughput).toContain(
      "added up across its network interfaces",
    );
    expect(D.nodeNetworkThroughput).toContain("counters grew");
    expect(D.nodeNetworkThroughput).toContain("selected time range");
  });

  test("the HPA's desired count is kept between min and max", () => {
    expect(D.hpaDesiredReplicas).toContain("between the min and max");
    expect(D.hpaMinReplicas).toContain("fewest pods");
    expect(D.hpaMaxReplicas).toContain("most pods");
  });

  test("CronJob history limits say what is kept and the Kubernetes defaults", () => {
    /*
     * Kubernetes defaults successfulJobsHistoryLimit to 3 and
     * failedJobsHistoryLimit to 1, so the stored object carries those.
     */
    expect(D.cronJobSuccessfulJobsHistoryLimit).toContain(
      "successful runs (Jobs)",
    );
    expect(D.cronJobSuccessfulJobsHistoryLimit).toContain(
      "Kubernetes keeps 3 unless",
    );
    expect(D.cronJobFailedJobsHistoryLimit).toContain("failed runs (Jobs)");
    expect(D.cronJobFailedJobsHistoryLimit).toContain(
      "Kubernetes keeps 1 unless",
    );
  });
});

describe("texts do not overstate what Kubernetes reports", () => {
  test("a node's CPU counts system processes too, so it can pass 100%", () => {
    /*
     * k8s.node.cpu.utilization is the whole node's cores in use, divided by
     * ALLOCATABLE cores (capacity minus the system reservation), and the
     * table prints the number uncapped - so a busy node reads over 100%.
     */
    expect(D.nodeCpu).toContain("system processes included");
    expect(D.nodeCpu).toContain("so it can pass 100%");
  });

  test("a container with no readiness check still counts as ready", () => {
    expect(D.containerReady).toContain(
      "one without a readiness check counts as ready once it runs",
    );
  });

  test("DaemonSet Current Scheduled counts placed pods, not only started ones", () => {
    expect(D.daemonSetCurrentScheduled).toContain("placed on them");
    expect(D.daemonSetCurrentScheduled).toContain("even if it has not started");
    expect(D.daemonSetCurrentScheduled).not.toContain("running");
  });

  test("the HPA Metrics field names what the page cannot spell out", () => {
    /*
     * The parser reads only spec.metrics[].resource, so ContainerResource,
     * Pods, Object and External targets render as their bare type.
     */
    expect(D.hpaMetrics).toContain(
      "custom, external and per-container targets show only their type name",
    );
    expect(D.hpaMetrics).not.toContain("other than CPU or memory");
  });

  test("a CPU limit throttles at the limit; memory kills past it", () => {
    expect(D.containerLimits).toContain("At its CPU limit");
    expect(D.containerLimits).toContain("over its memory limit");
  });

  test("the pod container count does not claim every init container exits", () => {
    // Native sidecars are init containers that keep running.
    expect(D.podContainers).not.toContain("exit");
  });

  test("a VPA memory recommendation can carry a decimal k suffix", () => {
    expect(D.vpaRecommendation).toMatch(/\bk\b/);
  });
});
