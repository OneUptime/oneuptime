import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  KUBERNETES_CLUSTER_METRIC_DESCRIPTIONS,
  KUBERNETES_COST_METRIC_DESCRIPTIONS,
  KUBERNETES_RIGHT_SIZING_METRIC_DESCRIPTIONS,
} from "../../FeatureSet/Dashboard/src/Components/MetricDescriptions/KubernetesClusterMetricDescriptions";

/*
 * Every metric on the Kubernetes cluster pages carries an (i) that says what
 * the number means. The pages compose charts, tables and model cards that no
 * node harness renders (the jsdom render tests live in the Common suite), so
 * the wiring is pinned here by reading the sources: each title is paired with
 * its own description reference, the counts match (no tile, chart card,
 * summary card or column slipped through), and the numbers the texts quote
 * (the 5-minute tile window, the idle % thresholds, the efficiency colours,
 * the 15-minute disconnect) are read back out of the code that computes
 * them. Comments are stripped and whitespace squashed so Prettier reflows and
 * rationale comments cannot make a test pass or fail.
 */

const DASHBOARD_SRC: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
);

const COMMON_ROOT: string = path.join(__dirname, "..", "..", "..", "Common");

const BLOCK_COMMENT: RegExp = /\/\*[\s\S]*?\*\//g;
const LINE_COMMENT: RegExp = /(^|[^:])\/\/[^\n]*/g;
const WHITESPACE: RegExp = /\s+/g;
const TITLE_ATTRIBUTE: RegExp = /title="([^"]+)"/;
const TITLE_PROPERTY: RegExp = /title: "([^"]+)"/;
const LABEL_PROPERTY: RegExp = /label: "([^"]+)"/;
const TILE_WINDOW: RegExp = /const TILE_WINDOW_MINUTES: number = (\d+);/;
const TOP_POD_SLICE: RegExp = /\.slice\(0, (\d+)\)/g;
const IDLE_THRESHOLDS: RegExp =
  /thresholds=\{\{ warn: (\d+), danger: (\d+) \}\}/;
const EFFICIENCY_GREEN: RegExp = /percent >= (\d+) \? "bg-green-50/;
const EFFICIENCY_YELLOW: RegExp = /: percent >= (\d+) \? "bg-yellow-50/;
const DISCONNECT_MINUTES: RegExp =
  /OneUptimeDate\.getCurrentDate\(\), -(\d+), \);/;
const TOP_PODS_HOURS: RegExp =
  /const hoursBack: number = options\.hoursBack \|\| (\d+);/;

/*
 * Prettier decides where a JSX expression breaks (`text={X}` or
 * `text={ X }`), so code snippets are compared with the space around
 * brackets, parens, commas and semicolons removed on both sides.
 */
const BRACKET_SPACE: RegExp = /\s*([{}()[\],;])\s*/g;

function tight(text: string): string {
  return text.replace(BRACKET_SPACE, "$1");
}

function expectCode(source: string, snippet: string): void {
  expect(tight(source)).toContain(tight(snippet));
}

function readSource(absolutePath: string): string {
  return fs.readFileSync(absolutePath, "utf8");
}

function squash(text: string): string {
  return text.replace(WHITESPACE, " ");
}

function stripComments(text: string): string {
  return text.replace(BLOCK_COMMENT, " ").replace(LINE_COMMENT, "$1");
}

function readCode(relativePath: string): string {
  return squash(
    stripComments(
      readSource(path.join(DASHBOARD_SRC, ...relativePath.split("/"))),
    ),
  );
}

function readCommonCode(relativePath: string): string {
  return squash(
    stripComments(
      readSource(path.join(COMMON_ROOT, ...relativePath.split("/"))),
    ),
  );
}

function between(source: string, from: string, to: string): string {
  const start: number = source.indexOf(from);

  if (start < 0) {
    throw new Error(`Expected the source to contain "${from}".`);
  }

  const end: number = source.indexOf(to, start + from.length);

  if (end < 0) {
    throw new Error(`Expected "${to}" after "${from}".`);
  }

  return source.slice(start, end);
}

