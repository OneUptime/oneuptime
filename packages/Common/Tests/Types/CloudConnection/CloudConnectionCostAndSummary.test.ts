import { CloudProvider } from "../../../Types/Cloud/CloudPlatform";
import {
  AWS_GET_METRIC_DATA_USD_PER_THOUSAND_METRICS,
  AZURE_FREE_METRIC_READS_PER_SUBSCRIPTION,
  AZURE_USD_PER_THOUSAND_METRIC_READS,
  CloudConnectionCostEstimate,
  GCP_FREE_TIME_SERIES_PER_MONTH,
  GCP_USD_PER_MILLION_TIME_SERIES,
  countKeyMetrics,
  countRetiredMetrics,
  estimateCloudConnectionCost,
  getAzureFiveMinuteReadsPerMonth,
  getReadsPerMonth,
} from "../../../Types/CloudConnection/CloudConnectionCost";
import {
  CLOUD_CONNECTION_SUMMARY_TOP,
  CloudConnectionFailureKind,
  CloudConnectionReadSummary,
  countCloudConnectionValues,
  readCloudConnectionReadSummary,
} from "../../../Types/CloudConnection/CloudConnectionTest";
import { LlmConnectionFailureKind } from "../../../Types/LlmObservability/LlmConnectionTest";
import { describe, expect, test } from "@jest/globals";

/*
 * What reading a connection costs in the customer's own cloud bill, at
 * each cloud's list price and free allowance - shown before a connection
 * is made - and the read summary the list shows, read back from the
 * connection however it was stored.
 */

describe("reads per month", () => {
  test("30 days of reads at the interval", () => {
    expect(getReadsPerMonth(5)).toBe(8640);
    expect(getReadsPerMonth(10)).toBe(4320);
    expect(getReadsPerMonth(60)).toBe(720);
    // Never divided by zero or less.
    expect(getReadsPerMonth(0)).toBe(43200);
  });
});

describe("key metrics per read", () => {
  test("AWS counts each type's namespace's key metrics", () => {
    // EC2: 7 key metrics; RDS: 12.
    expect(
      countKeyMetrics({
        provider: CloudProvider.AWS,
        resourceTypes: [
          { type: "AWS::EC2::Instance", count: 10 },
          { type: "AWS::RDS::DBInstance", count: 2 },
        ],
      }),
    ).toBe(10 * 7 + 2 * 12);
  });

  test("a type with no key metrics adds nothing", () => {
    expect(
      countKeyMetrics({
        provider: CloudProvider.Azure,
        resourceTypes: [
          { type: "Microsoft.Network/virtualNetworks", count: 9 },
        ],
      }),
    ).toBe(0);
    expect(
      countKeyMetrics({
        provider: CloudProvider.GCP,
        resourceTypes: [{ type: "bigquery_dataset", count: 9 }],
      }),
    ).toBe(0);
  });
});

