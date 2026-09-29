import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  KUBERNETES_RESOURCE_METRIC_DESCRIPTIONS,
  KubernetesResourceMetric,
} from "../../FeatureSet/Dashboard/src/Components/MetricDescriptions/KubernetesResourceMetricDescriptions";

/*
 * The (i) tooltips on the Kubernetes resource pages - every list table under
 * Pages/Kubernetes/View, the Overview summary fields of each resource's
 * detail page, the node's Network Throughput chart header and a pod's
 * container cards.
 *
 * "CPU" and "Memory" mean different things on different lists (a node's own
 * usage, a pod's share of its node, a SUM over a workload's pods), so each
 * page has to hand the table the text that matches what IT computes. These
 * pin that pairing - and the computations the texts describe - at the source
 * level. The App suite runs in plain Node with no renderer, so the JSX is
 * read, not rendered (Common/Tests/App/Dashboard/KubernetesResourceTooltips
 * .test.tsx renders it). Comments are stripped and ALL whitespace and
 * trailing commas removed, so a Prettier reflow or a rationale comment can
 * neither make a test pass nor fail.
 */

const DASHBOARD_SRC: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
);

const COMMON_SRC: string = path.join(__dirname, "..", "..", "..", "Common");

const WHITESPACE: RegExp = /\s+/g;
const TRAILING_COMMA: RegExp = /,([}\])])/g;
const BLOCK_COMMENT: RegExp = /\/\*[\s\S]*?\*\//g;
const LINE_COMMENT: RegExp = /(^|[^:])\/\/[^\n]*/g;
const DESCRIPTION_REFERENCE: RegExp =
  /KUBERNETES_RESOURCE_METRIC_DESCRIPTIONS\.(\w+)/g;

const REC: string = "KUBERNETES_RESOURCE_METRIC_DESCRIPTIONS";

function compact(text: string): string {
  return text.replace(WHITESPACE, "").replace(TRAILING_COMMA, "$1");
}

function stripComments(text: string): string {
  return text.replace(BLOCK_COMMENT, " ").replace(LINE_COMMENT, "$1");
}

function readFrom(root: string, relativePath: string): string {
  return compact(
    stripComments(
      fs.readFileSync(path.join(root, ...relativePath.split("/")), "utf8"),
    ),
  );
}

function readCode(relativePath: string): string {
  return readFrom(DASHBOARD_SRC, relativePath);
}

function countOf(haystack: string, needle: string): number {
  let count: number = 0;
  let index: number = haystack.indexOf(needle);

  while (index >= 0) {
    count++;
    index = haystack.indexOf(needle, index + needle.length);
  }

  return count;
}

/*
 * The `{ ... }` object literal that holds `marker`, in a compacted source.
 * Walks out to the nearest unmatched "{" and on to its matching "}", so the
 * test reads exactly one summary field or column - never its neighbour.
 */
function objectAround(code: string, marker: string): string {
  const at: number = code.indexOf(marker);

  if (at < 0) {
    throw new Error(`Expected the source to contain ${marker}`);
  }

  if (code.indexOf(marker, at + marker.length) >= 0) {
    throw new Error(`Expected ${marker} to appear once`);
  }

  let depth: number = 0;
  let start: number = at;

  for (; start >= 0; start--) {
    const char: string = code.charAt(start);

    if (char === "}") {
      depth++;
    } else if (char === "{") {
      if (depth === 0) {
        break;
      }
      depth--;
    }
  }

  depth = 0;

  for (let end: number = start; end < code.length; end++) {
    const char: string = code.charAt(end);

    if (char === "{") {
      depth++;
    } else if (char === "}") {
      depth--;

      if (depth === 0) {
        return code.slice(start, end + 1);
      }
    }
  }

  throw new Error(`Unbalanced braces around ${marker}`);
}

function between(code: string, from: string, to: string): string {
  const start: number = code.indexOf(from);

  if (start < 0) {
    throw new Error(`Expected the source to contain ${from}`);
  }

  const end: number = code.indexOf(to, start + from.length);

  if (end < 0) {
    throw new Error(`Expected ${to} after ${from}`);
  }

  return code.slice(start, end);
}

