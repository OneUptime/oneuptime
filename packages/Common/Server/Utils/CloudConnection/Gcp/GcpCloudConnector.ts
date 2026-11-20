import { CloudProvider } from "../../../../Types/Cloud/CloudPlatform";
import {
  GCP_ALIGNMENT_PERIOD_SECONDS,
  GCP_KEY_METRICS,
  GCP_OPS_AGENT,
  GcpAligner,
  GcpKeyMetric,
  GcpReadMetric,
  GcpTypeKeyMetrics,
  getGcpReadMetrics,
  getGcpStoredMetricName,
} from "../../../../Types/Cloud/CloudKeyMetrics";
import { CloudKeyMetricGroup } from "../../../../Types/Cloud/CloudKeyMetricGroup";
import {
  CLOUD_ADDED_METRIC_MAX_SPLIT_VALUES,
  CloudAddedMetric,
  CloudAddedMetricScope,
  GCP_SPLIT_LEARN_EVERY_MINUTES,
  isGcpFilterLabel,
} from "../../../../Types/Cloud/CloudAddedMetrics";
import { CloudMonitoredResource } from "../../../../Types/Cloud/CloudMonitoredResource";
import {
  GCP_BILLING_EXPORT_TABLE_FIELD_KEY,
  splitCloudConnectionList,
} from "../../../../Types/CloudConnection/CloudConnectionCatalog";
import { CloudConnectionSetupScope } from "../../../../Types/CloudConnection/CloudConnectionSetupCommands";
import {
  CloudConnectionFailureKind,
  CloudConnectionTestResult,
  countCloudConnectionValues,
} from "../../../../Types/CloudConnection/CloudConnectionTest";
import Dictionary from "../../../../Types/Dictionary";
import BadDataException from "../../../../Types/Exception/BadDataException";
import GoogleMonitoringClient from "../../LlmObservability/Connectors/GoogleVertexAI/GoogleMonitoringClient";
import LlmProviderError from "../../LlmObservability/LlmProviderError";
import GoogleSecOpsClient from "../../SecurityEvent/Connectors/GoogleSecOps/GoogleSecOpsClient";
import { Settled, mapWithConcurrency } from "../CloudConcurrency";
import {
  CloudMetricGroup,
  OtlpAttribute,
  buildMetricsPayloads,
  connectionResourceAttributes,
  countPayloadPoints,
  resolveCloudResourceOf,
  stringAttribute,
} from "../CloudMetricPayload";
import {
  GCP_METRIC_DELAY_MS,
  MetricWindow,
  getMetricWindow,
  getMetricWindowPolicy,
} from "../CloudMetricWindows";
import {
  CloudConnectionPullState,
  CloudConnectionSettings,
  CloudConnector,
  CloudConnectorCallOptions,
  CloudAuditRecord,
  CloudChange,
  CloudChangesOptions,
  CloudChangesResult,
  CloudCostAccountOutcome,
  CloudCostsOptions,
  CloudCostsResult,
  CloudDiscoveredResource,
  CloudInventoryItem,
  CloudInventoryOptions,
  CloudInventoryResult,
  CloudKnownResource,
  CloudReadBudget,
  CloudReadBudgetSpent,
  CloudReadOptions,
  CloudReadResult,
  CloudSavingRecord,
  CloudSavingsOptions,
  CloudSavingsResult,
  CLOUD_MAX_ORGANIZATION_ACCOUNTS,
  GcpSplitLearned,
  getCloudSecretValues,
  getOrganizationLimitWarning,
  keepsAuditRecords,
  orderLeastRecentlyRead,
  readCloudSetting,
} from "../CloudConnectorTypes";
import GcpCostClient, {
  GCP_COST_RECOMMENDERS,
  GcpCommitmentRow,
  GcpRecommenderPlace,
  describeGcpCostFailure,
  getGcpPlaces,
  isValidGcpBillingExportTable,
  readGcpRecommendation,
  summarizeGcpCommitmentRows,
} from "./GcpCosts";
import {
  CLOUD_COST_DEFAULT_CURRENCY,
  CloudCostState,
} from "../../../../Types/Cloud/CloudCost";
import {
  CLOUD_COMMITMENT_WINDOW_DAYS,
  CloudCommitmentKindFigures,
  CloudCommitmentSummary,
  getCloudCommitmentWindow,
} from "../../../../Types/Cloud/CloudCommitments";
import GcpInventoryClient, {
  GCP_INVENTORY_TYPES,
  GcpAsset,
  GcpAssetListing,
  addGcpInventoryEdges,
  buildGcpInventoryContext,
  getGcpInventoryResourceType,
  GcpInventoryContext,
  buildGcpInventoryItem,
} from "./GcpInventory";
import GcpMonitoring, {
  GCP_MAX_FILTER_URL_LENGTH,
  GCP_MAX_ONE_OF_VALUES,
  GcpLabelValues,
  GcpSplitRead,
  GcpSplitValue,
  GcpTimeSeries,
} from "./GcpMonitoring";
import { readGcpAuditEntry, readGcpHealthEvent } from "./GcpChanges";
import {
  getChangePlace,
  getChangeWindowStart,
  getHealthWindowStart,
  isHealthPaused,
  keepNewChanges,
  markHealthRead,
  pauseHealth,
} from "../CloudChangeWindow";
import { JSONObject } from "../../../../Types/JSON";
import logger from "../../Logger";
import { createHash } from "crypto";

/*
 * GOOGLE CLOUD: the projects a service account may read, from Cloud
 * Monitoring.
 *
 * Every read asks each project for the key metrics (CloudKeyMetrics) since
 * the last read, aligned to a minute: one call per metric type returns it
 * for every resource of the project, so a VM, a Cloud SQL instance, a
 * Cloud Run service is found the moment it reports. Each resource type's
 * first metric is asked of every project; its others only of the projects
 * that have such a resource (getGcpMetricTypesToAsk) - in the same read for
 * one found just now. Each series becomes
 * the export the googlecloudmonitoring receiver sends: the monitored
 * resource's type and labels on the OTel resource, the metric's labels on
 * its datapoints, the metric named by its type.
 */

const PROVIDER_TITLE: string = "Google Cloud";
const CONCURRENCY: number = 6;
export const GCP_MAX_PROJECTS: number = 20;
// The most projects of an organization one connection reads.
export const GCP_MAX_ORGANIZATION_PROJECTS: number =
  CLOUD_MAX_ORGANIZATION_ACCOUNTS;
const DAY_MS: number = 24 * 60 * 60 * 1000;
// How often Service Health is asked, and how long after a refusal it is not.
const HEALTH_INTERVAL_MS: number = 15 * 60 * 1000;
const HEALTH_PAUSE_MS: number = DAY_MS;

function isOlderThan(
  iso: string | undefined,
  ageMs: number,
  now: Date,
): boolean {
  const time: number = iso ? Date.parse(iso) : NaN;
  return !Number.isFinite(time) || now.getTime() - time >= ageMs;
}
// A test looks back this far, for the first metric of each resource type.
const TEST_LOOK_BACK_MS: number = 30 * 60 * 1000;

/*
 * How long a project counts as having a resource type after it last
 * reported a key metric of it: a day, so a quiet night or a paused
 * service does not drop its metrics from the reads.
 */
export const GCP_RESOURCE_TYPE_SEEN_MS: number = DAY_MS;

/*
 * Passes one read makes at most: the first, one for what it found (a
 * resource type, a VM's Ops Agent), and one for what that found (the
 * agent on a VM found in the second).
 */
const GCP_MAX_READ_PASSES: number = 3;

// Each resource type's first key metric: asked of every project, every read.
const GCP_PROBE_METRICS: ReadonlySet<string> = new Set<string>(
  GCP_KEY_METRICS.map((entry: GcpTypeKeyMetrics): string => {
    return getGcpStoredMetricName(entry.metrics[0]!);
  }),
);

/*
 * The Ops Agent's metrics (GcpKeyMetric.reportedBy), the first of them -
 * what a read asks a project to find out whether one of its VMs runs the
 * agent - and the resource types they are reported for: a project without
 * such a resource is never asked.
 */
const GCP_OPS_AGENT_METRICS: ReadonlyArray<GcpReadMetric> =
  getGcpReadMetrics().filter((metric: GcpReadMetric): boolean => {
    return metric.reportedBy === GCP_OPS_AGENT;
  });
const GCP_OPS_AGENT_RESOURCE_TYPES: ReadonlySet<string> = new Set<string>(
  GCP_OPS_AGENT_METRICS.flatMap((metric: GcpReadMetric): Array<string> => {
    return metric.resourceTypes;
  }),
);

/*
 * How long a project counts as running the Ops Agent after one of its VMs
 * last reported an agent metric, and how often a project none of whose VMs
 * does is asked whether one does now.
 */
export const GCP_OPS_AGENT_SEEN_MS: number = DAY_MS;
export const GCP_OPS_AGENT_ASK_EVERY_MS: number = 60 * 60 * 1000;

/*
 * What a read asks a project of the Ops Agent's metrics: "all" of them
 * while one of its VMs reported one within GCP_OPS_AGENT_SEEN_MS; "first",
 * the first alone, to find out whether one does now - once every
 * GCP_OPS_AGENT_ASK_EVERY_MS, while it has VMs; else "none". So a project
 * whose VMs run no agent costs a call an hour, not two calls a read.
 */
export type GcpOpsAgentAsk = "all" | "first" | "none";

export function getGcpOpsAgentAsk(data: {
  // Whether one of its VMs reported an agent metric lately.
  isReporting: boolean;
  // When a read last asked it the first agent metric alone.
  askedAt?: string | undefined;
  // Whether it has a resource the agent reports for (a VM).
  hasResources: boolean;
  now: Date;
}): GcpOpsAgentAsk {
  if (data.isReporting) {
    return "all";
  }

  return data.hasResources &&
    isOlderThan(data.askedAt, GCP_OPS_AGENT_ASK_EVERY_MS, data.now)
    ? "first"
    : "none";
}

// Whether a project has a resource of a type the Ops Agent reports for.
export function hasGcpOpsAgentResources(
  resourceTypes: ReadonlySet<string>,
): boolean {
  return Array.from(GCP_OPS_AGENT_RESOURCE_TYPES).some(
    (resourceType: string): boolean => {
      return resourceTypes.has(resourceType);
    },
  );
}

/*
 * WHICH KEY METRICS A READ ASKS ONE PROJECT FOR.
 *
 * One call per metric answers it for every resource of the project,
 * whether the project has such a resource or not - so asking every key
 * metric of every resource type would cost a project with a few VMs and a
 * bucket as many calls as one with every service. A read asks each
 * resource type's first metric of every project (a resource of the type
 * reports it: it is how a new one is found), and a type's other metrics -
 * and the deprecated ones it still reads (retired) - only of the projects
 * that reported one of its metrics in the last GCP_RESOURCE_TYPE_SEEN_MS
 * (`seenResourceTypes`). A metric type two resource types report is asked
 * once, when either is there. The Ops Agent's metrics are asked as
 * `opsAgent` says (getGcpOpsAgentAsk), never because a VM is there.
 *
 * `asked`: the metrics this read has asked the project already, by stored
 * name - a later pass for what an earlier one found asks only the rest.
 */
export function getGcpMetricTypesToAsk(data: {
  seenResourceTypes: ReadonlySet<string>;
  asked?: ReadonlySet<string> | undefined;
  opsAgent?: GcpOpsAgentAsk | undefined;
}): Array<GcpReadMetric> {
  const opsAgent: GcpOpsAgentAsk = data.opsAgent || "none";

  return getGcpReadMetrics().filter((metric: GcpReadMetric): boolean => {
    if (data.asked?.has(metric.storedName)) {
      return false;
    }

    if (metric.reportedBy === GCP_OPS_AGENT) {
      return (
        opsAgent === "all" ||
        (opsAgent === "first" &&
          metric.storedName === GCP_OPS_AGENT_METRICS[0]?.storedName)
      );
    }

    return (
      (!data.asked && GCP_PROBE_METRICS.has(metric.storedName)) ||
      metric.resourceTypes.some((resourceType: string): boolean => {
        return data.seenResourceTypes.has(resourceType);
      })
    );
  });
}