describe("the monthly estimate", () => {
  test("AWS: GetMetricData's price for every key metric of every read, with no free allowance", () => {
    const estimate: CloudConnectionCostEstimate = estimateCloudConnectionCost({
      provider: CloudProvider.AWS,
      resourceTypes: [{ type: "AWS::EC2::Instance", count: 100 }],
      readIntervalInMinutes: 10,
    });

    expect(estimate.monthlyUnits).toBe(100 * 7 * 4320);
    expect(estimate.monthlyCostUsd).toBeCloseTo(
      ((100 * 7 * 4320) / 1000) * AWS_GET_METRIC_DATA_USD_PER_THOUSAND_METRICS,
      6,
    );
    /*
     * About $30 a month for a hundred instances read every ten minutes, at
     * most: an instance that is not burstable has no CPU credits to read.
     */
    expect(estimate.monthlyCostUsd).toBeCloseTo(30.24, 2);
  });

  test("AWS read less often costs less", () => {
    const often: CloudConnectionCostEstimate = estimateCloudConnectionCost({
      provider: CloudProvider.AWS,
      resourceTypes: [{ type: "AWS::Lambda::Function", count: 10 }],
      readIntervalInMinutes: 5,
    });
    const seldom: CloudConnectionCostEstimate = estimateCloudConnectionCost({
      provider: CloudProvider.AWS,
      resourceTypes: [{ type: "AWS::Lambda::Function", count: 10 }],
      readIntervalInMinutes: 60,
    });

    expect(seldom.monthlyCostUsd).toBeCloseTo(often.monthlyCostUsd / 12, 6);
  });

  test("Azure: one read per resource with metrics, free up to a million a month per subscription", () => {
    const small: CloudConnectionCostEstimate = estimateCloudConnectionCost({
      provider: CloudProvider.Azure,
      resourceTypes: [
        { type: "Microsoft.Compute/virtualMachines", count: 100 },
        // No key metrics: listed, not read.
        { type: "Microsoft.Network/virtualNetworks", count: 50 },
      ],
      readIntervalInMinutes: 5,
      accounts: 1,
    });

    expect(small.monthlyUnits).toBe(100 * 8640);
    expect(small.monthlyCostUsd).toBe(0);

    const large: CloudConnectionCostEstimate = estimateCloudConnectionCost({
      provider: CloudProvider.Azure,
      resourceTypes: [{ type: "Microsoft.Web/sites", count: 500 }],
      readIntervalInMinutes: 5,
      accounts: 1,
    });

    // An app's health check is one more read every 15 minutes.
    expect(large.monthlyCostUsd).toBeCloseTo(
      ((500 * (8640 + 2880) - AZURE_FREE_METRIC_READS_PER_SUBSCRIPTION) /
        1000) *
        AZURE_USD_PER_THOUSAND_METRIC_READS,
      6,
    );
  });

  /*
   * A resource whose type has metrics Azure Monitor keeps at five minutes,
   * marked as earning their call (an App Service app's health check, a
   * Cosmos DB account's storage), is read in a five-minute call every 15
   * minutes beside its minute call (#9566): a third of a call more a read
   * at the default 5 minutes. Every other type costs what it did.
   */
  test("Azure: a type with five-minute metrics costs one more read every 15 minutes, and no other type more", () => {
    expect(getAzureFiveMinuteReadsPerMonth(5)).toBe(2880);
    // Read every 10 minutes: 15 minutes of them are there every other read.
    expect(getAzureFiveMinuteReadsPerMonth(10)).toBe(2160);
    expect(getAzureFiveMinuteReadsPerMonth(15)).toBe(2880);
    expect(getAzureFiveMinuteReadsPerMonth(30)).toBe(1440);
    expect(getAzureFiveMinuteReadsPerMonth(60)).toBe(720);

    const sites: CloudConnectionCostEstimate = estimateCloudConnectionCost({
      provider: CloudProvider.Azure,
      resourceTypes: [
        { type: "Microsoft.Web/sites", count: 100 },
        { type: "Microsoft.DocumentDB/databaseAccounts", count: 10 },
        { type: "Microsoft.Compute/virtualMachines", count: 50 },
      ],
      readIntervalInMinutes: 5,
      accounts: 1,
    });

    expect(sites.monthlyUnits).toBe(160 * 8640 + 110 * 2880);

    // A virtual machine and a Static Web App cost one read each, as before.
    expect(
      estimateCloudConnectionCost({
        provider: CloudProvider.Azure,
        resourceTypes: [
          { type: "Microsoft.Compute/virtualMachines", count: 50 },
          { type: "Microsoft.Web/staticSites", count: 50 },
        ],
        readIntervalInMinutes: 5,
        accounts: 1,
      }).monthlyUnits,
    ).toBe(100 * 8640);
  });

  test("Azure: each subscription has its own allowance", () => {
    const twoSubscriptions: CloudConnectionCostEstimate =
      estimateCloudConnectionCost({
        provider: CloudProvider.Azure,
        resourceTypes: [{ type: "Microsoft.Web/sites", count: 150 }],
        readIntervalInMinutes: 5,
        accounts: 2,
      });

    // More than one subscription's allowance, less than two's.
    expect(150 * (8640 + 2880)).toBeGreaterThan(
      AZURE_FREE_METRIC_READS_PER_SUBSCRIPTION,
    );
    expect(150 * (8640 + 2880)).toBeLessThan(
      2 * AZURE_FREE_METRIC_READS_PER_SUBSCRIPTION,
    );
    expect(twoSubscriptions.monthlyCostUsd).toBe(0);
  });

  test("Google Cloud: per time series read, free up to a million a month", () => {
    const small: CloudConnectionCostEstimate = estimateCloudConnectionCost({
      provider: CloudProvider.GCP,
      resourceTypes: [{ type: "gce_instance", count: 10 }],
      readIntervalInMinutes: 5,
    });

    expect(small.monthlyUnits).toBe(10 * 9 * 8640);
    expect(small.monthlyCostUsd).toBe(0);

    const large: CloudConnectionCostEstimate = estimateCloudConnectionCost({
      provider: CloudProvider.GCP,
      resourceTypes: [{ type: "gce_instance", count: 200 }],
      readIntervalInMinutes: 5,
    });

    expect(large.monthlyCostUsd).toBeCloseTo(
      ((200 * 9 * 8640 - GCP_FREE_TIME_SERIES_PER_MONTH) / 1000000) *
        GCP_USD_PER_MILLION_TIME_SERIES,
      6,
    );
  });

  /*
   * A Pub/Sub topic's publish operations are deprecated (#9565) but still
   * read, so a monitor built on them keeps working: a time series a topic
   * a read beside its 3 key metrics, which the estimate counts too.
   */
  test("Google Cloud: a deprecated metric still read for its monitors is a series a read too", () => {
    const topics: Array<{ type: string; count: number }> = [
      { type: "pubsub_topic", count: 10 },
    ];

    expect(
      countKeyMetrics({ provider: CloudProvider.GCP, resourceTypes: topics }),
    ).toBe(10 * 3);
    expect(
      countRetiredMetrics({
        provider: CloudProvider.GCP,
        resourceTypes: topics,
      }),
    ).toBe(10);
    expect(
      estimateCloudConnectionCost({
        provider: CloudProvider.GCP,
        resourceTypes: topics,
        readIntervalInMinutes: 5,
      }).monthlyUnits,
    ).toBe(10 * (3 + 1) * 8640);

    // A type with none adds nothing; Azure's ride in their resource's call.
    expect(
      countRetiredMetrics({
        provider: CloudProvider.GCP,
        resourceTypes: [{ type: "gce_instance", count: 10 }],
      }),
    ).toBe(0);
    expect(
      countRetiredMetrics({
        provider: CloudProvider.Azure,
        resourceTypes: [
          { type: "Microsoft.DocumentDB/databaseAccounts", count: 10 },
        ],
      }),
    ).toBe(0);
  });
});