function countOf(source: string, needle: string): number {
  return source.split(needle).length - 1;
}

/*
 * The description reference inside one element or object literal, e.g.
 * `description={KUBERNETES_COST_METRIC_DESCRIPTIONS.totalSpend}` or
 * `headerTooltip: KUBERNETES_COST_METRIC_DESCRIPTIONS.efficiency`.
 */
function referenceIn(
  chunk: string,
  prop: string,
  record: string,
): string | null {
  const pattern: RegExp = new RegExp(`${prop}(?:=\\{|:)\\s*${record}\\.(\\w+)`);
  const match: RegExpMatchArray | null = chunk.match(pattern);

  return match ? match[1]! : null;
}

/*
 * Split a block at every occurrence of `opener` and pair each piece's title
 * with the description key it passes.
 */
function pairsIn(data: {
  block: string;
  opener: string;
  closer: string;
  titlePattern: RegExp;
  prop: string;
  record: string;
}): Array<[string, string | null]> {
  return data.block
    .split(data.opener)
    .slice(1)
    .map((piece: string): [string, string | null] => {
      const end: number = piece.indexOf(data.closer);
      const chunk: string = end >= 0 ? piece.slice(0, end) : piece;
      const title: RegExpMatchArray | null = chunk.match(data.titlePattern);

      return [
        title ? title[1]! : "(no title)",
        referenceIn(chunk, data.prop, data.record),
      ];
    });
}

const CLUSTER_RECORD: string = "KUBERNETES_CLUSTER_METRIC_DESCRIPTIONS";
const COST_RECORD: string = "KUBERNETES_COST_METRIC_DESCRIPTIONS";
const RIGHT_SIZING_RECORD: string =
  "KUBERNETES_RIGHT_SIZING_METRIC_DESCRIPTIONS";

const OVERVIEW: string = readCode("Pages/Kubernetes/View/Index.tsx");
const RIGHT_SIZING: string = readCode(
  "Pages/Kubernetes/View/KubernetesRightSizingCard.tsx",
);
const CLUSTER_COSTS: string = readCode("Pages/Kubernetes/View/Costs.tsx");
const FLEET_COSTS: string = readCode("Pages/Kubernetes/Costs.tsx");
const INSIGHTS: string = readCode("Pages/Kubernetes/View/Insights.tsx");
const CONTROL_PLANE: string = readCode(
  "Pages/Kubernetes/View/ControlPlane.tsx",
);
const SERVICE_MESH: string = readCode("Pages/Kubernetes/View/ServiceMesh.tsx");

describe("cluster overview: golden tiles", () => {
  const tiles: string = between(
    OVERVIEW,
    "const renderGoldenMetrics:",
    "const renderChartCard:",
  );

  test("imports the descriptions and the (i)", () => {
    expectCode(
      OVERVIEW,
      `import { ${CLUSTER_RECORD} } from "../../../Components/MetricDescriptions/KubernetesClusterMetricDescriptions";`,
    );
    expectCode(
      OVERVIEW,
      'import InfoTooltip from "Common/UI/Components/Tooltip/InfoTooltip";',
    );
  });

  test("every tile passes its own description", () => {
    expect(
      pairsIn({
        block: tiles,
        opener: "<GoldenMetricTile",
        closer: "/>",
        titlePattern: TITLE_ATTRIBUTE,
        prop: "description",
        record: CLUSTER_RECORD,
      }),
    ).toEqual([
      ["Availability", "availability"],
      ["CPU", "cpu"],
      ["Memory", "memory"],
      ["Filesystem", "filesystem"],
      ["Network", "network"],
    ]);
  });

  test("tile and description counts match", () => {
    expect(countOf(tiles, "<GoldenMetricTile")).toBe(5);
    expect(countOf(tiles, `description={${CLUSTER_RECORD}.`)).toBe(5);
  });
});

