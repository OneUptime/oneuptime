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
import Dictionary from "../../../../Types/Dictionary";
import MetricFormulaConfigData from "../../../../Types/Metrics/MetricFormulaConfigData";
import MetricQueryConfigData from "../../../../Types/Metrics/MetricQueryConfigData";
import MetricsAggregationType from "../../../../Types/Metrics/MetricsAggregationType";
import MetricsViewConfig from "../../../../Types/Metrics/MetricsViewConfig";
import {
  CephAlertTemplate,
  CephAlertTemplateArgs,
  getCephAlertTemplateById,
} from "../../../../Types/Monitor/CephAlertTemplates";
import { getCephMetricByMetricName } from "../../../../Types/Monitor/CephMetricCatalog";
import {
  CheckOn,
  CriteriaFilter,
  FilterType,
} from "../../../../Types/Monitor/CriteriaFilter";
import {
  DockerSwarmAlertTemplate,
  DockerSwarmAlertTemplateArgs,
  getDockerSwarmAlertTemplateById,
} from "../../../../Types/Monitor/DockerSwarmAlertTemplates";
import { getDockerSwarmMetricByMetricName } from "../../../../Types/Monitor/DockerSwarmMetricCatalog";
import {
  buildKubernetesMonitorStep,
  buildOfflineCriteriaInstance,
  getKubernetesAlertTemplateById,
  KubernetesAlertTemplate,
  KubernetesAlertTemplateArgs,
} from "../../../../Types/Monitor/KubernetesAlertTemplates";
import { getKubernetesMetricByMetricName } from "../../../../Types/Monitor/KubernetesMetricCatalog";
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
} from "../../../../Types/Monitor/MetricMonitor/MetricMonitorResponse";
import MonitorCriteriaInstance from "../../../../Types/Monitor/MonitorCriteriaInstance";
import MonitorStep from "../../../../Types/Monitor/MonitorStep";
import { KubernetesResourceScope } from "../../../../Types/Monitor/MonitorStepKubernetesMonitor";
import {
  getProxmoxAlertTemplateById,
  ProxmoxAlertTemplate,
  ProxmoxAlertTemplateArgs,
} from "../../../../Types/Monitor/ProxmoxAlertTemplates";
import { getProxmoxMetricByMetricName } from "../../../../Types/Monitor/ProxmoxMetricCatalog";
import {
  getVMwareAlertTemplateById,
  VMwareAlertTemplate,
  VMwareAlertTemplateArgs,
} from "../../../../Types/Monitor/VMwareAlertTemplates";
import { getVMwareMetricByMetricName } from "../../../../Types/Monitor/VMwareMetricCatalog";
import ObjectID from "../../../../Types/ObjectID";
import RollingTime from "../../../../Types/RollingTime/RollingTime";
import { describe, expect, test } from "@jest/globals";

/*
 * The UNGROUPED half of the platform "Affected Resources" list.
 *
 * A grouped platform monitor lists the series its criteria matched. An
 * ungrouped one has no series, so the list comes from the worker's raw
 * datapoint scan — and the worker scans once PER QUERY. That is where the
 * reported email went wrong: the platform breakdown was a single field
 * each query's scan overwrote, so a ratio monitor listed its LAST query
 * (the denominator, k8s.node.allocatable_memory) in raw bytes under a
 * "> 85%" criteria, every node included.
 *
 * The worker now returns one scan per query, tagged with the query's
 * alias (`*ResourceBreakdowns[].metricAlias`), plus the unit the scan's
 * values are in. These tests drive the platform builders directly with
 * perSeriesMatches omitted and pin what the raw-scan path renders:
 *
 *   - only the scan taken for the criteria's own query is listed; a
 *     formula has no raw scan, so it gets no list at all, and a
 *     pre-tag (untagged, singular) breakdown still renders as it did;
 *   - values are formatted in the catalog's unit, else the scan's own
 *     unit — never a bare ten-digit byte count, never a cores gauge
 *     turned into a percentage;
 *   - rows are filtered and ordered by the matched criteria's direction:
 *     a criteria that fires when the metric FALLS lists the resources at
 *     their LOWEST sample, lowest first;
 *   - the "- Metric:" / "- Formula:" / "- Namespace:" detail lines say
 *     what the criteria compared, without "x (`x`)" duplication.
 */

type BuilderInput = {
  dataToProcess: MetricMonitorResponse;
  monitorStep: MonitorStep;
  monitor: Monitor;
  criteriaInstance?: MonitorCriteriaInstance | undefined;
};

type EvaluatorPrivate = {
  buildKubernetesRootCauseContext: (
    input: BuilderInput,
  ) => Promise<string | null>;
  buildProxmoxRootCauseContext: (input: BuilderInput) => string | null;
  buildVMwareRootCauseContext: (input: BuilderInput) => string | null;
  buildDockerSwarmRootCauseContext: (input: BuilderInput) => string | null;
  buildCephRootCauseContext: (input: BuilderInput) => string | null;
};

const Evaluator: EvaluatorPrivate =
  MonitorCriteriaEvaluator as unknown as EvaluatorPrivate;

const CLUSTER: string = "oneuptime-test";
const VCENTER: string = "vcsa-prod";

/*
 * A metric no platform catalog knows. The worker falls back to the metric
 * name as its friendly name, and to the exporter-declared unit for its
 * values — the path k8s.node.allocatable_memory took before it had a
 * catalog entry.
 */
const UNCATALOGED_METRIC: string = "k8s.custom.bytes_metric";

/*
 * Nothing ten digits long may reach the email: that is a raw byte count
 * the reader would have to divide in their head.
 */
const RAW_NUMBER: RegExp = /\b\d{10,}\b/;

// ---------- catalog lookups (never hard-code a friendly name) ----------

function catalogName(input: {
  friendlyName: string | undefined;
  metricName: string;
}): string {
  if (!input.friendlyName) {
    throw new Error(`${input.metricName} has no catalog entry`);
  }

  return input.friendlyName;
}

function kubernetesName(metricName: string): string {
  return catalogName({
    friendlyName: getKubernetesMetricByMetricName(metricName)?.friendlyName,
    metricName: metricName,
  });
}

function proxmoxName(metricName: string): string {
  return catalogName({
    friendlyName: getProxmoxMetricByMetricName(metricName)?.friendlyName,
    metricName: metricName,
  });
}

function vmwareName(metricName: string): string {
  return catalogName({
    friendlyName: getVMwareMetricByMetricName(metricName)?.friendlyName,
    metricName: metricName,
  });
}

function dockerSwarmName(metricName: string): string {
  return catalogName({
    friendlyName: getDockerSwarmMetricByMetricName(metricName)?.friendlyName,
    metricName: metricName,
  });
}

function cephName(metricName: string): string {
  return catalogName({
    friendlyName: getCephMetricByMetricName(metricName)?.friendlyName,
    metricName: metricName,
  });
}

// ---------- hand-built monitor configs and criteria ----------

function queryConfig(input: {
  alias: string;
  metricName: string;
}): MetricQueryConfigData {
  return {
    metricAliasData: {
      metricVariable: input.alias,
      title: input.alias,
      description: input.alias,
      legend: input.alias,
      legendUnit: undefined,
    },
    metricQueryData: {
      filterData: {
        metricName: input.metricName,
        attributes: {},
        aggegationType: MetricsAggregationType.Avg,
        aggregateBy: {},
      },
    },
  };
}

function formulaConfig(input: {
  alias: string;
  legend: string;
  expression: string;
}): MetricFormulaConfigData {
  return {
    metricAliasData: {
      metricVariable: input.alias,
      title: input.legend,
      description: input.legend,
      legend: input.legend,
      legendUnit: "%",
    },
    metricFormulaData: {
      metricFormula: input.expression,
    },
  };
}

/*
 * An incident-opening criteria on one alias, shaped exactly as the
 * template builders shape theirs.
 */
function criteriaOn(input: {
  alias: string;
  filterType: FilterType;
  value: number;
}): MonitorCriteriaInstance {
  return buildOfflineCriteriaInstance({
    offlineMonitorStatusId: ObjectID.generate(),
    incidentSeverityId: ObjectID.generate(),
    alertSeverityId: ObjectID.generate(),
    monitorName: "Raw Scan Monitor",
    metricAlias: input.alias,
    filterType: input.filterType,
    value: input.value,
  });
}

