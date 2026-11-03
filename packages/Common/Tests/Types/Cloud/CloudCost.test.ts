import { describe, expect, test } from "@jest/globals";
import {
  CLOUD_BUDGET_DEFAULT_THRESHOLDS,
  CLOUD_COST_DEFAULT_CURRENCY,
  CLOUD_COST_SUMMARY_TOP_SERVICES,
  CLOUD_SAVING_KIND_LABELS,
  CloudAccountCostSummary,
  CloudAccountSavingsSummary,
  CloudCostState,
  CloudCostTotals,
  CloudSavingKind,
  CloudSavingsTotals,
  addUtcDays,
  addUtcMonths,
  daysInUtcMonth,
  fromCloudCostDay,
  getCloudCostChangePercent,
  getCloudCostResourceKey,
  getCloudCostWindow,
  getMostCommonCloudCurrency,
  getPassedCloudBudgetThresholds,
  isCloudSavingKind,
  projectCloudMonthCost,
  readCloudAccountCostSummary,
  readCloudAccountSavingsSummary,
  readCloudBudgetThresholds,
  roundCost,
  startOfUtcDay,
  startOfUtcMonth,
  summarizeCloudAccountCosts,
  summarizeCloudAccountSavings,
  toCloudBudgetMonth,
  toCloudCostDay,
  totalCloudCosts,
  totalCloudSavings,
} from "../../../Types/Cloud/CloudCost";

/*
 * What a cloud account costs and how to spend less, as the server keeps it
 * and the Dashboard reads it: UTC days, the window a read covers, the
 * month's projection at the last week's pace, an account's summaries and
 * several accounts' as one, and a budget's thresholds.
 */

const NOW: Date = new Date("2026-11-20T15:30:00.000Z");

// Each day's total from "2026-11-01" -> amount pairs.
function days(entries: Array<[string, number]>): Map<string, number> {
  return new Map(entries);
}

// Every day from `start` for `count` days, at `amount` each.
function evenDays(
  start: string,
  count: number,
  amount: number,
): Map<string, number> {
  const totals: Map<string, number> = new Map();
  for (let index: number = 0; index < count; index++) {
    totals.set(
      toCloudCostDay(addUtcDays(fromCloudCostDay(start), index)),
      amount,
    );
  }
  return totals;
}

function costSummary(
  overrides: Partial<CloudAccountCostSummary>,
): CloudAccountCostSummary {
  return {
    state: CloudCostState.Reading,
    currency: "USD",
    monthToDate: 0,
    lastMonth: 0,
    lastMonthToDate: 0,
    projectedMonth: 0,
    last30Days: 0,
    topServices: [],
    readAt: NOW.toISOString(),
    ...overrides,
  };
}

function savingsSummary(
  overrides: Partial<CloudAccountSavingsSummary>,
): CloudAccountSavingsSummary {
  return {
    state: CloudCostState.Reading,
    count: 0,
    monthlySavings: 0,
    byKind: {},
    currency: "USD",
    readAt: NOW.toISOString(),
    ...overrides,
  };
}

describe("UTC days", () => {
  test("a day is its UTC date, and back to its start", () => {
    expect(toCloudCostDay(new Date("2026-11-02T23:59:59.000Z"))).toBe(
      "2026-11-02",
    );
    expect(fromCloudCostDay("2026-11-02").toISOString()).toBe(
      "2026-11-02T00:00:00.000Z",
    );
    expect(startOfUtcDay(NOW).toISOString()).toBe("2026-11-20T00:00:00.000Z");
  });

  test("months start on the first, and move across a year's end", () => {
    expect(startOfUtcMonth(NOW).toISOString()).toBe("2026-11-01T00:00:00.000Z");
    expect(addUtcMonths(startOfUtcMonth(NOW), 2).toISOString()).toBe(
      "2027-01-01T00:00:00.000Z",
    );
    expect(
      addUtcMonths(new Date("2026-01-15T00:00:00.000Z"), -1).toISOString(),
    ).toBe("2025-12-01T00:00:00.000Z");
  });

  test("a month's length, February of a leap year included", () => {
    expect(daysInUtcMonth(new Date("2026-11-20T00:00:00.000Z"))).toBe(30);
    expect(daysInUtcMonth(new Date("2028-02-10T00:00:00.000Z"))).toBe(29);
    expect(daysInUtcMonth(new Date("2027-02-10T00:00:00.000Z"))).toBe(28);
  });
});