describe("cluster overview: golden charts", () => {
  const charts: string = between(
    OVERVIEW,
    "const renderGoldenCharts:",
    "const renderResourceLinks:",
  );

  test("every chart card passes its own description", () => {
    expect(
      pairsIn({
        block: charts,
        opener: "renderChartCard({",
        closer: "})}",
        titlePattern: TITLE_PROPERTY,
        prop: "description",
        record: CLUSTER_RECORD,
      }),
    ).toEqual([
      ["Availability", "availabilityChart"],
      ["CPU", "cpuChart"],
      ["Memory", "memoryChart"],
      ["Filesystem", "filesystemChart"],
      ["Network", "networkChart"],
    ]);
    expect(countOf(charts, "renderChartCard({")).toBe(5);
  });

  test("the renderer requires a description, so a new chart cannot skip it", () => {
    const renderer: string = between(
      OVERVIEW,
      "const renderChartCard:",
      "const renderGoldenCharts:",
    );

    expectCode(renderer, "title: string; description: string;");
    expect(renderer).not.toContain("description?: string");
    expectCode(renderer, "description={params.description}");
    expectCode(renderer, "<ClusterChartCard");
  });

  test("the chart card builds its header once and shows it in both branches", () => {
    const card: string = between(
      OVERVIEW,
      "export const ClusterChartCard:",
      "export function titleWithTooltip(",
    );
    const header: string = between(
      card,
      "const header: ReactElement =",
      "if (!props.chartWindow)",
    );

    expectCode(
      header,
      "<InfoTooltip label={props.title} text={props.description} />",
    );
    expectCode(header, "{props.title}");
    // Loading skeleton and loaded chart.
    expect(countOf(card, "{header}")).toBe(2);
    // The title is drawn once (the (i) only names itself after it).
    expect(countOf(tight(card), ">{props.title}<")).toBe(1);
  });
});

describe("cluster overview: hero chips", () => {
  const hero: string = between(
    OVERVIEW,
    "const renderHero:",
    "return ( <Fragment> {renderHero()}",
  );

  test("each pod status chip carries its own description", () => {
    const chips: string = between(
      hero,
      "const podStatusChips:",
      "return ( <div",
    );

    expect(
      pairsIn({
        block: chips,
        opener: "podStatusChips.push({",
        closer: "});",
        titlePattern: LABEL_PROPERTY,
        prop: "description",
        record: CLUSTER_RECORD,
      }),
    ).toEqual([
      ["Running", "podsRunning"],
      ["Pending", "podsPending"],
      ["Failed", "podsFailed"],
      ["Nodes Not Ready", "nodesNotReady"],
    ]);
  });

  test("the chip renders its (i) inside the chip, named after the chip", () => {
    expectCode(hero, "<InfoTooltip label={chip.label} text={chip.description}");
  });

  test("the inventory count row ends with one (i) for the whole row", () => {
    expectCode(
      hero,
      `<InfoTooltip label="Cluster inventory counts" text={${CLUSTER_RECORD}.inventoryCounts} />`,
    );
  });
});

