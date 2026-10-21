import { CloudProvider } from "../Cloud/CloudPlatform";
import {
  AZURE_MAX_METRICS_PER_RESOURCE,
  getKeyMetricCount,
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
 *     read.
 *   - Google Cloud: Cloud Monitoring's first 1,000,000 time series read a
 *     month per billing account are free, then $0.50 per million. Each key
 *     metric of each resource is one time series per read.
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

    for (const entry of data.resourceTypes) {
      if (getKeyMetricCount(CloudProvider.Azure, entry.type) > 0) {
        resourcesWithMetrics += entry.count;
      }
    }

    const units: number = resourcesWithMetrics * reads;
    const free: number =
      AZURE_FREE_METRIC_READS_PER_SUBSCRIPTION * Math.max(1, data.accounts || 1);

    return {
      monthlyUnits: units,
      monthlyCostUsd:
        (Math.max(0, units - free) / 1000) * AZURE_USD_PER_THOUSAND_METRIC_READS,
    };
  }

  const units: number = countKeyMetrics(data) * reads;

  return {
    monthlyUnits: units,
    monthlyCostUsd:
      (Math.max(0, units - GCP_FREE_TIME_SERIES_PER_MONTH) / 1000000) *
      GCP_USD_PER_MILLION_TIME_SERIES,
  };
}
