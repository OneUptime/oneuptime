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