function referencedKeys(code: string): Array<string> {
  const keys: Array<string> = [];

  for (const match of code.matchAll(DESCRIPTION_REFERENCE)) {
    keys.push(match[1] as string);
  }

  return keys;
}

function describedBy(key: KubernetesResourceMetric): string {
  return compact(`description: ${REC}.${key}`);
}

const PAGES: string = "Pages/Kubernetes/View";
const RECORD_IMPORT: string = compact(
  'import { KUBERNETES_RESOURCE_METRIC_DESCRIPTIONS } from "../../../Components/MetricDescriptions/KubernetesResourceMetricDescriptions";',
);

/*
 * ---------------------------------------------------------------------------
 * Detail pages: Overview summary fields
 * ---------------------------------------------------------------------------
 */

// Page -> [title expression as written in the page, description key].
const DETAIL_FIELDS: Record<
  string,
  Array<[string, KubernetesResourceMetric]>
> = {
  NodeDetail: [
    ['"CPU (Capacity / Allocatable)"', "nodeCpuCapacity"],
    ['"Memory (Capacity / Allocatable)"', "nodeMemoryCapacity"],
    ['"Pods (Capacity)"', "nodePodCapacity"],
  ],
  PodDetail: [['"Restarts"', "podRestarts"]],
  DeploymentDetail: [
    ['"Rollout Status"', "deploymentRolloutStatus"],
    ['"Desired Replicas"', "deploymentDesiredReplicas"],
    ['"Ready Replicas"', "deploymentReadyReplicas"],
    ['"Available"', "deploymentAvailableReplicas"],
    ['"Unavailable"', "deploymentUnavailableReplicas"],
  ],
  StatefulSetDetail: [
    ['"Replicas"', "statefulSetReplicas"],
    ['"Ready Replicas"', "statefulSetReadyReplicas"],
  ],
  DaemonSetDetail: [
    ['"Desired Scheduled"', "daemonSetDesiredScheduled"],
    ['"Current Scheduled"', "daemonSetCurrentScheduled"],
    ['"Number Ready"', "daemonSetNumberReady"],
    ['"Number Available"', "daemonSetNumberAvailable"],
  ],
  JobDetail: [
    ['"Completions"', "jobCompletions"],
    ['"Parallelism"', "jobParallelism"],
    ['"Backoff Limit"', "jobBackoffLimit"],
    ['"Active"', "jobActive"],
    ['"Succeeded"', "jobSucceeded"],
    ['"Failed"', "jobFailed"],
  ],
  CronJobDetail: [
    ['"Successful Jobs History Limit"', "cronJobSuccessfulJobsHistoryLimit"],
    ['"Failed Jobs History Limit"', "cronJobFailedJobsHistoryLimit"],
    ['"Active Jobs"', "cronJobActiveJobs"],
  ],
  PVCDetail: [
    ['"Capacity"', "pvcCapacity"],
    ['"Requested Storage"', "pvcRequestedStorage"],
  ],
  PVDetail: [['"Capacity"', "pvCapacity"]],
  HPADetail: [
    ['"Min Replicas"', "hpaMinReplicas"],
    ['"Max Replicas"', "hpaMaxReplicas"],
    ['"Current Replicas"', "hpaCurrentReplicas"],
    ['"Desired Replicas"', "hpaDesiredReplicas"],
    ['"Metrics"', "hpaMetrics"],
  ],
  VPADetail: [["`Recommendation (${rec.containerName})`", "vpaRecommendation"]],
};

// Texts a detail page shows outside its summary fields.
const DETAIL_EXTRA_KEYS: Record<string, Array<KubernetesResourceMetric>> = {
  NodeDetail: ["nodeNetworkThroughput"],
};