describe("the read summary", () => {
  test("a stored summary is read back with every field typed", () => {
    const summary: CloudConnectionReadSummary | undefined =
      readCloudConnectionReadSummary({
        status: "partial",
        accounts: ["123456789012", 5, ""],
        resourceCount: 42,
        resourceTypes: [
          { type: "AWS::EC2::Instance", count: 40 },
          { type: "", count: 1 },
          { type: "AWS::S3::Bucket", count: 0 },
          "nonsense",
        ],
        regions: [{ region: "us-east-1", count: 42 }],
        newResources: 2,
        archivedResources: -1,
        pointsWritten: 840,
        changesRecorded: 7,
        requestCount: 31,
        warnings: ["one", 2],
        failureKind: "rate-limited",
        durationMs: 1200,
        finishedAt: "2026-10-21T10:00:00.000Z",
      });

    expect(summary).toEqual({
      status: "partial",
      accounts: ["123456789012"],
      resourceCount: 42,
      resourceTypes: [{ type: "AWS::EC2::Instance", count: 40 }],
      regions: [{ region: "us-east-1", count: 42 }],
      newResources: 2,
      archivedResources: 0,
      pointsWritten: 840,
      changesRecorded: 7,
      requestCount: 31,
      warnings: ["one"],
      failureKind: CloudConnectionFailureKind.RateLimited,
      durationMs: 1200,
      finishedAt: "2026-10-21T10:00:00.000Z",
    });
  });

  test("nothing, or a result of an unknown status, is no summary", () => {
    expect(readCloudConnectionReadSummary(undefined)).toBeUndefined();
    expect(readCloudConnectionReadSummary(null)).toBeUndefined();
    expect(readCloudConnectionReadSummary({ status: "done" })).toBeUndefined();
  });

  test("an unknown failure kind is left out", () => {
    expect(
      readCloudConnectionReadSummary({ status: "failed", failureKind: "boom" })
        ?.failureKind,
    ).toBeUndefined();
  });

  test("the failure kinds are the AI connections' own", () => {
    expect(CloudConnectionFailureKind).toBe(LlmConnectionFailureKind);
  });
});

describe("counting values", () => {
  test("most first, then by name, at most CLOUD_CONNECTION_SUMMARY_TOP", () => {
    expect(
      countCloudConnectionValues(["b", "a", "b", "", "c", "a", "b"]),
    ).toEqual([
      { value: "b", count: 3 },
      { value: "a", count: 2 },
      { value: "c", count: 1 },
    ]);

    const many: Array<string> = [];
    for (let index: number = 0; index < 30; index++) {
      many.push(`region-${String(index).padStart(2, "0")}`);
    }

    expect(countCloudConnectionValues(many)).toHaveLength(
      CLOUD_CONNECTION_SUMMARY_TOP,
    );
  });
});