describe("what a read of costs covers", () => {
  test("a first read goes back to the start of the month before last, through today", () => {
    const window: { start: Date; end: Date } = getCloudCostWindow({
      now: NOW,
      isFirstRead: true,
    });

    expect(window.start.toISOString()).toBe("2026-09-01T00:00:00.000Z");
    expect(window.end.toISOString()).toBe("2026-11-21T00:00:00.000Z");
  });

  test("later reads cover the last week, which a cloud still corrects", () => {
    const window: { start: Date; end: Date } = getCloudCostWindow({
      now: NOW,
      isFirstRead: false,
    });

    expect(window.start.toISOString()).toBe("2026-11-13T00:00:00.000Z");
    expect(window.end.toISOString()).toBe("2026-11-21T00:00:00.000Z");
  });

  test("in a month's first days, the whole of last month, still being finalised", () => {
    const window: { start: Date; end: Date } = getCloudCostWindow({
      now: new Date("2026-11-03T08:00:00.000Z"),
      isFirstRead: false,
    });

    expect(window.start.toISOString()).toBe("2026-10-01T00:00:00.000Z");
  });
});

describe("the month at the last week's pace", () => {
  test("the days left cost the average of the seven full days before the newest", () => {
    // Nov 1-19 at $100, and the newest day (the 20th), reported in part, at $30.
    const totals: Map<string, number> = evenDays("2026-11-01", 19, 100);
    totals.set("2026-11-20", 30);

    const projection: {
      monthToDate: number;
      projectedMonth: number;
      latestDay?: string;
    } = projectCloudMonthCost({ dailyTotals: totals, now: NOW });

    expect(projection.monthToDate).toBe(19 * 100 + 30);
    expect(projection.latestDay).toBe("2026-11-20");
    // Ten days left after the 20th, at $100 a day.
    expect(projection.projectedMonth).toBe(1930 + 10 * 100);
  });

  test("a quiet weekend counts once: the pace is the week's average", () => {
    const totals: Map<string, number> = days([
      ["2026-11-12", 100],
      ["2026-11-13", 100],
      ["2026-11-14", 30],
      ["2026-11-15", 30],
      ["2026-11-16", 100],
      ["2026-11-17", 100],
      ["2026-11-18", 100],
      ["2026-11-19", 80],
    ]);

    /*
     * $640 so far, the 19th the newest day; the pace is the 12th to the
     * 18th, $560 over 7 days = $80 a day, for the 11 days after the 19th.
     */
    expect(
      projectCloudMonthCost({ dailyTotals: totals, now: NOW }).projectedMonth,
    ).toBeCloseTo(640 + 11 * 80, 6);
  });

  test("with less than a week read, the days there are set the pace", () => {
    const totals: Map<string, number> = days([
      ["2026-11-18", 50],
      ["2026-11-19", 70],
    ]);

    // The pace is the 18th alone: $50 a day for the 11 days after the 19th.
    expect(
      projectCloudMonthCost({ dailyTotals: totals, now: NOW }).projectedMonth,
    ).toBe(120 + 11 * 50);
  });

  test("nothing read is nothing projected", () => {
    expect(projectCloudMonthCost({ dailyTotals: new Map(), now: NOW })).toEqual(
      { monthToDate: 0, projectedMonth: 0 },
    );
  });

  test("costs of an earlier month never count toward this one", () => {
    const totals: Map<string, number> = days([
      ["2026-10-31", 500],
      ["2026-11-01", 10],
    ]);

    expect(
      projectCloudMonthCost({ dailyTotals: totals, now: NOW }).monthToDate,
    ).toBe(10);
  });
});

