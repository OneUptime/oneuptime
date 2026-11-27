import { describe, expect, test } from "@jest/globals";
import {
  CLOUD_COST_ALLOCATION_MAX_DAYS,
  CloudCostAllocationInterval,
  CloudCostAllocationWindow,
  CloudCostBucketAmounts,
  CloudCostLineItemKind,
  CloudCostLineItemRecurrence,
  CloudCostSharedSplit,
  CloudCostSplitGroup,
  CloudCostSplitResult,
  getCloudCostAllocationChange,
  getCloudCostAllocationInterval,
  getCloudCostBuckets,
  getCloudCostLineItemDays,
  getCloudCostLineItemSignedAmount,
  getCloudCostSplitWeights,
  getCloudCostWindowDays,
  getPreviousCloudCostWindow,
  readCloudCostSharedPercentages,
  splitCloudCostSharedGroups,
  toCloudCostAllocationWindow,
  toCloudCostBucket,
  toCloudCostMonth,
  topCloudCostShares,
} from "../../../Types/Cloud/CloudCostAllocation";
import { toCloudCostDay } from "../../../Types/Cloud/CloudCost";
import BadDataException from "../../../Types/Exception/BadDataException";

/*
 * WHAT A COST VIEW ALLOCATES, IN PURE ARITHMETIC (#11006): the windows a
 * read covers and the one it is compared with, the custom line items day
 * by day, and the shared groups split across the others - evenly, by the
 * month's share of the spend, by fixed percentages, or by a Kubernetes
 * cluster's namespaces - never more, never less than they hold.
 */

const PAYMENTS: string = "0192f1a0-0000-7000-8000-00000000aa01";
const SEARCH: string = "0192f1a0-0000-7000-8000-00000000aa02";
const PLATFORM: string = "0192f1a0-0000-7000-8000-00000000aa03";
const SUPPORT: string = "0192f1a0-0000-7000-8000-00000000ff01";
const CLUSTER: string = "0192f1a0-0000-7000-8000-00000000ff02";

function day(text: string): Date {
  return new Date(`${text}T00:00:00.000Z`);
}

function window(start: string, lastDay: string): CloudCostAllocationWindow {
  return { start: day(start), lastDay: day(lastDay) };
}

function days(value: CloudCostAllocationWindow): [string, string] {
  return [toCloudCostDay(value.start), toCloudCostDay(value.lastDay)];
}

function amounts(
  entries: Record<string, Record<string, number>>,
): CloudCostBucketAmounts {
  return new Map(
    Object.entries(entries).map(
      ([groupId, byBucket]: [string, Record<string, number>]) => {
        return [groupId, new Map(Object.entries(byBucket))];
      },
    ),
  );
}

function total(result: CloudCostBucketAmounts, groupId: string): number {
  return Array.from(result.get(groupId)?.values() || []).reduce(
    (sum: number, amount: number): number => {
      return sum + amount;
    },
    0,
  );
}