/*
 * An added metric (CloudAddedMetrics) asked of one project: as a key
 * metric is, by its metric type and aligner, and only of the resources of
 * its type - for resources' own additions, of the resources of one batch
 * (planGcpResourceBatches): the labels they share (`resourceLabels`), the
 * one label whose values tell them apart (`resourceLabelIn`), and each
 * one's own labels (`resources`), the only series the call's answer keeps.
 */
export interface GcpAddedMetricAsk {
  metric: GcpReadMetric;
  resourceType: string;
  resourceLabels?: Record<string, string> | undefined;
  resourceLabelIn?: GcpLabelValues | undefined;
  resources?: Array<Record<string, string>> | undefined;
  // Split by one of its labels (#9808): its other labels added up.
  split?: GcpSplitRead | undefined;
  /*
   * A split's: the values of its label the call is narrowed to (#10076),
   * the busiest of its resources, and the learning they came from
   * (getGcpSplitLearnKey). None for a call that reads every value.
   */
  metricLabelIn?: GcpLabelValues | undefined;
  splitLearnKey?: string | undefined;
}

/*
 * A split read of an addition (#9808): its other labels added up as Cloud
 * Monitoring's Metrics Explorer adds them by default - a rate by their
 * sum, a level by their mean - keeping the label and the resource's own.
 */
export function getGcpSplitRead(
  added: Pick<
    CloudAddedMetric,
    "splitBy" | "aggregation" | "resourceLabelKeys"
  >,
): GcpSplitRead | undefined {
  if (!added.splitBy || !(added.resourceLabelKeys || []).length) {
    return undefined;
  }

  return {
    label: added.splitBy,
    reducer: added.aggregation === "ALIGN_RATE" ? "REDUCE_SUM" : "REDUCE_MEAN",
    resourceLabelKeys: added.resourceLabelKeys!,
  };
}

/*
 * A split read's series kept, at most CLOUD_ADDED_METRIC_MAX_SPLIT_VALUES
 * values of each resource: the busiest, by the sum of their points (#9808).
 */
export function capGcpSplitSeries(
  series: ReadonlyArray<GcpTimeSeries>,
): Array<GcpTimeSeries> {
  const byResource: Map<string, Array<GcpTimeSeries>> = new Map();

  for (const entry of series) {
    const key: string = labelSetKey(entry.resourceLabels);
    const list: Array<GcpTimeSeries> = byResource.get(key) || [];

    list.push(entry);
    byResource.set(key, list);
  }

  const total: (entry: GcpTimeSeries) => number = (
    entry: GcpTimeSeries,
  ): number => {
    return entry.points.reduce(
      (sum: number, point: { value: number }): number => {
        return sum + Math.abs(point.value);
      },
      0,
    );
  };
  const kept: Array<GcpTimeSeries> = [];

  for (const list of byResource.values()) {
    kept.push(
      ...[...list]
        .sort((a: GcpTimeSeries, b: GcpTimeSeries): number => {
          return total(b) - total(a);
        })
        .slice(0, CLOUD_ADDED_METRIC_MAX_SPLIT_VALUES),
    );
  }

  return kept;
}

/*
 * One call's share of the resources of a project a metric is added for
 * (#9810): the labels they all have the same value of, asked as equal; the
 * one label whose values tell them apart, asked as one_of; and each
 * resource's own labels.
 */
export interface GcpResourceBatch {
  labels: Record<string, string>;
  labelIn?: GcpLabelValues | undefined;
  resources: Array<Record<string, string>>;
}

// A label set as one string, its labels in name order: equal sets, equal text.
function labelSetKey(labels: Record<string, string>): string {
  return JSON.stringify(
    Object.keys(labels)
      .sort()
      .map((key: string): [string, string] => {
        return [key, labels[key]!];
      }),
  );
}

/*
 * HOW A READ ASKS FOR A METRIC ADDED FOR SEVERAL RESOURCES OF A PROJECT
 * (#9810).
 *
 * Each resource is known by its identifying labels (a VM's project_id,
 * zone and instance_id). Of the resources with the same labels, the one
 * label with the most values among them - a VM's instance_id, a Cloud SQL
 * database's database_id - tells them apart; the resources whose other
 * labels are all equal share a call that asks for them as equal and for
 * that label as one_of(...). So the batches are exact: a call asks for no
 * resource that is not in it, and its answer maps back to each by its own
 * labels. A batch holds at most GCP_MAX_ONE_OF_VALUES values, and no more
 * than keeps its filter within GCP_MAX_FILTER_URL_LENGTH. A resource whose
 * labels a filter cannot quote (isGcpFilterLabel) is asked of no call.
 */
export function planGcpResourceBatches(data: {
  metricType: string;
  resourceType: string;
  resources: ReadonlyArray<Record<string, string>>;
}): Array<GcpResourceBatch> {
  const unique: Map<string, Record<string, string>> = new Map();

  for (const labels of data.resources) {
    const entries: Array<[string, string]> = Object.entries(labels || {});

    if (
      entries.length === 0 ||
      !entries.every(([key, value]: [string, string]): boolean => {
        return typeof value === "string" && isGcpFilterLabel(key, value);
      })
    ) {
      continue;
    }

    unique.set(labelSetKey(labels), { ...labels });
  }

  // Resources known by the same labels: one plan each.
  const byKeys: Map<string, Array<Record<string, string>>> = new Map();

  for (const labels of unique.values()) {
    const keys: string = Object.keys(labels).sort().join("|");
    const list: Array<Record<string, string>> = byKeys.get(keys) || [];

    list.push(labels);
    byKeys.set(keys, list);
  }

  const batches: Array<GcpResourceBatch> = [];

  for (const group of byKeys.values()) {
    const keys: Array<string> = Object.keys(group[0]!).sort();
    let pivot: string = keys[0]!;
    let most: number = 0;

    for (const key of keys) {
      const values: number = new Set(
        group.map((labels: Record<string, string>): string => {
          return labels[key]!;
        }),
      ).size;

      if (values > most) {
        most = values;
        pivot = key;
      }
    }

    // The resources whose every other label is the same: one call's worth.
    const byOthers: Map<string, Array<Record<string, string>>> = new Map();

    for (const labels of group) {
      const others: Record<string, string> = { ...labels };

      delete others[pivot];

      const key: string = labelSetKey(others);
      const list: Array<Record<string, string>> = byOthers.get(key) || [];

      list.push(labels);
      byOthers.set(key, list);
    }

    for (const members of byOthers.values()) {
      const fixed: Record<string, string> = { ...members[0]! };

      delete fixed[pivot];

      const sorted: Array<Record<string, string>> = [...members].sort(
        (a: Record<string, string>, b: Record<string, string>): number => {
          return a[pivot]! < b[pivot]! ? -1 : a[pivot]! > b[pivot]! ? 1 : 0;
        },
      );
      let current: Array<Record<string, string>> = [];

      const filterLength: (
        resources: Array<Record<string, string>>,
      ) => number = (resources: Array<Record<string, string>>): number => {
        return GcpMonitoring.getFilterUrlLength(
          GcpMonitoring.buildFilter({
            metricType: data.metricType,
            resourceType: data.resourceType,
            resourceLabels: fixed,
            resourceLabelIn: {
              label: pivot,
              values: resources.map((labels: Record<string, string>) => {
                return labels[pivot]!;
              }),
            },
          }),
        );
      };

      const close: () => void = (): void => {
        if (current.length === 0) {
          return;
        }

        batches.push(
          current.length === 1
            ? { labels: { ...current[0]! }, resources: current }
            : {
                labels: fixed,
                labelIn: {
                  label: pivot,
                  values: current.map(
                    (labels: Record<string, string>): string => {
                      return labels[pivot]!;
                    },
                  ),
                },
                resources: current,
              },
        );
        current = [];
      };

      for (const labels of sorted) {
        if (
          current.length > 0 &&
          (current.length >= GCP_MAX_ONE_OF_VALUES ||
            filterLength([...current, labels]) > GCP_MAX_FILTER_URL_LENGTH)
        ) {
          close();
        }

        current.push(labels);
      }

      close();
    }
  }

  return batches;
}

// Whether a series is one of `resources`: every label of one of them, its value.
export function isGcpSeriesOfResources(
  series: Pick<GcpTimeSeries, "resourceLabels">,
  resources: ReadonlyArray<Record<string, string>>,
): boolean {
  return resources.some((labels: Record<string, string>): boolean => {
    return Object.entries(labels).every(
      ([key, value]: [string, string]): boolean => {
        return series.resourceLabels[key] === value;
      },
    );
  });
}

/*
 * HOW A SPLIT ADDITION IS BOUNDED AT THE READ (#10076).
 *
 * Cloud Monitoring bills every time series a call returns, and
 * timeSeries.list has no top-N: split by a label of 300 values, a read
 * returned - and Google billed - 300 series a resource while OneUptime kept
 * the busiest 10. So a split is read for the values it keeps:
 *
 *   - Learned first (GcpCloudConnector.learnSplit): each resource's busiest
 *     CLOUD_ADDED_METRIC_MAX_SPLIT_VALUES values over the last hour, by a
 *     PromQL topk, which returns - and so bills - those alone. A metric
 *     PromQL cannot rank is learned from a timeSeries.list of the hour
 *     instead, which returns every value once, and says so.
 *   - Read (planGcpSplitReads): a resource that had the cap's values or more
 *     is read for its busiest alone, metric.labels.<label>=one_of(...) -
 *     resources of the same values in one call, ten values at most, so each
 *     returns ten series at most. A resource with fewer values is read for
 *     every value, so a value it never had before - a first 503 - is read
 *     at once; when it has the cap's values too, that read learns its
 *     busiest (learnGcpSplitFromRead) and the next is narrowed.
 *   - Learned again an hour later (isGcpSplitLearnDue), a quarter of an hour
 *     later while nothing reported, and at once for a resource of a type's
 *     addition found since it was learned (getGcpSplitResourcesUnseen) - not
 *     for one found then without the metric, which would learn every read.
 *
 * What it costs a month, shown before it is added, counts the reads and the
 * learning, ten series a resource each (estimateCloudAddedMetricCost).
 */
export const GCP_SPLIT_LEARN_EVERY_MS: number =
  GCP_SPLIT_LEARN_EVERY_MINUTES * 60 * 1000;
// While a learning found no value at all: learned again this soon.
export const GCP_SPLIT_LEARN_EMPTY_EVERY_MS: number = 15 * 60 * 1000;
// The hour a learning ranks the values over.
export const GCP_SPLIT_LEARN_LOOK_BACK_SECONDS: number = 60 * 60;
// The resources one learning keeps at most, the busiest first: bounds the read state.
export const GCP_SPLIT_MAX_LEARNED_RESOURCES: number = 2000;

// A resource's labels, the ones a split keeps (its resourceLabelKeys) alone.
function splitResourceOf(
  labels: Readonly<Record<string, string>>,
  resourceLabelKeys: ReadonlyArray<string>,
): Record<string, string> {
  const resource: Record<string, string> = {};

  for (const key of resourceLabelKeys) {
    if (labels[key] !== undefined) {
      resource[key] = labels[key]!;
    }
  }

  return resource;
}

/*
 * What tells one split call's learning from another's: the project, the
 * metric and how it is read and split, and the resources the call is
 * narrowed to - so the resources of a batch changing learns their values
 * again. Hashed, to keep the read state small.
 */
export function getGcpSplitLearnKey(
  projectId: string,
  ask: Pick<
    GcpAddedMetricAsk,
    "metric" | "resourceType" | "resourceLabels" | "resourceLabelIn" | "split"
  >,
): string {
  return createHash("sha256")
    .update(
      JSON.stringify([
        projectId,
        ask.resourceType,
        ask.metric.metricType,
        ask.metric.aligner,
        ask.split?.label || "",
        [...(ask.split?.resourceLabelKeys || [])].sort(),
        labelSetKey(ask.resourceLabels || {}),
        ask.resourceLabelIn
          ? [ask.resourceLabelIn.label, [...ask.resourceLabelIn.values].sort()]
          : null,
      ]),
    )
    .digest("hex")
    .slice(0, 32);
}

/*
 * Whether a split's values are to be learned now: never learned, learned
 * an hour ago while some resource is read for its busiest alone, or a
 * quarter of an hour ago while nothing reported. One whose every resource
 * is read for every value learns from its own reads.
 */
