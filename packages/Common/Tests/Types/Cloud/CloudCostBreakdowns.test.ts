import CloudCost from "../../../Models/AnalyticsModels/CloudCost";
import AggregateBy from "../../../Types/BaseDatabase/AggregateBy";
import AggregatedResult from "../../../Types/BaseDatabase/AggregatedResult";
import AggregationInterval from "../../../Types/BaseDatabase/AggregationInterval";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import Includes from "../../../Types/BaseDatabase/Includes";
import {
  CloudCostAllocationGroupResult,
  CloudCostAllocationResult,
} from "../../../Types/Cloud/CloudCostAllocation";
import { CloudCostBasis } from "../../../Types/Cloud/CloudCostBasis";
import {
  CloudCostBreakdownComparison,
  CloudCostBreakdownReader,
  CloudCostBreakdownResult,
  CloudCostPoint,
  CloudCostScope,
  buildCloudCostAggregateBy,
  compareCloudCostBreakdowns,
  fillCloudCostDays,
  getCloudCostMovers,
  isCloudCostColumnDimension,
  isCloudCostDimension,
  readCloudCostBreakdown,
  readCloudCostBreakdownComparison,
  readCloudCostTrend,
  sortCloudCostShares,
  toCloudCostGroupBreakdown,
  toCloudCostGroupComparison,
  toCloudCostShares,
} from "../../../Types/Cloud/CloudCostBreakdowns";
import ObjectID from "../../../Types/ObjectID";
import Timezone from "../../../Types/Timezone";
import { describe, expect, test } from "@jest/globals";

/*
 * THE BREAKDOWNS (#11009): the one code Cloud > Costs, the API, the CLI,
 * the Cloud Cost widget and every report read the spend with. Each is
 * handed a reader - the page's AnalyticsModelAPI, the server's
 * CloudCostService.aggregateBy as the person the figures are for - so the
 * figures match wherever they are read: what each asks the reader, and
 * what it makes of the answer.
 */

const PROJECT: ObjectID = new ObjectID("0192f1a0-1100-7000-8000-000000011009");
const PROD: ObjectID = new ObjectID("0192f1a0-1100-7000-8000-00000000ac01");
const DATA: ObjectID = new ObjectID("0192f1a0-1100-7000-8000-00000000ac02");
const VIEW: ObjectID = new ObjectID("0192f1a0-1100-7000-8000-0000000e0001");

const NOVEMBER: CloudCostScope = {
  projectId: PROJECT,
  currency: "USD",
  startDate: new Date("2026-11-01T00:00:00.000Z"),
  endDate: new Date("2026-11-30T23:59:59.999Z"),
};

interface RecordingReader extends CloudCostBreakdownReader {
  asked: Array<AggregateBy<CloudCost>>;
  allocations: Array<Record<string, unknown>>;
  listsRead: number;
}

/*
 * A reader that answers each aggregate with `answer(aggregateBy)` and
 * records every question.
 */
function readerOf(
  answer: (aggregateBy: AggregateBy<CloudCost>) => Array<Record<string, unknown>>,
  allocation?: CloudCostAllocationResult,
): RecordingReader {
  const reader: RecordingReader = {
    asked: [],
    allocations: [],
    listsRead: 0,
    aggregate: async (
      aggregateBy: AggregateBy<CloudCost>,
    ): Promise<AggregatedResult> => {
      reader.asked.push(aggregateBy);
      return { data: answer(aggregateBy) } as unknown as AggregatedResult;
    },
    readAllocation: async (data: Record<string, unknown>) => {
      reader.allocations.push(data);

      if (!allocation) {
        throw new Error("No allocation in this test.");
      }

      return allocation;
    },
    readPlatformLists: async () => {
      reader.listsRead++;
      return { environments: [], apps: [] };
    },
  } as RecordingReader;

  return reader;
}

function isNovember(aggregateBy: AggregateBy<CloudCost>): boolean {
  const day: InBetween<Date> = (aggregateBy.query as Record<string, unknown>)[
    "day"
  ] as InBetween<Date>;

  return new Date(day.startValue).getUTCMonth() === 10;
}

