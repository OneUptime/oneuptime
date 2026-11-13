import { afterEach, describe, expect, jest, test } from "@jest/globals";
import CloudCost from "../../../Models/AnalyticsModels/CloudCost";
import AggregateBy from "../../../Types/BaseDatabase/AggregateBy";
import AggregationInterval from "../../../Types/BaseDatabase/AggregationInterval";
import AggregationType from "../../../Types/BaseDatabase/AggregationType";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import Includes from "../../../Types/BaseDatabase/Includes";
import {
  CloudAccountCostSummary,
  CloudCostState,
} from "../../../Types/Cloud/CloudCost";
import ObjectID from "../../../Types/ObjectID";
import OneUptimeDate from "../../../Types/Date";
import Timezone from "../../../Types/Timezone";
import AggregationIntervalUtil from "../../../Types/BaseDatabase/AggregationIntervalUtil";
import AnalyticsModelAPI from "../../../UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI";
import { getJestSpyOn } from "../../Spy";
import {
  CloudCostPoint,
  CloudCostScope,
  CloudCostShare,
  buildCloudCostAggregateBy,
  fetchCloudCostShares,
  fetchCloudCostTrend,
  fillCloudCostDays,
  mergeCloudTopServices,
  toCloudCostShares,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Cloud/CloudCostReads";

/*
 * What the Cloud pages read of the cost rows themselves: one sum through
 * /aggregate - in the project, one currency and the window shown, of the
 * accounts or the one resource asked for - each day of it with its bar, and
 * the spend by service, Region, account or resource, most first.
 */

const PROJECT: ObjectID = new ObjectID("10000000-0000-4000-8000-0000000000a1");
const WEB: ObjectID = new ObjectID("10000000-0000-4000-8000-0000000000b1");
const DATA: ObjectID = new ObjectID("10000000-0000-4000-8000-0000000000b2");
const START: Date = new Date("2026-11-01T00:00:00.000Z");
const END: Date = new Date("2026-11-04T15:30:00.000Z");

function scope(overrides: Partial<CloudCostScope> = {}): CloudCostScope {
  return {
    projectId: PROJECT,
    currency: "USD",
    startDate: START,
    endDate: END,
    ...overrides,
  };
}

function summary(
  overrides: Partial<CloudAccountCostSummary> = {},
): CloudAccountCostSummary {
  return {
    state: CloudCostState.Reading,
    currency: "USD",
    monthToDate: 0,
    lastMonth: 0,
    monthFullDays: 0,
    lastMonthToDate: 0,
    projectedMonth: 0,
    last30Days: 0,
    topServices: [],
    readAt: "2026-11-04T00:00:00.000Z",
    ...overrides,
  };
}

afterEach(() => {
  jest.restoreAllMocks();
  OneUptimeDate.setUserTimezone(null);
});

describe("the sum asked for", () => {
  test("the project's costs in one currency and the window, summed by day", () => {
    const aggregateBy: AggregateBy<CloudCost> = buildCloudCostAggregateBy({
      scope: scope(),
      interval: AggregationInterval.Day,
    });

    expect(aggregateBy).toMatchObject({
      aggregationType: AggregationType.Sum,
      aggregateColumnName: "cost",
      aggregationTimestampColumnName: "day",
      aggregationInterval: AggregationInterval.Day,
      timezone: Timezone.UTC,
      startTimestamp: START,
      endTimestamp: END,
      skip: 0,
    });
    expect(aggregateBy.query).toEqual({
      projectId: PROJECT,
      currency: "USD",
      day: new InBetween<Date>(START, END),
    });
    expect(aggregateBy.groupBy).toBeUndefined();
  });

  test("one account as itself, several as a list, one resource by its key, and a group", () => {
    expect(
      buildCloudCostAggregateBy({
        scope: scope({ cloudAccountIds: [WEB] }),
        interval: AggregationInterval.Day,
      }).query["cloudAccountId" as keyof CloudCost],
    ).toEqual(WEB);

    const several: AggregateBy<CloudCost> = buildCloudCostAggregateBy({
      scope: scope({
        cloudAccountIds: [WEB, DATA],
        resourceId: "arn:aws:ec2:us-east-1:1:instance/i-1",
      }),
      interval: AggregationInterval.Total,
      groupBy: { service: true },
    });

    expect(
      several.query["cloudAccountId" as keyof CloudCost] as unknown,
    ).toEqual(new Includes([WEB, DATA]));
    expect(several.query["resourceId" as keyof CloudCost] as unknown).toBe(
      "arn:aws:ec2:us-east-1:1:instance/i-1",
    );
    expect(several.groupBy).toEqual({ service: true });
    expect(several.aggregationInterval).toBe(AggregationInterval.Total);

    // No accounts listed is every account.
    expect(
      buildCloudCostAggregateBy({
        scope: scope({ cloudAccountIds: [] }),
        interval: AggregationInterval.Day,
      }).query,
    ).not.toHaveProperty("cloudAccountId");
  });
});

/*
 * A cloud bills by the UTC day: CloudCost.day is that day's start, and the
 * trend fills and names UTC days (fillCloudCostDays). The read names UTC,
 * so the reader's zone, which every other day chart is read in (#7277),
 * never moves a bill to another day.
 */
describe("the days a cloud bills by", () => {
  test("are UTC's for a reader in any zone: the read names UTC, and the reader's zone does not replace it", () => {
    for (const reader of [
      Timezone.AmericaNew_York,
      Timezone.AsiaKolkata,
      Timezone.PacificAuckland,
    ]) {
      OneUptimeDate.setUserTimezone(reader);

      for (const interval of [
        AggregationInterval.Day,
        AggregationInterval.Week,
        AggregationInterval.Month,
      ]) {
        const aggregateBy: AggregateBy<CloudCost> = buildCloudCostAggregateBy({
          scope: scope({
            startDate: new Date("2026-08-01T00:00:00.000Z"),
            endDate: new Date("2026-11-01T00:00:00.000Z"),
          }),
          interval: interval,
        });

        expect(aggregateBy.timezone).toBe(Timezone.UTC);
        // What AnalyticsModelAPI.aggregate sends.
        expect(
          AggregationIntervalUtil.withReaderTimezone(aggregateBy).timezone,
        ).toBe(Timezone.UTC);
      }
    }
  });
});

describe("each day of the window", () => {
  test("a day with no cost is a zero, and a day's rows are one bar", () => {
    const days: Array<CloudCostPoint> = fillCloudCostDays({
      points: [
        { x: new Date("2026-11-01T00:00:00.000Z"), y: 10 },
        { x: new Date("2026-11-03T00:00:00.000Z"), y: 4 },
        { x: new Date("2026-11-03T00:00:00.000Z"), y: 1.5 },
      ],
      startDate: new Date("2026-11-01T09:00:00.000Z"),
      endDate: END,
    });

    expect(
      days.map((point: CloudCostPoint) => {
        return [point.x.toISOString().slice(0, 10), point.y];
      }),
    ).toEqual([
      ["2026-11-01", 10],
      ["2026-11-02", 0],
      ["2026-11-03", 5.5],
      ["2026-11-04", 0],
    ]);
    // Each bar on its UTC day's start.
    expect(days[0]!.x.toISOString()).toBe("2026-11-01T00:00:00.000Z");
  });

  test("the trend is read summed by day, and filled", async () => {
    const aggregate: jest.SpyInstance<any, any> = getJestSpyOn(
      AnalyticsModelAPI,
      "aggregate",
    ).mockResolvedValue({
      data: [
        { timestamp: "2026-11-02T00:00:00.000Z", value: "12.5" },
        { timestamp: "2026-11-04T00:00:00.000Z", value: null },
      ],
    });

    const trend: Array<CloudCostPoint> = await fetchCloudCostTrend(scope());

    expect(
      trend.map((point: CloudCostPoint) => {
        return point.y;
      }),
    ).toEqual([0, 12.5, 0, 0]);

    const request: { modelType: unknown; aggregateBy: AggregateBy<CloudCost> } =
      aggregate.mock.calls[0]![0];
    expect(request.modelType).toBe(CloudCost);
    expect(request.aggregateBy.aggregationInterval).toBe(
      AggregationInterval.Day,
    );
    expect(request.aggregateBy.timezone).toBe(Timezone.UTC);
  });
});

describe("where the money goes", () => {
  test("by one dimension, most first, a cost with no value as its own entry", () => {
    expect(
      toCloudCostShares({
        rows: [
          { region: "us-east-1", value: 40 },
          { region: "eu-west-1", value: "60.25" },
          { region: null, value: 7 },
          { region: "us-east-1", value: 5 },
          // Corrections that cancel out are not an entry.
          { region: "ap-south-1", value: 0.001 },
          { region: "us-west-2", value: "not a number" },
        ],
        dimension: "region",
      }),
    ).toEqual([
      { key: "eu-west-1", amount: 60.25 },
      { key: "us-east-1", amount: 45 },
      { key: "", amount: 7 },
    ]);
  });

  test("the window summed once, grouped by the dimension asked for", async () => {
    const aggregate: jest.SpyInstance<any, any> = getJestSpyOn(
      AnalyticsModelAPI,
      "aggregate",
    ).mockResolvedValue({
      data: [
        { service: "Amazon EC2", value: 30 },
        { service: "Amazon S3", value: 31 },
      ],
    });

    const shares: Array<CloudCostShare> = await fetchCloudCostShares({
      scope: scope(),
      dimension: "service",
    });

    expect(
      shares.map((share: CloudCostShare) => {
        return share.key;
      }),
    ).toEqual(["Amazon S3", "Amazon EC2"]);

    const request: { aggregateBy: AggregateBy<CloudCost> } =
      aggregate.mock.calls[0]![0];
    expect(request.aggregateBy.aggregationInterval).toBe(
      AggregationInterval.Total,
    );
    expect(request.aggregateBy.groupBy).toEqual({ service: true });
  });

  test("the services that cost the most across accounts, from their summaries, in one currency", () => {
    expect(
      mergeCloudTopServices({
        summaries: [
          summary({
            topServices: [
              { service: "Amazon EC2", amount: 300 },
              { service: "Amazon RDS", amount: 120 },
            ],
          }),
          summary({
            topServices: [
              { service: "Amazon EC2", amount: 50 },
              { service: "Amazon S3", amount: 20 },
            ],
          }),
          // Another currency, an account not read and none at all are left out.
          summary({
            currency: "EUR",
            topServices: [{ service: "Virtual Machines", amount: 900 }],
          }),
          summary({
            state: CloudCostState.NotAllowed,
            topServices: [{ service: "Compute Engine", amount: 800 }],
          }),
          null,
        ],
        currency: "usd",
        top: 2,
      }),
    ).toEqual([
      { key: "Amazon EC2", amount: 350 },
      { key: "Amazon RDS", amount: 120 },
    ]);
  });
});