// Identity fields: names, where the thing lives, when it was made.
const DETAIL_IDENTITY_FIELDS: Record<string, Array<string>> = {
  NodeDetail: ['"Node Name"', '"Cluster"', '"Internal IP"', '"Created"'],
  PodDetail: ['"Pod Name"', '"Cluster"', '"Namespace"', '"Created"'],
  DeploymentDetail: ['"Cluster"', '"Namespace"', '"Created"'],
  StatefulSetDetail: ['"Cluster"', '"Namespace"', '"Created"'],
  DaemonSetDetail: ['"Cluster"', '"Namespace"', '"Created"'],
  JobDetail: ['"Job Name"', '"Cluster"', '"Namespace"', '"Created"'],
  CronJobDetail: [
    '"CronJob Name"',
    '"Cluster"',
    '"Namespace"',
    '"Schedule"',
    '"Concurrency Policy"',
    '"Last Schedule Time"',
    '"Created"',
  ],
  PVCDetail: ['"PVC Name"', '"Cluster"', '"Namespace"', '"Created"'],
  PVDetail: ['"PV Name"', '"Cluster"', '"Created"'],
  HPADetail: ['"Cluster"', '"Namespace"', '"Created"'],
  VPADetail: ['"Cluster"', '"Namespace"', '"Created"'],
};

describe("detail pages: every metric-like summary field carries its tooltip", () => {
  test.each(Object.keys(DETAIL_FIELDS))(
    "%s imports the descriptions and types its fields as SummaryField",
    (page: string) => {
      const code: string = readCode(`${PAGES}/${page}.tsx`);

      expect(code).toContain(RECORD_IMPORT);
      expect(code).toContain(
        compact(
          'import KubernetesOverviewTab, { SummaryField } from "../../../Components/Kubernetes/KubernetesOverviewTab";',
        ),
      );
      expect(code).toContain(
        compact("const summaryFields: Array<SummaryField> = ["),
      );
      /*
       * The old inline type had no room for a description; a field added
       * with it would silently drop its tooltip.
       */
      expect(code).not.toContain(
        compact("Array<{ title: string; value: string | ReactElement }>"),
      );
      expect(code).not.toContain(
        compact("Array<{ title: string; value: string | ReactElement; }>"),
      );
    },
  );

  const cases: Array<[string, string, KubernetesResourceMetric]> = [];

  for (const [page, fields] of Object.entries(DETAIL_FIELDS)) {
    for (const [title, key] of fields) {
      cases.push([page, title, key]);
    }
  }

  test.each(cases)(
    "%s: the %s field is explained by %s",
    (page: string, title: string, key: KubernetesResourceMetric) => {
      const code: string = readCode(`${PAGES}/${page}.tsx`);
      const field: string = objectAround(code, compact(`title: ${title},`));

      expect(field).toContain(describedBy(key));
      // One field, one text.
      expect(countOf(field, "description:")).toBe(1);
    },
  );

  test.each(Object.entries(DETAIL_FIELDS))(
    "%s explains exactly the fields listed here - no stray texts",
    (page: string, fields: Array<[string, KubernetesResourceMetric]>) => {
      const code: string = readCode(`${PAGES}/${page}.tsx`);

      expect(countOf(code, compact(`description: ${REC}.`))).toBe(
        fields.length,
      );
      expect(referencedKeys(code).sort()).toEqual(
        [
          ...fields.map((field: [string, KubernetesResourceMetric]): string => {
            return field[1];
          }),
          ...(DETAIL_EXTRA_KEYS[page] || []),
        ].sort(),
      );
    },
  );

  test.each(Object.entries(DETAIL_IDENTITY_FIELDS))(
    "%s leaves identity fields (names, cluster, namespace, age) without a metric text",
    (page: string, titles: Array<string>) => {
      const code: string = readCode(`${PAGES}/${page}.tsx`);

      for (const title of titles) {
        const field: string = objectAround(code, compact(`title: ${title},`));

        expect({ title, field }).toEqual({
          title,
          field: expect.not.stringContaining("description:"),
        });
      }
    },
  );

  test.each(["NamespaceDetail", "ContainerDetail"])(
    "%s shows no metric-like summary field, so it attaches no metric text",
    (page: string) => {
      const code: string = readCode(`${PAGES}/${page}.tsx`);

      /*
       * NamespaceDetail's Overview is name, cluster, a status badge and age;
       * ContainerDetail's is name and cluster. Their charts sit on the
       * Metrics tab, which carries its own visible chart descriptions.
       */
      expect(code).not.toContain(REC);
    },
  );
});