describe("an account's cost summary", () => {
  test("says this month, last month in full and by now, the last 30 days and the top services", () => {
    const totals: Map<string, number> = new Map([
      ...evenDays("2026-10-01", 31, 10),
      ...evenDays("2026-11-01", 20, 20),
    ]);
    const services: Map<string, number> = new Map([
      ["Amazon EC2", 250],
      ["Amazon RDS", 100],
      ["AWS Lambda", 0],
      ["Amazon S3", 30],
      ["Amazon CloudFront", 10],
      ["Amazon SQS", 5],
      ["Amazon SNS", 3],
    ]);

    const summary: CloudAccountCostSummary = summarizeCloudAccountCosts({
      dailyTotals: totals,
      monthServices: services,
      currency: "USD",
      now: NOW,
    });

    expect(summary.state).toBe(CloudCostState.Reading);
    expect(summary.monthToDate).toBe(400);
    expect(summary.lastMonth).toBe(310);
    // October 1 to 20: the same point of last month.
    expect(summary.lastMonthToDate).toBe(200);
    // October 22 to November 20.
    expect(summary.last30Days).toBe(10 * 10 + 20 * 20);
    expect(summary.topServices).toHaveLength(CLOUD_COST_SUMMARY_TOP_SERVICES);
    expect(summary.topServices[0]).toEqual({
      service: "Amazon EC2",
      amount: 250,
    });
    // A service that cost nothing is not a top service.
    expect(
      summary.topServices.map((entry: { service: string }): string => {
        return entry.service;
      }),
    ).not.toContain("AWS Lambda");
    expect(summary.latestDay).toBe("2026-11-20");
    expect(summary.readAt).toBe(NOW.toISOString());
  });

  test("a cloud naming no currency is in dollars", () => {
    expect(
      summarizeCloudAccountCosts({
        dailyTotals: new Map(),
        monthServices: new Map(),
        currency: "",
        now: NOW,
      }).currency,
    ).toBe(CLOUD_COST_DEFAULT_CURRENCY);
  });

  test("is read back from what was stored, and nothing else", () => {
    expect(readCloudAccountCostSummary(null)).toBeNull();
    expect(readCloudAccountCostSummary("text")).toBeNull();
    expect(readCloudAccountCostSummary([])).toBeNull();
    expect(readCloudAccountCostSummary({ state: "unknown" })).toBeNull();

    const read: CloudAccountCostSummary | null = readCloudAccountCostSummary({
      state: "not-set-up",
      message: "Cost Explorer is not turned on.",
      monthToDate: "12.5",
      lastMonth: "x",
      topServices: [
        { service: "Amazon EC2", amount: "7" },
        { amount: 3 },
        "nonsense",
      ],
    });

    expect(read).toEqual({
      state: CloudCostState.NotSetUp,
      message: "Cost Explorer is not turned on.",
      currency: "USD",
      monthToDate: 12.5,
      lastMonth: 0,
      lastMonthToDate: 0,
      projectedMonth: 0,
      last30Days: 0,
      topServices: [{ service: "Amazon EC2", amount: 7 }],
      latestDay: undefined,
      readAt: "",
    });
  });
});

describe("a resource's cost key", () => {
  test("an Azure id in lower case, as Cost Management writes it; any other as written", () => {
    expect(
      getCloudCostResourceKey(
        "azure",
        " /subscriptions/ABC/resourceGroups/RG/providers/Microsoft.Compute/virtualMachines/Web-1 ",
      ),
    ).toBe(
      "/subscriptions/abc/resourcegroups/rg/providers/microsoft.compute/virtualmachines/web-1",
    );
    expect(
      getCloudCostResourceKey(
        "gcp",
        "//compute.googleapis.com/projects/P/instances/1",
      ),
    ).toBe("//compute.googleapis.com/projects/P/instances/1");
  });
});

describe("rounding and change", () => {
  test("a cost to the hundredth of a cent; what is not a number is nothing", () => {
    expect(roundCost(1.234567)).toBe(1.2346);
    expect(roundCost(Number.NaN)).toBe(0);
    expect(roundCost(Number.POSITIVE_INFINITY)).toBe(0);
  });

  test("this month against last month by now, or nothing to compare with", () => {
    expect(getCloudCostChangePercent({ current: 120, previous: 100 })).toBe(20);
    expect(getCloudCostChangePercent({ current: 50, previous: 100 })).toBe(-50);
    expect(getCloudCostChangePercent({ current: 50, previous: 0 })).toBeNull();
  });

  test("the currency most figures are in; the first of a tie; dollars with none", () => {
    expect(
      getMostCommonCloudCurrency(
        new Map([
          ["EUR", 2],
          ["USD", 1],
        ]),
      ),
    ).toBe("EUR");
    expect(
      getMostCommonCloudCurrency(
        new Map([
          ["USD", 1],
          ["EUR", 1],
        ]),
      ),
    ).toBe("EUR");
    expect(getMostCommonCloudCurrency(new Map())).toBe("USD");
  });
});

