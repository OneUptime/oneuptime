import {
  CLOUD_ADDED_METRIC_MAX_SPLIT_VALUES,
  GCP_SPLIT_LEARN_EVERY_MINUTES,
} from "../Cloud/CloudAddedMetrics";
import { CloudProvider } from "../Cloud/CloudPlatform";
import {
  AZURE_FIVE_MINUTE_READ_MINUTES,
  AZURE_MAX_METRICS_PER_RESOURCE,
  getGcpRetiredMetricCount,
  getKeyMetricCount,
  hasAzureFiveMinuteKeyMetrics,
} from "../Cloud/CloudKeyMetrics";
import { CloudConnectionTypeCount } from "./CloudConnectionTest";

/*
 * WHAT A CLOUD CONNECTION COSTS IN THE CUSTOMER'S OWN CLOUD BILL.
 *
 * OneUptime reads each cloud's monitoring API with the customer's access,
 * so the calls are billed to the customer's account, at the cloud's list
 * prices:
 *
 *   - AWS: CloudWatch's GetMetricData is $0.01 per 1,000 metrics read,
 *     with no free allowance. Each key metric of each resource is one
 *     metric per read. (ListMetrics is free within the first million API
 *     calls a month.)
 *   - Azure: Azure Monitor gives each subscription its first 1,000,000
 *     metric reads a month free, then $0.01 per 1,000. Each resource is one
 *     read, and a resource of a type with metrics read at five minutes (an
 *     App Service app's health check) one more every
 *     AZURE_FIVE_MINUTE_READ_MINUTES (getAzureFiveMinuteReadsPerMonth).
 *   - Google Cloud: Cloud Monitoring's first 1,000,000 time series read a
 *     month per billing account are free, then $0.50 per million. Each key
 *     metric of each resource is one time series per read, and so is each
 *     deprecated one still read for the monitors built on it (a Pub/Sub
 *     topic's publish operations, countRetiredMetrics). A VM's Ops Agent
 *     metrics are not counted: whether a VM runs the agent is not known
 *     before its first read, and one that does not costs nothing.
 *
 * Shown before a connection is made (the test) and on the docs page, which
 * a test holds to these figures.
 */

export const AWS_GET_METRIC_DATA_USD_PER_THOUSAND_METRICS: number = 0.01;
export const AZURE_FREE_METRIC_READS_PER_SUBSCRIPTION: number = 1000000;
export const AZURE_USD_PER_THOUSAND_METRIC_READS: number = 0.01;
export const GCP_FREE_TIME_SERIES_PER_MONTH: number = 1000000;
export const GCP_USD_PER_MILLION_TIME_SERIES: number = 0.5;

const MINUTES_PER_MONTH: number = 30 * 24 * 60;

export interface CloudConnectionCostEstimate {
  // What one month of reads asks the cloud for: metrics, reads or series.
  monthlyUnits: number;
  // In US dollars at the cloud's list price; 0 within a free allowance.
  monthlyCostUsd: number;
}

export function getReadsPerMonth(readIntervalInMinutes: number): number {
  return Math.ceil(MINUTES_PER_MONTH / Math.max(1, readIntervalInMinutes));
}

/*
 * The five-minute calls a month of one Azure resource whose type has
 * metrics read at five minutes: one each read that finds 15 minutes of
 * them there - every third read at the default 5 minutes, every other at
 * 10, and every read from 15 on.
 */
export function getAzureFiveMinuteReadsPerMonth(
  readIntervalInMinutes: number,
): number {
  const interval: number = Math.max(1, readIntervalInMinutes);

  return getReadsPerMonth(
    Math.ceil(AZURE_FIVE_MINUTE_READ_MINUTES / interval) * interval,
  );
}

// Key metrics read per read for these resources, by their types.
export function countKeyMetrics(data: {
  provider: CloudProvider;
  resourceTypes: Array<CloudConnectionTypeCount>;
}): number {
  let metrics: number = 0;

  for (const entry of data.resourceTypes) {
    const count: number = getKeyMetricCount(data.provider, entry.type);

    metrics +=
      entry.count *
      (data.provider === CloudProvider.Azure
        ? Math.min(AZURE_MAX_METRICS_PER_RESOURCE, count)
        : count);
  }

  return metrics;
}

