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
import Dictionary from "../../../../Types/Dictionary";
import { JSONObject } from "../../../../Types/JSON";
import MetricFormulaConfigData from "../../../../Types/Metrics/MetricFormulaConfigData";
import MetricQueryConfigData from "../../../../Types/Metrics/MetricQueryConfigData";
import MetricsViewConfig from "../../../../Types/Metrics/MetricsViewConfig";
import {
  CephAlertTemplate,
  getCephAlertTemplateById,
} from "../../../../Types/Monitor/CephAlertTemplates";
import { getCephMetricByMetricName } from "../../../../Types/Monitor/CephMetricCatalog";
import {
  DockerSwarmAlertTemplate,
  getDockerSwarmAlertTemplateById,
} from "../../../../Types/Monitor/DockerSwarmAlertTemplates";
import { getDockerSwarmMetricByMetricName } from "../../../../Types/Monitor/DockerSwarmMetricCatalog";
import MetricMonitorResponse from "../../../../Types/Monitor/MetricMonitor/MetricMonitorResponse";
import MetricSeriesResult from "../../../../Types/Monitor/MetricMonitor/MetricSeriesResult";
import MonitorEvaluationSummary from "../../../../Types/Monitor/MonitorEvaluationSummary";
import MonitorStep from "../../../../Types/Monitor/MonitorStep";
import MonitorType from "../../../../Types/Monitor/MonitorType";
import {
  getProxmoxAlertTemplateById,
  ProxmoxAlertTemplate,
} from "../../../../Types/Monitor/ProxmoxAlertTemplates";
import { getProxmoxMetricByMetricName } from "../../../../Types/Monitor/ProxmoxMetricCatalog";
import {
  getVMwareAlertTemplateById,
  VMwareAlertTemplate,
  VMwareGroupByKey,
} from "../../../../Types/Monitor/VMwareAlertTemplates";
import { getVMwareMetricByMetricName } from "../../../../Types/Monitor/VMwareMetricCatalog";
import ObjectID from "../../../../Types/ObjectID";
import ProbeApiIngestResponse from "../../../../Types/Probe/ProbeApiIngestResponse";
import MetricFormulaEvaluator from "../../../../Utils/Metrics/MetricFormulaEvaluator";
import MetricSeriesFingerprint from "../../../../Utils/Metrics/MetricSeriesFingerprint";
import PlatformMetricUnitUtil, {
  MetricCatalogPlatform,
} from "../../../../Utils/Monitor/PlatformMetricUnitUtil";
import PlatformResourceIdentity, {
  CephResourceIdentity,
  DockerSwarmResourceIdentity,
  ProxmoxResourceIdentity,
  VMwareResourceIdentity,
} from "../../../../Utils/Monitor/PlatformResourceIdentity";
import { describe, expect, test } from "@jest/globals";

/*
 * Why this suite exists.
 *
 * A GROUPED platform monitor (one alert per node / pool / VM / task) used
 * to render its "Affected Resources" list from the worker's raw scan of
 * whichever query happened to be scanned last — for a ratio template that
 * is the DENOMINATOR, so a "Node Memory Utilization > 85%" email listed
 * every node at its total RAM in raw bytes, breaching or not; a Ceph
 * "Pool Near Full" email led with the EMPTIEST pool, ranked by free
 * bytes; and "Node Offline" / "OSD Down" listed the healthy resources
 * (value 1) and dropped the down one (value 0).
 *
 * The list is now built from the series the criteria actually matched,
 * valued with each series' worst breaching sample in the criteria's own
 * unit. The Kubernetes ratio email has its own suite
 * (MonitorCriteriaEvaluatorKubernetesRatioEmail.test.ts); these tests
 * drive the REAL Proxmox, Ceph, VMware and Docker Swarm templates through
 * the public evaluator entry point with a worker-shaped response —
 * seriesBreakdown aligned [queries..., formulas...], formula slots
 * computed by the same MetricFormulaEvaluator the worker uses, query rows
 * carrying the raw datapoint attributes, one alias-tagged raw-scan
 * breakdown per query, and the catalog-overlaid unit map — and pin the
 * rendered markdown.
 */

const MINUTES: Array<Date> = [0, 1, 2, 3, 4].map((minute: number) => {
  return new Date(Date.UTC(2026, 8, 25, 10, minute, 0));
});

const PVE_CLUSTER: string = "pve-lab";
const CEPH_CLUSTER: string = "ceph-prod";
const VCENTER: string = "vcsa-prod";
const SWARM_CLUSTER: string = "swarm-prod";

// No rendered value may be a raw, unscaled 10+ digit number (bytes, epochs).
const RAW_NUMBER: RegExp = /\b\d{10,}\b/;

/*
 * One resource as the worker's raw rows see it: the datapoint attributes
 * every row of it carries, and one value per minute for each query alias.
 */
interface RawSeries {
  attributes: JSONObject;
  valuesByAlias: Dictionary<Array<number>>;
}

type ScannedResource<I> = I & {
  metricValue: number;
  lowestMetricValue: number;
};

// A platform breakdown without its cluster / vCenter name.
interface ScannedBreakdown<I> {
  metricName: string;
  metricFriendlyName: string;
  metricAlias: string | undefined;
  metricUnit: string | undefined;
  attributes: Dictionary<string>;
  affectedResources: Array<ScannedResource<I>>;
}

interface PlatformFixture<I> {
  monitorType: MonitorType;
  platform: MetricCatalogPlatform;
  friendlyName: (metricName: string) => string | undefined;
  toIdentity: (attributes: JSONObject) => I;
  identityKey: (identity: I) => string;
  attach: (
    response: MetricMonitorResponse,
    breakdowns: Array<ScannedBreakdown<I>>,
  ) => void;
}