export function isGcpSplitLearnDue(
  learned: GcpSplitLearned | undefined,
  now: Date,
): boolean {
  if (!learned) {
    return true;
  }

  const age: number = now.getTime() - Date.parse(learned.at);

  if (!Number.isFinite(age) || age < 0) {
    return true;
  }

  if (learned.capped.length === 0) {
    return learned.others.length === 0 && age >= GCP_SPLIT_LEARN_EMPTY_EVERY_MS;
  }

  return age >= GCP_SPLIT_LEARN_EVERY_MS;
}

/*
 * A learning's answer as the read keeps it: each resource that had the
 * cap's values or more, with its busiest (the ones a filter can quote), and
 * the others; each in label order, the busiest resources first past
 * GCP_SPLIT_MAX_LEARNED_RESOURCES.
 */
export function toGcpSplitLearned(data: {
  values: ReadonlyArray<GcpSplitValue>;
  label: string;
  at: Date;
  via: GcpSplitLearned["via"];
}): GcpSplitLearned {
  const byResource: Map<
    string,
    {
      resource: Record<string, string>;
      values: Map<string, number>;
    }
  > = new Map();

  for (const entry of data.values) {
    const key: string = labelSetKey(entry.resourceLabels);
    const found: {
      resource: Record<string, string>;
      values: Map<string, number>;
    } = byResource.get(key) || {
      resource: { ...entry.resourceLabels },
      values: new Map<string, number>(),
    };

    found.values.set(
      entry.value,
      (found.values.get(entry.value) || 0) + Math.abs(entry.score || 0),
    );
    byResource.set(key, found);
  }

  const resources: Array<{
    key: string;
    resource: Record<string, string>;
    values: Array<[string, number]>;
    total: number;
  }> = Array.from(byResource.entries()).map(
    ([key, found]: [
      string,
      { resource: Record<string, string>; values: Map<string, number> },
    ]) => {
      const values: Array<[string, number]> = Array.from(
        found.values.entries(),
      ).sort((a: [string, number], b: [string, number]): number => {
        return b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0);
      });

      return {
        key,
        resource: found.resource,
        values,
        total: values.reduce((sum: number, value: [string, number]) => {
          return sum + value[1];
        }, 0),
      };
    },
  );

  // Past the most kept, the busiest resources stay.
  const kept: Array<{
    key: string;
    resource: Record<string, string>;
    values: Array<[string, number]>;
    total: number;
  }> = [...resources]
    .sort(
      (
        a: { total: number; key: string },
        b: { total: number; key: string },
      ) => {
        return b.total - a.total || (a.key < b.key ? -1 : 1);
      },
    )
    .slice(0, GCP_SPLIT_MAX_LEARNED_RESOURCES)
    .sort((a: { key: string }, b: { key: string }): number => {
      return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
    });

  const learned: GcpSplitLearned = {
    at: data.at.toISOString(),
    via: data.via,
    capped: [],
    others: [],
  };

  for (const entry of kept) {
    if (entry.values.length >= CLOUD_ADDED_METRIC_MAX_SPLIT_VALUES) {
      learned.capped.push({
        resource: entry.resource,
        values: entry.values
          .map((value: [string, number]): string => {
            return value[0];
          })
          .filter((value: string): boolean => {
            return isGcpFilterLabel(data.label, value);
          })
          .slice(0, CLOUD_ADDED_METRIC_MAX_SPLIT_VALUES),
      });
    } else {
      learned.others.push(entry.resource);
    }
  }

  return learned;
}

// A split read's series, as values a learning ranks: each series' sum, by its resource.
export function getGcpSplitValuesOfSeries(
  series: ReadonlyArray<GcpTimeSeries>,
  split: GcpSplitRead,
): Array<GcpSplitValue> {
  const values: Array<GcpSplitValue> = [];

  for (const entry of series) {
    const value: string | undefined = entry.metricLabels[split.label];

    if (value === undefined) {
      continue;
    }

    values.push({
      resourceLabels: splitResourceOf(
        entry.resourceLabels,
        split.resourceLabelKeys,
      ),
      value,
      score: entry.points.reduce(
        (sum: number, point: { value: number }): number => {
          return sum + Math.abs(point.value);
        },
        0,
      ),
    });
  }

  return values;
}

/*
 * THE CALLS A SPLIT ASK IS READ IN, ONCE ITS VALUES ARE LEARNED (#10076).
 *
 * With no resource that had the cap's values: the ask as it is, every
 * value. Else each resource that had is read for its busiest alone: the
 * ones of the same values together, and others joined while all of their
 * values stay within the cap - each call one_of() at most ten values - and
 * each call narrowed to its resources (planGcpResourceBatches), so none is
 * read twice; and the rest of the ask's resources read for every value,
 * narrowed to them. A batch's resources the learning did not see (they had
 * no data) are among the rest; a type's resources it did not see are read
 * from its next learning, which they make due (getGcpSplitResourcesUnseen).
 */
export function planGcpSplitReads(data: {
  ask: GcpAddedMetricAsk;
  learned: GcpSplitLearned;
}): Array<GcpAddedMetricAsk> {
  const ask: GcpAddedMetricAsk = data.ask;
  const split: GcpSplitRead | undefined = ask.split;

  if (!split || data.learned.capped.length === 0) {
    return [ask];
  }

  const inAsk: (resource: Record<string, string>) => boolean = (
    resource: Record<string, string>,
  ): boolean => {
    return (
      !ask.resources ||
      isGcpSeriesOfResources(
        { resourceLabels: resource },
        ask.resources.map((labels: Record<string, string>) => {
          return splitResourceOf(labels, split.resourceLabelKeys);
        }),
      )
    );
  };
  const capped: Array<{
    resource: Record<string, string>;
    values: Array<string>;
  }> = data.learned.capped.filter(
    (entry: { resource: Record<string, string>; values: Array<string> }) => {
      return entry.values.length > 0 && inAsk(entry.resource);
    },
  );
  const cappedKeys: Set<string> = new Set<string>(
    capped.map((entry: { resource: Record<string, string> }): string => {
      return labelSetKey(entry.resource);
    }),
  );

  // Resources of the same values first, then joined while within the cap.
  const bySet: Map<
    string,
    { values: Array<string>; resources: Array<Record<string, string>> }
  > = new Map();

  for (const entry of capped) {
    const values: Array<string> = Array.from(new Set(entry.values)).sort();
    const key: string = JSON.stringify(values);
    const found: {
      values: Array<string>;
      resources: Array<Record<string, string>>;
    } = bySet.get(key) || { values, resources: [] };

    found.resources.push(entry.resource);
    bySet.set(key, found);
  }

  const groups: Array<{
    values: Set<string>;
    resources: Array<Record<string, string>>;
  }> = [];

  for (const key of Array.from(bySet.keys()).sort()) {
    const set: {
      values: Array<string>;
      resources: Array<Record<string, string>>;
    } = bySet.get(key)!;
    const into:
      | { values: Set<string>; resources: Array<Record<string, string>> }
      | undefined = groups.find((group: { values: Set<string> }): boolean => {
      return (
        new Set<string>([...group.values, ...set.values]).size <=
        CLOUD_ADDED_METRIC_MAX_SPLIT_VALUES
      );
    });

    if (into) {
      for (const value of set.values) {
        into.values.add(value);
      }

      into.resources.push(...set.resources);
    } else {
      groups.push({
        values: new Set(set.values),
        resources: [...set.resources],
      });
    }
  }

  const planned: Array<GcpAddedMetricAsk> = [];
  const narrowed: (
    resources: Array<Record<string, string>>,
    values?: Array<string> | undefined,
  ) => void = (
    resources: Array<Record<string, string>>,
    values?: Array<string> | undefined,
  ): void => {
    for (const batch of planGcpResourceBatches({
      metricType: ask.metric.metricType,
      resourceType: ask.resourceType,
      resources,
    })) {
      planned.push({
        metric: ask.metric,
        resourceType: ask.resourceType,
        resourceLabels: batch.labels,
        ...(batch.labelIn ? { resourceLabelIn: batch.labelIn } : {}),
        resources: batch.resources,
        split,
        ...(values ? { metricLabelIn: { label: split.label, values } } : {}),
      });
    }
  };

  for (const group of groups) {
    narrowed(group.resources, Array.from(group.values).sort());
  }

  // The rest, every value: a batch's own resources, a type's the learning saw.
  const rest: Array<Record<string, string>> = (
    ask.resources
      ? ask.resources.map((labels: Record<string, string>) => {
          return splitResourceOf(labels, split.resourceLabelKeys);
        })
      : data.learned.others
  ).filter((resource: Record<string, string>): boolean => {
    return (
      Object.keys(resource).length > 0 && !cappedKeys.has(labelSetKey(resource))
    );
  });

  if (rest.length > 0) {
    narrowed(rest);
  }

  return planned;
}

/*
 * What a split's call read for every value says of its resources' values
 * (#10076): one that had the cap's values or more is read for its busiest
 * from the next read on, learned from this one, at no cost; one it never
 * saw is kept with the others. Null when it changes nothing.
 */
export function learnGcpSplitFromRead(data: {
  learned: GcpSplitLearned;
  series: ReadonlyArray<GcpTimeSeries>;
  split: GcpSplitRead;
}): GcpSplitLearned | null {
  const read: GcpSplitLearned = toGcpSplitLearned({
    values: getGcpSplitValuesOfSeries(data.series, data.split),
    label: data.split.label,
    at: new Date(data.learned.at),
    via: data.learned.via,
  });
  const cappedKeys: Set<string> = new Set<string>(
    data.learned.capped.map((entry: { resource: Record<string, string> }) => {
      return labelSetKey(entry.resource);
    }),
  );
  const otherKeys: Set<string> = new Set<string>(
    data.learned.others.map((resource: Record<string, string>): string => {
      return labelSetKey(resource);
    }),
  );
  const newlyCapped: Array<{
    resource: Record<string, string>;
    values: Array<string>;
  }> = read.capped.filter((entry: { resource: Record<string, string> }) => {
    return !cappedKeys.has(labelSetKey(entry.resource));
  });
  const newOthers: Array<Record<string, string>> = read.others.filter(
    (resource: Record<string, string>): boolean => {
      const key: string = labelSetKey(resource);

      return !cappedKeys.has(key) && !otherKeys.has(key);
    },
  );

  if (newlyCapped.length === 0 && newOthers.length === 0) {
    return null;
  }

  const nowCapped: Set<string> = new Set<string>(
    newlyCapped.map((entry: { resource: Record<string, string> }): string => {
      return labelSetKey(entry.resource);
    }),
  );

  return {
    ...data.learned,
    capped: [...data.learned.capped, ...newlyCapped].slice(
      0,
      GCP_SPLIT_MAX_LEARNED_RESOURCES,
    ),
    others: [
      ...data.learned.others.filter((resource: Record<string, string>) => {
        return !nowCapped.has(labelSetKey(resource));
      }),
      ...newOthers,
    ].slice(0, GCP_SPLIT_MAX_LEARNED_RESOURCES),
  };
}

// Each resource a read found by its key metrics, once, by the split's resource labels.
function getGcpSplitResourcesFound(
  split: GcpSplitRead,
  found: ReadonlyArray<Record<string, string>>,
): Map<string, Record<string, string>> {
  const resources: Map<string, Record<string, string>> = new Map();

  for (const labels of found) {
    const resource: Record<string, string> = splitResourceOf(
      labels,
      split.resourceLabelKeys,
    );

    if (Object.keys(resource).length === split.resourceLabelKeys.length) {
      resources.set(labelSetKey(resource), resource);
    }
  }

  return resources;
}

// The resources a learning saw, with the cap's values or fewer.
function getGcpSplitResourcesLearned(learned: GcpSplitLearned): Set<string> {
  return new Set<string>([
    ...learned.capped.map((entry: { resource: Record<string, string> }) => {
      return labelSetKey(entry.resource);
    }),
    ...learned.others.map((resource: Record<string, string>): string => {
      return labelSetKey(resource);
    }),
  ]);
}

/*
 * The resources of a type's split addition that the read it was learned in
 * found by their key metrics, but the learning did not see (#10076): a VM
 * without the Ops Agent never reports the metric, so it is no new resource
 * at the reads after (getGcpSplitResourcesUnseen). As many as the most a
 * learning keeps leaves room for, with the ones it saw.
 */