function group(
  id: string,
  name: string,
  total: number,
  previousTotal: number,
): CloudCostAllocationGroupResult {
  return {
    id,
    name,
    order: 1,
    isShared: false,
    total,
    previousTotal,
    cloud: total,
    lineItems: 0,
    series: [],
  } as unknown as CloudCostAllocationGroupResult;
}

const BY_TEAM: CloudCostAllocationResult = {
  viewId: VIEW.toString(),
  viewName: "By team",
  currency: "USD",
  start: "2026-11-01",
  lastDay: "2026-11-30",
  buckets: [],
  cloud: 1530,
  lineItems: 0,
  total: 1530,
  previousTotal: 765,
  groups: [
    group("g-search", "Search", 210, 105),
    group("g-pay", "Payments", 420, 210),
    group("g-data", "Data", 150, 75),
    // A shared group that split all its costs away: no share of its own.
    group("g-shared", "Shared", 0, 0),
  ],
  unallocated: {
    cloud: 750,
    lineItems: 0,
    total: 750,
    previousTotal: 375,
    series: [],
    topServices: [],
    topAccounts: [],
    topTagValues: [],
    topOwnerTeams: [],
  },
  readAt: "2026-12-02T12:00:00.000Z",
} as unknown as CloudCostAllocationResult;

describe("what a breakdown asks the costs", () => {
  test("one project's, one currency's, the window's days, summed on the basis shown, by the UTC day", () => {
    const aggregateBy: AggregateBy<CloudCost> = buildCloudCostAggregateBy({
      scope: NOVEMBER,
      interval: AggregationInterval.Total,
      groupBy: { service: true } as never,
    });
    const query: Record<string, unknown> = aggregateBy.query as Record<
      string,
      unknown
    >;

    expect(query["projectId"]).toBe(PROJECT);
    expect(query["currency"]).toBe("USD");
    expect((query["day"] as InBetween<Date>).startValue).toEqual(
      NOVEMBER.startDate,
    );
    expect((query["day"] as InBetween<Date>).endValue).toEqual(
      NOVEMBER.endDate,
    );
    expect(query["cloudAccountId"]).toBeUndefined();
    expect(aggregateBy.aggregateColumnName).toBe("cost");
    expect(aggregateBy.timezone).toBe(Timezone.UTC);
    expect(aggregateBy.groupBy).toEqual({ service: true });
  });

  test("each basis is its own column of the costs", () => {
    const column: (basis: CloudCostBasis | undefined) => unknown = (
      basis: CloudCostBasis | undefined,
    ): unknown => {
      return buildCloudCostAggregateBy({
        scope: { ...NOVEMBER, basis },
        interval: AggregationInterval.Total,
      }).aggregateColumnName;
    };

    expect(column(CloudCostBasis.Billed)).toBe("cost");
    expect(column(CloudCostBasis.Amortized)).toBe("amortizedCost");
    expect(column(CloudCostBasis.Net)).toBe("netCost");
    expect(column(undefined)).toBe("cost");
  });

  test("one account is asked by its ID, several by a list, one resource by its key", () => {
    const one: Record<string, unknown> = buildCloudCostAggregateBy({
      scope: { ...NOVEMBER, cloudAccountIds: [PROD], resourceId: "i-0pay" },
      interval: AggregationInterval.Total,
    }).query as Record<string, unknown>;
    const several: Record<string, unknown> = buildCloudCostAggregateBy({
      scope: { ...NOVEMBER, cloudAccountIds: [PROD, DATA] },
      interval: AggregationInterval.Total,
    }).query as Record<string, unknown>;

    expect(one["cloudAccountId"]).toBe(PROD);
    expect(one["resourceId"]).toBe("i-0pay");
    expect(several["cloudAccountId"]).toBeInstanceOf(Includes);
    expect((several["cloudAccountId"] as Includes).values).toEqual([
      PROD,
      DATA,
    ]);
  });

  test("the dimensions are the page's own", () => {
    for (const dimension of [
      "service",
      "region",
      "cloudAccountId",
      "resourceId",
      "environment",
      "app",
      "tag",
      "group",
    ]) {
      expect(isCloudCostDimension(dimension)).toBe(true);
    }

    expect(isCloudCostDimension("amount")).toBe(false);
    expect(isCloudCostDimension(undefined)).toBe(false);
    expect(isCloudCostColumnDimension("region")).toBe(true);
    expect(isCloudCostColumnDimension("tag")).toBe(false);
  });
});