const PROXMOX: PlatformFixture<ProxmoxResourceIdentity> = {
  monitorType: MonitorType.Proxmox,
  platform: "proxmox",
  friendlyName: (metricName: string): string | undefined => {
    return getProxmoxMetricByMetricName(metricName)?.friendlyName;
  },
  toIdentity: PlatformResourceIdentity.proxmox,
  identityKey: PlatformResourceIdentity.proxmoxKey,
  attach: (
    response: MetricMonitorResponse,
    breakdowns: Array<ScannedBreakdown<ProxmoxResourceIdentity>>,
  ): void => {
    response.proxmoxResourceBreakdowns = breakdowns.map(
      (breakdown: ScannedBreakdown<ProxmoxResourceIdentity>) => {
        return { ...breakdown, clusterName: PVE_CLUSTER };
      },
    );
  },
};

const CEPH: PlatformFixture<CephResourceIdentity> = {
  monitorType: MonitorType.Ceph,
  platform: "ceph",
  friendlyName: (metricName: string): string | undefined => {
    return getCephMetricByMetricName(metricName)?.friendlyName;
  },
  toIdentity: PlatformResourceIdentity.ceph,
  identityKey: PlatformResourceIdentity.cephKey,
  attach: (
    response: MetricMonitorResponse,
    breakdowns: Array<ScannedBreakdown<CephResourceIdentity>>,
  ): void => {
    response.cephResourceBreakdowns = breakdowns.map(
      (breakdown: ScannedBreakdown<CephResourceIdentity>) => {
        return { ...breakdown, clusterName: CEPH_CLUSTER };
      },
    );
  },
};

const VMWARE: PlatformFixture<VMwareResourceIdentity> = {
  monitorType: MonitorType.VMware,
  platform: "vmware",
  friendlyName: (metricName: string): string | undefined => {
    return getVMwareMetricByMetricName(metricName)?.friendlyName;
  },
  toIdentity: PlatformResourceIdentity.vmware,
  identityKey: PlatformResourceIdentity.vmwareKey,
  attach: (
    response: MetricMonitorResponse,
    breakdowns: Array<ScannedBreakdown<VMwareResourceIdentity>>,
  ): void => {
    response.vmwareResourceBreakdowns = breakdowns.map(
      (breakdown: ScannedBreakdown<VMwareResourceIdentity>) => {
        return { ...breakdown, vcenterName: VCENTER };
      },
    );
  },
};

const DOCKER_SWARM: PlatformFixture<DockerSwarmResourceIdentity> = {
  monitorType: MonitorType.DockerSwarm,
  platform: "dockerSwarm",
  friendlyName: (metricName: string): string | undefined => {
    return getDockerSwarmMetricByMetricName(metricName)?.friendlyName;
  },
  toIdentity: PlatformResourceIdentity.dockerSwarm,
  identityKey: PlatformResourceIdentity.dockerSwarmKey,
  attach: (
    response: MetricMonitorResponse,
    breakdowns: Array<ScannedBreakdown<DockerSwarmResourceIdentity>>,
  ): void => {
    response.dockerSwarmResourceBreakdowns = breakdowns.map(
      (breakdown: ScannedBreakdown<DockerSwarmResourceIdentity>) => {
        return { ...breakdown, clusterName: SWARM_CLUSTER };
      },
    );
  },
};

interface CommonTemplateArgs {
  onlineMonitorStatusId: ObjectID;
  offlineMonitorStatusId: ObjectID;
  defaultIncidentSeverityId: ObjectID;
  defaultAlertSeverityId: ObjectID;
  monitorName: string;
}

function commonArgs(monitorName: string): CommonTemplateArgs {
  return {
    onlineMonitorStatusId: ObjectID.generate(),
    offlineMonitorStatusId: ObjectID.generate(),
    defaultIncidentSeverityId: ObjectID.generate(),
    defaultAlertSeverityId: ObjectID.generate(),
    monitorName: monitorName,
  };
}

function requireTemplate<T>(template: T | undefined, id: string): T {
  if (!template) {
    throw new Error(`${id} template missing`);
  }

  return template;
}

function proxmoxStep(templateId: string): MonitorStep {
  const template: ProxmoxAlertTemplate = requireTemplate(
    getProxmoxAlertTemplateById(templateId),
    templateId,
  );

  return template.getMonitorStep({
    clusterIdentifier: PVE_CLUSTER,
    ...commonArgs(`${PVE_CLUSTER} - ${template.name}`),
  });
}

function cephStep(templateId: string): MonitorStep {
  const template: CephAlertTemplate = requireTemplate(
    getCephAlertTemplateById(templateId),
    templateId,
  );

  return template.getMonitorStep({
    clusterIdentifier: CEPH_CLUSTER,
    ...commonArgs(`${CEPH_CLUSTER} - ${template.name}`),
  });
}

function vmwareStep(templateId: string): MonitorStep {
  const template: VMwareAlertTemplate = requireTemplate(
    getVMwareAlertTemplateById(templateId),
    templateId,
  );

  return template.getMonitorStep({
    vcenterIdentifier: VCENTER,
    ...commonArgs(`${VCENTER} - ${template.name}`),
  });
}

function dockerSwarmStep(templateId: string): MonitorStep {
  const template: DockerSwarmAlertTemplate = requireTemplate(
    getDockerSwarmAlertTemplateById(templateId),
    templateId,
  );

  return template.getMonitorStep({
    clusterIdentifier: SWARM_CLUSTER,
    ...commonArgs(`${SWARM_CLUSTER} - ${template.name}`),
  });
}

function viewConfigOf(monitorStep: MonitorStep): MetricsViewConfig {
  const config: MetricsViewConfig | undefined =
    MonitorStep.getMetricsViewConfig(monitorStep);

  if (!config) {
    throw new Error("template has no metric view config");
  }

  return config;
}

function aliasOf(config: {
  metricAliasData?: { metricVariable?: string | undefined } | undefined;
}): string {
  return config.metricAliasData?.metricVariable || "";
}