function kubernetesStep(input: {
  metricViewConfig: MetricsViewConfig;
  namespaceFilter?: string | undefined;
}): MonitorStep {
  const alias: string =
    input.metricViewConfig.queryConfigs[0]?.metricAliasData?.metricVariable ||
    "query";

  return buildKubernetesMonitorStep({
    kubernetesMonitor: {
      clusterIdentifier: CLUSTER,
      resourceScope: KubernetesResourceScope.Cluster,
      resourceFilters: input.namespaceFilter
        ? { namespace: input.namespaceFilter }
        : {},
      metricViewConfig: input.metricViewConfig,
      rollingTime: RollingTime.Past5Minutes,
    },
    offlineCriteriaInstance: criteriaOn({
      alias: alias,
      filterType: FilterType.GreaterThan,
      value: 0,
    }),
    onlineCriteriaInstance: criteriaOn({
      alias: alias,
      filterType: FilterType.EqualTo,
      value: 0,
    }),
  });
}

/*
 * Swap a platform template's queries for a hand-built set, keeping the
 * rest of the step (cluster identifier, resource filters) as shipped.
 */
function withMetricViewConfig(
  step: MonitorStep,
  metricViewConfig: MetricsViewConfig,
): MonitorStep {
  const monitors: Array<{ metricViewConfig: MetricsViewConfig } | undefined> = [
    step.data?.kubernetesMonitor,
    step.data?.proxmoxMonitor,
    step.data?.vmwareMonitor,
    step.data?.dockerSwarmMonitor,
    step.data?.cephMonitor,
  ];

  for (const monitor of monitors) {
    if (monitor) {
      monitor.metricViewConfig = metricViewConfig;
    }
  }

  return step;
}

// ---------- real templates ----------

function templateArgs(): KubernetesAlertTemplateArgs &
  ProxmoxAlertTemplateArgs &
  DockerSwarmAlertTemplateArgs &
  CephAlertTemplateArgs {
  return {
    clusterIdentifier: CLUSTER,
    onlineMonitorStatusId: ObjectID.generate(),
    offlineMonitorStatusId: ObjectID.generate(),
    defaultIncidentSeverityId: ObjectID.generate(),
    defaultAlertSeverityId: ObjectID.generate(),
    monitorName: "Raw Scan Monitor",
  };
}

function kubernetesTemplateStep(templateId: string): MonitorStep {
  const template: KubernetesAlertTemplate | undefined =
    getKubernetesAlertTemplateById(templateId);

  if (!template) {
    throw new Error(`${templateId} template missing`);
  }

  return template.getMonitorStep(templateArgs());
}

function proxmoxTemplateStep(templateId: string): MonitorStep {
  const template: ProxmoxAlertTemplate | undefined =
    getProxmoxAlertTemplateById(templateId);

  if (!template) {
    throw new Error(`${templateId} template missing`);
  }

  return template.getMonitorStep(templateArgs());
}

function vmwareTemplateStep(templateId: string): MonitorStep {
  const template: VMwareAlertTemplate | undefined =
    getVMwareAlertTemplateById(templateId);

  if (!template) {
    throw new Error(`${templateId} template missing`);
  }

  const args: VMwareAlertTemplateArgs = {
    vcenterIdentifier: VCENTER,
    onlineMonitorStatusId: ObjectID.generate(),
    offlineMonitorStatusId: ObjectID.generate(),
    defaultIncidentSeverityId: ObjectID.generate(),
    defaultAlertSeverityId: ObjectID.generate(),
    monitorName: "Raw Scan Monitor",
  };

  return template.getMonitorStep(args);
}

function dockerSwarmTemplateStep(templateId: string): MonitorStep {
  const template: DockerSwarmAlertTemplate | undefined =
    getDockerSwarmAlertTemplateById(templateId);

  if (!template) {
    throw new Error(`${templateId} template missing`);
  }

  return template.getMonitorStep(templateArgs());
}

function cephTemplateStep(templateId: string): MonitorStep {
  const template: CephAlertTemplate | undefined =
    getCephAlertTemplateById(templateId);

  if (!template) {
    throw new Error(`${templateId} template missing`);
  }

  return template.getMonitorStep(templateArgs());
}

/** The template's FIRING criteria — the one that opens the incident. */
function firingCriteria(step: MonitorStep): MonitorCriteriaInstance {
  const instance: MonitorCriteriaInstance | undefined =
    step.data?.monitorCriteria?.data?.monitorCriteriaInstanceArray[0];

  if (!instance) {
    throw new Error("firing criteria instance missing");
  }

  return instance;
}

/** The metric-value filter of a criteria, for fixture guards. */
function metricFilter(criteria: MonitorCriteriaInstance): CriteriaFilter {
  const filter: CriteriaFilter | undefined = (
    criteria.data?.filters || []
  ).find((f: CriteriaFilter) => {
    return f.checkOn === CheckOn.MetricValue;
  });

  if (!filter) {
    throw new Error("metric-value filter missing");
  }

  return filter;
}

/** The step's first query, as the worker tags its scan. */
function firstQuery(step: MonitorStep): { alias: string; metricName: string } {
  const query: MetricQueryConfigData | undefined =
    MonitorStep.getMetricsViewConfig(step)?.queryConfigs[0];

  const alias: string = query?.metricAliasData?.metricVariable || "";
  const metricName: string =
    (query?.metricQueryData?.filterData?.metricName as string | undefined) ||
    "";

  if (!alias || !metricName) {
    throw new Error("template has no aliased query");
  }

  return { alias: alias, metricName: metricName };
}

// ---------- worker-shaped responses ----------

function metricResponse(
  overrides: Partial<MetricMonitorResponse>,
): MetricMonitorResponse {
  return {
    projectId: ObjectID.generate(),
    monitorId: ObjectID.generate(),
    metricResult: [],
    metricViewConfig: { queryConfigs: [], formulaConfigs: [] },
    ...overrides,
  };
}

/*
 * One Kubernetes raw scan the way MonitorTelemetryMonitor builds it: the
 * catalog's friendly name else the metric name, the query's attribute
 * filters under their stored `resource.`-prefixed keys, and the query's
 * alias as the tag.
 */
function kubernetesScan(input: {
  alias?: string | undefined;
  metricName: string;
  metricUnit?: string | undefined;
  attributes?: Dictionary<string> | undefined;
  resources: Array<KubernetesAffectedResource>;
}): KubernetesResourceBreakdown {
  return {
    clusterName: CLUSTER,
    metricName: input.metricName,
    metricFriendlyName:
      getKubernetesMetricByMetricName(input.metricName)?.friendlyName ||
      input.metricName,
    metricAlias: input.alias,
    metricUnit: input.metricUnit,
    attributes: input.attributes || {
      "resource.k8s.cluster.name": CLUSTER,
    },
    affectedResources: input.resources,
  };
}

async function kubernetesContext(input: {
  step: MonitorStep;
  response: MetricMonitorResponse;
  criteria?: MonitorCriteriaInstance | undefined;
}): Promise<string | null> {
  return Evaluator.buildKubernetesRootCauseContext({
    dataToProcess: input.response,
    monitorStep: input.step,
    monitor: new Monitor(),
    criteriaInstance: input.criteria,
  });
}

/*
 * ============================================================
 * 1. Which scan is listed (Kubernetes)
 * ============================================================
 *
 * The shape of the reported monitor, hand-built: used ÷ allocatable × 100
 * with NO group-by, so the evaluator has only the raw scans to go on.
 * The allocatable query is an uncataloged metric reported in "By", so its
 * values can only be read in the unit the worker recorded on the scan.
 */

const NODE_1: string = "gke-pool-1-1nd7";
const NODE_2: string = "gke-pool-1-7qrq";

const USED_BYTES: Dictionary<number> = {
  [NODE_1]: 228943289000, // 228.94 GB → "229 GB"
  [NODE_2]: 99800000000, // 99.8 GB
};

const ALLOCATABLE_BYTES: Dictionary<number> = {
  [NODE_1]: 257760964608, // 257.76 GB → "258 GB"
  [NODE_2]: 191483559936, // 191.48 GB → "191 GB"
};

function memoryRatioConfig(): MetricsViewConfig {
  return {
    queryConfigs: [
      queryConfig({ alias: "used_mem", metricName: "k8s.node.memory.usage" }),
      queryConfig({ alias: "alloc_mem", metricName: UNCATALOGED_METRIC }),
    ],
    formulaConfigs: [
      formulaConfig({
        alias: "mem_pct",
        legend: "Node Memory Utilization (%)",
        expression: "(used_mem / alloc_mem) * 100",
      }),
    ],
  };
}