describe("NodeDetail: the Network Throughput chart header", () => {
  const code: string = readCode(`${PAGES}/NodeDetail.tsx`);
  const extraCharts: string = between(
    code,
    "renderExtraCharts={",
    "<KubernetesNetworkThroughputChart",
  );

  test("the header carries an (i) with the throughput text", () => {
    expect(code).toContain(
      compact(
        'import InfoTooltip from "Common/UI/Components/Tooltip/InfoTooltip";',
      ),
    );
    expect(extraCharts).toContain(
      compact(
        `<span>Network Throughput</span>
         <InfoTooltip
           label="Network Throughput"
           text={ ${REC}.nodeNetworkThroughput }
         />`,
      ),
    );
  });

  test("the (i) is not nested inside anything clickable", () => {
    expect(extraCharts).not.toContain("<button");
    expect(extraCharts).not.toContain("<a");
    expect(extraCharts).not.toContain("<Link");
  });

  test("the chart it explains is the per-second rate of the node's network counter", () => {
    const utils: string = readCode(
      "Pages/Kubernetes/Utils/KubernetesNetworkUtils.ts",
    );

    expect(utils).toContain(compact('"k8s.node.network.io"'));
    expect(utils).toContain(compact("return computeCounterRate(result, {"));
    // Summed across interfaces: the series key is node|interface.
    expect(utils).toContain(compact("return `${node}|${interfaceName}`;"));
    expect(
      KUBERNETES_RESOURCE_METRIC_DESCRIPTIONS.nodeNetworkThroughput,
    ).toContain("added up across its network interfaces");
  });
});

/*
 * ---------------------------------------------------------------------------
 * List pages: built-in CPU / Memory columns and custom metric columns
 * ---------------------------------------------------------------------------
 */

interface ListPage {
  // Built-in CPU / Memory header texts, or null when the list hides them.
  builtIn: [KubernetesResourceMetric, KubernetesResourceMetric] | null;
  columns: Array<[string, KubernetesResourceMetric]>;
  // Rows carry pod sums from the aggregate endpoints.
  sumsPods: boolean;
}

const LIST_PAGES: Record<string, ListPage> = {
  Nodes: { builtIn: ["nodeCpu", "nodeMemory"], columns: [], sumsPods: false },
  Pods: {
    builtIn: ["podCpu", "podMemory"],
    columns: [["Containers", "podContainers"]],
    sumsPods: false,
  },
  Containers: {
    builtIn: ["containerCpu", "containerMemory"],
    columns: [["Restarts", "containerRestarts"]],
    sumsPods: false,
  },
  Deployments: {
    builtIn: ["deploymentCpu", "deploymentMemory"],
    columns: [["Ready", "deploymentReady"]],
    sumsPods: true,
  },
  StatefulSets: {
    builtIn: ["statefulSetCpu", "statefulSetMemory"],
    columns: [["Ready", "statefulSetReady"]],
    sumsPods: true,
  },
  DaemonSets: {
    builtIn: ["daemonSetCpu", "daemonSetMemory"],
    columns: [["Ready", "daemonSetReady"]],
    sumsPods: true,
  },
  Jobs: { builtIn: ["jobCpu", "jobMemory"], columns: [], sumsPods: true },
  CronJobs: {
    builtIn: ["cronJobCpu", "cronJobMemory"],
    columns: [],
    sumsPods: true,
  },
  Namespaces: {
    builtIn: ["namespaceCpu", "namespaceMemory"],
    columns: [],
    sumsPods: true,
  },
  HPAs: {
    builtIn: null,
    columns: [
      ["Min Replicas", "hpaMinReplicas"],
      ["Max Replicas", "hpaMaxReplicas"],
      ["Current", "hpaCurrentReplicas"],
      ["Desired", "hpaDesiredReplicas"],
    ],
    sumsPods: false,
  },
  VPAs: { builtIn: null, columns: [], sumsPods: false },
  PersistentVolumeClaims: {
    builtIn: null,
    columns: [["Capacity", "pvcCapacity"]],
    sumsPods: false,
  },
  PersistentVolumes: {
    builtIn: null,
    columns: [["Capacity", "pvCapacity"]],
    sumsPods: false,
  },
};