describe("several accounts' costs as one", () => {
  test("in the currency most accounts are billed in, the others counted apart", () => {
    const totals: CloudCostTotals = totalCloudCosts([
      costSummary({ monthToDate: 100, lastMonth: 300, projectedMonth: 150 }),
      costSummary({ monthToDate: 50, lastMonth: 60, projectedMonth: 75 }),
      costSummary({ currency: "EUR", monthToDate: 999 }),
      costSummary({ state: CloudCostState.NotAllowed }),
      costSummary({ state: CloudCostState.NotSetUp }),
      costSummary({ state: CloudCostState.Failed }),
      null,
    ]);

    expect(totals.currency).toBe("USD");
    expect(totals.monthToDate).toBe(150);
    expect(totals.lastMonth).toBe(360);
    expect(totals.projectedMonth).toBe(225);
    expect(totals.accountsRead).toBe(2);
    expect(totals.accountsInOtherCurrencies).toBe(1);
    expect(totals.accountsNotAllowed).toBe(1);
    expect(totals.accountsNotSetUp).toBe(1);
    expect(totals.accountsFailed).toBe(1);
  });

  test("no account read is nothing, in dollars", () => {
    const totals: CloudCostTotals = totalCloudCosts([null]);

    expect(totals.accountsRead).toBe(0);
    expect(totals.monthToDate).toBe(0);
    expect(totals.currency).toBe("USD");
  });
});

describe("an account's ways to spend less", () => {
  test("how many, what they save a month, and by what they ask", () => {
    const summary: CloudAccountSavingsSummary = summarizeCloudAccountSavings({
      savings: [
        {
          monthlySavings: 120.5,
          currency: "USD",
          kind: CloudSavingKind.Rightsize,
        },
        {
          monthlySavings: 30,
          currency: "usd",
          kind: CloudSavingKind.Rightsize,
        },
        { monthlySavings: 45, currency: "USD", kind: CloudSavingKind.Idle },
        // A kind no one knows is Other; a negative saving saves nothing.
        {
          monthlySavings: -5,
          currency: "USD",
          kind: "nonsense" as CloudSavingKind,
        },
        // Another currency is counted, but not added to the dollars.
        {
          monthlySavings: 999,
          currency: "EUR",
          kind: CloudSavingKind.Commitment,
        },
      ],
      now: NOW,
    });

    expect(summary.state).toBe(CloudCostState.Reading);
    expect(summary.count).toBe(5);
    expect(summary.currency).toBe("USD");
    expect(summary.monthlySavings).toBe(195.5);
    expect(summary.byKind[CloudSavingKind.Rightsize]).toEqual({
      count: 2,
      monthlySavings: 150.5,
    });
    expect(summary.byKind[CloudSavingKind.Idle]).toEqual({
      count: 1,
      monthlySavings: 45,
    });
    expect(summary.byKind[CloudSavingKind.Other]).toEqual({
      count: 1,
      monthlySavings: 0,
    });
    expect(summary.byKind[CloudSavingKind.Commitment]).toEqual({
      count: 1,
      monthlySavings: 0,
    });
  });

  test("none is nothing to save, in dollars", () => {
    expect(summarizeCloudAccountSavings({ savings: [], now: NOW })).toEqual({
      state: CloudCostState.Reading,
      count: 0,
      monthlySavings: 0,
      byKind: {},
      currency: "USD",
      readAt: NOW.toISOString(),
    });
  });

  test("is read back from what was stored, and nothing else", () => {
    expect(readCloudAccountSavingsSummary(undefined)).toBeNull();
    expect(readCloudAccountSavingsSummary({ state: "nope" })).toBeNull();

    expect(
      readCloudAccountSavingsSummary({
        state: "not-set-up",
        message: "Opt in to Cost Optimization Hub.",
        count: "3.6",
        monthlySavings: -10,
        byKind: {
          rightsize: { count: 2, monthlySavings: "40" },
          unknown: { count: 1, monthlySavings: 5 },
          idle: "nonsense",
        },
      }),
    ).toEqual({
      state: CloudCostState.NotSetUp,
      message: "Opt in to Cost Optimization Hub.",
      count: 4,
      monthlySavings: 0,
      byKind: { rightsize: { count: 2, monthlySavings: 40 } },
      currency: "USD",
      readAt: "",
    });
  });

  test("every kind has a label, and only those kinds are kinds", () => {
    for (const kind of Object.values(CloudSavingKind)) {
      expect(CLOUD_SAVING_KIND_LABELS[kind]).toBeTruthy();
      expect(isCloudSavingKind(kind)).toBe(true);
    }
    expect(isCloudSavingKind("downsize")).toBe(false);
  });
});

