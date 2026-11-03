import { describe, expect, test } from "@jest/globals";
import {
  CLOUD_COST_DIMENSION_OPTIONS,
  CLOUD_COST_PERIOD_OPTIONS,
  CloudCostPeriod,
  NO_REGION,
  NO_RESOURCE,
  UNKNOWN_ACCOUNT,
  UNNAMED_SERVICE,
  getCloudCostPeriodWindow,
  getCloudCostResourceName,
  getCloudCostShareLabel,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Cloud/CloudCostBreakdown";

/*
 * How the Costs pages break the spend down: the three periods in whole UTC
 * days as the clouds bill them, and the name each entry is drawn with - an
 * account by its name, a resource by the last part of the id it is billed
 * under, a cost with no value for the dimension said so.
 */

const NOW: Date = new Date("2026-03-01T05:30:00.000Z");

describe("the periods", () => {
  test("this month: from its first UTC day to now", () => {
    expect(getCloudCostPeriodWindow(CloudCostPeriod.ThisMonth, NOW)).toEqual({
      start: new Date("2026-03-01T00:00:00.000Z"),
      end: NOW,
    });
  });

  test("last month: the whole of it, to its last millisecond, February's 28 days included", () => {
    expect(getCloudCostPeriodWindow(CloudCostPeriod.LastMonth, NOW)).toEqual({
      start: new Date("2026-02-01T00:00:00.000Z"),
      end: new Date("2026-02-28T23:59:59.999Z"),
    });

    // January from February, across a year.
    expect(
      getCloudCostPeriodWindow(
        CloudCostPeriod.LastMonth,
        new Date("2026-01-15T12:00:00.000Z"),
      ).start,
    ).toEqual(new Date("2025-12-01T00:00:00.000Z"));
  });

  test("the last 30 days: today and the 29 before it", () => {
    const window: { start: Date; end: Date } = getCloudCostPeriodWindow(
      CloudCostPeriod.Last30Days,
      NOW,
    );

    expect(window.start).toEqual(new Date("2026-01-31T00:00:00.000Z"));
    expect(window.end).toEqual(NOW);
  });

  test("each period and each dimension is offered, in English to translate", () => {
    expect(
      CLOUD_COST_PERIOD_OPTIONS.map((option: { value: string }) => {
        return option.value;
      }),
    ).toEqual(Object.values(CloudCostPeriod));
    expect(
      CLOUD_COST_DIMENSION_OPTIONS.map(
        (option: { label: string; value: string }) => {
          return [option.label, option.value];
        },
      ),
    ).toEqual([
      ["Services", "service"],
      ["Regions", "region"],
      ["Accounts", "cloudAccountId"],
      ["Resources", "resourceId"],
    ]);
  });
});

describe("what an entry is called", () => {
  test("a resource by the last part of the id its cloud bills it under", () => {
    expect(
      getCloudCostResourceName(
        "/subscriptions/0000/resourceGroups/web/providers/Microsoft.Compute/virtualMachines/web-1",
      ),
    ).toBe("web-1");
    expect(
      getCloudCostResourceName(
        "//compute.googleapis.com/projects/shop/zones/europe-west1-b/instances/api-2/",
      ),
    ).toBe("api-2");
    expect(
      getCloudCostResourceName(
        "arn:aws:ec2:us-east-1:123456789012:instance/i-0abc",
      ),
    ).toBe("i-0abc");
    expect(getCloudCostResourceName("arn:aws:s3:::invoices-bucket")).toBe(
      "invoices-bucket",
    );
    expect(getCloudCostResourceName("i-0plain")).toBe("i-0plain");
    expect(getCloudCostResourceName("  ")).toBe("");
  });

  test("an account by its name, or said to be one since removed", () => {
    const names: Map<string, string> = new Map([["row-1", "Production"]]);

    expect(
      getCloudCostShareLabel({
        dimension: "cloudAccountId",
        key: "row-1",
        accountNames: names,
      }),
    ).toEqual({ label: "Production", isAsWritten: true });
    expect(
      getCloudCostShareLabel({
        dimension: "cloudAccountId",
        key: "row-gone",
        accountNames: names,
      }),
    ).toEqual({ label: UNKNOWN_ACCOUNT, isAsWritten: false });
  });

  test("a cost with no Region, resource or service is named so, to translate", () => {
    for (const [dimension, label] of [
      ["region", NO_REGION],
      ["resourceId", NO_RESOURCE],
      ["service", UNNAMED_SERVICE],
    ] as const) {
      expect(
        getCloudCostShareLabel({ dimension, key: "", accountNames: new Map() }),
      ).toEqual({ label, isAsWritten: false });
    }
  });

  test("a resource's name keeps the whole id under the pointer; a service or Region as written", () => {
    expect(
      getCloudCostShareLabel({
        dimension: "resourceId",
        key: "arn:aws:rds:us-east-1:1:db:orders",
        accountNames: new Map(),
      }),
    ).toEqual({
      label: "orders",
      isAsWritten: true,
      title: "arn:aws:rds:us-east-1:1:db:orders",
    });
    expect(
      getCloudCostShareLabel({
        dimension: "service",
        key: "Amazon Elastic Compute Cloud - Compute",
        accountNames: new Map(),
      }),
    ).toEqual({
      label: "Amazon Elastic Compute Cloud - Compute",
      isAsWritten: true,
    });
  });
});