const METRIC_LISTS: Array<[string, ListPage]> = Object.entries(
  LIST_PAGES,
).filter((entry: [string, ListPage]): boolean => {
  return entry[1].builtIn !== null;
});

describe("list pages: every CPU / Memory column says what it is a share of", () => {
  test.each(Object.keys(LIST_PAGES))(
    "%s hides the built-in metric columns exactly when it passes no texts for them",
    (page: string) => {
      const code: string = readCode(`${PAGES}/${page}.tsx`);
      const table: string = between(code, "<KubernetesResourceTable", "/>)");
      const hidesMetrics: boolean = table.includes(
        "showResourceMetrics={false}",
      );

      expect(hidesMetrics).toBe(LIST_PAGES[page]!.builtIn === null);
      expect(table.includes("builtInColumnDescriptions=")).toBe(!hidesMetrics);
    },
  );

  test.each(METRIC_LISTS)(
    "%s hands the table its own CPU and Memory texts",
    (page: string, list: ListPage) => {
      const code: string = readCode(`${PAGES}/${page}.tsx`);
      const [cpu, memory] = list.builtIn as [
        KubernetesResourceMetric,
        KubernetesResourceMetric,
      ];

      expect(code).toContain(RECORD_IMPORT);
      expect(code).toContain(
        compact(
          `builtInColumnDescriptions={{
            cpu: ${REC}.${cpu},
            memory: ${REC}.${memory},
          }}`,
        ),
      );
    },
  );

  test("no two lists share a CPU or a Memory text - each computes its own", () => {
    const cpuKeys: Array<string> = METRIC_LISTS.map(
      (entry: [string, ListPage]): string => {
        return entry[1].builtIn![0];
      },
    );
    const memoryKeys: Array<string> = METRIC_LISTS.map(
      (entry: [string, ListPage]): string => {
        return entry[1].builtIn![1];
      },
    );

    expect(new Set(cpuKeys).size).toBe(cpuKeys.length);
    expect(new Set(memoryKeys).size).toBe(memoryKeys.length);
  });

  test.each(METRIC_LISTS)(
    "%s: a list of pod sums says so, and a list of single readings says that",
    (page: string, list: ListPage) => {
      const code: string = readCode(`${PAGES}/${page}.tsx`);
      const [cpu, memory] = list.builtIn as [
        KubernetesResourceMetric,
        KubernetesResourceMetric,
      ];
      const cpuText: string = KUBERNETES_RESOURCE_METRIC_DESCRIPTIONS[cpu];
      const memoryText: string =
        KUBERNETES_RESOURCE_METRIC_DESCRIPTIONS[memory];

      expect(
        code.includes("KubernetesResourceUtils.applyAggregateMetrics("),
      ).toBe(list.sumsPods);

      if (list.sumsPods) {
        expect(cpuText).toContain("can pass 100%");
        expect(memoryText).toContain("can pass 100%");
      } else {
        expect(cpuText).toContain("latest sample, not an average");
        expect(memoryText).toContain("most recent memory use");
      }
    },
  );

  test("workload lists are summed by owner, the Namespaces list by namespace", () => {
    for (const [page, kind] of [
      ["Deployments", "Deployment"],
      ["StatefulSets", "StatefulSet"],
      ["DaemonSets", "DaemonSet"],
      ["Jobs", "Job"],
      ["CronJobs", "CronJob"],
    ]) {
      expect(readCode(`${PAGES}/${page}.tsx`)).toContain(
        compact(
          `KubernetesResourceUtils.fetchPodMetricsByOwner(modelId, "${kind}")`,
        ),
      );
    }

    expect(readCode(`${PAGES}/Namespaces.tsx`)).toContain(
      compact("KubernetesResourceUtils.fetchPodMetricsByNamespace(modelId)"),
    );
  });
});