function nodeRows(
  values: Dictionary<number>,
): Array<KubernetesAffectedResource> {
  return Object.keys(values).map(
    (nodeName: string): KubernetesAffectedResource => {
      return {
        nodeName: nodeName,
        metricValue: values[nodeName]!,
        lowestMetricValue: values[nodeName]!,
      };
    },
  );
}

function usedScan(alias: string | undefined): KubernetesResourceBreakdown {
  return kubernetesScan({
    alias: alias,
    metricName: "k8s.node.memory.usage",
    metricUnit: "By",
    resources: nodeRows(USED_BYTES),
  });
}

function allocatableScan(
  alias: string | undefined,
): KubernetesResourceBreakdown {
  return kubernetesScan({
    alias: alias,
    metricName: UNCATALOGED_METRIC,
    metricUnit: "By",
    resources: nodeRows(ALLOCATABLE_BYTES),
  });
}

const ALLOCATABLE_LIST: string = [
  "**Affected Resources** (2 total)",
  "",
  `1. **Node** \`${NODE_1}\` — **258 GB**`,
  `2. **Node** \`${NODE_2}\` — **191 GB**`,
].join("\n");

describe("Kubernetes raw scan: the criteria's own query is the one listed", () => {
  test("fixture guard: the uncataloged metric really has no catalog entry", () => {
    expect(getKubernetesMetricByMetricName(UNCATALOGED_METRIC)).toBeUndefined();
  });

  test("a criteria on `alloc_mem` lists the alloc_mem scan, in the scan's unit", async () => {
    const context: string | null = await kubernetesContext({
      step: kubernetesStep({ metricViewConfig: memoryRatioConfig() }),
      response: metricResponse({
        kubernetesResourceBreakdowns: [
          usedScan("used_mem"),
          allocatableScan("alloc_mem"),
        ],
      }),
      criteria: criteriaOn({
        alias: "alloc_mem",
        filterType: FilterType.GreaterThan,
        value: 100,
      }),
    });

    const text: string = context || "";

    expect(text).toContain(ALLOCATABLE_LIST);

    // None of the sibling (used_mem) scan's numbers.
    expect(text).not.toContain("229 GB");
    expect(text).not.toContain("99.8 GB");

    // "258 GB", never the 257760964608 it used to print.
    expect(text).not.toMatch(RAW_NUMBER);

    expect(text).toContain(`Most affected node: \`${NODE_1}\` (**258 GB**)`);
  });

  test("a criteria on `used_mem` lists the used_mem scan instead", async () => {
    const context: string | null = await kubernetesContext({
      step: kubernetesStep({ metricViewConfig: memoryRatioConfig() }),
      response: metricResponse({
        kubernetesResourceBreakdowns: [
          usedScan("used_mem"),
          allocatableScan("alloc_mem"),
        ],
      }),
      criteria: criteriaOn({
        alias: "used_mem",
        filterType: FilterType.GreaterThan,
        value: 100,
      }),
    });

    const text: string = context || "";

    expect(text).toContain(
      [
        "**Affected Resources** (2 total)",
        "",
        `1. **Node** \`${NODE_1}\` — **229 GB**`,
        `2. **Node** \`${NODE_2}\` — **99.8 GB**`,
      ].join("\n"),
    );
    expect(text).toContain(
      `- Metric: ${kubernetesName("k8s.node.memory.usage")} (\`k8s.node.memory.usage\`)`,
    );
    expect(text).toContain(`Node \`${NODE_1}\` memory usage is at **229 GB**.`);
    expect(text).not.toContain("258 GB");
    expect(text).not.toMatch(RAW_NUMBER);
  });

  test("the alias tag is matched case-insensitively", async () => {
    const context: string | null = await kubernetesContext({
      step: kubernetesStep({ metricViewConfig: memoryRatioConfig() }),
      response: metricResponse({
        kubernetesResourceBreakdowns: [
          usedScan("USED_MEM"),
          allocatableScan("ALLOC_MEM"),
        ],
      }),
      criteria: criteriaOn({
        alias: "alloc_mem",
        filterType: FilterType.GreaterThan,
        value: 100,
      }),
    });

    expect(context || "").toContain(ALLOCATABLE_LIST);
  });

  test("a criteria on the FORMULA lists no scan at all — neither operand is the ratio", async () => {
    const context: string | null = await kubernetesContext({
      step: kubernetesStep({ metricViewConfig: memoryRatioConfig() }),
      response: metricResponse({
        kubernetesResourceBreakdowns: [
          usedScan("used_mem"),
          allocatableScan("alloc_mem"),
        ],
      }),
      criteria: criteriaOn({
        alias: "mem_pct",
        filterType: FilterType.GreaterThan,
        value: 85,
      }),
    });

    const text: string = context || "";

    expect(text).not.toContain("**Affected Resources**");
    expect(text).not.toContain(NODE_1);
    expect(text).not.toContain(NODE_2);
    expect(text).not.toContain(" GB");
    expect(text).not.toMatch(RAW_NUMBER);
  });

  test("a criteria on the FORMULA still names the formula and its operands", async () => {
    /*
     * With no list to show, the details block is all the reader gets —
     * the other four platforms keep it for a formula target.
     */
    const context: string | null = await kubernetesContext({
      step: kubernetesStep({ metricViewConfig: memoryRatioConfig() }),
      response: metricResponse({
        kubernetesResourceBreakdowns: [
          usedScan("used_mem"),
          allocatableScan("alloc_mem"),
        ],
      }),
      criteria: criteriaOn({
        alias: "mem_pct",
        filterType: FilterType.GreaterThan,
        value: 85,
      }),
    });

    expect(context).toContain(
      [
        "**Kubernetes Cluster Details**",
        `- Cluster: ${CLUSTER}`,
        "- Metric: Node Memory Utilization (%)",
        "- Formula: `(used_mem / alloc_mem) * 100`",
        `  - \`used_mem\` = ${kubernetesName("k8s.node.memory.usage")} (\`k8s.node.memory.usage\`)`,
        `  - \`alloc_mem\` = \`${UNCATALOGED_METRIC}\``,
      ].join("\n"),
    );
    expect(context).not.toContain("**Affected Resources**");
  });

  test("tagged scans whose alias matches no query are not borrowed", async () => {
    const context: string | null = await kubernetesContext({
      step: kubernetesStep({ metricViewConfig: memoryRatioConfig() }),
      response: metricResponse({
        kubernetesResourceBreakdowns: [
          usedScan("stale_used"),
          allocatableScan("stale_alloc"),
        ],
      }),
      criteria: criteriaOn({
        alias: "alloc_mem",
        filterType: FilterType.GreaterThan,
        value: 100,
      }),
    });

    const text: string = context || "";

    expect(text).not.toContain("**Affected Resources**");
    expect(text).not.toContain("258 GB");
    expect(text).not.toContain("229 GB");
  });

  test("a legacy untagged singular breakdown still renders for a query target", async () => {
    const context: string | null = await kubernetesContext({
      step: kubernetesStep({ metricViewConfig: memoryRatioConfig() }),
      response: metricResponse({
        kubernetesResourceBreakdown: allocatableScan(undefined),
      }),
      criteria: criteriaOn({
        alias: "alloc_mem",
        filterType: FilterType.GreaterThan,
        value: 100,
      }),
    });

    const text: string = context || "";

    expect(text).toContain(`- Metric: \`${UNCATALOGED_METRIC}\``);
    expect(text).toContain(ALLOCATABLE_LIST);
    expect(text).not.toMatch(RAW_NUMBER);
  });

  test("a legacy untagged singular breakdown is NOT trusted for a formula target", async () => {
    const context: string | null = await kubernetesContext({
      step: kubernetesStep({ metricViewConfig: memoryRatioConfig() }),
      response: metricResponse({
        kubernetesResourceBreakdown: allocatableScan(undefined),
      }),
      criteria: criteriaOn({
        alias: "mem_pct",
        filterType: FilterType.GreaterThan,
        value: 85,
      }),
    });

    const text: string = context || "";

    expect(text).not.toContain("**Affected Resources**");
    expect(text).not.toContain("258 GB");
  });

  test("with no criteria at all, the legacy singular breakdown renders as before", async () => {
    const context: string | null = await kubernetesContext({
      step: kubernetesStep({ metricViewConfig: memoryRatioConfig() }),
      response: metricResponse({
        kubernetesResourceBreakdown: allocatableScan(undefined),
      }),
    });

    const text: string = context || "";

    expect(text).toContain(
      [
        "**Kubernetes Cluster Details**",
        `- Cluster: ${CLUSTER}`,
        `- Metric: \`${UNCATALOGED_METRIC}\``,
      ].join("\n"),
    );
    expect(text).toContain(ALLOCATABLE_LIST);
  });

  test("with no criteria, a single tagged scan is used but two are not guessed between", async () => {
    const single: string | null = await kubernetesContext({
      step: kubernetesStep({ metricViewConfig: memoryRatioConfig() }),
      response: metricResponse({
        kubernetesResourceBreakdowns: [allocatableScan("alloc_mem")],
      }),
    });

    expect(single || "").toContain(ALLOCATABLE_LIST);

    const ambiguous: string | null = await kubernetesContext({
      step: kubernetesStep({ metricViewConfig: memoryRatioConfig() }),
      response: metricResponse({
        kubernetesResourceBreakdowns: [
          usedScan("used_mem"),
          allocatableScan("alloc_mem"),
        ],
      }),
    });

    expect(ambiguous || "").not.toContain("**Affected Resources**");
  });
});