export function getGcpSplitResourcesChecked(data: {
  learned: GcpSplitLearned;
  split: GcpSplitRead;
  found: ReadonlyArray<Record<string, string>>;
}): Array<Record<string, string>> {
  const learned: Set<string> = getGcpSplitResourcesLearned(data.learned);
  const found: Map<string, Record<string, string>> = getGcpSplitResourcesFound(
    data.split,
    data.found,
  );
  const room: number = Math.max(
    0,
    GCP_SPLIT_MAX_LEARNED_RESOURCES -
      data.learned.capped.length -
      data.learned.others.length,
  );

  return Array.from(found.keys())
    .filter((key: string): boolean => {
      return !learned.has(key);
    })
    .sort()
    .slice(0, room)
    .map((key: string): Record<string, string> => {
      return found.get(key)!;
    });
}

/*
 * Whether a type's split addition, read for some resources' busiest values,
 * missed a resource of its type the read found (by its key metrics): its
 * learning is then due at once, so the new resource is read from the next
 * read, not an hour later. One the read it was learned in found too is no
 * new one (getGcpSplitResourcesChecked): it does not report the metric, and
 * learning again every read would bill as much as the read. Nor is one
 * while the learning holds the most it keeps: learning again would keep no
 * more, and the hour's learning ranks them all.
 */
export function getGcpSplitResourcesUnseen(data: {
  learned: GcpSplitLearned;
  split: GcpSplitRead;
  found: ReadonlyArray<Record<string, string>>;
}): number {
  const checked: Array<Record<string, string>> = data.learned.checked || [];

  if (
    data.learned.capped.length === 0 ||
    data.learned.capped.length + data.learned.others.length + checked.length >=
      GCP_SPLIT_MAX_LEARNED_RESOURCES
  ) {
    return 0;
  }

  const known: Set<string> = getGcpSplitResourcesLearned(data.learned);

  for (const resource of checked) {
    known.add(labelSetKey(resource));
  }

  return Array.from(
    getGcpSplitResourcesFound(data.split, data.found).keys(),
  ).filter((key: string): boolean => {
    return !known.has(key);
  }).length;
}

/*
 * WHICH ADDED METRICS A READ ASKS ONE PROJECT FOR.
 *
 * A type's addition of every project that reported a resource of the type
 * lately (`seenResourceTypes`); resources' own of the project they are in.
 * A type's is one call, narrowed to the type's series (resource.type). The
 * resources' own of one metric type are asked together, in as few calls as
 * their labels allow (planGcpResourceBatches, #9810): each call narrowed to
 * its resources' own series, so Cloud Monitoring, which bills a call by the
 * series it returns, bills what one call per resource would, and the
 * project's per-minute read quota is spent once per batch, not once per
 * resource. Not at all where a type's addition of the same reads them
 * already. A metric that is a key metric of the type is read as one
 * already, and is not asked again.
 */
export function getGcpAddedMetricsToAsk(data: {
  added: ReadonlyArray<CloudAddedMetric>;
  projectId: string;
  seenResourceTypes: ReadonlySet<string>;
}): Array<GcpAddedMetricAsk> {
  const keyMetricNames: Set<string> = new Set<string>(
    getGcpReadMetrics().map((metric: GcpReadMetric): string => {
      return metric.storedName.toLowerCase();
    }),
  );
  const asks: Array<GcpAddedMetricAsk> = [];
  // What a type's addition reads already: "<type>\n<metric type>\n<aligner>".
  const typeWide: Set<string> = new Set<string>();
  // The resources' own, by what one call can read them with.
  const owned: Map<
    string,
    {
      metric: GcpReadMetric;
      resources: Array<Record<string, string>>;
      split?: GcpSplitRead | undefined;
    }
  > = new Map();

  const toReadMetric: (added: CloudAddedMetric) => GcpReadMetric = (
    added: CloudAddedMetric,
  ): GcpReadMetric => {
    return {
      metricType: added.name,
      aligner: added.aggregation as GcpAligner,
      unit: added.unit,
      // Never shown: a resource's page lists an added metric on its own.
      group: CloudKeyMetricGroup.Traffic,
      resourceType: added.resourceType,
      resourceTypes: [added.resourceType],
      storedName: added.name,
      isRetired: false,
    };
  };

  const callKey: (added: CloudAddedMetric) => string = (
    added: CloudAddedMetric,
  ): string => {
    return [
      added.resourceType,
      added.name,
      added.aggregation,
      getGcpSplitRead(added)?.label || "",
      (getGcpSplitRead(added)?.resourceLabelKeys || []).join(","),
    ].join("\n");
  };

  for (const added of data.added) {
    if (
      added.provider !== CloudProvider.GCP ||
      keyMetricNames.has(added.name.toLowerCase())
    ) {
      continue;
    }

    if (added.scope === CloudAddedMetricScope.Type) {
      if (
        !data.seenResourceTypes.has(added.resourceType) ||
        typeWide.has(callKey(added))
      ) {
        continue;
      }

      typeWide.add(callKey(added));

      const split: GcpSplitRead | undefined = getGcpSplitRead(added);

      asks.push({
        metric: toReadMetric(added),
        resourceType: added.resourceType,
        ...(split ? { split } : {}),
      });
      continue;
    }

    if (
      added.accountId !== data.projectId ||
      Object.keys(added.resourceLabels || {}).length === 0
    ) {
      continue;
    }

    const entry: {
      metric: GcpReadMetric;
      resources: Array<Record<string, string>>;
      split?: GcpSplitRead | undefined;
    } = owned.get(callKey(added)) || {
      metric: toReadMetric(added),
      resources: [],
      split: getGcpSplitRead(added),
    };

    entry.resources.push(added.resourceLabels!);
    owned.set(callKey(added), entry);
  }

  for (const [key, entry] of owned) {
    if (typeWide.has(key)) {
      continue;
    }

    for (const batch of planGcpResourceBatches({
      metricType: entry.metric.metricType,
      resourceType: entry.metric.resourceType,
      resources: entry.resources,
    })) {
      asks.push({
        metric: entry.metric,
        resourceType: entry.metric.resourceType,
        resourceLabels: batch.labels,
        ...(batch.labelIn ? { resourceLabelIn: batch.labelIn } : {}),
        resources: batch.resources,
        ...(entry.split ? { split: entry.split } : {}),
      });
    }
  }

  return asks;
}

/*
 * The resource types a project reported within GCP_RESOURCE_TYPE_SEEN_MS
 * of `now`, from the read state's per-type times.
 */
export function getGcpSeenResourceTypes(data: {
  seen: Record<string, string> | undefined;
  now: Date;
}): Set<string> {
  const types: Set<string> = new Set<string>();

  for (const [resourceType, at] of Object.entries(data.seen || {})) {
    if (!isOlderThan(at, GCP_RESOURCE_TYPE_SEEN_MS, data.now)) {
      types.add(resourceType);
    }
  }

  return types;
}

interface ParsedKey {
  projectId: string;
  clientEmail: string;
}

export default class GcpCloudConnector implements CloudConnector {
  public provider: CloudProvider = CloudProvider.GCP;

  // The key's own project and service account, from its JSON.
  public static readKey(serviceAccountJson: string): ParsedKey {
    const credentials: { clientEmail: string } =
      GoogleSecOpsClient.parseServiceAccountJson(serviceAccountJson);
    let projectId: string = "";

    try {
      const parsed: unknown = JSON.parse(serviceAccountJson);

      if (parsed && typeof parsed === "object") {
        const value: unknown = (parsed as Dictionary<unknown>)["project_id"];
        projectId = typeof value === "string" ? value.trim() : "";
      }
    } catch {
      projectId = "";
    }

    return { projectId, clientEmail: credentials.clientEmail };
  }

  public getProjects(settings: CloudConnectionSettings): Array<string> {
    const named: Array<string> = splitCloudConnectionList(
      readCloudSetting(settings.config, "projectIds"),
    );

    if (named.length > 0) {
      return named;
    }

    const key: ParsedKey = GcpCloudConnector.readKey(
      readCloudSetting(settings.secrets, "serviceAccountJson"),
    );

    return key.projectId ? [key.projectId] : [];
  }

  // Whether the connection reads every project of a Google Cloud organization.
  public isOrganization(settings: CloudConnectionSettings): boolean {
    return (
      readCloudSetting(settings.config, "readScope") ===
      CloudConnectionSetupScope.Organization
    );
  }

  /*
   * The projects a read reads: those the connection names (or the key's
   * own) - or, for an organization, every active project the service
   * account may see, searched once a day and kept in the read state.
   */
  public async resolveProjects(data: {
    settings: CloudConnectionSettings;
    options: CloudConnectorCallOptions;
    budget: CloudReadBudget;
    state: CloudConnectionPullState;
    now: Date;
  }): Promise<Array<string>> {
    if (!this.isOrganization(data.settings)) {
      return this.getProjects(data.settings);
    }

    const known: Array<{ id: string; name: string }> =
      data.state.organizationAccounts || [];

    if (
      known.length > 0 &&
      !isOlderThan(data.state.organizationListedAt, DAY_MS, data.now)
    ) {
      return known.map((project: { id: string }): string => {
        return project.id;
      });
    }

    const client: GcpInventoryClient = new GcpInventoryClient({
      serviceAccountJson: readCloudSetting(
        data.settings.secrets,
        "serviceAccountJson",
      ),
      transport: data.options.transport,
      requestTimeoutInMs: data.options.requestTimeoutInMs,
      budget: data.budget,
      sleep: data.options.sleep,
    });
    const all: Array<{ projectId: string; displayName: string }> =
      await client.searchProjects();
    const found: Array<{ projectId: string; displayName: string }> = all.slice(
      0,
      GCP_MAX_ORGANIZATION_PROJECTS,
    );

    data.state.organizationAccounts = found.map(
      (project: { projectId: string; displayName: string }) => {
        return { id: project.projectId, name: project.displayName };
      },
    );
    data.state.organizationAccountCount = all.length;
    data.state.organizationListedAt = data.now.toISOString();

    return found.length > 0
      ? found.map((project: { projectId: string }): string => {
          return project.projectId;
        })
      : this.getProjects(data.settings);
  }

  public validateSettings(settings: CloudConnectionSettings): void {
    const json: string = readCloudSetting(
      settings.secrets,
      "serviceAccountJson",
    );

    if (!json) {
      throw new BadDataException("Service account key (JSON) is required.");
    }

    GcpCloudConnector.readKey(json);

    const projects: Array<string> = this.getProjects(settings);

    if (projects.length === 0) {
      throw new BadDataException(
        "The key names no project: list the projects to read under Projects.",
      );
    }

    if (projects.length > GCP_MAX_PROJECTS) {
      throw new BadDataException(
        `Projects can list at most ${GCP_MAX_PROJECTS} projects.`,
      );
    }

    for (const project of projects) {
      GoogleMonitoringClient.validateProjectId(project);
    }
  }

  // The connection's Cloud Monitoring client: a resource's metric list reads through it too.
  public monitoring(
    settings: CloudConnectionSettings,
    options: CloudConnectorCallOptions,
    budget?: CloudReadBudget | undefined,
  ): GcpMonitoring {
    return new GcpMonitoring({
      serviceAccountJson: readCloudSetting(
        settings.secrets,
        "serviceAccountJson",
      ),
      transport: options.transport,
      requestTimeoutInMs: options.requestTimeoutInMs,
      budget,
    });
  }

  // A project's own read state, by id (an organization's projects, or the named ones).
  private markProjectRead(data: {
    state: CloudConnectionPullState;
    projectId: string;
    field: "inventoryReadAt" | "changesReadAt";
    now: Date;
  }): void {
    data.state.accountStates = {
      ...(data.state.accountStates || {}),
      [data.projectId]: {
        ...(data.state.accountStates?.[data.projectId] || {}),
        [data.field]: data.now.toISOString(),
      },
    };
  }