describe("cluster overview: node pressure, summary cards and sections", () => {
  test("each pressure badge carries its own description", () => {
    const badges: string = between(
      OVERVIEW,
      "const pressureBadges:",
      "const renderRefreshControl:",
    );

    expect(
      pairsIn({
        block: badges,
        opener: "pressureBadges.push({",
        closer: "});",
        titlePattern: LABEL_PROPERTY,
        prop: "description",
        record: CLUSTER_RECORD,
      }),
    ).toEqual([
      ["Memory Pressure", "memoryPressure"],
      ["Disk Pressure", "diskPressure"],
      ["PID Pressure", "pidPressure"],
    ]);

    expectCode(
      OVERVIEW,
      "<InfoTooltip label={badge.label} text={badge.description} />",
    );
  });

  test("every summary card has a tooltip of its own", () => {
    const cards: string = between(
      OVERVIEW,
      '<div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4 mb-5">',
      "<ResourceActivityCards",
    );

    expect(
      pairsIn({
        block: cards,
        opener: "<InfoCard",
        closer: "value={",
        titlePattern: TITLE_ATTRIBUTE,
        prop: "tooltip",
        record: CLUSTER_RECORD,
      }),
    ).toEqual([
      ["Cluster Health", "clusterHealth"],
      ["Nodes", "nodes"],
      ["Pods", "pods"],
      ["Namespaces", "namespaces"],
      ["Agent Status", "agentStatus"],
    ]);
    expect(countOf(OVERVIEW, "<InfoCard")).toBe(5);
  });

  test("pod health and the two top-consumer lists put an (i) beside their title", () => {
    expectCode(
      OVERVIEW,
      `title={titleWithTooltip( "Pod Health", ${CLUSTER_RECORD}.podHealth, )}`,
    );
    expectCode(
      OVERVIEW,
      `{titleWithTooltip( "CPU Usage", ${CLUSTER_RECORD}.topCpuPods, )}`,
    );
    expectCode(
      OVERVIEW,
      `{titleWithTooltip( "Memory Usage", ${CLUSTER_RECORD}.topMemoryPods, )}`,
    );
  });

  test("titleWithTooltip names the (i) after the title it sits beside", () => {
    const helper: string = between(
      OVERVIEW,
      "export function titleWithTooltip(",
      "function formatRelativeTime(",
    );

    expectCode(helper, "<InfoTooltip label={title} text={description} />");
  });

  test("the overview shows every cluster description except the Insights one", () => {
    for (const key of Object.keys(KUBERNETES_CLUSTER_METRIC_DESCRIPTIONS)) {
      const referenced: boolean = OVERVIEW.includes(`${CLUSTER_RECORD}.${key}`);

      expect({ key, referenced }).toEqual({
        key,
        referenced: key !== "networkThroughput",
      });
    }
  });
});

