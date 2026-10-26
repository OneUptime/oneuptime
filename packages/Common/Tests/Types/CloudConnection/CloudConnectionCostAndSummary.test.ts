import { CloudProvider } from "../../../Types/Cloud/CloudPlatform";
import {
  AWS_GET_METRIC_DATA_USD_PER_THOUSAND_METRICS,
  AZURE_FREE_METRIC_READS_PER_SUBSCRIPTION,
  AZURE_USD_PER_THOUSAND_METRIC_READS,
  CloudConnectionCostEstimate,
  GCP_FREE_TIME_SERIES_PER_MONTH,
  GCP_USD_PER_MILLION_TIME_SERIES,
  countKeyMetrics,
  estimateCloudConnectionCost,
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
    // EC2: 4 key metrics; RDS: 6.
    expect(
      countKeyMetrics({
        provider: CloudProvider.AWS,
        resourceTypes: [
          { type: "AWS::EC2::Instance", count: 10 },
          { type: "AWS::RDS::DBInstance", count: 2 },
        ],
      }),
    ).toBe(10 * 4 + 2 * 6);
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

    expect(estimate.monthlyUnits).toBe(100 * 4 * 4320);
    expect(estimate.monthlyCostUsd).toBeCloseTo(
      ((100 * 4 * 4320) / 1000) * AWS_GET_METRIC_DATA_USD_PER_THOUSAND_METRICS,
      6,
    );
    // About $17 a month for a hundred instances read every ten minutes.
    expect(estimate.monthlyCostUsd).toBeCloseTo(17.28, 2);
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

    expect(large.monthlyCostUsd).toBeCloseTo(
      ((500 * 8640 - AZURE_FREE_METRIC_READS_PER_SUBSCRIPTION) / 1000) *
        AZURE_USD_PER_THOUSAND_METRIC_READS,
      6,
    );
  });

  test("Azure: each subscription has its own allowance", () => {
    const twoSubscriptions: CloudConnectionCostEstimate =
      estimateCloudConnectionCost({
        provider: CloudProvider.Azure,
        resourceTypes: [{ type: "Microsoft.Web/sites", count: 200 }],
        readIntervalInMinutes: 5,
        accounts: 2,
      });

    expect(200 * 8640).toBeLessThan(
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

    expect(small.monthlyUnits).toBe(10 * 3 * 8640);
    expect(small.monthlyCostUsd).toBe(0);

    const large: CloudConnectionCostEstimate = estimateCloudConnectionCost({
      provider: CloudProvider.GCP,
      resourceTypes: [{ type: "gce_instance", count: 200 }],
      readIntervalInMinutes: 5,
    });

    expect(large.monthlyCostUsd).toBeCloseTo(
      ((200 * 3 * 8640 - GCP_FREE_TIME_SERIES_PER_MONTH) / 1000000) *
        GCP_USD_PER_MILLION_TIME_SERIES,
      6,
    );
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