  /*
   * What changed in each project since the last read (its Admin Activity
   * audit log) and - every 15 minutes - Google Cloud's Service Health
   * events about it. A look back for an investigation reads only the
   * projects it names and moves no cursor.
   *
   * The projects are read least recently read first, so a read that stops
   * at its limit reaches the others next time; the audit log is listed
   * oldest first, so a project busier than one read takes carries on next
   * time from the newest change read (CloudChangeWindow).
   */
  public async readChanges(
    settings: CloudConnectionSettings,
    options: CloudChangesOptions,
  ): Promise<CloudChangesResult> {
    const now: Date = options.now ? options.now() : new Date();
    const state: CloudConnectionPullState = options.state;
    const client: GcpInventoryClient = new GcpInventoryClient({
      serviceAccountJson: readCloudSetting(
        settings.secrets,
        "serviceAccountJson",
      ),
      transport: options.transport,
      requestTimeoutInMs: options.requestTimeoutInMs,
      budget: options.budget,
      sleep: options.sleep,
    });
    const isLookBack: boolean = Boolean(options.since);
    const keepAudit: boolean = keepsAuditRecords(options);
    const result: CloudChangesResult = {
      changes: [],
      warnings: [],
      complete: true,
      ...(keepAudit ? { auditRecords: [] } : {}),
    };
    let projects: Array<string> = orderLeastRecentlyRead({
      accounts: this.isOrganization(settings)
        ? (state.organizationAccounts || []).map(
            (project: { id: string }): string => {
              return project.id;
            },
          )
        : this.getProjects(settings),
      readAt: (projectId: string): string | undefined => {
        return state.accountStates?.[projectId]?.changesReadAt;
      },
    });

    if (options.only) {
      const wanted: Set<string> = new Set(
        options.only.map((entry: { accountId: string }): string => {
          return entry.accountId;
        }),
      );
      projects = projects.filter((projectId: string): boolean => {
        return wanted.has(projectId);
      });
    }

    let refused: boolean = false;
    const busy: Array<string> = [];

    const outcomes: Array<
      Settled<{
        changes: Array<CloudChange>;
        complete: boolean;
        auditRecords: Array<CloudAuditRecord>;
      }>
    > = await mapWithConcurrency(
      projects,
      3,
      async (
        projectId: string,
      ): Promise<{
        changes: Array<CloudChange>;
        complete: boolean;
        auditRecords: Array<CloudAuditRecord>;
      }> => {
        const listing: { entries: Array<JSONObject>; complete: boolean } =
          await client.listAuditEntries({
            projectId,
            start: getChangeWindowStart({
              state,
              place: getChangePlace(projectId, ""),
              now,
              since: options.since,
            }),
            end: now,
          });

        return {
          changes: listing.entries
            .map((entry: JSONObject): CloudChange | null => {
              return readGcpAuditEntry({ entry, projectId });
            })
            .filter((change: CloudChange | null): boolean => {
              return change !== null;
            }) as Array<CloudChange>,
          complete: listing.complete,
          // The entries whole, for Security Events' Cloud audit logs.
          auditRecords: keepAudit
            ? listing.entries.map((entry: JSONObject): CloudAuditRecord => {
                return { accountId: projectId, record: entry };
              })
            : [],
        };
      },
    );

    outcomes.forEach(
      (
        outcome: Settled<{
          changes: Array<CloudChange>;
          complete: boolean;
          auditRecords: Array<CloudAuditRecord>;
        }>,
        index: number,
      ) => {
        const projectId: string = projects[index]!;

        if (outcome.ok) {
          result.auditRecords?.push(...outcome.value.auditRecords);

          result.changes.push(
            ...keepNewChanges({
              state,
              place: getChangePlace(projectId, ""),
              changes: outcome.value.changes,
              now,
              complete: outcome.value.complete,
              isLookBack,
              order: "oldest-first",
            }),
          );

          if (!outcome.value.complete) {
            busy.push(projectId);
          }

          if (!isLookBack) {
            this.markProjectRead({
              state,
              projectId,
              field: "changesReadAt",
              now,
            });
          }

          return;
        }

        result.complete = false;

        if (outcome.error instanceof CloudReadBudgetSpent) {
          return;
        }

        if (
          outcome.error instanceof LlmProviderError &&
          outcome.error.kind === CloudConnectionFailureKind.Authentication
        ) {
          throw outcome.error;
        }

        if (!isLookBack) {
          this.markProjectRead({
            state,
            projectId,
            field: "changesReadAt",
            now,
          });
        }

        if (
          outcome.error instanceof LlmProviderError &&
          outcome.error.kind === CloudConnectionFailureKind.Permission
        ) {
          refused = true;
          return;
        }

        // A project whose Logging API is off: its message says how to turn it on.
        result.warnings.push(
          `Could not read what changed in ${projectId}: ${
            outcome.error instanceof Error
              ? outcome.error.message
              : String(outcome.error)
          }`,
        );
      },
    );

    if (busy.length > 0) {
      result.warnings.push(
        `More changed in ${busy.slice(0, 5).join(", ")} than one read takes: the next read carries on from the newest change read.`,
      );
    }

    if (refused) {
      result.warnings.push(
        "The service account may not read a project's audit log. Run the setup command again: it gives it the Logs Viewer role.",
      );
    }

    // Service Health: a bonus, paused for a day for a project that does not allow it.
    const healthDue: boolean =
      !isLookBack && isOlderThan(state.healthReadAt, HEALTH_INTERVAL_MS, now);

    if (healthDue) {
      for (const projectId of projects) {
        if (options.budget.isSpent()) {
          break;
        }

        if (isHealthPaused({ state, accountId: projectId, now })) {
          continue;
        }

        try {
          const events: Array<JSONObject> =
            await client.listServiceHealthEvents({
              projectId,
              start: getHealthWindowStart({
                state,
                accountId: projectId,
                now,
              }),
            });

          result.changes.push(
            ...keepNewChanges({
              state,
              place: getChangePlace(projectId, "health"),
              changes: events
                .map((event: JSONObject): CloudChange | null => {
                  return readGcpHealthEvent({ event, projectId });
                })
                .filter((change: CloudChange | null): boolean => {
                  return change !== null;
                }) as Array<CloudChange>,
              now,
              complete: true,
              isLookBack,
            }),
          );
          markHealthRead({ state, accountId: projectId, now });
        } catch (error) {
          if (
            error instanceof LlmProviderError &&
            (error.kind === CloudConnectionFailureKind.Permission ||
              error.kind === CloudConnectionFailureKind.Settings)
          ) {
            pauseHealth({
              state,
              accountId: projectId,
              now,
              forMs: HEALTH_PAUSE_MS,
            });
          }
        }
      }

      state.healthReadAt = now.toISOString();
    }

    return result;
  }

  // The client a read of costs or savings asks Google Cloud with.
  private costClient(
    settings: CloudConnectionSettings,
    options: CloudConnectorCallOptions,
    budget: CloudReadBudget,
  ): GcpCostClient {
    return new GcpCostClient({
      serviceAccountJson: readCloudSetting(
        settings.secrets,
        "serviceAccountJson",
      ),
      transport: options.transport,
      requestTimeoutInMs: options.requestTimeoutInMs,
      budget,
      sleep: options.sleep,
    });
  }

  private static outcomesOf(
    projects: Array<string>,
    state: CloudCostState,
    message?: string | undefined,
  ): Array<CloudCostAccountOutcome> {
    return projects.map((accountId: string): CloudCostAccountOutcome => {
      return message ? { accountId, state, message } : { accountId, state };
    });
  }

  /*
   * What the connection's projects cost per day, from the billing export
   * it names (GcpCosts): one query, run in the service account's own
   * project. Without a billing export there is nothing to read, and the
   * projects say how to choose one.
   */
  public async readCosts(
    settings: CloudConnectionSettings,
    options: CloudCostsOptions,
  ): Promise<CloudCostsResult> {
    const now: Date = options.now ? options.now() : new Date();
    const projects: Array<string> = await this.resolveProjects({
      settings,
      options,
      budget: options.budget,
      state: options.state,
      now,
    });
    const table: string = readCloudSetting(
      settings.config,
      GCP_BILLING_EXPORT_TABLE_FIELD_KEY,
    );

    if (!table || !isValidGcpBillingExportTable(table)) {
      return {
        records: [],
        accounts: GcpCloudConnector.outcomesOf(
          projects,
          CloudCostState.NotSetUp,
          table
            ? "The billing export table must be written as project.dataset.table, as BigQuery shows it."
            : "Google Cloud's costs come from your billing export to BigQuery. Turn it on in the console (Billing > Billing export), then name its table under the connection's More fields.",
        ),
        warnings: [],
        complete: true,
      };
    }

    const queryProject: string =
      GcpCloudConnector.readKey(
        readCloudSetting(settings.secrets, "serviceAccountJson"),
      ).projectId ||
      projects[0] ||
      "";

    try {
      const read: { records: CloudCostsResult["records"]; complete: boolean } =
        await this.costClient(
          settings,
          options,
          options.budget,
        ).readBillingExport({
          queryProject,
          table,
          start: options.start,
          end: options.end,
        });

      if (!read.complete) {
        return {
          records: [],
          accounts: GcpCloudConnector.outcomesOf(
            projects,
            CloudCostState.Failed,
            "The billing export query took longer than one read waits: it is run again shortly.",
          ),
          warnings: [
            "The billing export query took longer than one read waits: it is run again shortly.",
          ],
          complete: false,
        };
      }

      return {
        records: read.records,
        accounts: GcpCloudConnector.outcomesOf(
          projects,
          CloudCostState.Reading,
        ),
        warnings: [],
        complete: true,
      };
    } catch (error) {
      if (
        error instanceof LlmProviderError &&
        error.kind === CloudConnectionFailureKind.Authentication
      ) {
        throw error;
      }

      const failure: { state: CloudCostState; message: string } =
        error instanceof CloudReadBudgetSpent
          ? {
              state: CloudCostState.Failed,
              message:
                "The read reached its limit before the costs: they are read again shortly.",
            }
          : describeGcpCostFailure({
              error,
              what: "costs",
              table,
              queryProject,
            });

      return {
        records: [],
        accounts: GcpCloudConnector.outcomesOf(
          projects,
          failure.state,
          failure.message,
        ),
        warnings: [failure.message],
        complete: false,
      };
    }
  }

  /*
   * The ways to spend less in each project, from the Recommender (GcpCosts):
   * each zonal recommender in every zone the project's machines are in,
   * each regional one in their Regions, the global ones once. A project
   * none of whose machines OneUptime knows is asked only the global ones.
   */
  public async readSavings(
    settings: CloudConnectionSettings,
    options: CloudSavingsOptions,
  ): Promise<CloudSavingsResult> {
    const now: Date = options.now ? options.now() : new Date();
    const projects: Array<string> = await this.resolveProjects({
      settings,
      options,
      budget: options.budget,
      state: options.state,
      now,
    });
    const client: GcpCostClient = this.costClient(
      settings,
      options,
      options.budget,
    );
    const result: CloudSavingsResult = {
      recommendations: [],
      accounts: [],
      warnings: [],
      complete: true,
    };

    for (const project of projects) {
      const places: { zones: Array<string>; regions: Array<string> } =
        getGcpPlaces(
          (options.knownResources || [])
            .filter((resource: CloudKnownResource): boolean => {
              return resource.accountId === project;
            })
            .map((resource: CloudKnownResource): string => {
              return resource.providerResourceId;
            }),
        );
      const calls: Array<{ recommender: string; location: string }> = [];

      for (const entry of GCP_COST_RECOMMENDERS as ReadonlyArray<GcpRecommenderPlace>) {
        const locations: Array<string> =
          entry.level === "zone"
            ? places.zones
            : entry.level === "region"
              ? places.regions
              : ["global"];

        for (const location of locations) {
          calls.push({ recommender: entry.recommender, location });
        }
      }

      const found: Array<CloudSavingRecord> = [];
      let failure: { state: CloudCostState; message: string } | null = null;

      for (const call of calls) {
        try {
          const items: Array<JSONObject> = await client.listRecommendations({
            project,
            location: call.location,
            recommender: call.recommender,
          });

          for (const item of items) {
            const record: CloudSavingRecord | null = readGcpRecommendation({
              item,
              project,
              location: call.location,
            });

            if (record) {
              found.push(record);
            }
          }
        } catch (error) {
          if (
            error instanceof LlmProviderError &&
            error.kind === CloudConnectionFailureKind.Authentication
          ) {
            throw error;
          }

          failure =
            error instanceof CloudReadBudgetSpent
              ? {
                  state: CloudCostState.Failed,
                  message:
                    "The read reached its limit before every recommendation: they are read again tomorrow.",
                }
              : describeGcpCostFailure({ error, what: "savings" });
          break;
        }
      }

      if (failure) {
        result.accounts.push({
          accountId: project,
          state: failure.state,
          message: failure.message,
        });
        result.warnings.push(failure.message);
        result.complete = false;
        continue;
      }

      result.recommendations.push(...found);
      result.accounts.push({
        accountId: project,
        state: CloudCostState.Reading,
      });
    }

    result.commitments = await this.readCommitments({
      settings,
      client,
      projects,
      now,
    });

    for (const entry of result.commitments.slice(0, 1)) {
      if (entry.summary.state !== CloudCostState.Reading) {
        result.warnings.push(entry.summary.message || "");
      }
    }

    return result;
  }