describe("accuracy anchors: the numbers the overview texts quote", () => {
  test("the tile window is the one the texts name", () => {
    const match: RegExpMatchArray | null = OVERVIEW.match(TILE_WINDOW);

    expect(match).not.toBeNull();

    const minutes: string = match![1]!;

    for (const key of ["cpu", "memory", "filesystem", "network"] as const) {
      expect(KUBERNETES_CLUSTER_METRIC_DESCRIPTIONS[key]).toContain(
        `last ${minutes} minutes`,
      );
    }
  });

  test("the tiles fall back to the whole range when the window is empty", () => {
    const mean: string = between(
      OVERVIEW,
      "const meanInRecentWindow:",
      "const clusterAllocatableCores:",
    );

    expectCode(mean, "if (count === 0) { for (const p of series)");

    for (const key of ["cpu", "memory", "filesystem", "network"] as const) {
      expect(KUBERNETES_CLUSTER_METRIC_DESCRIPTIONS[key]).toContain(
        "often the whole range",
      );
    }
  });

  /*
   * The window keeps a point by its bucket START, so once buckets are wider
   * than the window (ranges over 12 hours) the last bucket usually starts
   * before it and the tile falls back to the whole range - which is why the
   * texts say "often the whole range on ranges over 12 hours".
   */
  test("the recent window keeps a point by its bucket start", () => {
    const mean: string = between(
      OVERVIEW,
      "const meanInRecentWindow:",
      "const clusterAllocatableCores:",
    );

    expectCode(mean, "if (p.x.getTime() < tileWindowStartMs) { continue; }");

    for (const key of ["cpu", "memory", "filesystem", "network"] as const) {
      expect(KUBERNETES_CLUSTER_METRIC_DESCRIPTIONS[key]).toContain(
        "on ranges over 12 hours",
      );
    }
  });

  /*
   * kubeletstats emits k8s.node.filesystem.* once per node (the kubelet's
   * root filesystem, no mount attribute), so the per-(node, mount) join is a
   * per-node fraction and the average is across nodes, not disks.
   */
  test("filesystem reads the per-node kubeletstats metrics, and the texts say per node", () => {
    const golden: string = between(
      OVERVIEW,
      "const loadGoldenMetrics:",
      "const loadGoldenMetricsRef:",
    );

    expectCode(golden, '"k8s.node.filesystem.usage"');
    expectCode(golden, '"k8s.node.filesystem.available"');
    expect(KUBERNETES_CLUSTER_METRIC_DESCRIPTIONS.filesystem).toContain(
      "each node's disk, averaged across nodes",
    );
    expect(KUBERNETES_CLUSTER_METRIC_DESCRIPTIONS.filesystemChart).toContain(
      "averaged across the nodes",
    );
  });

  test("all five tiles, and only they, use the recent-window mean", () => {
    expect(countOf(OVERVIEW, "meanInRecentWindow(")).toBe(5);
    expectCode(OVERVIEW, "setAvailabilityPct(availability.uptimePercent);");
  });

  test("CPU is divided by the cluster's allocatable cores", () => {
    expectCode(OVERVIEW, "y: (p.y / clusterAllocatableCores) * 100");
  });

  test("filesystem averages used / (used + available) per mount", () => {
    expectCode(OVERVIEW, "const total: number = used + available;");
    expectCode(OVERVIEW, "const frac: number = (used / total) * 100;");
    expectCode(OVERVIEW, "y: e.sum / e.count");
  });

  test("the top-consumer lists are top 5, over the default 1-hour window", () => {
    const slices: Array<string> = Array.from(
      OVERVIEW.matchAll(TOP_POD_SLICE),
    ).map((match: RegExpMatchArray): string => {
      return match[1]!;
    });

    expect(slices).toEqual(["5", "5"]);

    const loadTopPods: string = between(
      OVERVIEW,
      "const loadTopPods:",
      "const loadWarnings:",
    );

    // No hoursBack, so the util's default applies.
    expect(loadTopPods).not.toContain("hoursBack");

    const utils: string = readCode(
      "Pages/Kubernetes/Utils/KubernetesResourceUtils.ts",
    );
    const hours: RegExpMatchArray | null = utils.match(TOP_PODS_HOURS);

    expect(hours).not.toBeNull();
    expect(hours![1]).toBe("1");
    expect(KUBERNETES_CLUSTER_METRIC_DESCRIPTIONS.topCpuPods).toContain(
      "past hour",
    );
  });

  test("the top CPU list keeps raw cores when allocatable is unknown", () => {
    const loadTopPods: string = between(
      OVERVIEW,
      "const loadTopPods:",
      "const loadWarnings:",
    );

    expectCode(loadTopPods, "if (denominator > 0) {");
    expect(KUBERNETES_CLUSTER_METRIC_DESCRIPTIONS.topCpuPods).toContain(
      "in cores",
    );
  });

  test("the health rule in the texts is the rule in the code", () => {
    const summary: string = between(
      OVERVIEW,
      "if (failed > 0 || notReady > 0) {",
      "} catch (err) {",
    );

    expectCode(summary, 'setClusterHealth("Unhealthy");');
    expectCode(
      summary,
      "pending > 0 || memoryPressure > 0 || diskPressure > 0 || pidPressure > 0",
    );
    expectCode(summary, 'setClusterHealth("Degraded");');
  });

  test("the agent disconnect threshold is the one the text names", () => {
    const service: string = between(
      readCommonCode("Server/Services/KubernetesClusterService.ts"),
      "public async markDisconnectedClusters()",
      'otelCollectorStatus: "disconnected"',
    );
    const match: RegExpMatchArray | null = service.match(DISCONNECT_MINUTES);

    expect(match).not.toBeNull();

    // The job that applies the threshold runs every 5 minutes.
    const job: string = readSource(
      path.join(
        DASHBOARD_SRC,
        "..",
        "..",
        "Workers",
        "Jobs",
        "Kubernetes",
        "CleanupStaleResources.ts",
      ),
    );

    expect(job).toContain("schedule: EVERY_FIVE_MINUTE");
    expect(KUBERNETES_CLUSTER_METRIC_DESCRIPTIONS.agentStatus).toContain(
      `about ${match![1]} to ${Number(match![1]) + 5} minutes`,
    );
  });
});