describe("a read's window", () => {
  test("whole UTC days, both ends included", () => {
    const read: CloudCostAllocationWindow = toCloudCostAllocationWindow({
      startDate: new Date("2026-11-01T00:00:00.000Z"),
      endDate: new Date("2026-11-24T15:30:00.000Z"),
    });

    expect(days(read)).toEqual(["2026-11-01", "2026-11-24"]);
    expect(getCloudCostWindowDays(read)).toBe(24);
  });

  test("an end before the start, and a window longer than the costs are kept, are refused", () => {
    expect(() => {
      return toCloudCostAllocationWindow({
        startDate: day("2026-11-02"),
        endDate: day("2026-11-01"),
      });
    }).toThrow(
      new BadDataException(
        "The window ends before it starts. Choose an end date after the start date.",
      ),
    );
    // The figure and its unit are kept together, by a no-break space.
    expect(() => {
      return toCloudCostAllocationWindow({
        startDate: day("2025-01-01"),
        endDate: day("2026-11-01"),
      });
    }).toThrow(new RegExp(`at most ${CLOUD_COST_ALLOCATION_MAX_DAYS}\\sdays`));
  });

  test("the window before: the same days a month back, months back, or just before", () => {
    // This month so far against last month by now.
    expect(
      days(getPreviousCloudCostWindow(window("2026-11-01", "2026-11-24"))),
    ).toEqual(["2026-10-01", "2026-10-24"]);
    // Last month against the month before, the 31st kept within September.
    expect(
      days(getPreviousCloudCostWindow(window("2026-10-01", "2026-10-31"))),
    ).toEqual(["2026-09-01", "2026-09-30"]);
    // A whole month against the whole month before, however long each is.
    expect(
      days(getPreviousCloudCostWindow(window("2026-11-01", "2026-11-30"))),
    ).toEqual(["2026-10-01", "2026-10-31"]);
    expect(
      days(getPreviousCloudCostWindow(window("2026-03-01", "2026-03-31"))),
    ).toEqual(["2026-02-01", "2026-02-28"]);
    // Part of March against as much of February as there is.
    expect(
      days(getPreviousCloudCostWindow(window("2026-03-01", "2026-03-30"))),
    ).toEqual(["2026-02-01", "2026-02-28"]);
    // A quarter against the quarter before.
    expect(
      days(getPreviousCloudCostWindow(window("2026-09-01", "2026-11-24"))),
    ).toEqual(["2026-06-01", "2026-08-24"]);
    // Over a year's end.
    expect(
      days(getPreviousCloudCostWindow(window("2026-01-01", "2026-01-31"))),
    ).toEqual(["2025-12-01", "2025-12-31"]);
    // March against February, in a leap year and not.
    expect(
      days(getPreviousCloudCostWindow(window("2028-03-01", "2028-03-31"))),
    ).toEqual(["2028-02-01", "2028-02-29"]);
    // The last 30 days against the 30 before them.
    expect(
      days(getPreviousCloudCostWindow(window("2026-10-26", "2026-11-24"))),
    ).toEqual(["2026-09-26", "2026-10-25"]);
  });

  test("by the day up to three months, by the month beyond", () => {
    const quarter: CloudCostAllocationWindow = window(
      "2026-09-01",
      "2026-11-30",
    );
    const year: CloudCostAllocationWindow = window("2025-12-01", "2026-11-30");

    expect(getCloudCostAllocationInterval({ window: quarter })).toBe(
      CloudCostAllocationInterval.Day,
    );
    expect(getCloudCostAllocationInterval({ window: year })).toBe(
      CloudCostAllocationInterval.Month,
    );
    expect(
      getCloudCostAllocationInterval({
        window: year,
        asked: CloudCostAllocationInterval.Day,
      }),
    ).toBe(CloudCostAllocationInterval.Month);
    expect(
      getCloudCostAllocationInterval({
        window: quarter,
        asked: CloudCostAllocationInterval.Month,
      }),
    ).toBe(CloudCostAllocationInterval.Month);
  });

  test("every bucket of a window, in order", () => {
    expect(
      getCloudCostBuckets({
        window: window("2026-10-30", "2026-11-02"),
        interval: CloudCostAllocationInterval.Day,
      }),
    ).toEqual(["2026-10-30", "2026-10-31", "2026-11-01", "2026-11-02"]);
    expect(
      getCloudCostBuckets({
        window: window("2025-12-15", "2026-02-03"),
        interval: CloudCostAllocationInterval.Month,
      }),
    ).toEqual(["2025-12-01", "2026-01-01", "2026-02-01"]);
    expect(
      toCloudCostBucket(day("2026-11-24"), CloudCostAllocationInterval.Month),
    ).toBe("2026-11-01");
    expect(toCloudCostMonth("2026-11-24")).toBe("2026-11-01");
  });
});