  /*
   * How much of each project's spend its committed use discounts cover,
   * from the billing export (GcpCosts' commitments query): one query for
   * every project. Without a billing export there is nothing to read, and
   * the projects say how to choose one.
   */
  private async readCommitments(data: {
    settings: CloudConnectionSettings;
    client: GcpCostClient;
    projects: Array<string>;
    now: Date;
  }): Promise<Array<{ accountId: string; summary: CloudCommitmentSummary }>> {
    const table: string = readCloudSetting(
      data.settings.config,
      GCP_BILLING_EXPORT_TABLE_FIELD_KEY,
    );
    const base: Omit<CloudCommitmentSummary, "state" | "kinds" | "currency"> = {
      days: CLOUD_COMMITMENT_WINDOW_DAYS,
      readAt: data.now.toISOString(),
    };
    const eachProject: (failure: {
      state: CloudCostState;
      message: string;
    }) => Array<{
      accountId: string;
      summary: CloudCommitmentSummary;
    }> = (failure: {
      state: CloudCostState;
      message: string;
    }): Array<{ accountId: string; summary: CloudCommitmentSummary }> => {
      return data.projects.map((accountId: string) => {
        return {
          accountId,
          summary: {
            ...base,
            state: failure.state,
            message: failure.message,
            currency: CLOUD_COST_DEFAULT_CURRENCY,
            kinds: [],
          },
        };
      });
    };

    if (!table || !isValidGcpBillingExportTable(table)) {
      return eachProject({
        state: CloudCostState.NotSetUp,
        message:
          "Committed use discounts are read from your billing export to BigQuery. Name its table under the connection's More fields.",
      });
    }

    const queryProject: string =
      GcpCloudConnector.readKey(
        readCloudSetting(data.settings.secrets, "serviceAccountJson"),
      ).projectId ||
      data.projects[0] ||
      "";
    const window: { start: Date; end: Date } = getCloudCommitmentWindow(
      data.now,
    );

    try {
      const read: { rows: Array<GcpCommitmentRow>; complete: boolean } =
        await data.client.readCommitments({
          queryProject,
          table,
          start: window.start,
          end: window.end,
        });

      if (!read.complete) {
        return eachProject({
          state: CloudCostState.Failed,
          message:
            "The commitments query took longer than one read waits: it is run again tomorrow.",
        });
      }

      return data.projects.map((accountId: string) => {
        const summary: {
          currency: string;
          figures: CloudCommitmentKindFigures;
        } = summarizeGcpCommitmentRows(
          read.rows.filter((row: GcpCommitmentRow): boolean => {
            return row.projectId === accountId;
          }),
        );

        return {
          accountId,
          summary: {
            ...base,
            state: CloudCostState.Reading,
            currency: summary.currency,
            kinds: [summary.figures],
          },
        };
      });
    } catch (error) {
      if (
        error instanceof LlmProviderError &&
        error.kind === CloudConnectionFailureKind.Authentication
      ) {
        throw error;
      }

      return eachProject(
        error instanceof CloudReadBudgetSpent
          ? {
              state: CloudCostState.Failed,
              message:
                "The read reached its limit before the commitments: they are read again tomorrow.",
            }
          : describeGcpCostFailure({
              error,
              what: "costs",
              table,
              queryProject,
            }),
      );
    }
  }

  /*
   * The projects' inventory (GcpInventory): every asset of the inventory's
   * types in each project read, and each project's name - the project
   * listed least recently first, so a listing that stops at its limit lists
   * the others next time. A project whose Cloud Asset API is off, or that
   * the service account may not list, is a warning that says what to run.
   */
  public async readInventory(
    settings: CloudConnectionSettings,
    options: CloudInventoryOptions,
  ): Promise<CloudInventoryResult> {
    const now: Date = options.now ? options.now() : new Date();
    const client: GcpInventoryClient = new GcpInventoryClient({
      serviceAccountJson: readCloudSetting(
        settings.secrets,
        "serviceAccountJson",
      ),
      transport: options.transport,
      requestTimeoutInMs: options.requestTimeoutInMs,
      budget: options.budget,
      sleep: options.sleep,
    });
    const organization: Array<{ id: string; name: string }> =
      this.isOrganization(settings)
        ? options.state.organizationAccounts || []
        : [];
    const projects: Array<string> = orderLeastRecentlyRead({
      accounts:
        organization.length > 0
          ? organization.map((project: { id: string }): string => {
              return project.id;
            })
          : this.getProjects(settings).slice(0, GCP_MAX_PROJECTS),
      readAt: (projectId: string): string | undefined => {
        return options.state.accountStates?.[projectId]?.inventoryReadAt;
      },
    });
    const organizationNames: Map<string, string> = new Map(
      organization.map((project: { id: string; name: string }) => {
        return [project.id, project.name];
      }),
    );
    const items: Array<CloudInventoryItem> = [];
    const accounts: Array<{ accountId: string; name?: string | undefined }> =
      [];
    const completelyListed: Array<{
      accountId: string;
      resourceTypes: Array<string>;
    }> = [];
    const warnings: Array<string> = [];
    let complete: boolean = true;

    for (const projectId of projects) {
      if (options.budget.isSpent()) {
        complete = false;
        break;
      }

      let listing: GcpAssetListing;

      try {
        listing = await client.listAssets(projectId);
      } catch (error) {
        if (error instanceof CloudReadBudgetSpent) {
          complete = false;
          break;
        }

        if (
          error instanceof LlmProviderError &&
          error.kind === CloudConnectionFailureKind.Authentication
        ) {
          throw error;
        }

        this.markProjectRead({
          state: options.state,
          projectId,
          field: "inventoryReadAt",
          now,
        });

        warnings.push(
          error instanceof LlmProviderError &&
            error.kind === CloudConnectionFailureKind.Permission
            ? `The service account may not list the resources of ${projectId}. Run the setup command again: it gives it the Cloud Asset Viewer role.`
            : `Could not list the resources of ${projectId}: ${
                error instanceof Error ? error.message : String(error)
              }`,
        );
        accounts.push({ accountId: projectId });
        continue;
      }

      this.markProjectRead({
        state: options.state,
        projectId,
        field: "inventoryReadAt",
        now,
      });

      const assets: Map<CloudInventoryItem, GcpAsset> = new Map();
      const projectItems: Array<CloudInventoryItem> = [];

      const context: GcpInventoryContext = buildGcpInventoryContext({
        projectId,
        assets: listing.assets,
      });

      for (const asset of listing.assets) {
        const item: CloudInventoryItem | null = buildGcpInventoryItem(
          asset,
          context,
        );

        if (item) {
          projectItems.push(item);
          assets.set(item, asset);
        }
      }

      addGcpInventoryEdges({
        items: projectItems,
        assets,
        listed: listing.assets,
      });
      items.push(...projectItems);

      if (listing.complete) {
        completelyListed.push({
          accountId: projectId,
          resourceTypes: Array.from(
            new Set(GCP_INVENTORY_TYPES.map(getGcpInventoryResourceType)),
          ),
        });
      } else {
        complete = false;
      }

      accounts.push({
        accountId: projectId,
        name:
          organizationNames.get(projectId) ||
          (await client.getProjectName(projectId)) ||
          undefined,
      });
    }

    const tooMany: string | null = this.isOrganization(settings)
      ? getOrganizationLimitWarning({
          total: options.state.organizationAccountCount || organization.length,
          noun: "projects",
        })
      : null;

    if (tooMany) {
      warnings.unshift(tooMany);
    }

    return { accounts, items, completelyListed, warnings, complete };
  }

  private resourceAttributes(data: {
    serviceName: string;
    connectionId: string;
    series: GcpTimeSeries;
  }): Array<OtlpAttribute> {
    const attributes: Array<OtlpAttribute> = [
      ...connectionResourceAttributes({
        serviceName: data.serviceName,
        connectionId: data.connectionId,
        cloudProvider: CloudProvider.GCP,
      }),
      stringAttribute("gcp.resource_type", data.series.resourceType),
    ];

    for (const key of Object.keys(data.series.resourceLabels).sort()) {
      attributes.push(stringAttribute(key, data.series.resourceLabels[key]!));
    }

    if (data.series.metadataName && !data.series.resourceLabels["name"]) {
      attributes.push(stringAttribute("name", data.series.metadataName));
    }

    return attributes;
  }

  private datapointAttributes(series: GcpTimeSeries): Array<OtlpAttribute> {
    return Object.keys(series.metricLabels)
      .sort()
      .map((key: string): OtlpAttribute => {
        return stringAttribute(key, series.metricLabels[key]!);
      });
  }

  private resolve(series: GcpTimeSeries): CloudMonitoredResource | null {
    return resolveCloudResourceOf({
      metricName: series.metricType,
      resourceAttributes: this.resourceAttributes({
        serviceName: "",
        connectionId: "",
        series,
      }),
      datapointAttributes: this.datapointAttributes(series),
    });
  }

  public async testConnection(
    settings: CloudConnectionSettings,
    options: CloudConnectorCallOptions,
  ): Promise<CloudConnectionTestResult> {
    const startedAt: number = Date.now();

    try {
      this.validateSettings(settings);

      const monitoring: GcpMonitoring = this.monitoring(settings, options);
      const projects: Array<string> = this.getProjects(settings);
      const now: Date = options.now ? options.now() : new Date();
      const end: Date = new Date(
        Math.floor(now.getTime() / 60000) * 60000 - GCP_METRIC_DELAY_MS,
      );
      const start: Date = new Date(end.getTime() - TEST_LOOK_BACK_MS);

      // The first key metric of each resource type, in each project.
      const asks: Array<{ projectId: string; metric: GcpKeyMetric }> = [];

      for (const projectId of projects.slice(0, 3)) {
        for (const entry of GCP_KEY_METRICS) {
          asks.push({ projectId, metric: entry.metrics[0]! });
        }
      }

      const outcomes: Array<Settled<Array<GcpTimeSeries>>> =
        await mapWithConcurrency(
          asks,
          CONCURRENCY,
          async (ask: {
            projectId: string;
            metric: GcpKeyMetric;
          }): Promise<Array<GcpTimeSeries>> => {
            // Read as a read reads it: a topic's first is a distribution's count.
            return await monitoring.listTimeSeries({
              projectId: ask.projectId,
              metricType: ask.metric.metricType,
              aligner: ask.metric.aligner,
              alignmentPeriodSeconds: 300,
              start,
              end,
              metricLabels: ask.metric.metricLabels,
              readAs: ask.metric.readAs,
              firstPageOnly: true,
            });
          },
        );

      const resources: Map<string, CloudMonitoredResource> = new Map();
      let succeeded: number = 0;
      let firstError: unknown = undefined;

      for (const outcome of outcomes) {
        if (!outcome.ok) {
          firstError = firstError || outcome.error;
          continue;
        }

        succeeded++;

        for (const series of outcome.value) {
          const resource: CloudMonitoredResource | null = this.resolve(series);

          if (resource) {
            resources.set(resource.identityKey, resource);
          }
        }
      }

      if (succeeded === 0 && firstError) {
        throw firstError;
      }

      const found: Array<CloudMonitoredResource> = Array.from(
        resources.values(),
      );

      return {
        provider: CloudProvider.GCP,
        status: found.length > 0 ? "pass" : "warn",
        message:
          found.length > 0
            ? `Signed in and found ${found.length} resources reporting to Cloud Monitoring in ${projects.length} projects.`
            : `Signed in to ${projects.join(", ")}, but found no resources reporting to Cloud Monitoring in the last half hour.`,
        accounts: projects,
        resourceCount: found.length,
        resourceTypes: countCloudConnectionValues(
          found.map((resource: CloudMonitoredResource): string => {
            return resource.resourceType;
          }),
        ).map((entry: { value: string; count: number }) => {
          return { type: entry.value, count: entry.count };
        }),
        regions: countCloudConnectionValues(
          found.map((resource: CloudMonitoredResource): string => {
            return resource.region;
          }),
        ).map((entry: { value: string; count: number }) => {
          return { region: entry.value, count: entry.count };
        }),
        isSample: true,
        durationMs: Date.now() - startedAt,
      };
    } catch (error) {
      return GcpCloudConnector.failedTest({ error, settings, startedAt });
    }
  }