describe("Right-Sizing card", () => {
  test("every tile passes its own description", () => {
    expect(
      pairsIn({
        block: RIGHT_SIZING,
        opener: "<GoldenMetricTile",
        closer: "/>",
        titlePattern: TITLE_ATTRIBUTE,
        prop: "description",
        record: RIGHT_SIZING_RECORD,
      }),
    ).toEqual([
      ["Potential Saving", "potentialSaving"],
      ["Over-provisioned", "overprovisioned"],
      ["Under-provisioned", "underprovisioned"],
      ["Analyzed", "analyzed"],
    ]);
  });

  test("the metric columns explain themselves; the identity columns do not", () => {
    const columns: string = between(
      RIGHT_SIZING,
      "const columns: Array<Column<RightSizingRecommendation>>",
      "}, []);",
    );

    expect(
      pairsIn({
        block: columns,
        opener: "{ title:",
        closer: "getElement",
        titlePattern: new RegExp('^ "([^"]+)"'),
        prop: "headerTooltip",
        record: RIGHT_SIZING_RECORD,
      }),
    ).toEqual([
      ["Container", null],
      ["Namespace", null],
      ["CPU Request", "cpuRequest"],
      ["Memory Request", "memoryRequest"],
      ["Est. Saving", "estimatedSaving"],
    ]);
  });

  test("the card's own caption no longer says a bare 'P95'", () => {
    expect(RIGHT_SIZING).not.toContain("a P95 of CPU usage");
    expectCode(
      RIGHT_SIZING,
      "the 95th percentile of hourly CPU usage (95% of hourly readings were lower)",
    );
  });

  test("shows every right-sizing description", () => {
    for (const key of Object.keys(
      KUBERNETES_RIGHT_SIZING_METRIC_DESCRIPTIONS,
    )) {
      expect({
        key,
        shown: RIGHT_SIZING.includes(`${RIGHT_SIZING_RECORD}.${key}`),
      }).toEqual({
        key,
        shown: true,
      });
    }
  });
});