/*
 * ============================================================
 * 1b. Which scan is listed (Proxmox, VMware, Docker Swarm, Ceph)
 * ============================================================
 *
 * The same selection on every other platform: two tagged scans and a
 * formula over them. A criteria on one query lists that query's scan; a
 * criteria on the formula lists nothing but still says what was compared.
 */

type PlatformSelectionCase = {
  platform: string;
  listHeading: string;
  render: (criteriaInstance: MonitorCriteriaInstance) => string | null;
  queryAlias: string;
  expectedQueryList: Array<string>;
  siblingValue: string;
  formulaAlias: string;
  expectedFormulaLines: Array<string>;
  resourceName: string;
};

function proxmoxSelectionCase(): PlatformSelectionCase {
  const guest: Omit<ProxmoxAffectedResource, "metricValue"> = {
    resourceId: "qemu/100",
    resourceName: "web-vm",
    resourceType: "qemu",
    scope: "guest",
    nodeName: "pve1",
  };

  const scan: (input: {
    alias: string;
    metricName: string;
    value: number;
  }) => ProxmoxResourceBreakdown = (input: {
    alias: string;
    metricName: string;
    value: number;
  }): ProxmoxResourceBreakdown => {
    return {
      clusterName: CLUSTER,
      metricName: input.metricName,
      metricFriendlyName: proxmoxName(input.metricName),
      metricAlias: input.alias,
      metricUnit: "bytes",
      attributes: {},
      affectedResources: [
        { ...guest, metricValue: input.value, lowestMetricValue: input.value },
      ],
    };
  };

  const step: MonitorStep = withMetricViewConfig(
    proxmoxTemplateStep("pve-node-offline"),
    {
      queryConfigs: [
        queryConfig({
          alias: "mem_used",
          metricName: "pve_memory_usage_bytes",
        }),
        queryConfig({ alias: "mem_size", metricName: "pve_memory_size_bytes" }),
      ],
      formulaConfigs: [
        formulaConfig({
          alias: "mem_pct",
          legend: "Guest Memory Used (%)",
          expression: "(mem_used / mem_size) * 100",
        }),
      ],
    },
  );

  const response: MetricMonitorResponse = metricResponse({
    proxmoxResourceBreakdowns: [
      scan({
        alias: "mem_used",
        metricName: "pve_memory_usage_bytes",
        value: 4000000000,
      }),
      scan({
        alias: "mem_size",
        metricName: "pve_memory_size_bytes",
        value: 8000000000,
      }),
    ],
  });

  return {
    platform: "Proxmox",
    listHeading: "**Affected Resources**",
    render: (criteriaInstance: MonitorCriteriaInstance): string | null => {
      return Evaluator.buildProxmoxRootCauseContext({
        dataToProcess: response,
        monitorStep: step,
        monitor: new Monitor(),
        criteriaInstance: criteriaInstance,
      });
    },
    queryAlias: "mem_size",
    expectedQueryList: [
      "**Affected Resources** (1 total)",
      "",
      "1. **Virtual Machine** `web-vm` (`qemu/100`) — **8 GB**",
      "   - Node: `pve1`",
    ],
    siblingValue: "4 GB",
    formulaAlias: "mem_pct",
    expectedFormulaLines: [
      "- Metric: Guest Memory Used (%)",
      "- Formula: `(mem_used / mem_size) * 100`",
      `  - \`mem_used\` = ${proxmoxName("pve_memory_usage_bytes")} (\`pve_memory_usage_bytes\`)`,
      `  - \`mem_size\` = ${proxmoxName("pve_memory_size_bytes")} (\`pve_memory_size_bytes\`)`,
    ],
    resourceName: "web-vm",
  };
}

function vmwareSelectionCase(): PlatformSelectionCase {
  const host: Omit<VMwareAffectedResource, "metricValue"> = {
    datacenterName: "dc1",
    clusterName: "prod-cluster",
    hostName: "esx-1",
  };

  const scan: (input: {
    alias: string;
    metricName: string;
    value: number;
  }) => VMwareResourceBreakdown = (input: {
    alias: string;
    metricName: string;
    value: number;
  }): VMwareResourceBreakdown => {
    return {
      vcenterName: VCENTER,
      metricName: input.metricName,
      metricFriendlyName: vmwareName(input.metricName),
      metricAlias: input.alias,
      metricUnit: "%",
      attributes: {},
      affectedResources: [
        { ...host, metricValue: input.value, lowestMetricValue: input.value },
      ],
    };
  };

  const step: MonitorStep = withMetricViewConfig(
    vmwareTemplateStep("vmware-host-cpu-saturation"),
    {
      queryConfigs: [
        queryConfig({
          alias: "cpu_util",
          metricName: "vcenter.host.cpu.utilization",
        }),
        queryConfig({
          alias: "mem_util",
          metricName: "vcenter.host.memory.utilization",
        }),
      ],
      formulaConfigs: [
        formulaConfig({
          alias: "host_pressure",
          legend: "Host Pressure (%)",
          expression: "(cpu_util + mem_util) / 2",
        }),
      ],
    },
  );

  const response: MetricMonitorResponse = metricResponse({
    vmwareResourceBreakdowns: [
      scan({
        alias: "cpu_util",
        metricName: "vcenter.host.cpu.utilization",
        value: 92.5,
      }),
      scan({
        alias: "mem_util",
        metricName: "vcenter.host.memory.utilization",
        value: 71.25,
      }),
    ],
  });

  return {
    platform: "VMware",
    listHeading: "**Affected Resources**",
    render: (criteriaInstance: MonitorCriteriaInstance): string | null => {
      return Evaluator.buildVMwareRootCauseContext({
        dataToProcess: response,
        monitorStep: step,
        monitor: new Monitor(),
        criteriaInstance: criteriaInstance,
      });
    },
    queryAlias: "mem_util",
    expectedQueryList: [
      "**Affected Resources** (1 total)",
      "",
      "1. **Host** `esx-1` — **71.25%**",
      "   - Cluster: `prod-cluster`",
    ],
    siblingValue: "92.50%",
    formulaAlias: "host_pressure",
    expectedFormulaLines: [
      "- Metric: Host Pressure (%)",
      "- Formula: `(cpu_util + mem_util) / 2`",
      `  - \`cpu_util\` = ${vmwareName("vcenter.host.cpu.utilization")} (\`vcenter.host.cpu.utilization\`)`,
      `  - \`mem_util\` = ${vmwareName("vcenter.host.memory.utilization")} (\`vcenter.host.memory.utilization\`)`,
    ],
    resourceName: "esx-1",
  };
}