  public static failedTest(data: {
    error: unknown;
    settings: CloudConnectionSettings;
    startedAt: number;
  }): CloudConnectionTestResult {
    if (data.error instanceof BadDataException) {
      return {
        provider: CloudProvider.GCP,
        status: "fail",
        message: data.error.message,
        failureKind: CloudConnectionFailureKind.Settings,
        durationMs: Date.now() - data.startedAt,
      };
    }

    const failure: LlmProviderError = LlmProviderError.from({
      error: data.error,
      step: "test",
      providerTitle: PROVIDER_TITLE,
      secretValues: getCloudSecretValues(data.settings),
    });

    return {
      provider: CloudProvider.GCP,
      status: "fail",
      message: failure.message,
      failureKind: failure.kind,
      durationMs: Date.now() - data.startedAt,
    };
  }

  /*
   * A split ask's busiest values of each resource over the hour before
   * `end` (#10076): asked of PromQL's topk, which Google bills for those
   * alone; where PromQL cannot rank them, from a timeSeries.list of the
   * hour aligned to one point, which returns every value once. Only the
   * ask's own resources, for a batch.
   */
  private async learnSplit(data: {
    monitoring: GcpMonitoring;
    projectId: string;
    ask: GcpAddedMetricAsk;
    end: Date;
    now: Date;
  }): Promise<GcpSplitLearned> {
    const split: GcpSplitRead = data.ask.split!;
    const ofAsk: (values: Array<GcpSplitValue>) => Array<GcpSplitValue> = (
      values: Array<GcpSplitValue>,
    ): Array<GcpSplitValue> => {
      const resources: Array<Record<string, string>> | undefined =
        data.ask.resources;

      return resources
        ? values.filter((value: GcpSplitValue): boolean => {
            return isGcpSeriesOfResources(
              { resourceLabels: value.resourceLabels },
              resources,
            );
          })
        : values;
    };

    try {
      return toGcpSplitLearned({
        values: ofAsk(
          await data.monitoring.listTopSplitValues({
            projectId: data.projectId,
            metricType: data.ask.metric.metricType,
            aligner: data.ask.metric.aligner,
            resourceType: data.ask.resourceType,
            resourceLabels: data.ask.resourceLabels,
            resourceLabelIn: data.ask.resourceLabelIn,
            split,
            top: CLOUD_ADDED_METRIC_MAX_SPLIT_VALUES,
            lookBackSeconds: GCP_SPLIT_LEARN_LOOK_BACK_SECONDS,
            at: data.end,
          }),
        ),
        label: split.label,
        at: data.now,
        via: "promql",
      });
    } catch (error) {
      if (error instanceof CloudReadBudgetSpent) {
        throw error;
      }

      logger.debug(
        `GcpCloudConnector: PromQL could not rank ${data.ask.metric.metricType} by ${split.label}; learning from timeSeries.list:`,
      );
      logger.debug(error);
    }

    const series: Array<GcpTimeSeries> = await data.monitoring.listTimeSeries({
      projectId: data.projectId,
      metricType: data.ask.metric.metricType,
      aligner: data.ask.metric.aligner,
      alignmentPeriodSeconds: GCP_SPLIT_LEARN_LOOK_BACK_SECONDS,
      start: new Date(
        data.end.getTime() - GCP_SPLIT_LEARN_LOOK_BACK_SECONDS * 1000,
      ),
      end: data.end,
      resourceType: data.ask.resourceType,
      resourceLabels: data.ask.resourceLabels,
      resourceLabelIn: data.ask.resourceLabelIn,
      split,
    });

    return toGcpSplitLearned({
      values: ofAsk(getGcpSplitValuesOfSeries(series, split)),
      label: split.label,
      at: data.now,
      via: "list",
    });
  }

