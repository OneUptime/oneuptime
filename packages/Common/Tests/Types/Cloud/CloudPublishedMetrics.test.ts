import { describe, expect, test } from "@jest/globals";
import { CloudAddedMetricScope } from "../../../Types/Cloud/CloudAddedMetrics";
import { CloudProvider } from "../../../Types/Cloud/CloudPlatform";
import {
  CLOUD_PUBLISHED_METRIC_BLOCK_REASONS,
  CloudPublishedMetric,
  CloudPublishedMetricBlock,
  CloudPublishedMetricStatus,
  CloudPublishedMetricsListing,
  readCloudPublishedMetricsListing,
  sortCloudPublishedMetrics,
} from "../../../Types/Cloud/CloudPublishedMetrics";
import {
  AWS_GET_METRIC_DATA_USD_PER_THOUSAND_METRICS,
  AZURE_USD_PER_THOUSAND_METRIC_READS,
  GCP_USD_PER_MILLION_TIME_SERIES,
  estimateCloudAddedMetricCost,
  getAzureFiveMinuteReadsPerMonth,
  getReadsPerMonth,
} from "../../../Types/CloudConnection/CloudConnectionCost";

/*
 * What a cloud resource publishes beyond its key metrics (#9563): the
 * server's listing read defensively, the order the page lists it in, and
 * what one more metric costs a month in each cloud before it is added.
 */

function metric(
  overrides: Partial<CloudPublishedMetric> = {},
): CloudPublishedMetric {
  return {
    name: "AverageMemoryWorkingSet",
    unit: "Bytes",
    aggregation: "Average",
    status: CloudPublishedMetricStatus.Available,
    ...overrides,
  };
}

describe("reading the server's listing", () => {
  test("every field it carries", () => {
    const listing: CloudPublishedMetricsListing | null =
      readCloudPublishedMetricsListing({
        provider: "azure",
        resourceType: "Microsoft.Web/sites",
        metrics: [
          {
            name: "AverageMemoryWorkingSet",
            displayName: "Average memory working set",
            description: "The average memory used by the app.",
            unit: "Bytes",
            aggregation: "Average",
            grain: "PT1M",
            status: "added",
            addedKey: "type|microsoft.web/sites|||averagememoryworkingset",
            addedScope: "type",
          },
          {
            name: "SwapUsage",
            namespace: "AWS/RDS",
            unit: "",
            aggregation: "Average",
            dimensions: [
              { name: "DBInstanceIdentifier", value: "orders" },
              { value: "no name" },
            ],
            status: "available",
            block: "needs-dimension",
          },
        ],
        resourcesOfType: 186,
        readIntervalInMinutes: 5,
        azureMetricsInCall: 17,
        azureHasFiveMinuteCall: true,
        addedForResource: 2,
        canEdit: true,
      });

    expect(listing).toEqual({
      provider: "azure",
      resourceType: "Microsoft.Web/sites",
      metrics: [
        {
          name: "AverageMemoryWorkingSet",
          displayName: "Average memory working set",
          description: "The average memory used by the app.",
          unit: "Bytes",
          aggregation: "Average",
          grain: "PT1M",
          status: CloudPublishedMetricStatus.Added,
          addedKey: "type|microsoft.web/sites|||averagememoryworkingset",
          addedScope: CloudAddedMetricScope.Type,
        },
        {
          name: "SwapUsage",
          namespace: "AWS/RDS",
          unit: "",
          aggregation: "Average",
          dimensions: [{ name: "DBInstanceIdentifier", value: "orders" }],
          status: CloudPublishedMetricStatus.Available,
          block: CloudPublishedMetricBlock.NeedsDimension,
        },
      ],
      resourcesOfType: 186,
      readIntervalInMinutes: 5,
      azureMetricsInCall: 17,
      azureHasFiveMinuteCall: true,
      addedForResource: 2,
      canEdit: true,
    });
  });

  test("what is not a listing, or not a metric, is dropped; counts are never negative", () => {
    expect(readCloudPublishedMetricsListing(null)).toBeNull();
    expect(readCloudPublishedMetricsListing([])).toBeNull();
    expect(readCloudPublishedMetricsListing({ metrics: "x" })).toBeNull();

    const listing: CloudPublishedMetricsListing | null =
      readCloudPublishedMetricsListing({
        metrics: [
          null,
          { name: "", status: "available" },
          { name: "X", status: "made-up" },
          { name: "Kept", status: "key", addedScope: "galaxy", block: "x" },
        ],
        resourcesOfType: -3,
        readIntervalInMinutes: 0,
        canEdit: "yes",
      });

    expect(listing).toEqual({
      provider: "",
      resourceType: "",
      metrics: [
        {
          name: "Kept",
          unit: "",
          aggregation: "",
          status: CloudPublishedMetricStatus.Key,
        },
      ],
      resourcesOfType: 0,
      readIntervalInMinutes: 1,
      addedForResource: 0,
      canEdit: false,
    });
  });
});