function dockerSwarmSelectionCase(): PlatformSelectionCase {
  const task: Omit<DockerSwarmAffectedResource, "metricValue"> = {
    containerName: "web.1.abc",
    serviceName: "web",
    nodeName: "swarm-1",
  };

  const scan: (input: {
    alias: string;
    metricName: string;
    value: number;
  }) => DockerSwarmResourceBreakdown = (input: {
    alias: string;
    metricName: string;
    value: number;
  }): DockerSwarmResourceBreakdown => {
    return {
      clusterName: CLUSTER,
      metricName: input.metricName,
      metricFriendlyName: dockerSwarmName(input.metricName),
      metricAlias: input.alias,
      metricUnit: "%",
      attributes: {},
      affectedResources: [
        { ...task, metricValue: input.value, lowestMetricValue: input.value },
      ],
    };
  };

  const step: MonitorStep = withMetricViewConfig(
    dockerSwarmTemplateStep("docker-swarm-task-down"),
    {
      queryConfigs: [
        queryConfig({ alias: "cpu", metricName: "container.cpu.utilization" }),
        queryConfig({
          alias: "mem_pct",
          metricName: "container.memory.percent",
        }),
      ],
      formulaConfigs: [
        formulaConfig({
          alias: "pressure",
          legend: "Task Pressure (%)",
          expression: "(cpu + mem_pct) / 2",
        }),
      ],
    },
  );

  const response: MetricMonitorResponse = metricResponse({
    dockerSwarmResourceBreakdowns: [
      scan({
        alias: "cpu",
        metricName: "container.cpu.utilization",
        value: 40,
      }),
      scan({
        alias: "mem_pct",
        metricName: "container.memory.percent",
        value: 88.5,
      }),
    ],
  });

  return {
    platform: "Docker Swarm",
    listHeading: "**Affected Tasks**",
    render: (criteriaInstance: MonitorCriteriaInstance): string | null => {
      return Evaluator.buildDockerSwarmRootCauseContext({
        dataToProcess: response,
        monitorStep: step,
        monitor: new Monitor(),
        criteriaInstance: criteriaInstance,
      });
    },
    queryAlias: "mem_pct",
    expectedQueryList: [
      "**Affected Tasks** (1 total)",
      "",
      "1. **Task** `web.1.abc` — **88.50%**",
      "   - Service: `web`",
      "   - Node: `swarm-1`",
    ],
    siblingValue: "40.00%",
    formulaAlias: "pressure",
    expectedFormulaLines: [
      "- Metric: Task Pressure (%)",
      "- Formula: `(cpu + mem_pct) / 2`",
      `  - \`cpu\` = ${dockerSwarmName("container.cpu.utilization")} (\`container.cpu.utilization\`)`,
      `  - \`mem_pct\` = ${dockerSwarmName("container.memory.percent")} (\`container.memory.percent\`)`,
    ],
    resourceName: "web.1.abc",
  };
}

function cephSelectionCase(): PlatformSelectionCase {
  const osd: Omit<CephAffectedResource, "metricValue"> = {
    daemon: "osd.3",
    hostname: "ceph-1",
  };

  const scan: (input: {
    alias: string;
    metricName: string;
    value: number;
  }) => CephResourceBreakdown = (input: {
    alias: string;
    metricName: string;
    value: number;
  }): CephResourceBreakdown => {
    return {
      clusterName: CLUSTER,
      metricName: input.metricName,
      metricFriendlyName: cephName(input.metricName),
      metricAlias: input.alias,
      metricUnit: "bytes",
      attributes: {},
      affectedResources: [
        { ...osd, metricValue: input.value, lowestMetricValue: input.value },
      ],
    };
  };

  const step: MonitorStep = withMetricViewConfig(
    cephTemplateStep("ceph-osd-down"),
    {
      queryConfigs: [
        queryConfig({
          alias: "osd_used",
          metricName: "ceph_osd_stat_bytes_used",
        }),
        queryConfig({ alias: "osd_total", metricName: "ceph_osd_stat_bytes" }),
      ],
      formulaConfigs: [
        formulaConfig({
          alias: "osd_fill",
          legend: "OSD Fill (%)",
          expression: "(osd_used / osd_total) * 100",
        }),
      ],
    },
  );

  const response: MetricMonitorResponse = metricResponse({
    cephResourceBreakdowns: [
      scan({
        alias: "osd_used",
        metricName: "ceph_osd_stat_bytes_used",
        value: 1500000000000,
      }),
      scan({
        alias: "osd_total",
        metricName: "ceph_osd_stat_bytes",
        value: 4000000000000,
      }),
    ],
  });

  return {
    platform: "Ceph",
    listHeading: "**Affected Resources**",
    render: (criteriaInstance: MonitorCriteriaInstance): string | null => {
      return Evaluator.buildCephRootCauseContext({
        dataToProcess: response,
        monitorStep: step,
        monitor: new Monitor(),
        criteriaInstance: criteriaInstance,
      });
    },
    queryAlias: "osd_used",
    expectedQueryList: [
      "**Affected Resources** (1 total)",
      "",
      "1. **Daemon** `osd.3` — **1.5 TB**",
      "   - Host: `ceph-1`",
    ],
    siblingValue: "4 TB",
    formulaAlias: "osd_fill",
    expectedFormulaLines: [
      "- Metric: OSD Fill (%)",
      "- Formula: `(osd_used / osd_total) * 100`",
      `  - \`osd_used\` = ${cephName("ceph_osd_stat_bytes_used")} (\`ceph_osd_stat_bytes_used\`)`,
      `  - \`osd_total\` = ${cephName("ceph_osd_stat_bytes")} (\`ceph_osd_stat_bytes\`)`,
    ],
    resourceName: "osd.3",
  };
}

describe("Platform raw scan: the criteria's own query is the one listed", () => {
  const cases: Array<PlatformSelectionCase> = [
    proxmoxSelectionCase(),
    vmwareSelectionCase(),
    dockerSwarmSelectionCase(),
    cephSelectionCase(),
  ];

  cases.forEach((platformCase: PlatformSelectionCase) => {
    describe(platformCase.platform, () => {
      test("a criteria on one query lists that query's scan, not its sibling's", () => {
        const text: string =
          platformCase.render(
            criteriaOn({
              alias: platformCase.queryAlias,
              filterType: FilterType.GreaterThan,
              value: 1,
            }),
          ) || "";

        expect(text).toContain(platformCase.expectedQueryList.join("\n"));
        expect(text).not.toContain(platformCase.siblingValue);
        expect(text).not.toMatch(RAW_NUMBER);
      });

      test("a criteria on the formula lists nothing but names the formula", () => {
        const text: string =
          platformCase.render(
            criteriaOn({
              alias: platformCase.formulaAlias,
              filterType: FilterType.GreaterThan,
              value: 85,
            }),
          ) || "";

        expect(text).toContain(platformCase.expectedFormulaLines.join("\n"));
        expect(text).not.toContain(platformCase.listHeading);
        expect(text).not.toContain(platformCase.resourceName);
        expect(text).not.toMatch(RAW_NUMBER);
      });
    });
  });
});

/*
 * ============================================================
 * 2. Unit fallback: the catalog's unit beats the scan's
 * ============================================================
 */