describe("several accounts' savings as one", () => {
  test("in the costs' currency, by kind, with why some were not read", () => {
    const totals: CloudSavingsTotals = totalCloudSavings({
      summaries: [
        savingsSummary({
          count: 2,
          monthlySavings: 100,
          byKind: { rightsize: { count: 2, monthlySavings: 100 } },
        }),
        savingsSummary({
          count: 1,
          monthlySavings: 40,
          byKind: { rightsize: { count: 1, monthlySavings: 40 } },
        }),
        // A failed read keeps what the account had.
        savingsSummary({
          state: CloudCostState.Failed,
          count: 1,
          monthlySavings: 10,
          byKind: { idle: { count: 1, monthlySavings: 10 } },
        }),
        savingsSummary({ currency: "EUR", count: 1, monthlySavings: 999 }),
        // Nothing to save is in every currency.
        savingsSummary({ currency: "GBP" }),
        savingsSummary({ state: CloudCostState.NotSetUp }),
        savingsSummary({ state: CloudCostState.NotAllowed }),
        null,
      ],
      currency: "usd",
    });

    expect(totals.currency).toBe("USD");
    expect(totals.monthlySavings).toBe(150);
    expect(totals.count).toBe(4);
    expect(totals.accountsRead).toBe(3);
    expect(totals.accountsInOtherCurrencies).toBe(1);
    expect(totals.accountsFailed).toBe(1);
    expect(totals.accountsNotSetUp).toBe(1);
    expect(totals.accountsNotAllowed).toBe(1);
    expect(totals.byKind).toEqual({
      rightsize: { count: 3, monthlySavings: 140 },
      idle: { count: 1, monthlySavings: 10 },
    });
  });

  test("with no costs read, the currency most savings are in", () => {
    expect(
      totalCloudSavings({
        summaries: [
          savingsSummary({ currency: "EUR", count: 1, monthlySavings: 5 }),
        ],
      }).currency,
    ).toBe("EUR");
  });
});

describe("a budget's thresholds", () => {
  test("a budget's month is its year and month", () => {
    expect(toCloudBudgetMonth(NOW)).toBe("2026-11");
  });

  test("the thresholds the month's spend has passed, the highest last", () => {
    expect(
      getPassedCloudBudgetThresholds({
        spent: 850,
        amount: 1000,
        thresholds: [100, 50, 80, 80, -5, Number.NaN],
      }),
    ).toEqual([50, 80]);
    expect(
      getPassedCloudBudgetThresholds({
        spent: 1200,
        amount: 1000,
        thresholds: [80, 100],
      }),
    ).toEqual([80, 100]);
    // No amount, no threshold.
    expect(
      getPassedCloudBudgetThresholds({ spent: 1, amount: 0, thresholds: [80] }),
    ).toEqual([]);
  });

  test("read back as whole percents from 1 to 1000, the defaults when none is", () => {
    expect(readCloudBudgetThresholds("100, 80,80, 50.4")).toEqual([
      50, 80, 100,
    ]);
    expect(readCloudBudgetThresholds([120, "90"])).toEqual([90, 120]);
    expect(readCloudBudgetThresholds("0,2000,abc")).toEqual(
      CLOUD_BUDGET_DEFAULT_THRESHOLDS,
    );
    expect(readCloudBudgetThresholds(undefined)).toEqual(
      CLOUD_BUDGET_DEFAULT_THRESHOLDS,
    );
    // The defaults are a copy: changing one read leaves the next alone.
    readCloudBudgetThresholds(null).push(5);
    expect(readCloudBudgetThresholds(null)).toEqual([80, 100]);
  });
});
