import { translationKey } from "../Translator";
import {
  CloudAddedMetricDimension,
  CloudAddedMetricScope,
} from "./CloudAddedMetrics";

/*
 * WHAT ONE CLOUD RESOURCE PUBLISHES, BEYOND WHAT ITS CONNECTION READS (#9563).
 *
 * A resource's Metrics tab lists, on demand, the metrics its cloud says it
 * publishes (CloudResourceMetrics.listPublished): an Azure resource's
 * metric definitions, the CloudWatch metrics of an AWS resource's own
 * dimensions, the Cloud Monitoring metric descriptors of a Google Cloud
 * resource's type. Each says whether the connection reads it already - as
 * a key metric, or because someone added it - and how it would be read if
 * added. The listing carries what the page needs to say what an addition
 * costs before it is made (CloudConnectionCost.estimateCloudAddedMetricCost).
 */

export enum CloudPublishedMetricStatus {
  // One of its type's key metrics: read already.
  Key = "key",
  // Someone added it: read for this resource, or for its whole type.
  Added = "added",
  // Neither: it can be added.
  Available = "available",
}

// Why a metric a resource publishes cannot be added.
export enum CloudPublishedMetricBlock {
  // Azure: a call must split it by one of its dimensions to read it at all.
  NeedsDimension = "needs-dimension",
  // Kept only at a grain coarser than an hour.
  CoarseGrain = "coarse-grain",
  // Its values are text, or of a kind the read cannot align to a number.
  Unreadable = "unreadable",
  // Its cloud deprecates it.
  Deprecated = "deprecated",
}

export const CLOUD_PUBLISHED_METRIC_BLOCK_REASONS: Readonly<
  Record<CloudPublishedMetricBlock, string>
> = {
  [CloudPublishedMetricBlock.NeedsDimension]: translationKey(
    "Its cloud reads it only split by one of its dimensions.",
  ),
  [CloudPublishedMetricBlock.CoarseGrain]: translationKey(
    "Its cloud keeps it only at a grain coarser than an hour.",
  ),
  [CloudPublishedMetricBlock.Unreadable]: translationKey(
    "Its values are not numbers OneUptime can chart.",
  ),
  [CloudPublishedMetricBlock.Deprecated]: translationKey(
    "Its cloud deprecates it.",
  ),
};

/*
 * A dimension a metric can be read split by (#9808): its name as its cloud
 * names it, in words where the cloud gives them, and - where the listing
 * saw them (AWS) - how many values the resource has of it now.
 */
export interface CloudPublishedMetricSplit {
  name: string;
  displayName?: string | undefined;
  values?: number | undefined;
  /*
   * Google Cloud: its connection's reads found PromQL cannot rank the
   * metric's values by it (#10164), so each hour's learning of its busiest
   * lists every value of each resource - `learnedValuesPerResource` of them
   * on average, where a list has run - and Google bills them all.
   */
  isLearnedFromEveryValue?: boolean | undefined;
  learnedValuesPerResource?: number | undefined;
}

export interface CloudPublishedMetric {
  /*
   * The cloud's own name: Azure Monitor's, CloudWatch's, or a Cloud
   * Monitoring metric type.
   */
  name: string;
  // Its name in words, where the cloud gives one.
  displayName?: string | undefined;
  description?: string | undefined;
  // Its unit, where the cloud gives one (CloudWatch's listing does not).
  unit: string;
  // AWS: its CloudWatch namespace.
  namespace?: string | undefined;
  /*
   * How it is read when added: an Azure aggregation (its primary), a
   * CloudWatch statistic, a Cloud Monitoring aligner.
   */
  aggregation: string;
  // Azure: the grain it is read at, its finest from a minute up.
  grain?: string | undefined;
  // AWS: the resource's own series of it.
  dimensions?: Array<CloudAddedMetricDimension> | undefined;
  /*
   * The dimensions it can be split by when added (#9808), and whether its
   * cloud reads it only so: an Azure metric whose definition requires a
   * dimension, an AWS metric the resource publishes only per value of one.
   */
  splits?: Array<CloudPublishedMetricSplit> | undefined;
  isSplitRequired?: boolean | undefined;
  // An addition's: the dimension it is split by.
  addedSplitBy?: string | undefined;
  status: CloudPublishedMetricStatus;
  // An added metric's key (CloudAddedMetric.key) and for what it is read.
  addedKey?: string | undefined;
  addedScope?: CloudAddedMetricScope | undefined;
  // Set when it cannot be added, and why.
  block?: CloudPublishedMetricBlock | undefined;
}