describe("each day's spend", () => {
  test("every day of the window, a day with no cost as 0, a day read twice summed", async () => {
    const reader: RecordingReader = readerOf(() => {
      return [
        { timestamp: "2026-11-01T00:00:00.000Z", value: 10 },
        { timestamp: "2026-11-01T00:00:00.000Z", value: 2.5 },
        { timestamp: "2026-11-03T00:00:00.000Z", value: "4" },
      ];
    });
    const points: Array<CloudCostPoint> = await readCloudCostTrend(reader, {
      ...NOVEMBER,
      endDate: new Date("2026-11-04T23:59:59.999Z"),
    });

    expect(
      points.map((point: CloudCostPoint) => {
        return [point.x.toISOString().slice(0, 10), point.y];
      }),
    ).toEqual([
      ["2026-11-01", 12.5],
      ["2026-11-02", 0],
      ["2026-11-03", 4],
      ["2026-11-04", 0],
    ]);
    expect(reader.asked[0]!.aggregationInterval).toBe(AggregationInterval.Day);
  });

  test("the days are UTC's, whatever the window's start time", () => {
    const points: Array<CloudCostPoint> = fillCloudCostDays({
      points: [],
      startDate: new Date("2026-11-01T18:00:00.000Z"),
      endDate: new Date("2026-11-02T23:59:59.999Z"),
    });

    expect(points.map((point: CloudCostPoint) => point.x.toISOString())).toEqual(
      ["2026-11-01T00:00:00.000Z", "2026-11-02T00:00:00.000Z"],
    );
  });
});

describe("a breakdown by a column", () => {
  test("by service: the costliest first, ties by name, what rounds to nothing left out, the total their sum", async () => {
    const reader: RecordingReader = readerOf(() => {
      return [
        { service: "Amazon S3", value: 150 },
        { service: "Amazon EC2", value: 420 },
        { service: "Amazon RDS", value: 150 },
        { service: "Amazon SNS", value: 0.004 },
        { service: "Amazon EC2", value: 30 },
      ];
    });
    const result: CloudCostBreakdownResult = await readCloudCostBreakdown(
      reader,
      { scope: NOVEMBER, dimension: "service" },
    );

    expect(result.shares).toEqual([
      { key: "Amazon EC2", amount: 450 },
      { key: "Amazon RDS", amount: 150 },
      { key: "Amazon S3", amount: 150 },
    ]);
    expect(result.rest).toEqual([]);
    expect(result.total).toBe(750);
    expect(reader.asked[0]!.groupBy).toEqual({ service: true });
    expect(reader.asked[0]!.aggregationInterval).toBe(
      AggregationInterval.Total,
    );
  });

  test("a credit is a share below nothing, kept", () => {
    expect(
      toCloudCostShares({
        rows: [
          { region: "us-east-1", value: 100 },
          { region: "", value: -40 },
        ],
        dimension: "region",
      }),
    ).toEqual([
      { key: "us-east-1", amount: 100 },
      { key: "", amount: -40 },
    ]);
    expect(sortCloudCostShares([{ key: "x", amount: -0.001 }])).toEqual([]);
  });

  test("by tag: each value, what carries none said apart, the tag asked as an attribute", async () => {
    const reader: RecordingReader = readerOf(() => {
      return [
        { attributes: { team: "payments" }, value: 420 },
        { attributes: { team: "search" }, value: 210 },
        { attributes: {}, value: 900 },
      ];
    });
    const result: CloudCostBreakdownResult = await readCloudCostBreakdown(
      reader,
      { scope: NOVEMBER, dimension: "tag", tagKey: "team" },
    );

    expect(result.shares).toEqual([
      { key: "payments", amount: 420 },
      { key: "search", amount: 210 },
    ]);
    expect(result.rest).toEqual([{ kind: "without-tag", amount: 900 }]);
    expect(result.total).toBe(1530);
    expect(reader.asked[0]!.groupByAttributeKeys).toEqual(["team"]);
  });

  test("by tag without a tag asks nothing", async () => {
    const reader: RecordingReader = readerOf(() => {
      return [];
    });
    const result: CloudCostBreakdownResult = await readCloudCostBreakdown(
      reader,
      { scope: NOVEMBER, dimension: "tag" },
    );

    expect(result).toEqual({ shares: [], rest: [], total: 0 });
    expect(reader.asked).toHaveLength(0);
  });

  test("by environment, the environments are read once and their costs asked by place", async () => {
    const reader: RecordingReader = readerOf(() => {
      return [{ accountId: "111", region: "us-east-1", service: "AWS Lambda", value: 5 }];
    });
    const result: CloudCostBreakdownResult = await readCloudCostBreakdown(
      reader,
      { scope: NOVEMBER, dimension: "environment" },
    );

    expect(reader.listsRead).toBe(1);
    expect(reader.asked[0]!.groupBy).toEqual({
      accountId: true,
      region: true,
      service: true,
    });
    // Nothing in an environment: all of it is said apart.
    expect(result.shares).toEqual([]);
    expect(result.total).toBe(5);
    expect(result.rest).toEqual([{ kind: "not-in-environment", amount: 5 }]);
  });
});