describe("list pages: custom metric columns carry their tooltip", () => {
  const cases: Array<[string, string, KubernetesResourceMetric]> = [];

  for (const [page, list] of Object.entries(LIST_PAGES)) {
    for (const [title, key] of list.columns) {
      cases.push([page, title, key]);
    }
  }

  test.each(cases)(
    "%s: the %s column is explained by %s",
    (page: string, title: string, key: KubernetesResourceMetric) => {
      const code: string = readCode(`${PAGES}/${page}.tsx`);
      const column: string = objectAround(code, compact(`title: "${title}",`));

      expect(column).toContain(describedBy(key));
    },
  );

  test.each(Object.entries(LIST_PAGES))(
    "%s references exactly the texts listed here",
    (page: string, list: ListPage) => {
      const code: string = readCode(`${PAGES}/${page}.tsx`);
      const expected: Array<string> = [
        ...(list.builtIn || []),
        ...list.columns.map(
          (column: [string, KubernetesResourceMetric]): string => {
            return column[1];
          },
        ),
      ];

      expect(referencedKeys(code).sort()).toEqual(expected.sort());
    },
  );

  test("name-like columns stay without a metric text", () => {
    for (const [page, title] of [
      ["Pods", "Node"],
      ["Containers", "Pod"],
      ["HPAs", "Target"],
      ["VPAs", "Target"],
      ["VPAs", "Update Mode"],
      ["CronJobs", "Schedule"],
      ["PersistentVolumeClaims", "Storage Class"],
      ["PersistentVolumeClaims", "Volume"],
      ["PersistentVolumeClaims", "Access Modes"],
      ["PersistentVolumes", "Storage Class"],
      ["PersistentVolumes", "Reclaim Policy"],
      ["PersistentVolumes", "Claim"],
    ] as Array<[string, string]>) {
      const column: string = objectAround(
        readCode(`${PAGES}/${page}.tsx`),
        compact(`title: "${title}",`),
      );

      expect({ page, title, column }).toEqual({
        page,
        title,
        column: expect.not.stringContaining("description:"),
      });
    }
  });
});

/*
 * ---------------------------------------------------------------------------
 * What the texts say, against what the code computes
 * ---------------------------------------------------------------------------
 */