describe("Platform raw scan: the catalog unit wins over the scan's declared unit", () => {
  test("k8s.node.cpu.utilization is a cores gauge: 1.4 reads '1.4 cores', never '140.00%'", async () => {
    /*
     * kubeletstats declares the metric "1", which on a `.utilization`
     * name would read as a fraction and render ×100. The catalog knows
     * it is cores.
     */
    const metricName: string = "k8s.node.cpu.utilization";

    expect(getKubernetesMetricByMetricName(metricName)?.unit).toBe("cores");

    const context: string | null = await kubernetesContext({
      step: kubernetesStep({
        metricViewConfig: {
          queryConfigs: [
            queryConfig({ alias: "node_cpu", metricName: metricName }),
          ],
          formulaConfigs: [],
        },
      }),
      response: metricResponse({
        kubernetesResourceBreakdowns: [
          kubernetesScan({
            alias: "node_cpu",
            metricName: metricName,
            metricUnit: "1",
            resources: [
              { nodeName: "node-a", metricValue: 0.6, lowestMetricValue: 0.2 },
              { nodeName: "node-b", metricValue: 1.4, lowestMetricValue: 1.1 },
            ],
          }),
        ],
      }),
      criteria: criteriaOn({
        alias: "node_cpu",
        filterType: FilterType.GreaterThan,
        value: 1,
      }),
    });

    const text: string = context || "";

    expect(text).toContain(
      [
        "1. **Node** `node-b` — **1.4 cores**",
        "2. **Node** `node-a` — **0.6 cores**",
      ].join("\n"),
    );
    expect(text).toContain(
      `- Metric: ${kubernetesName(metricName)} (\`${metricName}\`)`,
    );
    expect(text).toContain(
      "Node `node-b` is at **1.4 cores** CPU utilization.",
    );
    expect(text).not.toContain("140.00%");
    expect(text).not.toContain("%");
  });

  test("VMware host CPU is already 0–100: 92.5 reads '92.50%', never '9250.00%'", () => {
    const step: MonitorStep = vmwareTemplateStep("vmware-host-cpu-saturation");
    const query: { alias: string; metricName: string } = firstQuery(step);

    expect(getVMwareMetricByMetricName(query.metricName)?.unit).toBe("%");

    const context: string | null = Evaluator.buildVMwareRootCauseContext({
      dataToProcess: metricResponse({
        vmwareResourceBreakdowns: [
          {
            vcenterName: VCENTER,
            metricName: query.metricName,
            metricFriendlyName: vmwareName(query.metricName),
            metricAlias: query.alias,
            // What the receiver might declare; the catalog must win.
            metricUnit: "1",
            attributes: {},
            affectedResources: [
              {
                hostName: "esx-1",
                clusterName: "prod-cluster",
                datacenterName: "dc1",
                metricValue: 92.5,
                lowestMetricValue: 91,
              },
              {
                hostName: "esx-2",
                clusterName: "prod-cluster",
                datacenterName: "dc1",
                metricValue: 95.25,
                lowestMetricValue: 93,
              },
              {
                hostName: "esx-3",
                clusterName: "prod-cluster",
                datacenterName: "dc1",
                metricValue: 0,
                lowestMetricValue: 0,
              },
            ],
          },
        ],
      }),
      monitorStep: step,
      monitor: new Monitor(),
      criteriaInstance: firingCriteria(step),
    });

    const text: string = context || "";

    expect(text).toContain(
      [
        "**Affected Resources** (2 total)",
        "",
        "1. **Host** `esx-2` — **95.25%**",
        "   - Cluster: `prod-cluster`",
        "2. **Host** `esx-1` — **92.50%**",
        "   - Cluster: `prod-cluster`",
      ].join("\n"),
    );
    expect(text).toContain(`- vCenter: ${VCENTER}`);
    expect(text).toContain(
      `- Metric: ${vmwareName(query.metricName)} (\`${query.metricName}\`)`,
    );
    expect(text).not.toContain("esx-3");
    expect(text).not.toContain("9250");
    expect(text).not.toContain("9525");
  });
});

/*
 * ============================================================
 * 3. The ungrouped Kubernetes templates
 * ============================================================
 *
 * Four shipped templates are deliberately NOT grouped — each is one
 * cluster-wide number — so their incidents can only ever list the raw
 * scan. Each is driven with its real step and firing criteria, and a
 * scan tagged with the template's own alias.
 */

describe("Ungrouped Kubernetes templates: rows and direction from the raw scan", () => {
  test("k8s-etcd-no-leader (= 0) lists the leaderless member at its LOWEST sample", async () => {
    const step: MonitorStep = kubernetesTemplateStep("k8s-etcd-no-leader");
    const criteria: MonitorCriteriaInstance = firingCriteria(step);
    const query: { alias: string; metricName: string } = firstQuery(step);

    // Fixture guard: an incident-opening `= 0` on an ungrouped query.
    expect(metricFilter(criteria).filterType).toBe(FilterType.EqualTo);
    expect(metricFilter(criteria).value).toBe(0);
    expect(criteria.data?.createIncidents).toBe(true);
    expect(MonitorStep.getGroupByAttributeKeys(step)).toEqual([]);

    const context: string | null = await kubernetesContext({
      step: step,
      criteria: criteria,
      response: metricResponse({
        kubernetesResourceBreakdowns: [
          kubernetesScan({
            alias: query.alias,
            metricName: query.metricName,
            resources: [
              {
                podName: "etcd-cp-2",
                namespace: "kube-system",
                nodeName: "cp-2",
                metricValue: 1,
                lowestMetricValue: 1,
              },
              /*
               * Lost its leader for one scrape: the highest sample is 1,
               * the Min-aggregated criteria fired on the 0.
               */
              {
                podName: "etcd-cp-1",
                namespace: "kube-system",
                nodeName: "cp-1",
                metricValue: 1,
                lowestMetricValue: 0,
              },
              {
                podName: "etcd-cp-3",
                namespace: "kube-system",
                nodeName: "cp-3",
                metricValue: 1,
                lowestMetricValue: 1,
              },
            ],
          }),
        ],
      }),
    });

    const text: string = context || "";

    expect(text).toContain(
      [
        "**Affected Resources** (1 total)",
        "",
        "1. **Pod** `etcd-cp-1` — **0**",
        "   - Namespace: `kube-system`",
        "   - Node: `cp-1`",
      ].join("\n"),
    );
    expect(text).toContain(
      `- Metric: ${kubernetesName(query.metricName)} (\`${query.metricName}\`)`,
    );
    expect(text).toContain("Most affected pod: `etcd-cp-1` (**0**)");
    expect(text).not.toContain("etcd-cp-2");
    expect(text).not.toContain("etcd-cp-3");
  });

  test("k8s-apiserver-throttling (>= 200) lists the busiest API server first, idle ones dropped", async () => {
    const step: MonitorStep = kubernetesTemplateStep(
      "k8s-apiserver-throttling",
    );
    const criteria: MonitorCriteriaInstance = firingCriteria(step);
    const query: { alias: string; metricName: string } = firstQuery(step);

    expect(metricFilter(criteria).filterType).toBe(
      FilterType.GreaterThanOrEqualTo,
    );
    expect(MonitorStep.getGroupByAttributeKeys(step)).toEqual([]);

    const context: string | null = await kubernetesContext({
      step: step,
      criteria: criteria,
      response: metricResponse({
        kubernetesResourceBreakdowns: [
          kubernetesScan({
            alias: query.alias,
            metricName: query.metricName,
            resources: [
              {
                podName: "kube-apiserver-cp-2",
                namespace: "kube-system",
                metricValue: 210,
                lowestMetricValue: 205,
              },
              {
                podName: "kube-apiserver-cp-1",
                namespace: "kube-system",
                metricValue: 250,
                lowestMetricValue: 190,
              },
              // Just restarted: nothing in flight.
              {
                podName: "kube-apiserver-cp-3",
                namespace: "kube-system",
                metricValue: 0,
                lowestMetricValue: 0,
              },
            ],
          }),
        ],
      }),
    });

    const text: string = context || "";

    /*
     * An upward criteria reads each server's HIGHEST sample; the catalog
     * calls it a "count", which is left bare rather than printed as
     * "250 count".
     */
    expect(text).toContain(
      [
        "**Affected Resources** (2 total)",
        "",
        "1. **Pod** `kube-apiserver-cp-1` — **250**",
        "   - Namespace: `kube-system`",
        "2. **Pod** `kube-apiserver-cp-2` — **210**",
        "   - Namespace: `kube-system`",
      ].join("\n"),
    );
    expect(text).toContain(
      `Kubernetes metric \`${query.metricName}\` (${kubernetesName(query.metricName)}) has breached the configured threshold.`,
    );
    expect(text).toContain(
      "Most affected pod: `kube-apiserver-cp-1` (**250**)",
    );
    expect(text).not.toContain("kube-apiserver-cp-3");
    expect(text).not.toContain("count");
  });

  test("k8s-apiserver-throttling: a scrape with no Kubernetes identity is titled by the cluster", async () => {
    const step: MonitorStep = kubernetesTemplateStep(
      "k8s-apiserver-throttling",
    );
    const query: { alias: string; metricName: string } = firstQuery(step);

    const context: string | null = await kubernetesContext({
      step: step,
      criteria: firingCriteria(step),
      response: metricResponse({
        kubernetesResourceBreakdowns: [
          kubernetesScan({
            alias: query.alias,
            metricName: query.metricName,
            resources: [{ metricValue: 250, lowestMetricValue: 190 }],
          }),
        ],
      }),
    });

    expect(context).toContain(
      [
        "**Affected Resources** (1 total)",
        "",
        `1. **Cluster** \`${CLUSTER}\` — **250**`,
      ].join("\n"),
    );
  });

  test("k8s-scheduler-backlog (> 0) lists the scheduler with a queue at its highest sample", async () => {
    const step: MonitorStep = kubernetesTemplateStep("k8s-scheduler-backlog");
    const criteria: MonitorCriteriaInstance = firingCriteria(step);
    const query: { alias: string; metricName: string } = firstQuery(step);

    expect(metricFilter(criteria).filterType).toBe(FilterType.GreaterThan);
    expect(metricFilter(criteria).value).toBe(0);
    expect(MonitorStep.getGroupByAttributeKeys(step)).toEqual([]);

    const context: string | null = await kubernetesContext({
      step: step,
      criteria: criteria,
      response: metricResponse({
        kubernetesResourceBreakdowns: [
          kubernetesScan({
            alias: query.alias,
            metricName: query.metricName,
            resources: [
              // The standby scheduler holds no queue.
              {
                podName: "kube-scheduler-cp-2",
                namespace: "kube-system",
                metricValue: 0,
                lowestMetricValue: 0,
              },
              {
                podName: "kube-scheduler-cp-1",
                namespace: "kube-system",
                metricValue: 3,
                lowestMetricValue: 0,
              },
            ],
          }),
        ],
      }),
    });

    const text: string = context || "";

    expect(text).toContain(
      [
        "**Affected Resources** (1 total)",
        "",
        "1. **Pod** `kube-scheduler-cp-1` — **3**",
        "   - Namespace: `kube-system`",
      ].join("\n"),
    );
    expect(text).toContain(
      `- Metric: ${kubernetesName(query.metricName)} (\`${query.metricName}\`)`,
    );
    expect(text).toContain("Most affected pod: `kube-scheduler-cp-1` (**3**)");
    expect(text).not.toContain("kube-scheduler-cp-2");
  });

  describe("k8s-pod-pending (phase = 1)", () => {
    /*
     * k8s.pod.phase carries the phase in its VALUE: 1 = Pending,
     * 2 = Running, 3 = Succeeded, 4 = Failed, 5 = Unknown. The template
     * fires when the cluster-wide Min is exactly 1.
     */
    function podPendingContext(): Promise<string | null> {
      const step: MonitorStep = kubernetesTemplateStep("k8s-pod-pending");
      const query: { alias: string; metricName: string } = firstQuery(step);

      return kubernetesContext({
        step: step,
        criteria: firingCriteria(step),
        response: metricResponse({
          kubernetesResourceBreakdowns: [
            kubernetesScan({
              alias: query.alias,
              metricName: query.metricName,
              resources: [
                {
                  podName: "checkout-7d9f-running",
                  namespace: "shop",
                  metricValue: 2,
                  lowestMetricValue: 2,
                },
                {
                  podName: "checkout-7d9f-pending",
                  namespace: "shop",
                  metricValue: 1,
                  lowestMetricValue: 1,
                },
                {
                  podName: "report-job-failed",
                  namespace: "batch",
                  metricValue: 4,
                  lowestMetricValue: 4,
                },
                {
                  podName: "lost-pod",
                  namespace: "shop",
                  metricValue: 5,
                  lowestMetricValue: 5,
                },
              ],
            }),
          ],
        }),
      });
    }

    test("fixture guard: an incident-opening `= 1` on an ungrouped k8s.pod.phase query", () => {
      const step: MonitorStep = kubernetesTemplateStep("k8s-pod-pending");
      const criteria: MonitorCriteriaInstance = firingCriteria(step);

      expect(firstQuery(step).metricName).toBe("k8s.pod.phase");
      expect(metricFilter(criteria).filterType).toBe(FilterType.EqualTo);
      expect(metricFilter(criteria).value).toBe(1);
      expect(criteria.data?.createIncidents).toBe(true);
      expect(MonitorStep.getGroupByAttributeKeys(step)).toEqual([]);
    });

    test("names the metric and takes the Pending analysis branch", async () => {
      const text: string = (await podPendingContext()) || "";

      expect(text).toContain(
        `- Metric: ${kubernetesName("k8s.pod.phase")} (\`k8s.pod.phase\`)`,
      );
      expect(text).toContain(
        "Pods are stuck in Pending phase and unable to be scheduled.",
      );
    });

    test("lists only the Pending pod, and the analysis sends the reader to it", async () => {
      /*
       * The criteria compared the phase code for EQUALITY with 1. A
       * Running (2), Failed (4) or Unknown (5) pod did not breach it, and
       * ranking them "highest first" puts the Unknown pod at the top and
       * into the `kubectl describe pod` the analysis recommends for
       * scheduling events.
       */
      const text: string = (await podPendingContext()) || "";

      expect(text).toContain(
        [
          "**Affected Resources** (1 total)",
          "",
          "1. **Pod** `checkout-7d9f-pending` — **1**",
          "   - Namespace: `shop`",
        ].join("\n"),
      );
      expect(text).toContain("kubectl describe pod checkout-7d9f-pending");
      expect(text).not.toContain("checkout-7d9f-running");
      expect(text).not.toContain("report-job-failed");
      expect(text).not.toContain("lost-pod");
    });
  });
});