export interface CloudPublishedMetricsListing {
  provider: string;
  resourceType: string;
  // Key metrics first, then what was added, then the rest, each by name.
  metrics: Array<CloudPublishedMetric>;
  /*
   * What an addition's cost is worked out from: the resources of its type
   * the connection reads, and how often it reads.
   */
  resourcesOfType: number;
  readIntervalInMinutes: number;
  /*
   * Azure: the metrics the resource's minute call reads now - the key
   * metrics it publishes and what was added - and whether it has a
   * five-minute call (an App Service app's health check) an addition kept
   * at five minutes can ride in.
   */
  azureMetricsInCall?: number | undefined;
  azureHasFiveMinuteCall?: boolean | undefined;
  // The additions that apply to the resource now, its type's and its own.
  addedForResource: number;
  // Whether the person asking may add and remove (a project owner or admin).
  canEdit: boolean;
}

function readText(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/*
 * A listed metric's unit as the list shows it: as its cloud writes it, but
 * nothing for a cloud's own word for no unit - CloudWatch's "None", Azure
 * Monitor's "Unspecified" - which is not one (#9809).
 */
export function getCloudPublishedMetricUnitText(unit: string): string {
  const trimmed: string = (unit || "").trim();

  return ["none", "unspecified"].includes(trimmed.toLowerCase()) ? "" : trimmed;
}

function readMetric(value: unknown): CloudPublishedMetric | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const raw: Record<string, unknown> = value as Record<string, unknown>;
  const name: string = readText(raw["name"]);
  const status: string = readText(raw["status"]);

  if (
    !name ||
    !(Object.values(CloudPublishedMetricStatus) as Array<string>).includes(
      status,
    )
  ) {
    return null;
  }

  const metric: CloudPublishedMetric = {
    name,
    unit: readText(raw["unit"]),
    aggregation: readText(raw["aggregation"]),
    status: status as CloudPublishedMetricStatus,
  };

  for (const field of [
    "displayName",
    "description",
    "namespace",
    "grain",
    "addedKey",
    "addedSplitBy",
  ] as const) {
    const text: string = readText(raw[field]);

    if (text) {
      metric[field] = text;
    }
  }

  const scope: string = readText(raw["addedScope"]);

  if ((Object.values(CloudAddedMetricScope) as Array<string>).includes(scope)) {
    metric.addedScope = scope as CloudAddedMetricScope;
  }

  const block: string = readText(raw["block"]);

  if (
    (Object.values(CloudPublishedMetricBlock) as Array<string>).includes(block)
  ) {
    metric.block = block as CloudPublishedMetricBlock;
  }

  if (Array.isArray(raw["splits"])) {
    metric.splits = (raw["splits"] as Array<unknown>)
      .map((item: unknown): CloudPublishedMetricSplit | null => {
        if (!item || typeof item !== "object" || Array.isArray(item)) {
          return null;
        }

        const split: Record<string, unknown> = item as Record<string, unknown>;
        const splitName: string = readText(split["name"]);

        if (!splitName) {
          return null;
        }

        const displayName: string = readText(split["displayName"]);
        const values: unknown = split["values"];
        const learnedValues: unknown = split["learnedValuesPerResource"];
        const isLearnedFromEveryValue: boolean =
          split["isLearnedFromEveryValue"] === true;

        return {
          name: splitName,
          ...(displayName && displayName !== splitName ? { displayName } : {}),
          ...(typeof values === "number" &&
          Number.isFinite(values) &&
          values >= 0
            ? { values: Math.floor(values) }
            : {}),
          ...(isLearnedFromEveryValue ? { isLearnedFromEveryValue: true } : {}),
          ...(isLearnedFromEveryValue &&
          typeof learnedValues === "number" &&
          Number.isFinite(learnedValues) &&
          learnedValues >= 1
            ? { learnedValuesPerResource: Math.ceil(learnedValues) }
            : {}),
        };
      })
      .filter(
        (
          item: CloudPublishedMetricSplit | null,
        ): item is CloudPublishedMetricSplit => {
          return item !== null;
        },
      );
  }

  if (raw["isSplitRequired"] === true) {
    metric.isSplitRequired = true;
  }

  if (Array.isArray(raw["dimensions"])) {
    metric.dimensions = (raw["dimensions"] as Array<unknown>)
      .map((item: unknown): CloudAddedMetricDimension | null => {
        if (!item || typeof item !== "object" || Array.isArray(item)) {
          return null;
        }

        const dimension: Record<string, unknown> = item as Record<
          string,
          unknown
        >;
        const dimensionName: string = readText(dimension["name"]);

        return dimensionName
          ? { name: dimensionName, value: readText(dimension["value"]) }
          : null;
      })
      .filter(
        (
          item: CloudAddedMetricDimension | null,
        ): item is CloudAddedMetricDimension => {
          return item !== null;
        },
      );
  }

  return metric;
}

function readCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : 0;
}

// The server's answer, read defensively; null when it is not one.
export function readCloudPublishedMetricsListing(
  value: unknown,
): CloudPublishedMetricsListing | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const raw: Record<string, unknown> = value as Record<string, unknown>;

  if (!Array.isArray(raw["metrics"])) {
    return null;
  }

  const listing: CloudPublishedMetricsListing = {
    provider: readText(raw["provider"]),
    resourceType: readText(raw["resourceType"]),
    metrics: (raw["metrics"] as Array<unknown>)
      .map(readMetric)
      .filter(
        (
          metric: CloudPublishedMetric | null,
        ): metric is CloudPublishedMetric => {
          return metric !== null;
        },
      ),
    resourcesOfType: readCount(raw["resourcesOfType"]),
    readIntervalInMinutes: Math.max(1, readCount(raw["readIntervalInMinutes"])),
    addedForResource: readCount(raw["addedForResource"]),
    canEdit: raw["canEdit"] === true,
  };

  if (typeof raw["azureMetricsInCall"] === "number") {
    listing.azureMetricsInCall = readCount(raw["azureMetricsInCall"]);
  }

  if (raw["azureHasFiveMinuteCall"] === true) {
    listing.azureHasFiveMinuteCall = true;
  }

  return listing;
}

/*
 * The listing's metrics in the order the page lists them: what was added
 * first (what a person comes back to remove), then what can be added, then
 * what cannot, then the key metrics read already - each by its name in
 * words, else its own.
 */
export function sortCloudPublishedMetrics(
  metrics: ReadonlyArray<CloudPublishedMetric>,
): Array<CloudPublishedMetric> {
  const rank: (metric: CloudPublishedMetric) => number = (
    metric: CloudPublishedMetric,
  ): number => {
    if (metric.status === CloudPublishedMetricStatus.Added) {
      return 0;
    }

    if (metric.status === CloudPublishedMetricStatus.Key) {
      return 3;
    }

    return metric.block ? 2 : 1;
  };

  return [...metrics].sort(
    (a: CloudPublishedMetric, b: CloudPublishedMetric): number => {
      const byRank: number = rank(a) - rank(b);

      if (byRank !== 0) {
        return byRank;
      }

      const nameA: string = (a.displayName || a.name).toLowerCase();
      const nameB: string = (b.displayName || b.name).toLowerCase();

      return nameA < nameB ? -1 : nameA > nameB ? 1 : 0;
    },
  );
}
