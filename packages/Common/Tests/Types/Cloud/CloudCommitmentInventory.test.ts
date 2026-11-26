import {
  CLOUD_COMMITMENT_PAYMENT_LABELS,
  CLOUD_COMMITMENT_SCOPE_LABELS,
  CLOUD_COMMITMENT_STATE_LABELS,
  CloudCommitmentPaymentOption,
  CloudCommitmentScope,
  CloudCommitmentState,
  getCloudCommitmentDaysLeft,
  getCloudCommitmentPurchaseUrl,
  isCloudCommitmentPaymentOption,
  isCloudCommitmentScope,
  isCloudCommitmentState,
  readCloudCommitmentFigures,
  readCloudCommitmentPaymentOption,
  readCloudCommitmentTermMonths,
} from "../../../Types/Cloud/CloudCommitmentInventory";
import { CloudCommitmentKind } from "../../../Types/Cloud/CloudCommitments";
import { describe, expect, test } from "@jest/globals";

/*
 * A commitment as each cloud writes it, as OneUptime keeps it (#11011):
 * its payment option, its term, its figures, the days it has left and
 * where it is bought again.
 */

describe("a payment option as each cloud writes it", () => {
  test("AWS's, Cost Optimization Hub's and Azure's words", () => {
    expect(readCloudCommitmentPaymentOption("All Upfront")).toBe(
      CloudCommitmentPaymentOption.AllUpfront,
    );
    expect(readCloudCommitmentPaymentOption("AllUpfront")).toBe(
      CloudCommitmentPaymentOption.AllUpfront,
    );
    expect(readCloudCommitmentPaymentOption("Partial Upfront")).toBe(
      CloudCommitmentPaymentOption.PartialUpfront,
    );
    expect(readCloudCommitmentPaymentOption("No Upfront")).toBe(
      CloudCommitmentPaymentOption.NoUpfront,
    );
    // Azure's billing plans.
    expect(readCloudCommitmentPaymentOption("Upfront")).toBe(
      CloudCommitmentPaymentOption.AllUpfront,
    );
    expect(readCloudCommitmentPaymentOption("Monthly")).toBe(
      CloudCommitmentPaymentOption.NoUpfront,
    );
    expect(readCloudCommitmentPaymentOption("no-upfront")).toBe(
      CloudCommitmentPaymentOption.NoUpfront,
    );
    expect(readCloudCommitmentPaymentOption("Heavy Utilization")).toBeNull();
    expect(readCloudCommitmentPaymentOption(undefined)).toBeNull();
  });

  test("each has a label, and only OneUptime's words are options", () => {
    for (const option of Object.values(CloudCommitmentPaymentOption)) {
      expect(CLOUD_COMMITMENT_PAYMENT_LABELS[option].length).toBeGreaterThan(0);
      expect(isCloudCommitmentPaymentOption(option)).toBe(true);
    }

    expect(isCloudCommitmentPaymentOption("All Upfront")).toBe(false);
  });
});

describe("a term as each cloud writes it", () => {
  test("in years, ISO 8601, Google's plans and seconds, as months", () => {
    expect(readCloudCommitmentTermMonths("1yr")).toBe(12);
    expect(readCloudCommitmentTermMonths("3 yr")).toBe(36);
    expect(readCloudCommitmentTermMonths("3 Years")).toBe(36);
    expect(readCloudCommitmentTermMonths("1")).toBe(12);
    expect(readCloudCommitmentTermMonths("P1Y")).toBe(12);
    expect(readCloudCommitmentTermMonths("P3Y")).toBe(36);
    expect(readCloudCommitmentTermMonths("P5Y")).toBe(60);
    expect(readCloudCommitmentTermMonths("P1M")).toBe(1);
    expect(readCloudCommitmentTermMonths("TWELVE_MONTH")).toBe(12);
    expect(readCloudCommitmentTermMonths("THIRTY_SIX_MONTH")).toBe(36);
    expect(readCloudCommitmentTermMonths("OneYear")).toBe(12);
    expect(readCloudCommitmentTermMonths("ThreeYears")).toBe(36);
    expect(readCloudCommitmentTermMonths(31536000)).toBe(12);
    expect(readCloudCommitmentTermMonths(94608000)).toBe(36);
    expect(readCloudCommitmentTermMonths(3)).toBe(36);
    expect(readCloudCommitmentTermMonths(36)).toBe(36);
  });

  test("anything else is no term", () => {
    expect(readCloudCommitmentTermMonths("")).toBeNull();
    expect(readCloudCommitmentTermMonths("forever")).toBeNull();
    expect(readCloudCommitmentTermMonths("12 years")).toBeNull();
    expect(readCloudCommitmentTermMonths(-1)).toBeNull();
    expect(readCloudCommitmentTermMonths(undefined)).toBeNull();
  });
});