function metricNameOf(queryConfig: MetricQueryConfigData): string {
  return (queryConfig.metricQueryData.filterData.metricName as string) || "";
}

/*
 * What the telemetry worker hands the evaluator for a grouped platform
 * monitor, built the way the worker builds it:
 *
 *  - per query, one row per minute per resource, each carrying the raw
 *    datapoint attributes (aggregatePerSeriesFromRawMetrics keeps the
 *    bucket's first datapoint's attribute map);
 *  - series labels / fingerprints from the template's group-by keys;
 *  - each series' formula slots evaluated by MetricFormulaEvaluator, as
 *    appendFormulaResults does — their rows carry only the group labels;
 *  - one raw-scan breakdown per query, tagged with the query's alias and
 *    the unit the monitor's unit map gives it;
 *  - nativeUnitsByMetricName from the catalog-overlaid unit map.
 */
function workerResponse<I>(input: {
  monitorStep: MonitorStep;
  fixture: PlatformFixture<I>;
  series: Array<RawSeries>;
  declaredUnits?: Dictionary<string> | undefined;
}): MetricMonitorResponse {
  const viewConfig: MetricsViewConfig = viewConfigOf(input.monitorStep);
  const queryConfigs: Array<MetricQueryConfigData> = viewConfig.queryConfigs;
  const formulaConfigs: Array<MetricFormulaConfigData> =
    viewConfig.formulaConfigs || [];
  const groupByKeys: Array<string> = MonitorStep.getGroupByAttributeKeys(
    input.monitorStep,
  );

  if (groupByKeys.length === 0) {
    throw new Error("these tests are about GROUPED monitors");
  }

  const declaredUnits: Map<string, string> = new Map<string, string>(
    Object.entries(input.declaredUnits || {}).map(
      ([metricName, unit]: [string, string]): [string, string] => {
        return [metricName.toLowerCase(), unit];
      },
    ),
  );

  const unitsByMetricName: Dictionary<string> =
    PlatformMetricUnitUtil.buildUnitsByMetricName({
      platform: input.fixture.platform,
      metricNames: queryConfigs.map(metricNameOf),
      declaredUnitsByMetricName: declaredUnits,
    });

  const queryRows: (
    series: RawSeries,
    alias: string,
  ) => Array<AggregateModel> = (
    series: RawSeries,
    alias: string,
  ): Array<AggregateModel> => {
    const values: Array<number> = series.valuesByAlias[alias] || [];

    return values.map((value: number, i: number): AggregateModel => {
      return {
        timestamp: MINUTES[i]!,
        value: value,
        attributes: series.attributes,
      } as unknown as AggregateModel;
    });
  };

  const seriesBreakdown: Array<MetricSeriesResult> = input.series.map(
    (series: RawSeries): MetricSeriesResult => {
      const results: Array<AggregatedResult> = queryConfigs.map(
        (queryConfig: MetricQueryConfigData): AggregatedResult => {
          return { data: queryRows(series, aliasOf(queryConfig)) };
        },
      );

      formulaConfigs.forEach(
        (formulaConfig: MetricFormulaConfigData, index: number): void => {
          results.push(
            MetricFormulaEvaluator.evaluateFormula({
              formula: formulaConfig.metricFormulaData.metricFormula,
              queryConfigs: queryConfigs,
              formulaConfigs: formulaConfigs.slice(0, index),
              results: [...results],
            }),
          );
        },
      );

      const labels: JSONObject = MetricSeriesFingerprint.extractSeriesLabels({
        sample: { attributes: series.attributes } as unknown as AggregateModel,
        attributeKeys: groupByKeys,
      });

      return {
        fingerprint: MetricSeriesFingerprint.computeFingerprint(labels),
        labels: labels,
        aggregatedResults: results,
      };
    },
  );

  const breakdowns: Array<ScannedBreakdown<I>> = queryConfigs.map(
    (queryConfig: MetricQueryConfigData): ScannedBreakdown<I> => {
      const alias: string = aliasOf(queryConfig);
      const metricName: string = metricNameOf(queryConfig);
      const byKey: Map<string, ScannedResource<I>> = new Map();

      for (const series of input.series) {
        for (const row of queryRows(series, alias)) {
          const identity: I = input.fixture.toIdentity(series.attributes);
          const key: string = input.fixture.identityKey(identity);
          const existing: ScannedResource<I> | undefined = byKey.get(key);

          if (!existing) {
            byKey.set(key, {
              ...identity,
              metricValue: row.value,
              lowestMetricValue: row.value,
            });
            continue;
          }

          existing.metricValue = Math.max(existing.metricValue, row.value);
          existing.lowestMetricValue = Math.min(
            existing.lowestMetricValue,
            row.value,
          );
        }
      }

      return {
        metricName: metricName,
        metricFriendlyName:
          input.fixture.friendlyName(metricName) || metricName,
        metricAlias: alias,
        metricUnit: unitsByMetricName[metricName.toLowerCase()],
        attributes: {
          ...((queryConfig.metricQueryData.filterData.attributes ||
            {}) as Dictionary<string>),
        },
        affectedResources: Array.from(byKey.values()),
      };
    },
  );

  const response: MetricMonitorResponse = {
    projectId: ObjectID.generate(),
    monitorId: ObjectID.generate(),
    metricResult: [],
    metricViewConfig: viewConfig,
    seriesBreakdown: seriesBreakdown,
    nativeUnitsByMetricName: unitsByMetricName,
  };

  input.fixture.attach(
    response,
    breakdowns.filter((breakdown: ScannedBreakdown<I>) => {
      return breakdown.affectedResources.length > 0;
    }),
  );

  return response;
}