describe("a breakdown by a cost view's groups", () => {
  test("is the view's allocation: each group's total, what no group takes said apart, the view's whole total", async () => {
    const reader: RecordingReader = readerOf(() => {
      return [];
    }, BY_TEAM);
    const result: CloudCostBreakdownResult = await readCloudCostBreakdown(
      reader,
      {
        scope: {
          ...NOVEMBER,
          basis: CloudCostBasis.Amortized,
          cloudAccountIds: [PROD],
        },
        dimension: "group",
        viewId: VIEW,
      },
    );

    expect(result.shares).toEqual([
      { key: "g-pay", amount: 420 },
      { key: "g-search", amount: 210 },
      { key: "g-data", amount: 150 },
    ]);
    expect(result.rest).toEqual([{ kind: "not-in-group", amount: 750 }]);
    expect(result.total).toBe(1530);
    expect(result.viewName).toBe("By team");
    expect(reader.asked).toHaveLength(0);
    expect(reader.allocations).toEqual([
      {
        viewId: VIEW,
        startDate: NOVEMBER.startDate,
        endDate: NOVEMBER.endDate,
        currency: "USD",
        basis: CloudCostBasis.Amortized,
        cloudAccountIds: [PROD],
      },
    ]);
  });

  test("without a view asks nothing", async () => {
    const reader: RecordingReader = readerOf(() => {
      return [];
    });

    expect(
      await readCloudCostBreakdown(reader, {
        scope: NOVEMBER,
        dimension: "group",
      }),
    ).toEqual({ shares: [], rest: [], total: 0, groups: [] });
    expect(reader.allocations).toHaveLength(0);
  });

  test("against the period before: the allocation's own previous totals, read once", async () => {
    const reader: RecordingReader = readerOf(() => {
      return [];
    }, BY_TEAM);
    const comparison: CloudCostBreakdownComparison =
      await readCloudCostBreakdownComparison(reader, {
        scope: NOVEMBER,
        previousStartDate: new Date("2026-10-01T00:00:00.000Z"),
        previousEndDate: new Date("2026-10-31T23:59:59.999Z"),
        dimension: "group",
        viewId: VIEW,
      });

    expect(reader.allocations).toHaveLength(1);
    expect(comparison.total).toBe(1530);
    expect(comparison.previousTotal).toBe(765);
    expect(comparison.shares).toEqual([
      { key: "g-pay", amount: 420, previousAmount: 210 },
      { key: "g-search", amount: 210, previousAmount: 105 },
      { key: "g-data", amount: 150, previousAmount: 75 },
    ]);
    expect(comparison.rest).toEqual([
      { kind: "not-in-group", amount: 750, previousAmount: 375 },
    ]);
    expect(toCloudCostGroupComparison(BY_TEAM)).toEqual(comparison);
    expect(toCloudCostGroupBreakdown(BY_TEAM).groups).toBe(BY_TEAM.groups);
  });
});