describe("a commitment's figures as stored", () => {
  test("are read back; a figure its cloud does not say is nothing", () => {
    expect(
      readCloudCommitmentFigures({
        days: 30,
        commitmentCost: "7200",
        usedCost: 5040,
        unusedCost: null,
        coveredOnDemandCost: 7920,
        netSavings: "",
        weekCommitmentCost: 1680,
        weekUnusedCost: "x",
      }),
    ).toEqual({
      days: 30,
      commitmentCost: 7200,
      usedCost: 5040,
      unusedCost: null,
      coveredOnDemandCost: 7920,
      netSavings: null,
      weekCommitmentCost: 1680,
      weekUnusedCost: null,
    });
    expect(readCloudCommitmentFigures({})!.days).toBe(30);
    expect(readCloudCommitmentFigures(null)).toBeNull();
    expect(readCloudCommitmentFigures([])).toBeNull();
  });
});

describe("the days a commitment has left", () => {
  const NOW: Date = new Date("2026-11-20T12:00:00.000Z");

  test("whole days, counted as a person does", () => {
    expect(
      getCloudCommitmentDaysLeft({
        endsAt: new Date("2026-12-20T13:00:00.000Z"),
        now: NOW,
      }),
    ).toBe(30);
    expect(
      getCloudCommitmentDaysLeft({
        endsAt: new Date("2026-11-20T20:00:00.000Z"),
        now: NOW,
      }),
    ).toBe(0);
    expect(
      getCloudCommitmentDaysLeft({
        endsAt: new Date("2026-11-19T12:00:00.000Z"),
        now: NOW,
      }),
    ).toBe(-1);
  });
});

describe("where a commitment is bought again", () => {
  test("AWS's Savings Plans purchase page, and each service's reserved page in its Region", () => {
    expect(
      getCloudCommitmentPurchaseUrl({
        provider: "aws",
        kind: CloudCommitmentKind.SavingsPlans,
      }),
    ).toBe(
      "https://console.aws.amazon.com/costmanagement/home#/savings-plans/purchase",
    );
    expect(
      getCloudCommitmentPurchaseUrl({
        provider: "aws",
        kind: CloudCommitmentKind.Reservations,
        service: "Amazon Elastic Compute Cloud - Compute",
        region: "eu-west-1",
      }),
    ).toBe(
      "https://console.aws.amazon.com/ec2/home?region=eu-west-1#ReservedInstances:",
    );
    expect(
      getCloudCommitmentPurchaseUrl({
        provider: "aws",
        kind: CloudCommitmentKind.Reservations,
        service: "Amazon Relational Database Service (Standard)",
      }),
    ).toContain("/rds/home?region=us-east-1#reserved-instances:");
    expect(
      getCloudCommitmentPurchaseUrl({
        provider: "aws",
        kind: CloudCommitmentKind.Reservations,
        service: "Amazon ElastiCache",
      }),
    ).toContain("/elasticache/");
    expect(
      getCloudCommitmentPurchaseUrl({
        provider: "aws",
        kind: CloudCommitmentKind.Reservations,
        service: "Amazon OpenSearch Service",
      }),
    ).toContain("/aos/");
    expect(
      getCloudCommitmentPurchaseUrl({
        provider: "aws",
        kind: CloudCommitmentKind.Reservations,
        service: "Amazon Redshift",
      }),
    ).toContain("/redshiftv2/");
  });

  test("Azure's reservations and savings plans, and a Google Cloud project's commitments", () => {
    expect(
      getCloudCommitmentPurchaseUrl({
        provider: "azure",
        kind: CloudCommitmentKind.Reservations,
      }),
    ).toContain("Microsoft_Azure_Reservations");
    expect(
      getCloudCommitmentPurchaseUrl({
        provider: "azure",
        kind: CloudCommitmentKind.SavingsPlans,
      }),
    ).toContain("savingsPlanOrders");
    expect(
      getCloudCommitmentPurchaseUrl({
        provider: "gcp",
        kind: CloudCommitmentKind.CommittedUseDiscounts,
        accountId: "my project",
      }),
    ).toBe(
      "https://console.cloud.google.com/compute/commitments?project=my%20project",
    );
  });
});

describe("states and scopes", () => {
  test("each has a label, and only OneUptime's words are one", () => {
    for (const state of Object.values(CloudCommitmentState)) {
      expect(CLOUD_COMMITMENT_STATE_LABELS[state].length).toBeGreaterThan(0);
      expect(isCloudCommitmentState(state)).toBe(true);
    }

    for (const scope of Object.values(CloudCommitmentScope)) {
      expect(CLOUD_COMMITMENT_SCOPE_LABELS[scope].length).toBeGreaterThan(0);
      expect(isCloudCommitmentScope(scope)).toBe(true);
    }

    expect(isCloudCommitmentState("ACTIVE")).toBe(false);
    expect(isCloudCommitmentScope("Shared")).toBe(false);
  });
});