describe("cluster Costs page", () => {
  test("every tile passes its own description", () => {
    expect(
      pairsIn({
        block: CLUSTER_COSTS,
        opener: "<GoldenMetricTile",
        closer: "/>",
        titlePattern: TITLE_ATTRIBUTE,
        prop: "description",
        record: COST_RECORD,
      }),
    ).toEqual([
      ["Total Spend", "totalSpend"],
      ["Workload Spend", "workloadSpend"],
      ["Idle Spend", "idleSpend"],
      ["Idle %", "idlePercent"],
    ]);
  });

  test("the untitled spend chart is explained beside its section title", () => {
    expectCode(
      CLUSTER_COSTS,
      `title={getSectionTitle( IconProp.Billing, "Spend", ${COST_RECORD}.spendTrend, )}`,
    );
    expectCode(
      CLUSTER_COSTS,
      "<InfoTooltip label={title} text={description} />",
    );
  });

  test("namespace table: every cost column explains itself", () => {
    const columns: string = between(
      CLUSTER_COSTS,
      "const namespaceColumns:",
      "}, [totalSpend]);",
    );

    expect(
      pairsIn({
        block: columns,
        opener: "{ title:",
        closer: "getElement",
        titlePattern: new RegExp('^ "([^"]+)"'),
        prop: "headerTooltip",
        record: COST_RECORD,
      }),
    ).toEqual([
      ["Namespace", null],
      ["CPU", "namespaceCpuCost"],
      ["Memory", "namespaceMemoryCost"],
      ["Storage", "namespaceStorageCost"],
      ["Other", "namespaceOtherCost"],
      ["Total", "namespaceTotalCost"],
      ["Efficiency", "efficiency"],
    ]);
  });

  test("workload table: the total and efficiency columns explain themselves", () => {
    const columns: string = between(
      CLUSTER_COSTS,
      "const workloadColumns:",
      "}, [workloadSpend]);",
    );

    expect(
      pairsIn({
        block: columns,
        opener: "{ title:",
        closer: "getElement",
        titlePattern: new RegExp('^ "([^"]+)"'),
        prop: "headerTooltip",
        record: COST_RECORD,
      }),
    ).toEqual([
      ["Workload", null],
      ["Kind", null],
      ["Namespace", null],
      ["Total", "workloadTotalCost"],
      ["Efficiency", "efficiency"],
    ]);
  });

  test("idle spend here is every sentinel namespace: idle AND unallocated", () => {
    const idle: string = between(
      CLUSTER_COSTS,
      "const idleSpend: number",
      "const workloadSpend: number",
    );

    expectCode(idle, "isSentinelNamespace(row.namespace)");

    const utils: string = readCode(
      "Pages/Kubernetes/Utils/KubernetesCostUtils.ts",
    );

    expectCode(
      utils,
      "return namespace === IDLE_NAMESPACE || namespace === UNALLOCATED_NAMESPACE;",
    );
    expect(KUBERNETES_COST_METRIC_DESCRIPTIONS.workloadSpend).toContain(
      "minus idle and unallocated",
    );
  });

  test("the Total column's share is of all spend on the namespace table, of workload spend on the workload table", () => {
    expectCode(CLUSTER_COSTS, "getTotalCostElement(row.totalCost, totalSpend)");
    expectCode(
      CLUSTER_COSTS,
      "getTotalCostElement(row.totalCost, workloadSpend)",
    );
  });
});

describe("project Costs page", () => {
  test("every tile passes its own description", () => {
    expect(
      pairsIn({
        block: FLEET_COSTS,
        opener: "<GoldenMetricTile",
        closer: "/>",
        titlePattern: TITLE_ATTRIBUTE,
        prop: "description",
        record: COST_RECORD,
      }),
    ).toEqual([
      ["Total Spend", "fleetTotalSpend"],
      ["Workload Spend", "fleetWorkloadSpend"],
      ["Idle Spend", "fleetIdleSpend"],
      ["Idle %", "fleetIdlePercent"],
    ]);
  });

  test("the untitled spend chart is explained beside its section title", () => {
    expectCode(
      FLEET_COSTS,
      `title={getSectionTitle( IconProp.Billing, "Kubernetes Spend", ${COST_RECORD}.fleetSpendTrend, )}`,
    );
    expectCode(
      FLEET_COSTS,
      'import { KUBERNETES_COST_METRIC_DESCRIPTIONS } from "../../Components/MetricDescriptions/KubernetesClusterMetricDescriptions";',
    );
  });

  test("cluster table: every cost column explains itself", () => {
    const columns: string = between(
      FLEET_COSTS,
      "const tableColumns:",
      "}, [clusterIdByName, totalSpend]);",
    );

    expect(
      pairsIn({
        block: columns,
        opener: "{ title:",
        closer: "getElement",
        titlePattern: new RegExp('^ "([^"]+)"'),
        prop: "headerTooltip",
        record: COST_RECORD,
      }),
    ).toEqual([
      ["Cluster", null],
      ["Workload", "clusterWorkloadCost"],
      ["Idle", "clusterIdleCost"],
      ["Total", "clusterTotalCost"],
      ["Efficiency", "clusterEfficiency"],
    ]);
  });

  test("idle here is only the __idle__ namespace - unallocated stays in workload", () => {
    const utils: string = readCode(
      "Pages/Kubernetes/Utils/KubernetesCostUtils.ts",
    );
    const breakdown: string = between(
      utils,
      "export const fetchClusterBreakdown:",
      "return rows.sort(",
    );

    expectCode(breakdown, "extraQuery: { namespace: IDLE_NAMESPACE }");
    expect(breakdown).not.toContain("UNALLOCATED_NAMESPACE");
    expectCode(FLEET_COSTS, "formatCost(totalSpend - idleSpend)");
    expect(KUBERNETES_COST_METRIC_DESCRIPTIONS.fleetWorkloadSpend).toContain(
      "unallocated is counted here",
    );
  });
});