describe("the texts match the computations behind the lists", () => {
  test("the 15-minute window the texts promise is the window the code uses", () => {
    expect(
      readCode("Pages/Kubernetes/Utils/KubernetesResourceUtils.ts"),
    ).toContain(
      compact(
        "private static readonly METRIC_STALE_MS: number = 15 * 60 * 1000;",
      ),
    );
    expect(readCode(`${PAGES}/Containers.tsx`)).toContain(
      compact("const METRIC_STALE_MS: number = 15 * 60 * 1000;"),
    );

    const api: string = readFrom(
      COMMON_SRC,
      "Server/API/KubernetesResourceAPI.ts",
    );

    expect(
      countOf(
        api,
        compact(
          "const staleAfter: Date = new Date(Date.now() - 15 * 60 * 1000);",
        ),
      ),
    ).toBe(2);
  });

  test("the Nodes list measures memory against the node's allocatable, then its capacity", () => {
    const code: string = readCode(`${PAGES}/Nodes.tsx`);

    expect(code).toContain(
      compact(
        '(allocatable["memory"] as string) || (capacity["memory"] as string) || ""',
      ),
    );
    expect(KUBERNETES_RESOURCE_METRIC_DESCRIPTIONS.nodeMemory).toContain(
      "total memory when allocatable is not reported",
    );
  });

  test("the Pods list measures memory against its containers' limits, then its node", () => {
    const code: string = readCode(`${PAGES}/Pods.tsx`);

    expect(code).toContain(
      compact('const memLimit: unknown = limits["memory"];'),
    );
    expect(code).toContain(
      compact("KubernetesResourceUtils.fetchNodeAllocatableMemory(modelId)"),
    );
    expect(KUBERNETES_RESOURCE_METRIC_DESCRIPTIONS.podMemory).toContain(
      "sum of the memory limits its containers set",
    );
  });

  test("the Containers list measures memory against the container's own limit", () => {
    const code: string = readCode(`${PAGES}/Containers.tsx`);

    expect(code).toContain(compact("memoryLimitBytes: true,"));
    expect(KUBERNETES_RESOURCE_METRIC_DESCRIPTIONS.containerMemory).toContain(
      "share of its memory limit",
    );
  });

  test("the Pods list counts regular containers only", () => {
    const code: string = readCode(`${PAGES}/Pods.tsx`);

    expect(code).toContain(
      compact('(spec["containers"] as Array<Record<string, unknown>>) || [];'),
    );
    expect(code).toContain(
      compact(
        'resource.additionalAttributes["containers"] = `${containers.length}`;',
      ),
    );
    expect(code).not.toContain("initContainers");
  });

  test("the table caps the bars at 100% but prints summed values in full", () => {
    const table: string = readCode(
      "Components/Infrastructure/ResourceTable.tsx",
    );

    expect(table).toContain(
      compact("const pct: number = Math.min(resource.cpuUtilization, 100);"),
    );
    expect(table).toContain(
      compact("{formatCpuValue(resource.cpuUtilization)}"),
    );
    expect(table).toContain(
      compact("const pct: number = Math.min(resource.memoryUtilization, 100);"),
    );
    expect(table).toContain(
      compact("{resource.memoryUtilization.toFixed(1)}%"),
    );
    // A limit-based percentage is capped in the number too.
    expect(table).toContain(compact("{Math.round(pct)}%"));
  });

  test("workload sums are keyed by owner NAME only - the texts own up to it", () => {
    /*
     * Pinned so that the day the aggregate is keyed by namespace too, this
     * fails and the "same-named ... in other namespaces" caveat is dropped
     * from the texts.
     */
    expect(
      readCode("Pages/Kubernetes/Utils/KubernetesResourceUtils.ts"),
    ).toContain(
      compact(
        "const agg: PodMetricAggregate | undefined = options.aggregates.get( resource.name, );",
      ),
    );

    for (const key of [
      "deploymentCpu",
      "statefulSetCpu",
      "daemonSetCpu",
      "jobCpu",
      "cronJobCpu",
    ] as Array<KubernetesResourceMetric>) {
      expect(KUBERNETES_RESOURCE_METRIC_DESCRIPTIONS[key]).toContain(
        "same-named",
      );
    }
  });

  test("CronJob Active Jobs reads a list as a number - the text owns up to it", () => {
    /*
     * CronJob status.active is a list of job references; parseInt of its
     * (empty) string form is NaN, so the parser always stores 0. Pinned so
     * that fixing the parser fails this and the caveat is dropped.
     */
    const parser: string = readFrom(
      COMMON_SRC,
      "Types/Kubernetes/KubernetesObjectParser.ts",
    );
    const cronJob: string = between(
      parser,
      compact("export function parseCronJobObject("),
      compact("export function parseNamespaceObject("),
    );

    expect(cronJob).toContain(
      compact(
        'activeCount: statusKv ? parseInt(getKvStringValue(statusKv as JSONObject, "active")) || 0 : 0',
      ),
    );
    expect(KUBERNETES_RESOURCE_METRIC_DESCRIPTIONS.cronJobActiveJobs).toContain(
      "shows 0 even during a run",
    );
  });

  test("a pod's restart total sums regular containers only, as its text says", () => {
    const code: string = readCode(`${PAGES}/PodDetail.tsx`);

    expect(code).toContain(
      compact(
        "const restartCount: number = podObject.status.containerStatuses.reduce(",
      ),
    );
    expect(KUBERNETES_RESOURCE_METRIC_DESCRIPTIONS.podRestarts).toContain(
      "not counting init containers",
    );
  });

  test("the rollout badge uses the rule its text states", () => {
    const code: string = readCode(`${PAGES}/DeploymentDetail.tsx`);

    expect(code).toContain(
      compact(
        "const isFullyRolledOut: boolean = ready === desired && unavailable === 0;",
      ),
    );
    expect(code).toContain(compact("if (unavailable > 0) {"));
  });
});

