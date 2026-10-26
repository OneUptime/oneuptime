import { describe, expect, test } from "@jest/globals";
import {
  CLOUD_ACCOUNT_SUMMARY_MAX_ENTRIES,
  CloudAccountResourceSummary,
  readCloudAccountResourceSummary,
  summarizeCloudAccountResourceCounts,
  summarizeCloudAccountResources,
} from "../../../Types/Cloud/CloudAccountSummary";

/*
 * A cloud account's resources at a glance: how many, by type and by
 * Region, most first - from counts the database makes (any size of
 * account is one small read), or from rows - and read back safely from
 * what is stored.
 */

describe("an account's resources, summed from the database's counts", () => {
  test("adds the counts up by type and by Region, most first, then by name", () => {
    expect(
      summarizeCloudAccountResourceCounts([
        { type: "AWS::EC2::Instance", region: "eu-west-1", count: 1200 },
        { type: "AWS::EC2::Instance", region: "us-east-1", count: 300 },
        { type: "AWS::SQS::Queue", region: "eu-west-1", count: 40 },
        { type: "AWS::Lambda::Function", region: "us-east-1", count: 40 },
      ]),
    ).toEqual({
      resourceCount: 1580,
      types: [
        { type: "AWS::EC2::Instance", count: 1500 },
        { type: "AWS::Lambda::Function", count: 40 },
        { type: "AWS::SQS::Queue", count: 40 },
      ],
      regions: [
        { region: "eu-west-1", count: 1240 },
        { region: "us-east-1", count: 340 },
      ],
    });
  });

  test("a resource with no type or Region counts toward the total only", () => {
    const summary: CloudAccountResourceSummary =
      summarizeCloudAccountResourceCounts([
        { type: "", region: "", count: 3 },
        { type: "  ", region: "eu-west-1", count: 2 },
      ]);

    expect(summary.resourceCount).toBe(5);
    expect(summary.types).toEqual([]);
    expect(summary.regions).toEqual([{ region: "eu-west-1", count: 2 }]);
  });

  test("a count that is not a count is none", () => {
    expect(
      summarizeCloudAccountResourceCounts([
        { type: "a", region: "r", count: Number.NaN },
        { type: "b", region: "r", count: -4 },
        { type: "c", region: "r", count: 2.7 },
      ]),
    ).toEqual({
      resourceCount: 2,
      types: [{ type: "c", count: 2 }],
      regions: [{ region: "r", count: 2 }],
    });
  });

  test("names the first fifty types and Regions; the rest are counted, not named", () => {
    const counts: Array<{ type: string; region: string; count: number }> = [];

    for (let index: number = 0; index < 70; index++) {
      counts.push({
        type: `type-${index}`,
        region: `region-${index}`,
        count: 1,
      });
    }

    const summary: CloudAccountResourceSummary =
      summarizeCloudAccountResourceCounts(counts);

    expect(summary.resourceCount).toBe(70);
    expect(summary.types).toHaveLength(CLOUD_ACCOUNT_SUMMARY_MAX_ENTRIES);
    expect(summary.regions).toHaveLength(CLOUD_ACCOUNT_SUMMARY_MAX_ENTRIES);
  });

  test("rows give the same summary as their counts", () => {
    expect(
      summarizeCloudAccountResources([
        { type: "AWS::EC2::Instance", region: "eu-west-1" },
        { type: "AWS::EC2::Instance", region: "eu-west-1" },
        { type: "AWS::SQS::Queue", region: "us-east-1" },
      ]),
    ).toEqual(
      summarizeCloudAccountResourceCounts([
        { type: "AWS::EC2::Instance", region: "eu-west-1", count: 2 },
        { type: "AWS::SQS::Queue", region: "us-east-1", count: 1 },
      ]),
    );
  });
});

describe("a stored summary, read back", () => {
  test("reads what was written", () => {
    const summary: CloudAccountResourceSummary =
      summarizeCloudAccountResourceCounts([
        { type: "AWS::EC2::Instance", region: "eu-west-1", count: 2 },
      ]);

    expect(
      readCloudAccountResourceSummary(JSON.parse(JSON.stringify(summary))),
    ).toEqual(summary);
  });

  test("anything malformed reads as empty, or is skipped", () => {
    for (const value of [null, undefined, "x", 3, []]) {
      expect(readCloudAccountResourceSummary(value)).toEqual({
        resourceCount: 0,
        types: [],
        regions: [],
      });
    }

    expect(
      readCloudAccountResourceSummary({
        resourceCount: "7",
        types: [{ type: "a", count: "2" }, { type: 3 }, "x", null],
        regions: [{ region: "r", count: 1 }, { count: 2 }],
      }),
    ).toEqual({
      resourceCount: 7,
      types: [{ type: "a", count: 2 }],
      regions: [{ region: "r", count: 1 }],
    });
  });
});