  public async read(
    settings: CloudConnectionSettings,
    options: CloudReadOptions,
  ): Promise<CloudReadResult> {
    const now: Date = options.now ? options.now() : new Date();
    const budget: CloudReadBudget = new CloudReadBudget({
      maxRequests: options.maxRequests,
      maxDurationMs: options.maxDurationMs,
    });
    const state: CloudConnectionPullState = { ...options.state };
    const warnings: Array<string> = [];
    const monitoring: GcpMonitoring = this.monitoring(
      settings,
      options,
      budget,
    );
    const projects: Array<string> = await this.resolveProjects({
      settings,
      options,
      budget,
      state,
      now,
    });
    const cursors: Record<string, string> = { ...(state.cursors || {}) };
    const window: MetricWindow | null = getMetricWindow({
      policy: getMetricWindowPolicy({
        periodSeconds: GCP_ALIGNMENT_PERIOD_SECONDS,
        delayMs: GCP_METRIC_DELAY_MS,
      }),
      cursor: cursors[String(GCP_ALIGNMENT_PERIOD_SECONDS)],
      now,
    });

    const resources: Map<string, CloudDiscoveredResource> = new Map();
    const groups: Map<string, CloudMetricGroup> = new Map();
    // Each split's values, by its learning's key (#10076).
    const splitValues: Record<string, GcpSplitLearned> = {};
    /*
     * Per project, the resource types it reported lately
     * (getGcpMetricTypesToAsk): the ones the state kept, less those quiet
     * for a day, plus what this read finds.
     */
    const seenByProject: Record<string, Record<string, string>> = {};

    for (const projectId of Array.from(
      new Set<string>([
        ...projects,
        ...Object.keys(state.gcpResourceTypesSeen || {}),
      ]),
    )) {
      const kept: Record<string, string> = {};

      for (const resourceType of getGcpSeenResourceTypes({
        seen: state.gcpResourceTypesSeen?.[projectId],
        now,
      })) {
        kept[resourceType] =
          state.gcpResourceTypesSeen![projectId]![resourceType]!;
      }

      // A project quiet for a day is forgotten.
      if (Object.keys(kept).length > 0 || projects.includes(projectId)) {
        seenByProject[projectId] = kept;
      }
    }

    /*
     * Per project, when one of its VMs last reported an Ops Agent metric
     * (kept while within GCP_OPS_AGENT_SEEN_MS), and when a read last asked
     * it whether one does (getGcpOpsAgentAsk).
     */
    const opsAgentSeen: Record<string, string> = {};
    const opsAgentAskedAt: Record<string, string> = {};

    for (const [projectId, at] of Object.entries(state.gcpOpsAgentSeen || {})) {
      if (!isOlderThan(at, GCP_OPS_AGENT_SEEN_MS, now)) {
        opsAgentSeen[projectId] = at;
      }
    }

    for (const [projectId, at] of Object.entries(
      state.gcpOpsAgentAskedAt || {},
    )) {
      if (
        projects.includes(projectId) &&
        !isOlderThan(at, GCP_OPS_AGENT_ASK_EVERY_MS, now)
      ) {
        opsAgentAskedAt[projectId] = at;
      }
    }

    if (window) {
      type GcpAsk = {
        projectId: string;
        metric: GcpReadMetric;
        // An added metric's narrowing (getGcpAddedMetricsToAsk).
        added?: GcpAddedMetricAsk | undefined;
      };

      // The split calls read for every value, by their learning (#10076).
      const readWhole: Array<{
        key: string;
        split: GcpSplitRead;
        series: Array<GcpTimeSeries>;
      }> = [];
      // Per project and resource type, the resources its key metrics found.
      const foundByType: Map<string, Array<Record<string, string>>> = new Map();

      // Each project's metrics asked so far this read, by stored name.
      const askedByProject: Map<string, Set<string>> = new Map();
      const knownResourceTypes: ReadonlySet<string> = new Set<string>(
        GCP_KEY_METRICS.map((entry: GcpTypeKeyMetrics): string => {
          return entry.resourceType;
        }),
      );
      /*
       * What each project is known to have, this read's finds included so
       * far: its resource types, and whether a VM of it runs the Ops Agent.
       */
      const typesByProject: Map<string, Set<string>> = new Map();
      const agentProjects: Set<string> = new Set<string>(
        Object.keys(opsAgentSeen),
      );

      for (const projectId of projects) {
        typesByProject.set(
          projectId,
          new Set<string>(Object.keys(seenByProject[projectId] || {})),
        );
      }

      // How a project is asked for the agent's metrics, now; a "first" is kept.
      const opsAgentAskOf: (projectId: string) => GcpOpsAgentAsk = (
        projectId: string,
      ): GcpOpsAgentAsk => {
        const ask: GcpOpsAgentAsk = getGcpOpsAgentAsk({
          isReporting: agentProjects.has(projectId),
          askedAt: opsAgentAskedAt[projectId],
          hasResources: hasGcpOpsAgentResources(
            typesByProject.get(projectId) || new Set<string>(),
          ),
          now,
        });

        if (ask === "first") {
          opsAgentAskedAt[projectId] = now.toISOString();
        }

        return ask;
      };

      const ask: (asks: Array<GcpAsk>) => Promise<{
        outcomes: Array<Settled<Array<GcpTimeSeries>>>;
        asks: Array<GcpAsk>;
      }> = async (
        asks: Array<GcpAsk>,
      ): Promise<{
        outcomes: Array<Settled<Array<GcpTimeSeries>>>;
        asks: Array<GcpAsk>;
      }> => {
        for (const item of asks) {
          // An added metric is asked as it is narrowed, whatever else is.
          if (item.added) {
            continue;
          }

          const asked: Set<string> =
            askedByProject.get(item.projectId) || new Set<string>();
          asked.add(item.metric.storedName);
          askedByProject.set(item.projectId, asked);
        }

        return {
          asks,
          outcomes: await mapWithConcurrency(
            asks,
            CONCURRENCY,
            async (item: GcpAsk): Promise<Array<GcpTimeSeries>> => {
              const series: Array<GcpTimeSeries> =
                await monitoring.listTimeSeries({
                  projectId: item.projectId,
                  metricType: item.metric.metricType,
                  aligner: item.metric.aligner,
                  alignmentPeriodSeconds: GCP_ALIGNMENT_PERIOD_SECONDS,
                  start: window.start,
                  end: window.end,
                  metricLabels: item.metric.metricLabels,
                  readAs: item.metric.readAs,
                  resourceType: item.added?.resourceType,
                  resourceLabels: item.added?.resourceLabels,
                  resourceLabelIn: item.added?.resourceLabelIn,
                  metricLabelIn: item.added?.metricLabelIn,
                  split: item.added?.split,
                });
              const resources: Array<Record<string, string>> | undefined =
                item.added?.resources;

              /*
               * A batch's answer, each series filed under the resource
               * whose labels it carries: a series of a resource the batch
               * did not ask for is never written (#9810).
               */
              const ofResources: Array<GcpTimeSeries> = resources
                ? series.filter((entry: GcpTimeSeries): boolean => {
                    return isGcpSeriesOfResources(entry, resources);
                  })
                : series;

              // Read for every value: what it says of each resource's values (#10076).
              if (
                item.added?.split &&
                item.added.splitLearnKey &&
                !item.added.metricLabelIn
              ) {
                readWhole.push({
                  key: item.added.splitLearnKey,
                  split: item.added.split,
                  series: ofResources,
                });
              }

              // A split's busiest values of each resource, at most its cap (#9808).
              return item.added?.split
                ? capGcpSplitSeries(ofResources)
                : ofResources;
            },
          ),
        };
      };

      /*
       * 1. Every resource type's first metric, the others of the types each
       * project has, and the Ops Agent's where a VM runs it.
       */
      let next: Array<GcpAsk> = [];
      // The split additions' asks (#10076), read once their values are known.
      const splitAsks: Array<{
        projectId: string;
        ask: GcpAddedMetricAsk;
        key: string;
      }> = [];

      for (const projectId of projects) {
        for (const metric of getGcpMetricTypesToAsk({
          seenResourceTypes: typesByProject.get(projectId)!,
          opsAgent: opsAgentAskOf(projectId),
        })) {
          next.push({ projectId, metric });
        }

        // The metrics people added, of the types the project has.
        for (const added of getGcpAddedMetricsToAsk({
          added: options.addedMetrics || [],
          projectId,
          seenResourceTypes: typesByProject.get(projectId)!,
        })) {
          if (added.split) {
            splitAsks.push({
              projectId,
              ask: added,
              key: getGcpSplitLearnKey(projectId, added),
            });
            continue;
          }

          next.push({ projectId, metric: added.metric, added });
        }
      }

      /*
       * The values each split is read for (#10076): as the read state keeps
       * them, learned again where that is due, before anything is read.
       */
      for (const entry of splitAsks) {
        const kept: GcpSplitLearned | undefined =
          state.gcpSplitValues?.[entry.key];

        if (kept) {
          splitValues[entry.key] = kept;
        }
      }

      const dueSplits: Array<{
        projectId: string;
        ask: GcpAddedMetricAsk;
        key: string;
      }> = splitAsks.filter((entry: { key: string }): boolean => {
        return isGcpSplitLearnDue(splitValues[entry.key], now);
      });
      // The splits learned in this read.
      const learnedNow: Set<string> = new Set<string>();
      const learnings: Array<Settled<GcpSplitLearned>> =
        await mapWithConcurrency(
          dueSplits,
          CONCURRENCY,
          async (entry: {
            projectId: string;
            ask: GcpAddedMetricAsk;
          }): Promise<GcpSplitLearned> => {
            return await this.learnSplit({
              monitoring,
              projectId: entry.projectId,
              ask: entry.ask,
              end: window.end,
              now,
            });
          },
        );

      learnings.forEach((outcome: Settled<GcpSplitLearned>, index: number) => {
        const entry: { ask: GcpAddedMetricAsk; key: string } =
          dueSplits[index]!;

        if (outcome.ok) {
          splitValues[entry.key] = outcome.value;
          learnedNow.add(entry.key);

          if (outcome.value.via === "list") {
            warnings.push(
              `Cloud Monitoring could not rank the values of ${entry.ask.metric.metricType} by ${entry.ask.split!.label} with PromQL, so its busiest values were learned from all of them this hour.`,
            );
          }

          return;
        }

        if (outcome.error instanceof CloudReadBudgetSpent) {
          return;
        }

        // Kept as last learned where they were: still read for those alone.
        warnings.push(
          `Could not learn which values of ${entry.ask.metric.metricType} by ${
            entry.ask.split!.label
          } to read${
            splitValues[entry.key] ? ", so the last ones learned were read" : ""
          }: ${
            outcome.error instanceof Error
              ? outcome.error.message
              : String(outcome.error)
          }`,
        );
      });

      for (const entry of splitAsks) {
        const learned: GcpSplitLearned | undefined = splitValues[entry.key];

        // Never learned: read once its values are, never for every value unasked.
        if (!learned) {
          continue;
        }

        for (const planned of planGcpSplitReads({ ask: entry.ask, learned })) {
          next.push({
            projectId: entry.projectId,
            metric: planned.metric,
            added: { ...planned, splitLearnKey: entry.key },
          });
        }
      }

      const passes: Array<{
        outcomes: Array<Settled<Array<GcpTimeSeries>>>;
        asks: Array<GcpAsk>;
      }> = [];

      /*
       * 2. What a pass found for the first time - a resource type a project
       * reported for the first time in a day, an Ops Agent on one of its
       * VMs - asked whole in a pass of its own, for the same window, so its
       * first minutes are read whole: a VM found asks whether it runs the
       * agent, and an agent found asks the agent's other metrics.
       */
      while (next.length > 0 && passes.length < GCP_MAX_READ_PASSES) {
        const pass: {
          outcomes: Array<Settled<Array<GcpTimeSeries>>>;
          asks: Array<GcpAsk>;
        } = await ask(next);
        const found: Map<string, { types: Set<string>; isAgent: boolean }> =
          new Map();

        passes.push(pass);
        pass.outcomes.forEach(
          (outcome: Settled<Array<GcpTimeSeries>>, index: number) => {
            if (!outcome.ok || outcome.value.length === 0) {
              return;
            }

            const item: GcpAsk = pass.asks[index]!;
            const what: { types: Set<string>; isAgent: boolean } = found.get(
              item.projectId,
            ) || { types: new Set<string>(), isAgent: false };

            for (const series of outcome.value) {
              if (
                knownResourceTypes.has(series.resourceType) &&
                !typesByProject.get(item.projectId)?.has(series.resourceType)
              ) {
                what.types.add(series.resourceType);
              }
            }

            if (
              item.metric.reportedBy === GCP_OPS_AGENT &&
              !agentProjects.has(item.projectId)
            ) {
              what.isAgent = true;
            }

            found.set(item.projectId, what);
          },
        );

        next = [];

        for (const [projectId, what] of found) {
          const types: Set<string> =
            typesByProject.get(projectId) || new Set<string>();

          for (const resourceType of what.types) {
            types.add(resourceType);
          }

          typesByProject.set(projectId, types);

          if (what.isAgent) {
            agentProjects.add(projectId);
          }

          for (const metric of getGcpMetricTypesToAsk({
            seenResourceTypes: what.types,
            asked: askedByProject.get(projectId),
            opsAgent: what.isAgent
              ? "all"
              : hasGcpOpsAgentResources(what.types)
                ? opsAgentAskOf(projectId)
                : "none",
          })) {
            next.push({ projectId, metric });
          }
        }
      }

      let succeeded: number = 0;
      let failedMetrics: number = 0;
      let firstError: unknown = undefined;

      const collect: (
        outcome: Settled<Array<GcpTimeSeries>>,
        item: GcpAsk,
      ) => void = (
        outcome: Settled<Array<GcpTimeSeries>>,
        item: GcpAsk,
      ): void => {
        if (!outcome.ok) {
          if (outcome.error instanceof CloudReadBudgetSpent) {
            return;
          }

          if (
            outcome.error instanceof LlmProviderError &&
            (outcome.error.kind === CloudConnectionFailureKind.Authentication ||
              outcome.error.kind === CloudConnectionFailureKind.Settings)
          ) {
            throw outcome.error;
          }

          failedMetrics++;
          firstError = firstError || outcome.error;
          return;
        }

        succeeded++;
        const askedMetric: GcpReadMetric = item.metric;

        for (const series of outcome.value) {
          if (knownResourceTypes.has(series.resourceType)) {
            const seen: Record<string, string> =
              seenByProject[item.projectId] || {};
            seen[series.resourceType] = now.toISOString();
            seenByProject[item.projectId] = seen;
          }

          if (!item.added) {
            const typeKey: string = `${item.projectId}\n${series.resourceType}`;
            const found: Array<Record<string, string>> =
              foundByType.get(typeKey) || [];

            found.push(series.resourceLabels);
            foundByType.set(typeKey, found);
          }
        }

        // A VM of the project runs the Ops Agent: its metrics are asked every read.
        if (askedMetric.reportedBy === GCP_OPS_AGENT && outcome.value.length) {
          opsAgentSeen[item.projectId] = now.toISOString();
        }

        for (const series of outcome.value) {
          const resource: CloudMonitoredResource | null = this.resolve(series);

          if (!resource) {
            continue;
          }

          if (!resources.has(resource.identityKey)) {
            resources.set(resource.identityKey, {
              resource,
              displayName: series.metadataName || undefined,
            });
          }

          let group: CloudMetricGroup | undefined = groups.get(
            resource.identityKey,
          );

          if (!group) {
            group = {
              resourceAttributes: this.resourceAttributes({
                serviceName: options.serviceName,
                connectionId: options.connectionId,
                series,
              }),
              metrics: [],
            };
            groups.set(resource.identityKey, group);
          }

          // Stored as the catalog names it: a distribution's count as its own.
          let metric: CloudMetricGroup["metrics"][number] | undefined =
            group.metrics.find((candidate: { name: string }): boolean => {
              return candidate.name === askedMetric.storedName;
            });

          if (!metric) {
            metric = {
              name: askedMetric.storedName,
              unit: askedMetric.unit,
              datapointSets: [],
            };
            group.metrics.push(metric);
          }

          metric.datapointSets.push({
            attributes: this.datapointAttributes(series),
            points: series.points,
          });
        }
      };

      for (const pass of passes) {
        pass.outcomes.forEach(
          (outcome: Settled<Array<GcpTimeSeries>>, index: number) => {
            collect(outcome, pass.asks[index]!);
          },
        );
      }

      /*
       * What the calls read for every value say of their resources (#10076):
       * one that has the cap's values now is read for its busiest from the
       * next read on. A type's resource the learning missed learns again.
       */
      for (const entry of readWhole) {
        const learned: GcpSplitLearned | undefined = splitValues[entry.key];
        const updated: GcpSplitLearned | null = learned
          ? learnGcpSplitFromRead({
              learned,
              series: entry.series,
              split: entry.split,
            })
          : null;

        if (updated) {
          splitValues[entry.key] = updated;
        }
      }

      for (const entry of splitAsks) {
        const learned: GcpSplitLearned | undefined = splitValues[entry.key];

        // A batch's resources are its own: a type's alone finds new ones.
        if (!learned || entry.ask.resources) {
          continue;
        }

        const found: Array<Record<string, string>> =
          foundByType.get(`${entry.projectId}\n${entry.ask.resourceType}`) ||
          [];

        // Learned in this read: the resources it found without the metric are no new ones.
        if (learnedNow.has(entry.key)) {
          const checked: Array<Record<string, string>> =
            getGcpSplitResourcesChecked({
              learned,
              split: entry.ask.split!,
              found,
            });

          if (checked.length > 0) {
            splitValues[entry.key] = { ...learned, checked };
          }
        } else if (
          getGcpSplitResourcesUnseen({
            learned,
            split: entry.ask.split!,
            found,
          }) > 0
        ) {
          splitValues[entry.key] = {
            ...learned,
            at: new Date(0).toISOString(),
          };
        }
      }

      // Only the learnings of what is added now are kept.
      const keptSplitValues: Record<string, GcpSplitLearned> = {};

      for (const entry of splitAsks) {
        if (splitValues[entry.key]) {
          keptSplitValues[entry.key] = splitValues[entry.key]!;
        }
      }

      state.gcpSplitValues = keptSplitValues;

      if (succeeded === 0 && firstError) {
        throw firstError;
      }

      if (failedMetrics > 0) {
        warnings.push(
          `Could not read ${failedMetrics} metrics this time: ${
            firstError instanceof Error
              ? firstError.message
              : String(firstError)
          }`,
        );
      }

      if (!budget.isSpent()) {
        cursors[String(GCP_ALIGNMENT_PERIOD_SECONDS)] =
          window.end.toISOString();
      }
    }

    state.cursors = cursors;
    state.accounts = projects;
    state.inventoryAt = now.toISOString();
    state.gcpResourceTypesSeen = seenByProject;
    state.gcpOpsAgentSeen = opsAgentSeen;
    /*
     * A read that stopped at its limit may not have asked what it meant to:
     * the next asks again rather than an hour later.
     */
    state.gcpOpsAgentAskedAt = budget.isSpent()
      ? state.gcpOpsAgentAskedAt
      : opsAgentAskedAt;

    const tooMany: string | null = this.isOrganization(settings)
      ? getOrganizationLimitWarning({
          total: state.organizationAccountCount || projects.length,
          noun: "projects",
        })
      : null;

    if (tooMany) {
      warnings.unshift(tooMany);
    }

    const metricGroups: Array<CloudMetricGroup> = budget.isSpent()
      ? []
      : Array.from(groups.values());

    if (budget.isSpent()) {
      warnings.push(
        "This read stopped at its limit and carries on within a minute. Name fewer projects to read them in one go.",
      );
    }

    return {
      accounts: projects,
      resources: Array.from(resources.values()),
      completelyListedAccounts: [],
      payloads: buildMetricsPayloads(metricGroups),
      pointsWritten: countPayloadPoints(metricGroups),
      requestCount: budget.getUsed(),
      warnings,
      complete: !budget.isSpent(),
      nextState: state,
    };
  }
}