describe("cost thresholds the texts quote", () => {
  const IDLE_TILES: Array<
    [string, string, "idlePercent" | "fleetIdlePercent"]
  > = [
    ["cluster", CLUSTER_COSTS, "idlePercent"],
    ["project", FLEET_COSTS, "fleetIdlePercent"],
  ];

  test.each(IDLE_TILES)(
    "the %s Idle %% bar thresholds are the ones its text names",
    (
      _page: string,
      source: string,
      key: "idlePercent" | "fleetIdlePercent",
    ) => {
      const match: RegExpMatchArray | null = source.match(IDLE_THRESHOLDS);

      expect(match).not.toBeNull();
      expect(KUBERNETES_COST_METRIC_DESCRIPTIONS[key]).toContain(
        `amber at ${match![1]}% and red at ${match![2]}%`,
      );
    },
  );

  test("the efficiency pill colours are the ones the texts name", () => {
    const cells: string = readCode(
      "Pages/Kubernetes/Utils/KubernetesCostTableCells.tsx",
    );
    const green: RegExpMatchArray | null = cells.match(EFFICIENCY_GREEN);
    const yellow: RegExpMatchArray | null = cells.match(EFFICIENCY_YELLOW);

    expect(green).not.toBeNull();
    expect(yellow).not.toBeNull();

    for (const key of ["efficiency", "clusterEfficiency"] as const) {
      expect(KUBERNETES_COST_METRIC_DESCRIPTIONS[key]).toContain(
        `Green from ${green![1]}%, red below ${yellow![1]}%`,
      );
    }
  });

  test("the costs pages together show every cost description", () => {
    const both: string = `${CLUSTER_COSTS} ${FLEET_COSTS}`;

    for (const key of Object.keys(KUBERNETES_COST_METRIC_DESCRIPTIONS)) {
      expect({ key, shown: both.includes(`${COST_RECORD}.${key}`) }).toEqual({
        key,
        shown: true,
      });
    }
  });
});

describe("Insights, Control Plane and Service Mesh", () => {
  test("the untitled network chart is explained beside its section title", () => {
    expectCode(
      INSIGHTS,
      `title={getSectionTitle( IconProp.Signal, "Network", ${CLUSTER_RECORD}.networkThroughput, )}`,
    );
  });

  test("the metric-query sections pass no (i): their charts carry captions", () => {
    expectCode(
      INSIGHTS,
      'title={getSectionTitle(IconProp.CPUChip, "Compute & Storage")}',
    );
    expectCode(INSIGHTS, 'title={getSectionTitle(IconProp.Circle, "Pods")}');
  });

  test.each([
    ["Insights", INSIGHTS],
    ["Control Plane", CONTROL_PLANE],
    ["Service Mesh", SERVICE_MESH],
  ])(
    "every %s metric-query chart has a visible caption",
    (_page: string, source: string) => {
      const specs: Array<string> = source.split("buildQuery( {").slice(1);

      expect(specs.length).toBeGreaterThan(0);

      for (const spec of specs) {
        const caption: RegExpMatchArray | null = spec.match(
          new RegExp('description: "([^"]{10,})"'),
        );

        expect({
          spec: spec.slice(0, 80),
          captioned: caption !== null,
        }).toEqual({
          spec: spec.slice(0, 80),
          captioned: true,
        });
      }
    },
  );
});