/*
 * ---------------------------------------------------------------------------
 * A pod's Containers tab
 * ---------------------------------------------------------------------------
 */

describe("KubernetesContainersTab: the container cards explain their numbers", () => {
  const code: string = readCode(
    "Components/Kubernetes/KubernetesContainersTab.tsx",
  );

  test.each([
    ["State", "containerState"],
    ["Ready", "containerReady"],
    ["Restarts", "containerRestarts"],
  ] as Array<[string, KubernetesResourceMetric]>)(
    "the %s card passes %s to InfoCard",
    (title: string, key: KubernetesResourceMetric) => {
      expect(code).toContain(
        compact(`<InfoCard title="${title}" tooltip={${REC}.${key}}`),
      );
    },
  );

  test.each([
    ["Requests", "containerRequests"],
    ["Limits", "containerLimits"],
  ] as Array<[string, KubernetesResourceMetric]>)(
    "the %s header has an (i) with %s",
    (title: string, key: KubernetesResourceMetric) => {
      expect(code).toContain(
        compact(
          `<span>${title}</span>
           <InfoTooltip
             label="${title}"
             text={${REC}.${key}}
             className="normal-case tracking-normal"
           />`,
        ),
      );
    },
  );

  test("exactly two inline (i)s, and neither inside the expand buttons", () => {
    expect(countOf(code, "<InfoTooltip")).toBe(2);

    for (const toggle of [
      "setShowEnv(!showEnv);",
      "setShowMounts(!showMounts);",
    ]) {
      const button: string = between(code, "<button", toggle);

      expect(button).not.toContain("InfoTooltip");
    }
  });
});

/*
 * ---------------------------------------------------------------------------
 * The record against every file that shows it
 * ---------------------------------------------------------------------------
 */

describe("every Kubernetes resource text is shown, and every reference exists", () => {
  const files: Array<string> = [
    ...Object.keys(DETAIL_FIELDS).map((page: string): string => {
      return `${PAGES}/${page}.tsx`;
    }),
    ...Object.keys(LIST_PAGES).map((page: string): string => {
      return `${PAGES}/${page}.tsx`;
    }),
    "Components/Kubernetes/KubernetesContainersTab.tsx",
  ];

  const referenced: Map<string, Array<string>> = new Map();

  for (const file of files) {
    for (const key of referencedKeys(readCode(file))) {
      referenced.set(key, [...(referenced.get(key) || []), file]);
    }
  }

  test("no page references a text that does not exist", () => {
    const known: Array<string> = Object.keys(
      KUBERNETES_RESOURCE_METRIC_DESCRIPTIONS,
    );

    expect(
      [...referenced.keys()].filter((key: string): boolean => {
        return !known.includes(key);
      }),
    ).toEqual([]);
  });

  test("every text is shown by one of these pages", () => {
    expect(
      Object.keys(KUBERNETES_RESOURCE_METRIC_DESCRIPTIONS).filter(
        (key: string): boolean => {
          return !referenced.has(key);
        },
      ),
    ).toEqual([]);
  });

  test("a metric shown on both a list and a detail page uses one text for both", () => {
    const sharedOn: Array<[KubernetesResourceMetric, Array<string>]> = [
      ["hpaMinReplicas", ["HPAs", "HPADetail"]],
      ["hpaMaxReplicas", ["HPAs", "HPADetail"]],
      ["hpaCurrentReplicas", ["HPAs", "HPADetail"]],
      ["hpaDesiredReplicas", ["HPAs", "HPADetail"]],
      ["pvcCapacity", ["PersistentVolumeClaims", "PVCDetail"]],
      ["pvCapacity", ["PersistentVolumes", "PVDetail"]],
    ];

    for (const [key, pages] of sharedOn) {
      expect(referenced.get(key)?.sort()).toEqual(
        pages
          .map((page: string): string => {
            return `${PAGES}/${page}.tsx`;
          })
          .sort(),
      );
    }

    expect(referenced.get("containerRestarts")?.sort()).toEqual(
      [
        "Components/Kubernetes/KubernetesContainersTab.tsx",
        `${PAGES}/Containers.tsx`,
      ].sort(),
    );
  });
});