/*
 * The deprecated metrics read per read for these resources beside their key
 * metrics, for the monitors built on them: on Google Cloud, each a time
 * series a resource (GcpTypeKeyMetrics.retired). An Azure type's ride in
 * its resource's one call, which costs the same with them.
 */
export function countRetiredMetrics(data: {
  provider: CloudProvider;
  resourceTypes: Array<CloudConnectionTypeCount>;
}): number {
  if (data.provider !== CloudProvider.GCP) {
    return 0;
  }

  let metrics: number = 0;

  for (const entry of data.resourceTypes) {
    metrics += entry.count * getGcpRetiredMetricCount(entry.type);
  }

  return metrics;
}

/*
 * WHAT ONE ADDED METRIC COSTS A MONTH (CloudAddedMetrics, #9563), shown
 * before it is added, for the resources it would be read for:
 *
 *   - AWS: one more metric each read per resource in GetMetricData, which
 *     bills every metric from the first;
 *   - Azure: nothing while it rides in a call the resource makes anyway -
 *     its minute call while that has fewer than 20 metrics, its five-minute
 *     call (every 15 minutes) for one kept at five minutes - else one more
 *     call per resource each time that grain is read, free within each
 *     subscription's first 1,000,000 calls a month;
 *   - Google Cloud: one more time series per resource each read, free
 *     within a billing account's first 1,000,000 a month.
 *
 * Split by a dimension (#9808), it is a series per value: on AWS a metric
 * read each, on Google Cloud a time series each - `seriesPerResource` of
 * them, the values the resource has, at most the cap - while Azure answers
 * every value in one call of its own, which never rides in the key
 * metrics' call: its filter would split those too.
 *
 * Google Cloud bills every series a call returns, so a split is read for
 * each resource's busiest values alone, which a PromQL topk learns once an
 * hour, returning those alone (#10076): a resource costs the cap's series a
 * read, and as many again each hour - at most, since one with fewer values
 * returns fewer (`isAtMost`).
 *
 * The cost is at the cloud's list price before any free allowance: whether
 * the allowance covers it depends on the rest of the account's use.
 */
export interface CloudAddedMetricCostEstimate {
  // The extra units a month: metrics read, calls, or time series.
  monthlyUnits: number;
  monthlyCostUsd: number;
  // Azure: it rides in a call the resource makes anyway, at no cost.
  ridesInExistingCall: boolean;
  // Google Cloud, split: the most it costs, a resource of fewer values costing less.
  isAtMost?: boolean | undefined;
}

// Google Cloud: the hourly learnings of a split's busiest values a month (#10076).
export function getGcpSplitLearnsPerMonth(): number {
  return Math.ceil(MINUTES_PER_MONTH / GCP_SPLIT_LEARN_EVERY_MINUTES);
}

// Minutes between two of a grain's calls (an Azure ISO 8601 grain).
const AZURE_GRAIN_MINUTES: Readonly<Record<string, number>> = {
  PT1M: 1,
  PT5M: 5,
  PT15M: 15,
  PT30M: 30,
  PT1H: 60,
};