/*
 * ============================================================
 * 4. The other platforms' fall criteria on the raw scan
 * ============================================================
 */

describe("Platform templates: fall criteria list the resources that fell", () => {
  function proxmoxNodes(): Array<ProxmoxAffectedResource> {
    return [
      // Went down for one scrape: highest 1, lowest 0.
      {
        resourceId: "node/pve1",
        resourceType: "node",
        scope: "node",
        metricValue: 1,
        lowestMetricValue: 0,
      },
      {
        resourceId: "node/pve2",
        resourceType: "node",
        scope: "node",
        metricValue: 1,
        lowestMetricValue: 1,
      },
      {
        resourceId: "node/pve3",
        resourceType: "node",
        scope: "node",
        metricValue: 0,
        lowestMetricValue: 0,
      },
    ];
  }

  const PROXMOX_DOWN_LIST: string = [
    "**Affected Resources** (2 total)",
    "",
    "1. **Node** `node/pve1` — **0**",
    "2. **Node** `node/pve3` — **0**",
  ].join("\n");

  test("pve-node-offline (pve_up < 1) lists the down nodes at 0, healthy nodes absent", () => {
    const step: MonitorStep = proxmoxTemplateStep("pve-node-offline");
    const criteria: MonitorCriteriaInstance = firingCriteria(step);
    const query: { alias: string; metricName: string } = firstQuery(step);

    expect(metricFilter(criteria).filterType).toBe(FilterType.LessThan);
    expect(metricFilter(criteria).value).toBe(1);

    const text: string =
      Evaluator.buildProxmoxRootCauseContext({
        dataToProcess: metricResponse({
          proxmoxResourceBreakdowns: [
            {
              clusterName: CLUSTER,
              metricName: query.metricName,
              metricFriendlyName: proxmoxName(query.metricName),
              metricAlias: query.alias,
              attributes: {},
              affectedResources: proxmoxNodes(),
            },
          ],
        }),
        monitorStep: step,
        monitor: new Monitor(),
        criteriaInstance: criteria,
      }) || "";

    expect(text).toContain(PROXMOX_DOWN_LIST);
    expect(text).toContain(
      `- Metric: ${proxmoxName(query.metricName)} (\`${query.metricName}\`)`,
    );
    // The old `> 0` listed exactly this healthy node, and only it.
    expect(text).not.toContain("node/pve2");
  });

  test("pve-node-offline reads a legacy untagged singular breakdown the same way", () => {
    const step: MonitorStep = proxmoxTemplateStep("pve-node-offline");
    const query: { alias: string; metricName: string } = firstQuery(step);

    const text: string =
      Evaluator.buildProxmoxRootCauseContext({
        dataToProcess: metricResponse({
          proxmoxResourceBreakdown: {
            clusterName: CLUSTER,
            metricName: query.metricName,
            metricFriendlyName: proxmoxName(query.metricName),
            attributes: {},
            affectedResources: proxmoxNodes(),
          },
        }),
        monitorStep: step,
        monitor: new Monitor(),
        criteriaInstance: firingCriteria(step),
      }) || "";

    expect(text).toContain(PROXMOX_DOWN_LIST);
    expect(text).not.toContain("node/pve2");
  });

  test("docker-swarm-task-down (uptime < 60) lists the lowest uptime first, as a duration", () => {
    const step: MonitorStep = dockerSwarmTemplateStep("docker-swarm-task-down");
    const criteria: MonitorCriteriaInstance = firingCriteria(step);
    const query: { alias: string; metricName: string } = firstQuery(step);

    expect(metricFilter(criteria).filterType).toBe(FilterType.LessThan);
    expect(metricFilter(criteria).value).toBe(60);
    expect(getDockerSwarmMetricByMetricName(query.metricName)?.unit).toBe(
      "seconds",
    );

    const text: string =
      Evaluator.buildDockerSwarmRootCauseContext({
        dataToProcess: metricResponse({
          dockerSwarmResourceBreakdowns: [
            {
              clusterName: CLUSTER,
              metricName: query.metricName,
              metricFriendlyName: dockerSwarmName(query.metricName),
              metricAlias: query.alias,
              metricUnit: "s",
              attributes: {},
              affectedResources: [
                // Ran for an hour, then restarted 45 seconds ago.
                {
                  containerName: "web.1.abc",
                  serviceName: "web",
                  nodeName: "swarm-1",
                  metricValue: 3600,
                  lowestMetricValue: 45,
                },
                // Healthy and long-running.
                {
                  containerName: "api.1.xyz",
                  serviceName: "api",
                  nodeName: "swarm-1",
                  metricValue: 86400,
                  lowestMetricValue: 86340,
                },
                // Crash-looping: never gets past half a minute.
                {
                  containerName: "web.2.def",
                  serviceName: "web",
                  nodeName: "swarm-2",
                  metricValue: 30,
                  lowestMetricValue: 12,
                },
              ],
            },
          ],
        }),
        monitorStep: step,
        monitor: new Monitor(),
        criteriaInstance: criteria,
      }) || "";

    expect(text).toContain(
      [
        "**Affected Tasks** (2 total)",
        "",
        "1. **Task** `web.2.def` — **12 sec**",
        "   - Service: `web`",
        "   - Node: `swarm-2`",
        "2. **Task** `web.1.abc` — **45 sec**",
        "   - Service: `web`",
        "   - Node: `swarm-1`",
      ].join("\n"),
    );
    expect(text).not.toContain("api.1.xyz");
    expect(text).not.toContain("86400");
  });

  test("ceph-osd-down (ceph_osd_up < 1) lists the down OSDs at 0, up OSDs absent", () => {
    const step: MonitorStep = cephTemplateStep("ceph-osd-down");
    const criteria: MonitorCriteriaInstance = firingCriteria(step);
    const query: { alias: string; metricName: string } = firstQuery(step);

    expect(metricFilter(criteria).filterType).toBe(FilterType.LessThan);
    expect(metricFilter(criteria).value).toBe(1);

    const text: string =
      Evaluator.buildCephRootCauseContext({
        dataToProcess: metricResponse({
          cephResourceBreakdowns: [
            {
              clusterName: CLUSTER,
              metricName: query.metricName,
              metricFriendlyName: cephName(query.metricName),
              metricAlias: query.alias,
              attributes: {},
              affectedResources: [
                {
                  daemon: "osd.3",
                  hostname: "ceph-1",
                  metricValue: 1,
                  lowestMetricValue: 0,
                },
                {
                  daemon: "osd.4",
                  hostname: "ceph-1",
                  metricValue: 1,
                  lowestMetricValue: 1,
                },
                {
                  daemon: "osd.7",
                  hostname: "ceph-2",
                  metricValue: 0,
                  lowestMetricValue: 0,
                },
              ],
            },
          ],
        }),
        monitorStep: step,
        monitor: new Monitor(),
        criteriaInstance: criteria,
      }) || "";

    expect(text).toContain(
      [
        "**Affected Resources** (2 total)",
        "",
        "1. **Daemon** `osd.3` — **0**",
        "   - Host: `ceph-1`",
        "2. **Daemon** `osd.7` — **0**",
        "   - Host: `ceph-2`",
      ].join("\n"),
    );
    expect(text).toContain(
      `- Metric: ${cephName(query.metricName)} (\`${query.metricName}\`)`,
    );
    expect(text).not.toContain("osd.4");
    expect(text).not.toContain("count");
  });
});