describe("custom line items, day by day", () => {
  test("a one-off item falls on its day, and only inside the window", () => {
    const item: Parameters<typeof getCloudCostLineItemDays>[0]["item"] = {
      kind: CloudCostLineItemKind.Charge,
      amount: 1200,
      recurrence: CloudCostLineItemRecurrence.Once,
      startDate: new Date("2026-11-10T18:00:00.000Z"),
    };

    expect(
      getCloudCostLineItemDays({
        item,
        window: window("2026-11-01", "2026-11-30"),
      }),
    ).toEqual([{ day: "2026-11-10", amount: 1200 }]);
    expect(
      getCloudCostLineItemDays({
        item,
        window: window("2026-11-11", "2026-11-30"),
      }),
    ).toEqual([]);
  });

  test("a monthly item comes to its amount over a whole month, and its part over part of one", () => {
    const item: Parameters<typeof getCloudCostLineItemDays>[0]["item"] = {
      kind: CloudCostLineItemKind.Charge,
      amount: 300,
      recurrence: CloudCostLineItemRecurrence.Monthly,
      startDate: day("2026-09-15"),
      endDate: day("2026-11-01"),
    };
    const sum: (entries: Array<{ amount: number }>) => number = (
      entries: Array<{ amount: number }>,
    ): number => {
      return entries.reduce((value: number, entry: { amount: number }) => {
        return value + entry.amount;
      }, 0);
    };

    // From its start month's first day: September whole.
    expect(
      sum(
        getCloudCostLineItemDays({
          item,
          window: window("2026-09-01", "2026-09-30"),
        }),
      ),
    ).toBeCloseTo(300, 8);
    // Ten of November's thirty days.
    expect(
      sum(
        getCloudCostLineItemDays({
          item,
          window: window("2026-11-01", "2026-11-10"),
        }),
      ),
    ).toBeCloseTo(100, 8);
    // Its end month is its last: nothing in December.
    expect(
      getCloudCostLineItemDays({
        item,
        window: window("2026-12-01", "2026-12-31"),
      }),
    ).toEqual([]);
    // Before it starts: nothing.
    expect(
      getCloudCostLineItemDays({
        item,
        window: window("2026-08-01", "2026-08-31"),
      }),
    ).toEqual([]);
    // Three whole months, nine hundred.
    expect(
      sum(
        getCloudCostLineItemDays({
          item,
          window: window("2026-09-01", "2026-11-30"),
        }),
      ),
    ).toBeCloseTo(900, 8);
  });

  test("a credit takes off; an item with no end goes on", () => {
    const credit: Parameters<typeof getCloudCostLineItemDays>[0]["item"] = {
      kind: CloudCostLineItemKind.Credit,
      amount: 62,
      recurrence: CloudCostLineItemRecurrence.Monthly,
      startDate: day("2026-01-01"),
    };

    expect(getCloudCostLineItemSignedAmount(credit)).toBe(-62);
    expect(
      getCloudCostLineItemDays({
        item: credit,
        window: window("2026-10-01", "2026-10-31"),
      })
        .map((entry: { amount: number }): number => {
          return entry.amount;
        })
        .reduce((sum: number, amount: number): number => {
          return sum + amount;
        }, 0),
    ).toBeCloseTo(-62, 8);
    expect(
      getCloudCostLineItemDays({
        item: { ...credit, amount: 0 },
        window: window("2026-10-01", "2026-10-31"),
      }),
    ).toEqual([]);
  });
});

describe("fixed percentages", () => {
  test("each group's ID and its percent, together 100", () => {
    expect(
      readCloudCostSharedPercentages({
        [PAYMENTS.toUpperCase()]: "60",
        [SEARCH]: 40,
      }),
    ).toEqual({ [PAYMENTS]: 60, [SEARCH]: 40 });
    expect(readCloudCostSharedPercentages(undefined)).toEqual({});
  });

  test("anything else is refused with what to fix", () => {
    expect(() => {
      return readCloudCostSharedPercentages({ [PAYMENTS]: 60, [SEARCH]: 30 });
    }).toThrow(
      "A shared group's percentages must add up to 100. These add up to 90.",
    );
    expect(() => {
      return readCloudCostSharedPercentages({ Payments: 100 });
    }).toThrow("A shared group's percentages must name each group by its ID.");
    expect(() => {
      return readCloudCostSharedPercentages({ [PAYMENTS]: 0, [SEARCH]: 100 });
    }).toThrow(
      "Each group's share of a shared group must be a percent above 0 and at most 100.",
    );
    expect(() => {
      return readCloudCostSharedPercentages([60, 40]);
    }).toThrow(
      "A shared group's percentages must be an object of each group's ID and its percent.",
    );
  });
});