export function estimateCloudAddedMetricCost(data: {
  provider: CloudProvider;
  // The resources it would be read for: one, or every one of its type.
  resources: number;
  readIntervalInMinutes: number;
  // Azure: the grain it is read at, and the call it would ride in.
  azureGrain?: string | undefined;
  azureMetricsInCall?: number | undefined;
  azureHasFiveMinuteCall?: boolean | undefined;
  /*
   * Read split by a dimension (#9808): whether it is, and the series of
   * each resource it reads, one a value. Unsplit, one.
   */
  isSplit?: boolean | undefined;
  seriesPerResource?: number | undefined;
}): CloudAddedMetricCostEstimate {
  const resources: number = Math.max(0, data.resources);
  const reads: number = getReadsPerMonth(data.readIntervalInMinutes);
  // A split reads at most the cap's values of a resource, whatever it has.
  const series: number = data.isSplit
    ? Math.min(
        CLOUD_ADDED_METRIC_MAX_SPLIT_VALUES,
        Math.max(1, Math.floor(data.seriesPerResource || 1)),
      )
    : 1;

  if (data.provider === CloudProvider.AWS) {
    const units: number = resources * series * reads;

    return {
      monthlyUnits: units,
      monthlyCostUsd:
        (units / 1000) * AWS_GET_METRIC_DATA_USD_PER_THOUSAND_METRICS,
      ridesInExistingCall: false,
    };
  }

  if (data.provider === CloudProvider.Azure) {
    const grain: string = (data.azureGrain || "PT1M").toUpperCase();
    const isFiveMinutes: boolean = grain === "PT5M";
    const ridesInMinuteCall: boolean =
      grain === "PT1M" &&
      (data.azureMetricsInCall || 0) < AZURE_MAX_METRICS_PER_RESOURCE;

    if (
      !data.isSplit &&
      (ridesInMinuteCall || (isFiveMinutes && data.azureHasFiveMinuteCall))
    ) {
      return { monthlyUnits: 0, monthlyCostUsd: 0, ridesInExistingCall: true };
    }

    const callsPerResource: number = isFiveMinutes
      ? getAzureFiveMinuteReadsPerMonth(data.readIntervalInMinutes)
      : getReadsPerMonth(
          Math.max(data.readIntervalInMinutes, AZURE_GRAIN_MINUTES[grain] || 1),
        );
    const units: number = resources * callsPerResource;

    return {
      monthlyUnits: units,
      monthlyCostUsd: (units / 1000) * AZURE_USD_PER_THOUSAND_METRIC_READS,
      ridesInExistingCall: false,
    };
  }

  // A split's reads, and its hourly learning of each resource's busiest values.
  const units: number = data.isSplit
    ? resources * series * (reads + getGcpSplitLearnsPerMonth())
    : resources * reads;

  return {
    monthlyUnits: units,
    monthlyCostUsd: (units / 1000000) * GCP_USD_PER_MILLION_TIME_SERIES,
    ridesInExistingCall: false,
    ...(data.isSplit ? { isAtMost: true } : {}),
  };
}

export function estimateCloudConnectionCost(data: {
  provider: CloudProvider;
  resourceTypes: Array<CloudConnectionTypeCount>;
  readIntervalInMinutes: number;
  // Azure: the subscriptions read; each has its own free allowance.
  accounts?: number | undefined;
}): CloudConnectionCostEstimate {
  const reads: number = getReadsPerMonth(data.readIntervalInMinutes);

  if (data.provider === CloudProvider.AWS) {
    const units: number = countKeyMetrics(data) * reads;

    return {
      monthlyUnits: units,
      monthlyCostUsd:
        (units / 1000) * AWS_GET_METRIC_DATA_USD_PER_THOUSAND_METRICS,
    };
  }

  if (data.provider === CloudProvider.Azure) {
    let resourcesWithMetrics: number = 0;
    let resourcesWithFiveMinuteMetrics: number = 0;

    for (const entry of data.resourceTypes) {
      if (getKeyMetricCount(CloudProvider.Azure, entry.type) > 0) {
        resourcesWithMetrics += entry.count;
      }

      if (hasAzureFiveMinuteKeyMetrics(entry.type)) {
        resourcesWithFiveMinuteMetrics += entry.count;
      }
    }

    const units: number =
      resourcesWithMetrics * reads +
      resourcesWithFiveMinuteMetrics *
        getAzureFiveMinuteReadsPerMonth(data.readIntervalInMinutes);
    const free: number =
      AZURE_FREE_METRIC_READS_PER_SUBSCRIPTION *
      Math.max(1, data.accounts || 1);

    return {
      monthlyUnits: units,
      monthlyCostUsd:
        (Math.max(0, units - free) / 1000) *
        AZURE_USD_PER_THOUSAND_METRIC_READS,
    };
  }

  const units: number =
    (countKeyMetrics(data) + countRetiredMetrics(data)) * reads;

  return {
    monthlyUnits: units,
    monthlyCostUsd:
      (Math.max(0, units - GCP_FREE_TIME_SERIES_PER_MONTH) / 1000000) *
      GCP_USD_PER_MILLION_TIME_SERIES,
  };
}