async function rootCauseOf<I>(input: {
  monitorStep: MonitorStep;
  fixture: PlatformFixture<I>;
  series: Array<RawSeries>;
  declaredUnits?: Dictionary<string> | undefined;
}): Promise<string> {
  const monitor: Monitor = new Monitor();
  monitor._id = ObjectID.generate().toString();
  monitor.monitorType = input.fixture.monitorType;
  monitor.name = "platform grouped monitor";

  const response: ProbeApiIngestResponse =
    await MonitorCriteriaEvaluator.processMonitorStep({
      dataToProcess: workerResponse(input),
      monitorStep: input.monitorStep,
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

  return response.rootCause || "";
}

function linesOf(rootCause: string): Array<string> {
  return rootCause.split("\n");
}

// The part of a fixture the "- Metric:" expectations need.
interface CatalogLookup {
  friendlyName: (metricName: string) => string | undefined;
}

/*
 * The "- Metric:" sub-line for one formula component, with the metric's
 * catalog name looked up rather than hard-coded (catalogs change).
 */
function componentLine(input: {
  fixture: CatalogLookup;
  alias: string;
  metricName: string;
}): string {
  const friendlyName: string | undefined = input.fixture.friendlyName(
    input.metricName,
  );

  const described: string =
    friendlyName && friendlyName !== input.metricName
      ? `${friendlyName} (\`${input.metricName}\`)`
      : `\`${input.metricName}\``;

  return `  - \`${input.alias}\` = ${described}`;
}

function metricLine(input: {
  fixture: CatalogLookup;
  metricName: string;
}): string {
  const friendlyName: string | undefined = input.fixture.friendlyName(
    input.metricName,
  );

  return friendlyName && friendlyName !== input.metricName
    ? `- Metric: ${friendlyName} (\`${input.metricName}\`)`
    : `- Metric: \`${input.metricName}\``;
}

// --- Proxmox ---

function pveAttributes(input: {
  id: string;
  type: string;
  scope: string;
}): JSONObject {
  // pve-exporter's `id` label, split by the agent's OTTL transform.
  return {
    id: input.id,
    "pve.type": input.type,
    "pve.scope": input.scope,
    "pve.id": input.id.split("/").slice(1).join("/"),
    "resource.proxmox.cluster.name": PVE_CLUSTER,
  };
}

const GB: number = 1_000_000_000;

/*
 * Three nodes: pve1 at 90–94% of 64 GB, pve3 at 86–88% of 128 GB, pve2
 * comfortably at 50%. The RAM totals are 11- and 12-digit byte counts —
 * exactly what the old denominator scan printed for every node.
 */
const PVE_NODE_MEMORY: Array<RawSeries> = [
  {
    attributes: pveAttributes({ id: "node/pve1", type: "node", scope: "node" }),
    valuesByAlias: {
      used_mem: [57.6 * GB, 58.24 * GB, 58.88 * GB, 59.52 * GB, 60.16 * GB],
      total_mem: [64 * GB, 64 * GB, 64 * GB, 64 * GB, 64 * GB],
    },
  },
  {
    attributes: pveAttributes({ id: "node/pve2", type: "node", scope: "node" }),
    valuesByAlias: {
      used_mem: [64 * GB, 64 * GB, 64 * GB, 64 * GB, 64 * GB],
      total_mem: [128 * GB, 128 * GB, 128 * GB, 128 * GB, 128 * GB],
    },
  },
  {
    attributes: pveAttributes({ id: "node/pve3", type: "node", scope: "node" }),
    valuesByAlias: {
      used_mem: [110.08 * GB, 110.72 * GB, 111.36 * GB, 112 * GB, 112.64 * GB],
      total_mem: [128 * GB, 128 * GB, 128 * GB, 128 * GB, 128 * GB],
    },
  },
];

const PVE_STORAGE: Array<RawSeries> = [
  {
    attributes: pveAttributes({
      id: "storage/local-lvm",
      type: "storage",
      scope: "storage",
    }),
    valuesByAlias: {
      used_disk: [900 * GB, 910 * GB, 920 * GB, 930 * GB, 940 * GB],
      total_disk: [1000 * GB, 1000 * GB, 1000 * GB, 1000 * GB, 1000 * GB],
    },
  },
  {
    attributes: pveAttributes({
      id: "storage/local",
      type: "storage",
      scope: "storage",
    }),
    valuesByAlias: {
      used_disk: [20 * GB, 20 * GB, 20 * GB, 20 * GB, 20 * GB],
      total_disk: [100 * GB, 100 * GB, 100 * GB, 100 * GB, 100 * GB],
    },
  },
  {
    attributes: pveAttributes({
      id: "storage/backups",
      type: "storage",
      scope: "storage",
    }),
    valuesByAlias: {
      used_disk: [3480 * GB, 3480 * GB, 3480 * GB, 3480 * GB, 3480 * GB],
      total_disk: [4000 * GB, 4000 * GB, 4000 * GB, 4000 * GB, 4000 * GB],
    },
  },
];

const PVE_LXC_DISK: Array<RawSeries> = [
  {
    attributes: pveAttributes({ id: "lxc/101", type: "lxc", scope: "guest" }),
    valuesByAlias: {
      used_disk: [7.6 * GB, 7.6 * GB, 7.6 * GB, 7.6 * GB, 7.6 * GB],
      total_disk: [8 * GB, 8 * GB, 8 * GB, 8 * GB, 8 * GB],
    },
  },
  {
    attributes: pveAttributes({ id: "lxc/102", type: "lxc", scope: "guest" }),
    valuesByAlias: {
      used_disk: [12.8 * GB, 12.8 * GB, 12.8 * GB, 12.8 * GB, 12.8 * GB],
      total_disk: [32 * GB, 32 * GB, 32 * GB, 32 * GB, 32 * GB],
    },
  },
];

describe("Grouped Proxmox ratio templates list only the breaching series, in %", () => {
  test("pve-node-high-memory: only the nodes above 85%, worst first, never RAM bytes", async () => {
    const rootCause: string = await rootCauseOf({
      monitorStep: proxmoxStep("pve-node-high-memory"),
      fixture: PROXMOX,
      series: PVE_NODE_MEMORY,
    });

    const lines: Array<string> = linesOf(rootCause);

    expect(lines).toContain("**Affected Resources** (2 total)");
    // Kind-agnostic here — the kind is pinned by the next describe block.
    expect(rootCause).toMatch(
      /^1\. \*\*[^*]+\*\* `node\/pve1` — \*\*94\.00%\*\*$/m,
    );
    expect(rootCause).toMatch(
      /^2\. \*\*[^*]+\*\* `node\/pve3` — \*\*88\.00%\*\*$/m,
    );

    // The healthy node is not "affected".
    expect(rootCause).not.toContain("node/pve2");

    // No RAM totals, raw or scaled.
    expect(rootCause).not.toMatch(RAW_NUMBER);
    expect(rootCause).not.toContain("64 GB");
    expect(rootCause).not.toContain("128 GB");
  });

  test("pve-node-high-memory: '- Metric:' names the formula legend and lists both components", async () => {
    const rootCause: string = await rootCauseOf({
      monitorStep: proxmoxStep("pve-node-high-memory"),
      fixture: PROXMOX,
      series: PVE_NODE_MEMORY,
    });

    const lines: Array<string> = linesOf(rootCause);

    expect(lines).toContain("**Proxmox Cluster Details**");
    expect(lines).toContain(`- Cluster: ${PVE_CLUSTER}`);
    expect(lines).toContain("- Metric: Node Memory Utilization (%)");
    expect(lines).toContain("- Formula: `(used_mem / total_mem) * 100`");
    expect(lines).toContain(
      componentLine({
        fixture: PROXMOX,
        alias: "used_mem",
        metricName: "pve_memory_usage_bytes",
      }),
    );
    expect(lines).toContain(
      componentLine({
        fixture: PROXMOX,
        alias: "total_mem",
        metricName: "pve_memory_size_bytes",
      }),
    );

    // Not the denominator's own metric line.
    expect(lines).not.toContain(
      metricLine({ fixture: PROXMOX, metricName: "pve_memory_size_bytes" }),
    );
  });

  test("pve-storage-near-full: only the volumes above 85%, in %, with the legend and components", async () => {
    const rootCause: string = await rootCauseOf({
      monitorStep: proxmoxStep("pve-storage-near-full"),
      fixture: PROXMOX,
      series: PVE_STORAGE,
    });

    const lines: Array<string> = linesOf(rootCause);

    expect(lines).toContain("**Affected Resources** (2 total)");
    expect(rootCause).toMatch(
      /^1\. \*\*[^*]+\*\* `storage\/local-lvm` — \*\*94\.00%\*\*$/m,
    );
    expect(rootCause).toMatch(
      /^2\. \*\*[^*]+\*\* `storage\/backups` — \*\*87\.00%\*\*$/m,
    );
    expect(rootCause).not.toContain("`storage/local`");

    expect(lines).toContain("- Metric: Storage Utilization (%)");
    expect(lines).toContain("- Formula: `(used_disk / total_disk) * 100`");
    expect(lines).toContain(
      componentLine({
        fixture: PROXMOX,
        alias: "used_disk",
        metricName: "pve_disk_usage_bytes",
      }),
    );
    expect(lines).toContain(
      componentLine({
        fixture: PROXMOX,
        alias: "total_disk",
        metricName: "pve_disk_size_bytes",
      }),
    );

    expect(rootCause).not.toMatch(RAW_NUMBER);
    expect(rootCause).not.toContain("4 TB");
    expect(rootCause).not.toContain("1 TB");
  });

  test("pve-lxc-disk-near-full: only the container above 90%, in %, with the legend and components", async () => {
    const rootCause: string = await rootCauseOf({
      monitorStep: proxmoxStep("pve-lxc-disk-near-full"),
      fixture: PROXMOX,
      series: PVE_LXC_DISK,
    });

    const lines: Array<string> = linesOf(rootCause);

    expect(lines).toContain("**Affected Resources** (1 total)");
    expect(rootCause).toMatch(
      /^1\. \*\*[^*]+\*\* `lxc\/101` — \*\*95\.00%\*\*$/m,
    );
    expect(rootCause).not.toContain("lxc/102");

    expect(lines).toContain("- Metric: Container Root Disk Utilization (%)");
    expect(lines).toContain("- Formula: `(used_disk / total_disk) * 100`");
    expect(lines).toContain(
      componentLine({
        fixture: PROXMOX,
        alias: "used_disk",
        metricName: "pve_disk_usage_bytes",
      }),
    );

    expect(rootCause).not.toMatch(RAW_NUMBER);
    expect(rootCause).not.toContain("8 GB");
  });
});

/*
 * A grouped ratio template groups by pve-exporter's `id` label alone, and
 * a formula row carries only its group labels — so the only raw
 * attributes the evaluator enriches a formula series from are `{ id }`.
 * The kind (Node / Storage / Container) lives in `pve.type` / `pve.scope`,
 * which the component query rows of the SAME series do carry, and which
 * the raw scan of the same query reads. PlatformResourceIdentity exists so
 * that "a per-series list and a raw-scan list title the same node the same
 * way"; these pin that promise for the formula templates.
 */
describe("Grouped Proxmox ratio templates title each series by its kind, as the raw scan does", () => {
  test("pve-node-high-memory: the node is a **Node**", async () => {
    const lines: Array<string> = linesOf(
      await rootCauseOf({
        monitorStep: proxmoxStep("pve-node-high-memory"),
        fixture: PROXMOX,
        series: PVE_NODE_MEMORY,
      }),
    );

    expect(lines).toContain("1. **Node** `node/pve1` — **94.00%**");
    expect(lines).toContain("2. **Node** `node/pve3` — **88.00%**");
  });

  test("pve-storage-near-full: the volume is a **Storage**", async () => {
    const lines: Array<string> = linesOf(
      await rootCauseOf({
        monitorStep: proxmoxStep("pve-storage-near-full"),
        fixture: PROXMOX,
        series: PVE_STORAGE,
      }),
    );

    expect(lines).toContain("1. **Storage** `storage/local-lvm` — **94.00%**");
    expect(lines).toContain("2. **Storage** `storage/backups` — **87.00%**");
  });

  test("pve-lxc-disk-near-full: the guest is a **Container**", async () => {
    const lines: Array<string> = linesOf(
      await rootCauseOf({
        monitorStep: proxmoxStep("pve-lxc-disk-near-full"),
        fixture: PROXMOX,
        series: PVE_LXC_DISK,
      }),
    );

    expect(lines).toContain("1. **Container** `lxc/101` — **95.00%**");
  });
});

describe("Grouped Proxmox pve-node-offline lists the DOWN node", () => {
  const NODES_UP: Array<RawSeries> = [
    {
      attributes: pveAttributes({
        id: "node/pve1",
        type: "node",
        scope: "node",
      }),
      valuesByAlias: { node_up: [1, 1, 1, 1, 1] },
    },
    {
      attributes: pveAttributes({
        id: "node/pve2",
        type: "node",
        scope: "node",
      }),
      valuesByAlias: { node_up: [0, 0, 0, 0, 0] },
    },
    {
      attributes: pveAttributes({
        id: "node/pve3",
        type: "node",
        scope: "node",
      }),
      valuesByAlias: { node_up: [1, 1, 1, 1, 1] },
    },
  ];

  test("the node at 0 is listed and titled as a node; the up nodes are not", async () => {
    const rootCause: string = await rootCauseOf({
      monitorStep: proxmoxStep("pve-node-offline"),
      fixture: PROXMOX,
      series: NODES_UP,
    });

    const lines: Array<string> = linesOf(rootCause);

    expect(lines).toContain("**Affected Resources** (1 total)");
    expect(lines).toContain("1. **Node** `node/pve2` — **0**");
    expect(rootCause).not.toContain("node/pve1");
    expect(rootCause).not.toContain("node/pve3");

    expect(lines).toContain(
      metricLine({ fixture: PROXMOX, metricName: "pve_up" }),
    );
    expect(rootCause).not.toMatch(RAW_NUMBER);
  });
});

// --- Ceph ---

function cephPoolAttributes(poolId: number): JSONObject {
  // ceph-mgr's pool data series carry pool_id only — no `name` label.
  return {
    pool_id: poolId,
    instance: "10.0.0.11:9283",
    job: "ceph",
    "resource.ceph.cluster.name": CEPH_CLUSTER,
  };
}

describe("Grouped Ceph templates list the series the criteria matched", () => {
  /*
   * pool 3 (rbd) is 93–95% full. pool 0 (.mgr) is nearly empty with 2.4 TB
   * free — the largest max_avail, which is why the old denominator scan,
   * ranked by value, listed it FIRST. pool 5 sits at 40%.
   */
  const POOLS: Array<RawSeries> = [
    {
      attributes: cephPoolAttributes(0),
      valuesByAlias: {
        pool_stored: [1_500_000, 1_500_000, 1_500_000, 1_500_000, 1_500_000],
        pool_max_avail: [2400 * GB, 2400 * GB, 2400 * GB, 2400 * GB, 2400 * GB],
      },
    },
    {
      attributes: cephPoolAttributes(3),
      valuesByAlias: {
        pool_stored: [930 * GB, 935 * GB, 940 * GB, 945 * GB, 950 * GB],
        pool_max_avail: [70 * GB, 65 * GB, 60 * GB, 55 * GB, 50 * GB],
      },
    },
    {
      attributes: cephPoolAttributes(5),
      valuesByAlias: {
        pool_stored: [400 * GB, 400 * GB, 400 * GB, 400 * GB, 400 * GB],
        pool_max_avail: [600 * GB, 600 * GB, 600 * GB, 600 * GB, 600 * GB],
      },
    },
  ];

  test("ceph-pool-near-full: the full pool at its %, the emptiest pool absent", async () => {
    const rootCause: string = await rootCauseOf({
      monitorStep: cephStep("ceph-pool-near-full"),
      fixture: CEPH,
      series: POOLS,
    });

    const lines: Array<string> = linesOf(rootCause);

    expect(lines).toContain("**Ceph Cluster Details**");
    expect(lines).toContain(`- Cluster: ${CEPH_CLUSTER}`);
    expect(lines).toContain("**Affected Resources** (1 total)");
    expect(lines).toContain("1. **Pool** `3` — **95.00%**");

    // The emptiest pool, previously first by free bytes, is gone.
    expect(rootCause).not.toContain("**Pool** `0`");
    expect(rootCause).not.toContain("**Pool** `5`");
    expect(rootCause).not.toContain("2.4 TB");
    expect(rootCause).not.toMatch(RAW_NUMBER);
  });

  test("ceph-pool-near-full: '- Metric:' names the formula and each component once", async () => {
    const rootCause: string = await rootCauseOf({
      monitorStep: cephStep("ceph-pool-near-full"),
      fixture: CEPH,
      series: POOLS,
    });

    const lines: Array<string> = linesOf(rootCause);

    expect(lines).toContain("- Metric: Pool Capacity Used (%)");
    expect(lines).toContain(
      "- Formula: `(pool_stored / (pool_stored + pool_max_avail)) * 100`",
    );

    const storedLine: string = componentLine({
      fixture: CEPH,
      alias: "pool_stored",
      metricName: "ceph_pool_stored",
    });
    const maxAvailLine: string = componentLine({
      fixture: CEPH,
      alias: "pool_max_avail",
      metricName: "ceph_pool_max_avail",
    });

    // pool_stored appears twice in the expression but is one component.
    expect(
      lines.filter((line: string) => {
        return line === storedLine;
      }),
    ).toHaveLength(1);
    expect(lines).toContain(maxAvailLine);
    expect(lines).not.toContain(
      metricLine({ fixture: CEPH, metricName: "ceph_pool_max_avail" }),
    );
  });

  test("ceph-osd-down grouped by ceph_daemon: the down OSD at **0**, the up OSDs absent", async () => {
    const osd: (daemon: string, values: Array<number>) => RawSeries = (
      daemon: string,
      values: Array<number>,
    ): RawSeries => {
      return {
        attributes: {
          ceph_daemon: daemon,
          instance: "10.0.0.11:9283",
          job: "ceph",
          "resource.ceph.cluster.name": CEPH_CLUSTER,
        },
        valuesByAlias: { osd_up: values },
      };
    };

    const rootCause: string = await rootCauseOf({
      monitorStep: cephStep("ceph-osd-down"),
      fixture: CEPH,
      series: [
        osd("osd.0", [1, 1, 1, 1, 1]),
        osd("osd.1", [0, 0, 0, 0, 0]),
        osd("osd.2", [1, 1, 1, 1, 1]),
      ],
    });

    const lines: Array<string> = linesOf(rootCause);

    expect(lines).toContain("**Affected Resources** (1 total)");
    expect(lines).toContain("1. **Daemon** `osd.1` — **0**");
    expect(rootCause).not.toContain("osd.0");
    expect(rootCause).not.toContain("osd.2");
    expect(lines).toContain(
      metricLine({ fixture: CEPH, metricName: "ceph_osd_up" }),
    );
    expect(rootCause).not.toMatch(RAW_NUMBER);
  });
});

// --- VMware ---

function vmwareAttributes(overrides: JSONObject): JSONObject {
  return {
    "resource.vmware.vcenter.name": VCENTER,
    "resource.vcenter.datacenter.name": "DC1",
    ...overrides,
  };
}

describe("Grouped VMware templates name the object the series is about", () => {
  test("vmware-vm-memory-saturation: the VM, with the Host and Cluster its datapoints carry", async () => {
    const monitorStep: MonitorStep = vmwareStep("vmware-vm-memory-saturation");

    // The template groups by VM name — the series label names only the VM.
    expect(MonitorStep.getGroupByAttributeKeys(monitorStep)).toEqual([
      VMwareGroupByKey.VirtualMachine,
    ]);

    const rootCause: string = await rootCauseOf({
      monitorStep: monitorStep,
      fixture: VMWARE,
      declaredUnits: { "vcenter.vm.memory.utilization": "%" },
      series: [
        {
          attributes: vmwareAttributes({
            "resource.vcenter.cluster.name": "prod-cluster",
            "resource.vcenter.host.name": "esx-01.lab",
            "resource.vcenter.vm.name": "db-01",
            "resource.vcenter.vm.id": "5029a1b2-db01",
            "resource.vcenter.resource_pool.name": "databases",
            "resource.vcenter.resource_pool.inventory_path":
              "/DC1/host/prod-cluster/Resources/databases",
          }),
          valuesByAlias: {
            vm_memory_utilization: [92, 93, 94.25, 95, 96.5],
          },
        },
        {
          attributes: vmwareAttributes({
            "resource.vcenter.cluster.name": "prod-cluster",
            "resource.vcenter.host.name": "esx-02.lab",
            "resource.vcenter.vm.name": "web-01",
            "resource.vcenter.vm.id": "5029c3d4-web01",
          }),
          valuesByAlias: {
            vm_memory_utilization: [40, 41, 42, 43, 44],
          },
        },
      ],
    });

    const lines: Array<string> = linesOf(rootCause);

    expect(lines).toContain("**vCenter Details**");
    expect(lines).toContain(`- vCenter: ${VCENTER}`);
    expect(lines).toContain(
      metricLine({
        fixture: VMWARE,
        metricName: "vcenter.vm.memory.utilization",
      }),
    );
    expect(lines).toContain("**Affected Resources** (1 total)");

    const head: number = lines.indexOf(
      "1. **Virtual Machine** `db-01` — **96.50%**",
    );
    expect(head).toBeGreaterThanOrEqual(0);
    expect(lines[head + 1]).toBe("   - Host: `esx-01.lab`");
    expect(lines[head + 2]).toBe("   - Cluster: `prod-cluster`");

    expect(rootCause).not.toContain("web-01");
    expect(rootCause).not.toContain("esx-02.lab");
    expect(rootCause).not.toContain("9650.00%");
    expect(rootCause).not.toMatch(RAW_NUMBER);
  });

  test("vmware-resource-pool-memory-swapped: the pool, never a Host borrowed from its datapoint", async () => {
    const monitorStep: MonitorStep = vmwareStep(
      "vmware-resource-pool-memory-swapped",
    );

    expect(MonitorStep.getGroupByAttributeKeys(monitorStep)).toEqual([
      VMwareGroupByKey.ResourcePool,
    ]);

    const pool: (
      name: string,
      host: string,
      values: Array<number>,
    ) => RawSeries = (
      name: string,
      host: string,
      values: Array<number>,
    ): RawSeries => {
      return {
        /*
         * The pool's datapoint happens to carry a host — but a pool's
         * VMs can run on different hosts, so the list must not say so.
         */
        attributes: vmwareAttributes({
          "resource.vcenter.cluster.name": "prod-cluster",
          "resource.vcenter.host.name": host,
          "resource.vcenter.resource_pool.name": name,
          "resource.vcenter.resource_pool.inventory_path": `/DC1/host/prod-cluster/Resources/${name}`,
        }),
        valuesByAlias: { resource_pool_memory_swapped: values },
      };
    };

    const rootCause: string = await rootCauseOf({
      monitorStep: monitorStep,
      fixture: VMWARE,
      declaredUnits: { "vcenter.resource_pool.memory.swapped": "MiBy" },
      series: [
        // 512 MiB = 536870912 bytes → "537 MB" on the decimal ladder.
        pool("batch", "esx-01.lab", [256, 300, 400, 512, 512]),
        pool("web", "esx-02.lab", [0, 0, 0, 0, 0]),
      ],
    });

    const lines: Array<string> = linesOf(rootCause);

    expect(lines).toContain("**Affected Resources** (1 total)");

    /*
     * Titled by its inventory path (the group-by key); the pool's display
     * name may or may not precede it.
     */
    const poolHead: RegExp =
      /^1\. \*\*Resource Pool\*\* .*`\/DC1\/host\/prod-cluster\/Resources\/batch`.* — \*\*537 MB\*\*$/;

    const head: number = lines.findIndex((line: string) => {
      return poolHead.test(line);
    });
    expect(head).toBeGreaterThanOrEqual(0);
    expect(lines[head + 1]).toBe("   - Cluster: `prod-cluster`");

    // Never a Host under a pool.
    expect(
      lines.filter((line: string) => {
        return line.trim().startsWith("- Host:");
      }),
    ).toEqual([]);
    expect(rootCause).not.toContain("esx-01.lab");

    expect(rootCause).not.toContain("Resources/web");
    expect(rootCause).not.toContain("512 MiB");
    expect(rootCause).not.toMatch(RAW_NUMBER);
  });
});

// --- Docker Swarm ---

function swarmTask(input: {
  container: string;
  service: string;
  node: string;
  alias: string;
  values: Array<number>;
}): RawSeries {
  return {
    attributes: {
      "resource.container.name": input.container,
      "resource.container.image.name": `registry.local/${input.service}:1.4.2`,
      "resource.docker.swarm.cluster.name": SWARM_CLUSTER,
      "docker.swarm.service.name": input.service,
      "docker.swarm.node.name": input.node,
    },
    valuesByAlias: { [input.alias]: input.values },
  };
}

describe("Grouped Docker Swarm templates list the affected tasks", () => {
  test("docker-swarm-task-down: lowest uptime first, as a duration", async () => {
    const rootCause: string = await rootCauseOf({
      monitorStep: dockerSwarmStep("docker-swarm-task-down"),
      fixture: DOCKER_SWARM,
      declaredUnits: { "container.uptime": "s" },
      series: [
        swarmTask({
          container: "web.1.k3j2h1g0f9e8",
          service: "web",
          node: "swarm-worker-1",
          alias: "container_uptime",
          values: [35, 65],
        }),
        swarmTask({
          container: "api.1.a1b2c3d4e5f6",
          service: "api",
          node: "swarm-worker-2",
          alias: "container_uptime",
          values: [7200, 7260],
        }),
        swarmTask({
          container: "web.2.z9y8x7w6v5u4",
          service: "web",
          node: "swarm-worker-3",
          alias: "container_uptime",
          values: [12.5, 42.5],
        }),
      ],
    });

    const lines: Array<string> = linesOf(rootCause);

    expect(lines).toContain("**Docker Swarm Cluster Details**");
    expect(lines).toContain(`- Cluster: ${SWARM_CLUSTER}`);
    expect(lines).toContain("**Affected Tasks** (2 total)");
    expect(rootCause).not.toContain("**Affected Resources**");

    const first: number = lines.indexOf(
      "1. **Task** `web.2.z9y8x7w6v5u4` — **12.5 sec**",
    );
    expect(first).toBeGreaterThanOrEqual(0);
    expect(lines[first + 1]).toBe("   - Service: `web`");
    expect(lines[first + 2]).toBe("   - Node: `swarm-worker-3`");

    expect(lines).toContain("2. **Task** `web.1.k3j2h1g0f9e8` — **35 sec**");

    // The long-running task never breached.
    expect(rootCause).not.toContain("api.1.a1b2c3d4e5f6");
    expect(rootCause).not.toMatch(RAW_NUMBER);
  });

  test('docker-swarm-high-cpu: rendered as %, from the catalog — not the exporter\'s declared "1"', async () => {
    const rootCause: string = await rootCauseOf({
      monitorStep: dockerSwarmStep("docker-swarm-high-cpu"),
      fixture: DOCKER_SWARM,
      // docker_stats declares "1" but sends 0–100 (100 = one core).
      declaredUnits: { "container.cpu.utilization": "1" },
      series: [
        swarmTask({
          container: "web.1.k3j2h1g0f9e8",
          service: "web",
          node: "swarm-worker-1",
          alias: "container_cpu",
          values: [85, 88, 90.25, 92, 95.5],
        }),
        swarmTask({
          container: "api.1.a1b2c3d4e5f6",
          service: "api",
          node: "swarm-worker-2",
          alias: "container_cpu",
          values: [10, 12, 11, 9, 10],
        }),
        swarmTask({
          container: "worker.1.q1w2e3r4t5y6",
          service: "worker",
          node: "swarm-worker-2",
          alias: "container_cpu",
          values: [150, 160, 170, 180, 185],
        }),
      ],
    });

    const lines: Array<string> = linesOf(rootCause);

    expect(lines).toContain("**Affected Tasks** (2 total)");
    expect(lines).toContain(
      metricLine({
        fixture: DOCKER_SWARM,
        metricName: "container.cpu.utilization",
      }),
    );
    expect(lines).toContain(
      "1. **Task** `worker.1.q1w2e3r4t5y6` — **185.00%**",
    );
    expect(lines).toContain("2. **Task** `web.1.k3j2h1g0f9e8` — **95.50%**");

    expect(rootCause).not.toContain("api.1.a1b2c3d4e5f6");
    expect(rootCause).not.toContain("18500.00%");
    expect(rootCause).not.toContain("9550.00%");
    expect(rootCause).not.toMatch(RAW_NUMBER);
  });
});