describe("against the period before", () => {
  test("both periods are read alike, the period before on its own days", async () => {
    const reader: RecordingReader = readerOf(
      (aggregateBy: AggregateBy<CloudCost>) => {
        return isNovember(aggregateBy)
          ? [
              { service: "Amazon EC2", value: 300 },
              { service: "Amazon Bedrock", value: 25 },
            ]
          : [
              { service: "Amazon EC2", value: 200 },
              { service: "Amazon S3", value: 100 },
            ];
      },
    );
    const comparison: CloudCostBreakdownComparison =
      await readCloudCostBreakdownComparison(reader, {
        scope: NOVEMBER,
        previousStartDate: new Date("2026-10-01T00:00:00.000Z"),
        previousEndDate: new Date("2026-10-31T23:59:59.999Z"),
        dimension: "service",
      });

    expect(reader.asked).toHaveLength(2);
    expect(comparison.total).toBe(325);
    expect(comparison.previousTotal).toBe(300);
    expect(comparison.shares).toEqual([
      { key: "Amazon EC2", amount: 300, previousAmount: 200 },
      { key: "Amazon Bedrock", amount: 25, previousAmount: 0 },
      // Gone this period: kept, at nothing, so its fall shows.
      { key: "Amazon S3", amount: 0, previousAmount: 100 },
    ]);
  });

  test("what a breakdown leaves out is compared kind by kind", () => {
    expect(
      compareCloudCostBreakdowns({
        current: {
          shares: [],
          rest: [{ kind: "without-tag", amount: 5 }],
          total: 5,
        },
        previous: {
          shares: [],
          rest: [
            { kind: "without-tag", amount: 3 },
            { kind: "not-in-environment", amount: 2 },
          ],
          total: 5,
        },
      }).rest,
    ).toEqual([
      { kind: "without-tag", amount: 5, previousAmount: 3 },
      { kind: "not-in-environment", amount: 0, previousAmount: 2 },
    ]);
  });

  test("the movers: what rose and fell the most, by as much as the least worth saying", () => {
    const comparison: CloudCostBreakdownComparison = {
      shares: [
        { key: "Amazon EC2", amount: 300, previousAmount: 200 },
        { key: "Amazon Bedrock", amount: 25, previousAmount: 0 },
        { key: "Amazon S3", amount: 0, previousAmount: 100 },
        { key: "Amazon RDS", amount: 50.004, previousAmount: 50 },
        { key: "AWS Lambda", amount: 10, previousAmount: 35 },
      ],
      rest: [],
      total: 385.004,
      previousTotal: 385,
    };
    const movers: {
      rises: Array<{ key: string }>;
      falls: Array<{ key: string }>;
    } = getCloudCostMovers({ comparison, count: 5 });

    expect(movers.rises.map((share: { key: string }) => share.key)).toEqual([
      "Amazon EC2",
      "Amazon Bedrock",
    ]);
    expect(movers.falls.map((share: { key: string }) => share.key)).toEqual([
      "Amazon S3",
      "AWS Lambda",
    ]);

    expect(
      getCloudCostMovers({ comparison, count: 1, minimum: 50 }),
    ).toEqual({
      rises: [{ key: "Amazon EC2", amount: 300, previousAmount: 200 }],
      falls: [{ key: "Amazon S3", amount: 0, previousAmount: 100 }],
    });
  });
});