describe("splitting a shared group", () => {
  const groups: (
    support: Partial<CloudCostSplitGroup>,
  ) => Array<CloudCostSplitGroup> = (
    support: Partial<CloudCostSplitGroup>,
  ): Array<CloudCostSplitGroup> => {
    return [
      { id: PAYMENTS, isShared: false },
      { id: SEARCH, isShared: false },
      { id: PLATFORM, isShared: false },
      { id: SUPPORT, isShared: true, ...support },
    ];
  };

  const monthSpend: Map<string, Map<string, number>> = new Map([
    [
      "2026-11-01",
      new Map([
        [PAYMENTS, 6000],
        [SEARCH, 3000],
        [PLATFORM, 1000],
        [SUPPORT, 500],
      ]),
    ],
    ["2026-10-01", new Map([[PAYMENTS, 100]])],
  ]);

  function split(
    support: Partial<CloudCostSplitGroup>,
    held: CloudCostBucketAmounts,
  ): CloudCostSplitResult {
    return splitCloudCostSharedGroups({
      groups: groups(support),
      amounts: held,
      monthSpend,
      monthOf: toCloudCostMonth,
    });
  }

  test("by their share of the month's spend: the support plan as the issue asks", () => {
    const result: CloudCostSplitResult = split(
      { split: CloudCostSharedSplit.Proportional },
      amounts({ [SUPPORT]: { "2026-11-01": 500 } }),
    );

    expect(total(result.received, PAYMENTS)).toBeCloseTo(300, 8);
    expect(total(result.received, SEARCH)).toBeCloseTo(150, 8);
    expect(total(result.received, PLATFORM)).toBeCloseTo(50, 8);
    expect(total(result.given, SUPPORT)).toBeCloseTo(500, 8);
    expect(
      Array.from(result.sharedTo.get(SUPPORT)!.values()).reduce(
        (sum: number, amount: number): number => {
          return sum + amount;
        },
        0,
      ),
    ).toBeCloseTo(500, 8);
  });

  test("a month read by the day splits to what it does read as a month", () => {
    const byDay: CloudCostBucketAmounts = amounts({
      [SUPPORT]: { "2026-11-01": 100, "2026-11-15": 150, "2026-11-30": 250 },
    });
    const daily: CloudCostSplitResult = split(
      { split: CloudCostSharedSplit.Proportional },
      byDay,
    );
    const monthly: CloudCostSplitResult = split(
      { split: CloudCostSharedSplit.Proportional },
      amounts({ [SUPPORT]: { "2026-11-01": 500 } }),
    );

    for (const target of [PAYMENTS, SEARCH, PLATFORM]) {
      expect(total(daily.received, target)).toBeCloseTo(
        total(monthly.received, target),
        8,
      );
    }
  });

  test("evenly; and a month the others spent nothing in, proportional falls back to even", () => {
    const even: CloudCostSplitResult = split(
      { split: CloudCostSharedSplit.Even },
      amounts({ [SUPPORT]: { "2026-11-01": 90 } }),
    );

    expect(total(even.received, PAYMENTS)).toBeCloseTo(30, 8);
    expect(total(even.received, SEARCH)).toBeCloseTo(30, 8);
    expect(total(even.received, PLATFORM)).toBeCloseTo(30, 8);

    // September: no spend read for any group.
    const fallback: CloudCostSplitResult = split(
      { split: CloudCostSharedSplit.Proportional },
      amounts({ [SUPPORT]: { "2026-09-12": 90 } }),
    );

    expect(total(fallback.received, PLATFORM)).toBeCloseTo(30, 8);
    // October: only Payments spent - it takes all of it.
    const october: CloudCostSplitResult = split(
      { split: CloudCostSharedSplit.Proportional },
      amounts({ [SUPPORT]: { "2026-10-12": 90 } }),
    );

    expect(total(october.received, PAYMENTS)).toBeCloseTo(90, 8);
    expect(total(october.received, SEARCH)).toBe(0);
  });

  test("by fixed percentages; what names a group the view no longer has stays unsplit", () => {
    const fixed: CloudCostSplitResult = split(
      {
        split: CloudCostSharedSplit.Fixed,
        percentages: {
          [PAYMENTS]: 50,
          [SEARCH]: 25,
          "0192f1a0-0000-7000-8000-0000deadbeef": 25,
        },
      },
      amounts({ [SUPPORT]: { "2026-11-01": 1000 } }),
    );

    expect(total(fixed.received, PAYMENTS)).toBeCloseTo(500, 8);
    expect(total(fixed.received, SEARCH)).toBeCloseTo(250, 8);
    expect(total(fixed.received, PLATFORM)).toBe(0);
    // A quarter is kept by the shared group: given away is what was split.
    expect(total(fixed.given, SUPPORT)).toBeCloseTo(750, 8);
  });

  test("a negative cost - a credit - is split the same way", () => {
    const credit: CloudCostSplitResult = split(
      { split: CloudCostSharedSplit.Even },
      amounts({ [SUPPORT]: { "2026-11-01": -60 } }),
    );

    expect(total(credit.received, PAYMENTS)).toBeCloseTo(-20, 8);
    expect(total(credit.given, SUPPORT)).toBeCloseTo(-60, 8);
  });

  test("by a Kubernetes cluster's namespaces, month by month; idle capacity stays", () => {
    const kubernetesWeights: Map<string, Map<string, number>> = new Map([
      [
        "2026-11-01",
        new Map([
          [PAYMENTS, 0.5],
          [SEARCH, 0.3],
          // A shared group never takes a share, even when a weight names it.
          [SUPPORT, 0.1],
        ]),
      ],
    ]);
    const result: CloudCostSplitResult = splitCloudCostSharedGroups({
      groups: [
        { id: PAYMENTS, isShared: false },
        { id: SEARCH, isShared: false },
        {
          id: CLUSTER,
          isShared: true,
          split: CloudCostSharedSplit.Kubernetes,
          kubernetesWeights,
        },
        { id: SUPPORT, isShared: true, split: CloudCostSharedSplit.Even },
      ],
      amounts: amounts({
        [CLUSTER]: { "2026-11-03": 1000, "2026-10-30": 400 },
      }),
      monthSpend: new Map(),
      monthOf: toCloudCostMonth,
    });

    expect(total(result.received, PAYMENTS)).toBeCloseTo(500, 8);
    expect(total(result.received, SEARCH)).toBeCloseTo(300, 8);
    expect(total(result.received, SUPPORT)).toBe(0);
    // November's idle fifth stays; October has no namespaces read, so all of it stays.
    expect(total(result.given, CLUSTER)).toBeCloseTo(800, 8);
  });

  test("with no other group to split onto, nothing moves", () => {
    const result: CloudCostSplitResult = splitCloudCostSharedGroups({
      groups: [
        { id: SUPPORT, isShared: true, split: CloudCostSharedSplit.Even },
      ],
      amounts: amounts({ [SUPPORT]: { "2026-11-01": 100 } }),
      monthSpend,
      monthOf: toCloudCostMonth,
    });

    expect(result.received.size).toBe(0);
    expect(result.given.size).toBe(0);
  });

  test("two shared groups split independently, onto the unshared groups only", () => {
    const result: CloudCostSplitResult = splitCloudCostSharedGroups({
      groups: [
        { id: PAYMENTS, isShared: false },
        { id: SEARCH, isShared: true, split: CloudCostSharedSplit.Even },
        { id: SUPPORT, isShared: true, split: CloudCostSharedSplit.Even },
      ],
      amounts: amounts({
        [SEARCH]: { "2026-11-01": 10 },
        [SUPPORT]: { "2026-11-01": 20 },
      }),
      monthSpend,
      monthOf: toCloudCostMonth,
    });

    expect(total(result.received, PAYMENTS)).toBeCloseTo(30, 8);
    expect(total(result.received, SEARCH)).toBe(0);
  });

  test("weights a split would use, read on their own", () => {
    expect(
      getCloudCostSplitWeights({
        group: { id: SUPPORT, isShared: true },
        targets: [PAYMENTS, SEARCH],
        monthSpend: new Map([
          [PAYMENTS, 300],
          [SEARCH, -100],
        ]),
      }),
    ).toEqual(new Map([[PAYMENTS, 1]]));
    expect(
      getCloudCostSplitWeights({
        group: {
          id: SUPPORT,
          isShared: true,
          split: CloudCostSharedSplit.Even,
        },
        targets: [],
        monthSpend: undefined,
      }).size,
    ).toBe(0);
  });
});

describe("what a read lists and compares", () => {
  test("the largest first, none that rounds to nothing", () => {
    expect(
      topCloudCostShares(
        new Map([
          ["Amazon S3", 12.5],
          ["Amazon EC2", 40],
          ["AWS Lambda", 0.001],
          ["Amazon RDS", 12.5],
        ]),
        3,
      ),
    ).toEqual([
      { key: "Amazon EC2", amount: 40 },
      { key: "Amazon RDS", amount: 12.5 },
      { key: "Amazon S3", amount: 12.5 },
    ]);
  });

  test("the change from the window before, never from nothing", () => {
    expect(
      getCloudCostAllocationChange({ current: 120, previous: 100 }),
    ).toBeCloseTo(20, 8);
    expect(
      getCloudCostAllocationChange({ current: 50, previous: -100 }),
    ).toBeCloseTo(150, 8);
    expect(
      getCloudCostAllocationChange({ current: 50, previous: 0 }),
    ).toBeNull();
    expect(
      getCloudCostAllocationChange({ current: 50, previous: undefined }),
    ).toBeNull();
  });
});