describe("the order the page lists them in", () => {
  test("added first, then what can be added, then what cannot, then the key metrics read already, each by its name in words", () => {
    expect(
      sortCloudPublishedMetrics([
        metric({ name: "Key B", status: CloudPublishedMetricStatus.Key }),
        metric({ name: "zeta" }),
        metric({
          name: "Blocked",
          block: CloudPublishedMetricBlock.CoarseGrain,
        }),
        metric({ name: "Added", status: CloudPublishedMetricStatus.Added }),
        metric({ name: "b-name", displayName: "Alpha" }),
        metric({ name: "Key A", status: CloudPublishedMetricStatus.Key }),
      ]).map((item: CloudPublishedMetric): string => {
        return item.name;
      }),
    ).toEqual(["Added", "b-name", "zeta", "Blocked", "Key A", "Key B"]);
  });

  test("each reason a metric cannot be added is a sentence", () => {
    for (const block of Object.values(CloudPublishedMetricBlock)) {
      expect(CLOUD_PUBLISHED_METRIC_BLOCK_REASONS[block]).toMatch(/\.$/);
    }
  });
});

describe("what one more metric costs a month", () => {
  const reads: number = getReadsPerMonth(5);

  test("AWS: one more GetMetricData metric per resource each read, billed from the first", () => {
    expect(
      estimateCloudAddedMetricCost({
        provider: CloudProvider.AWS,
        resources: 1,
        readIntervalInMinutes: 5,
      }),
    ).toEqual({
      monthlyUnits: reads,
      monthlyCostUsd:
        (reads / 1000) * AWS_GET_METRIC_DATA_USD_PER_THOUSAND_METRICS,
      ridesInExistingCall: false,
    });
    expect(reads).toBe(8640);
    // For a type of 186 resources, 186 times as much.
    expect(
      estimateCloudAddedMetricCost({
        provider: CloudProvider.AWS,
        resources: 186,
        readIntervalInMinutes: 5,
      }).monthlyUnits,
    ).toBe(186 * reads);
  });

  test("Azure: nothing while it rides in the resource's minute call", () => {
    expect(
      estimateCloudAddedMetricCost({
        provider: CloudProvider.Azure,
        resources: 186,
        readIntervalInMinutes: 5,
        azureGrain: "PT1M",
        azureMetricsInCall: 19,
      }),
    ).toEqual({
      monthlyUnits: 0,
      monthlyCostUsd: 0,
      ridesInExistingCall: true,
    });
  });

  test("Azure: past 20 metrics, a call more per resource each read", () => {
    expect(
      estimateCloudAddedMetricCost({
        provider: CloudProvider.Azure,
        resources: 2,
        readIntervalInMinutes: 5,
        azureGrain: "PT1M",
        azureMetricsInCall: 20,
      }),
    ).toEqual({
      monthlyUnits: 2 * reads,
      monthlyCostUsd:
        ((2 * reads) / 1000) * AZURE_USD_PER_THOUSAND_METRIC_READS,
      ridesInExistingCall: false,
    });
  });

  test("Azure: kept at five minutes, nothing in a five-minute call the resource makes, else a call every 15 minutes", () => {
    expect(
      estimateCloudAddedMetricCost({
        provider: CloudProvider.Azure,
        resources: 1,
        readIntervalInMinutes: 5,
        azureGrain: "PT5M",
        azureHasFiveMinuteCall: true,
      }).ridesInExistingCall,
    ).toBe(true);
    expect(
      estimateCloudAddedMetricCost({
        provider: CloudProvider.Azure,
        resources: 1,
        readIntervalInMinutes: 5,
        azureGrain: "PT5M",
      }).monthlyUnits,
    ).toBe(getAzureFiveMinuteReadsPerMonth(5));
  });

  test("Azure: kept at an hour, a call an hour", () => {
    expect(
      estimateCloudAddedMetricCost({
        provider: CloudProvider.Azure,
        resources: 1,
        readIntervalInMinutes: 5,
        azureGrain: "PT1H",
      }).monthlyUnits,
    ).toBe(getReadsPerMonth(60));
  });

  test("Google Cloud: one more time series per resource each read", () => {
    expect(
      estimateCloudAddedMetricCost({
        provider: CloudProvider.GCP,
        resources: 3,
        readIntervalInMinutes: 5,
      }),
    ).toEqual({
      monthlyUnits: 3 * reads,
      monthlyCostUsd: ((3 * reads) / 1000000) * GCP_USD_PER_MILLION_TIME_SERIES,
      ridesInExistingCall: false,
    });
  });

  test("a longer read interval costs less; no resources cost nothing", () => {
    expect(
      estimateCloudAddedMetricCost({
        provider: CloudProvider.AWS,
        resources: 1,
        readIntervalInMinutes: 15,
      }).monthlyUnits,
    ).toBe(getReadsPerMonth(15));
    expect(
      estimateCloudAddedMetricCost({
        provider: CloudProvider.GCP,
        resources: 0,
        readIntervalInMinutes: 5,
      }).monthlyUnits,
    ).toBe(0);
  });
});