/*
 * ============================================================
 * 5. The namespace line
 * ============================================================
 *
 * The worker records the query's attribute filters under their stored,
 * `resource.`-prefixed keys. The evaluator used to read the bare key,
 * which never occurs, so this line never rendered.
 */

describe("Kubernetes details: the namespace the query was scoped to", () => {
  function namespaceContext(input: {
    attributes: Dictionary<string>;
    namespaceFilter?: string | undefined;
  }): Promise<string | null> {
    return kubernetesContext({
      step: kubernetesStep({
        metricViewConfig: {
          queryConfigs: [
            queryConfig({
              alias: "unavailable",
              metricName: "k8s.deployment.unavailable_replicas",
            }),
          ],
          formulaConfigs: [],
        },
        namespaceFilter: input.namespaceFilter,
      }),
      response: metricResponse({
        kubernetesResourceBreakdowns: [
          kubernetesScan({
            alias: "unavailable",
            metricName: "k8s.deployment.unavailable_replicas",
            attributes: input.attributes,
            resources: [
              {
                workloadType: "Deployment",
                workloadName: "checkout",
                namespace: "payments",
                metricValue: 2,
                lowestMetricValue: 1,
              },
            ],
          }),
        ],
      }),
      criteria: criteriaOn({
        alias: "unavailable",
        filterType: FilterType.GreaterThan,
        value: 0,
      }),
    });
  }

  test("reads the `resource.`-prefixed attribute the worker records", async () => {
    const context: string | null = await namespaceContext({
      attributes: {
        "resource.k8s.cluster.name": CLUSTER,
        "resource.k8s.namespace.name": "payments",
      },
    });

    expect(context).toContain(
      [
        `- Cluster: ${CLUSTER}`,
        `- Metric: ${kubernetesName("k8s.deployment.unavailable_replicas")} (\`k8s.deployment.unavailable_replicas\`)`,
        "- Namespace: payments",
      ].join("\n"),
    );
  });

  test("falls back to the step's namespace filter", async () => {
    const context: string | null = await namespaceContext({
      attributes: { "resource.k8s.cluster.name": CLUSTER },
      namespaceFilter: "payments",
    });

    expect(context).toContain("- Namespace: payments");
  });

  test("renders no namespace line when the query was not scoped to one", async () => {
    const context: string | null = await namespaceContext({
      attributes: { "resource.k8s.cluster.name": CLUSTER },
    });

    // No cluster-level line (an entry's detail bullet is indented).
    expect(context).not.toMatch(/^- Namespace:/m);
    // The resource's own namespace still sits under its entry.
    expect(context).toContain("   - Namespace: `payments`");
  });
});

/*
 * ============================================================
 * 6. The "- Metric:" line
 * ============================================================
 */

describe("Platform details: the metric line never repeats a name as its own friendly name", () => {
  test("a metric whose friendly name is its own name renders as just the code-quoted name", async () => {
    /*
     * The worker's friendly name for a metric the catalog does not know
     * is the metric name itself, which the old line printed twice:
     * "k8s.node.allocatable_memory (`k8s.node.allocatable_memory`)".
     */
    const scan: KubernetesResourceBreakdown = allocatableScan("alloc_mem");

    expect(scan.metricFriendlyName).toBe(UNCATALOGED_METRIC);

    const context: string | null = await kubernetesContext({
      step: kubernetesStep({ metricViewConfig: memoryRatioConfig() }),
      response: metricResponse({ kubernetesResourceBreakdowns: [scan] }),
      criteria: criteriaOn({
        alias: "alloc_mem",
        filterType: FilterType.GreaterThan,
        value: 100,
      }),
    });

    const text: string = context || "";

    expect(text).toContain(`- Metric: \`${UNCATALOGED_METRIC}\``);
    expect(text).not.toContain(
      `${UNCATALOGED_METRIC} (\`${UNCATALOGED_METRIC}\`)`,
    );
    expect(text.split("- Metric:").length - 1).toBe(1);
    // Nor does the analysis add the same name again in parentheses.
    expect(text).toContain(
      `Kubernetes metric \`${UNCATALOGED_METRIC}\` has breached the configured threshold.`,
    );
  });

  test("a cataloged metric is named by the catalog, with its metric name beside it", async () => {
    const metricName: string = "k8s.node.memory.usage";

    const context: string | null = await kubernetesContext({
      step: kubernetesStep({ metricViewConfig: memoryRatioConfig() }),
      response: metricResponse({
        kubernetesResourceBreakdowns: [usedScan("used_mem")],
      }),
      criteria: criteriaOn({
        alias: "used_mem",
        filterType: FilterType.GreaterThan,
        value: 100,
      }),
    });

    expect(kubernetesName(metricName)).not.toBe(metricName);
    expect(context).toContain(
      `- Metric: ${kubernetesName(metricName)} (\`${metricName}\`)`,
    );
  });
});
