import { describe, expect, test } from "@jest/globals";
import {
  CLOUD_BUDGET_ALERT_FROM_PERCENT,
  CLOUD_BUDGET_UNUSUAL_DAY_MIN_INCREASE,
  CloudBudgetCheckWindow,
  CloudBudgetPeriod,
  CloudBudgetPeriodWindow,
  CloudBudgetPlanSplit,
  CloudBudgetScope,
  CloudBudgetUnusualDayUnit,
  CloudBudgetWindowSpend,
  getCloudBudgetCheckWindow,
  getCloudBudgetMonthlyPlan,
  getCloudBudgetPeriodWindow,
  getCloudBudgetPlannedToDate,
  getCloudBudgetWindowDays,
  getCloudBudgetWindowNoun,
  getPreviousCloudBudgetPeriodWindow,
  isCloudBudgetNoticeOnly,
  isCloudBudgetUnusualDay,
  projectCloudBudgetWindow,
  readCloudBudgetFiscalYearStartMonth,
  readCloudBudgetMonthlyPlan,
  readCloudBudgetPeriod,
  readCloudBudgetPlanSplit,
  readCloudBudgetScope,
  readCloudBudgetUnusualDayRule,
  splitCloudBudgetAmountEqually,
  sumCloudBudgetPlan,
} from "../../../Types/Cloud/CloudBudget";
import {
  projectCloudMonthCost,
  toCloudCostDay,
} from "../../../Types/Cloud/CloudCost";

/*
 * A CLOUD BUDGET'S SCOPE, PERIOD, PLAN AND PROJECTION (#11008), as the
 * evaluator, the API and the Dashboard all read them:
 *
 *   - a period is a calendar month, or the quarter or year of the fiscal
 *     year holding the day - a year from April runs April to March, its
 *     quarters April-June, July-September, October-December, January-March;
 *   - a yearly budget split by month is checked against the month it is in
 *     and that month's share, and says what it planned up to the day;
 *   - a window is projected as months were before periods: the rest of this
 *     month at the last full week's pace, the months after it as forecast;
 *   - below 100% a budget with people to tell tells them with no alert;
 *   - a budget's own unusual day is an amount or a percent above usual.
 */

// Each day of a span, at an amount: "2026-11-01" -> amount.
function evenDays(
  start: string,
  count: number,
  amount: number,
): Map<string, number> {
  const totals: Map<string, number> = new Map();
  const first: Date = new Date(`${start}T00:00:00.000Z`);

  for (let index: number = 0; index < count; index++) {
    totals.set(
      toCloudCostDay(new Date(first.getTime() + index * 86400000)),
      amount,
    );
  }

  return totals;
}

function at(iso: string): Date {
  return new Date(iso);
}

function period(
  data: { period: unknown; fiscalYearStartMonth?: unknown },
  now: string,
): CloudBudgetPeriodWindow {
  return getCloudBudgetPeriodWindow({
    period: data.period,
    fiscalYearStartMonth: data.fiscalYearStartMonth ?? 1,
    now: at(now),
  });
}

function days(window: CloudBudgetPeriodWindow): Array<string> {
  return [
    getCloudBudgetWindowDays(window).start,
    getCloudBudgetWindowDays(window).lastDay,
  ];
}

describe("a budget's period", () => {
  test("a monthly budget's period is the calendar month, kept apart as months always were", () => {
    const window: CloudBudgetPeriodWindow = period(
      { period: CloudBudgetPeriod.Month },
      "2026-11-20T15:30:00.000Z",
    );

    expect(days(window)).toEqual(["2026-11-01", "2026-11-30"]);
    expect(window.months).toEqual(["2026-11"]);
    // The key every budget's month had before periods: its alerts carry on.
    expect(window.key).toBe("2026-11");
    expect(window.period).toBe(CloudBudgetPeriod.Month);
  });

  test("a month's last hour is still that month (UTC), and the next starts at midnight", () => {
    expect(
      period({ period: "month" }, "2026-11-30T23:59:59.999Z").months,
    ).toEqual(["2026-11"]);
    expect(
      period({ period: "month" }, "2026-12-01T00:00:00.000Z").months,
    ).toEqual(["2026-12"]);
  });

  test("February's last day, in a leap year and not", () => {
    expect(days(period({ period: "month" }, "2028-02-10T00:00:00Z"))).toEqual([
      "2028-02-01",
      "2028-02-29",
    ]);
    expect(days(period({ period: "month" }, "2027-02-10T00:00:00Z"))).toEqual([
      "2027-02-01",
      "2027-02-28",
    ]);
  });

  test("calendar quarters, for a fiscal year from January", () => {
    expect(days(period({ period: "quarter" }, "2026-11-20T00:00:00Z"))).toEqual(
      ["2026-10-01", "2026-12-31"],
    );
    expect(days(period({ period: "quarter" }, "2026-01-01T00:00:00Z"))).toEqual(
      ["2026-01-01", "2026-03-31"],
    );
    expect(days(period({ period: "quarter" }, "2026-06-30T12:00:00Z"))).toEqual(
      ["2026-04-01", "2026-06-30"],
    );
    expect(period({ period: "quarter" }, "2026-11-20T00:00:00Z").key).toBe(
      "2026-10/3",
    );
    expect(
      period({ period: "quarter" }, "2026-11-20T00:00:00Z").months,
    ).toEqual(["2026-10", "2026-11", "2026-12"]);
  });

  test("a fiscal year from April has quarters April-June, July-September, October-December and January-March", () => {
    const fiscal: { period: string; fiscalYearStartMonth: number } = {
      period: "quarter",
      fiscalYearStartMonth: 4,
    };

    expect(days(period(fiscal, "2026-04-01T00:00:00Z"))).toEqual([
      "2026-04-01",
      "2026-06-30",
    ]);
    expect(days(period(fiscal, "2026-08-15T00:00:00Z"))).toEqual([
      "2026-07-01",
      "2026-09-30",
    ]);
    expect(days(period(fiscal, "2026-11-20T00:00:00Z"))).toEqual([
      "2026-10-01",
      "2026-12-31",
    ]);
    expect(days(period(fiscal, "2027-02-10T00:00:00Z"))).toEqual([
      "2027-01-01",
      "2027-03-31",
    ]);
  });

  test("a fiscal year from February has quarters that straddle the calendar's", () => {
    const fiscal: { period: string; fiscalYearStartMonth: number } = {
      period: "quarter",
      fiscalYearStartMonth: 2,
    };

    expect(days(period(fiscal, "2027-01-15T00:00:00Z"))).toEqual([
      "2026-11-01",
      "2027-01-31",
    ]);
    expect(period(fiscal, "2027-01-15T00:00:00Z").months).toEqual([
      "2026-11",
      "2026-12",
      "2027-01",
    ]);
  });

  test("a yearly budget from April runs April to March, whichever side of New Year the day is", () => {
    const fiscal: { period: string; fiscalYearStartMonth: number } = {
      period: "year",
      fiscalYearStartMonth: 4,
    };

    for (const day of [
      "2026-04-01T00:00:00Z",
      "2026-11-20T00:00:00Z",
      "2027-01-01T00:00:00Z",
      "2027-03-31T23:59:59Z",
    ]) {
      expect(days(period(fiscal, day))).toEqual(["2026-04-01", "2027-03-31"]);
    }

    expect(days(period(fiscal, "2027-04-01T00:00:00Z"))).toEqual([
      "2027-04-01",
      "2028-03-31",
    ]);

    const window: CloudBudgetPeriodWindow = period(
      fiscal,
      "2026-11-20T00:00:00Z",
    );

    expect(window.months).toHaveLength(12);
    expect(window.months[0]).toBe("2026-04");
    expect(window.months[11]).toBe("2027-03");
    expect(window.key).toBe("2026-04/12");
  });

  test("a calendar year, for a fiscal year from January", () => {
    expect(days(period({ period: "year" }, "2026-11-20T00:00:00Z"))).toEqual([
      "2026-01-01",
      "2026-12-31",
    ]);
  });

  test("the period before: a month, a quarter and a fiscal year back", () => {
    const now: Date = at("2026-11-20T00:00:00Z");

    expect(
      days(
        getPreviousCloudBudgetPeriodWindow({
          period: "month",
          fiscalYearStartMonth: 1,
          now,
        }),
      ),
    ).toEqual(["2026-10-01", "2026-10-31"]);
    expect(
      days(
        getPreviousCloudBudgetPeriodWindow({
          period: "quarter",
          fiscalYearStartMonth: 4,
          now,
        }),
      ),
    ).toEqual(["2026-07-01", "2026-09-30"]);
    expect(
      days(
        getPreviousCloudBudgetPeriodWindow({
          period: "year",
          fiscalYearStartMonth: 4,
          now,
        }),
      ),
    ).toEqual(["2025-04-01", "2026-03-31"]);
  });

  test("what is not a period or a month of the year reads as a month and January", () => {
    expect(readCloudBudgetPeriod("fortnight")).toBe(CloudBudgetPeriod.Month);
    expect(readCloudBudgetPeriod(undefined)).toBe(CloudBudgetPeriod.Month);
    expect(readCloudBudgetPeriod("year")).toBe(CloudBudgetPeriod.Year);

    for (const value of [0, 13, -1, 4.5, "x", null, undefined, ""]) {
      expect(readCloudBudgetFiscalYearStartMonth(value)).toBe(1);
    }

    expect(readCloudBudgetFiscalYearStartMonth("4")).toBe(4);
    expect(readCloudBudgetFiscalYearStartMonth(12)).toBe(12);
    // An unreadable fiscal year leaves a yearly budget a calendar year.
    expect(
      days(
        period(
          { period: "year", fiscalYearStartMonth: 99 },
          "2026-11-20T00:00:00Z",
        ),
      ),
    ).toEqual(["2026-01-01", "2026-12-31"]);
  });

  test("the window's noun, as alerts say 'the quarter' or 'the month'", () => {
    const now: Date = at("2026-11-20T00:00:00Z");

    expect(
      getCloudBudgetWindowNoun(
        getCloudBudgetCheckWindow({
          period: "quarter",
          fiscalYearStartMonth: 1,
          amount: 100,
          planSplit: "none",
          monthlyPlan: null,
          now,
        }),
      ),
    ).toBe("quarter");
    expect(
      getCloudBudgetWindowNoun(
        getCloudBudgetCheckWindow({
          period: "year",
          fiscalYearStartMonth: 1,
          amount: 1200,
          planSplit: "equal",
          monthlyPlan: null,
          now,
        }),
      ),
    ).toBe("month");
    expect(
      getCloudBudgetWindowNoun(
        getCloudBudgetCheckWindow({
          period: "year",
          fiscalYearStartMonth: 1,
          amount: 1200,
          planSplit: "none",
          monthlyPlan: null,
          now,
        }),
      ),
    ).toBe("year");
  });
});

describe("a budget's scope", () => {
  test("its own, else what its columns say", () => {
    expect(readCloudBudgetScope({ scope: "costGroup" })).toBe(
      CloudBudgetScope.CostGroup,
    );
    expect(readCloudBudgetScope({ scope: "filter" })).toBe(
      CloudBudgetScope.Filter,
    );
    // Written before scopes were: an account's when it names one.
    expect(
      readCloudBudgetScope({ scope: undefined, cloudAccountId: "abc" }),
    ).toBe(CloudBudgetScope.Account);
    expect(readCloudBudgetScope({ scope: null })).toBe(
      CloudBudgetScope.AllAccounts,
    );
    expect(readCloudBudgetScope({ scope: "everything" })).toBe(
      CloudBudgetScope.AllAccounts,
    );
  });

  test("a budget that names an account and says every account is the account's: the release before writes the default", () => {
    expect(
      readCloudBudgetScope({ scope: "allAccounts", cloudAccountId: "abc" }),
    ).toBe(CloudBudgetScope.Account);
    expect(readCloudBudgetScope({ scope: "allAccounts" })).toBe(
      CloudBudgetScope.AllAccounts,
    );
  });
});

describe("a yearly budget's plan", () => {
  test("twelve equal months to the cent, the last taking what is left", () => {
    expect(splitCloudBudgetAmountEqually(12000, 12)).toEqual(
      new Array(12).fill(1000),
    );

    const odd: Array<number> = splitCloudBudgetAmountEqually(100, 12);

    expect(odd.slice(0, 11)).toEqual(new Array(11).fill(8.33));
    expect(odd[11]).toBe(8.37);
    expect(sumCloudBudgetPlan(odd)).toBe(100);
    expect(splitCloudBudgetAmountEqually(100, 3)).toEqual([
      33.33, 33.33, 33.34,
    ]);
  });

  test("typed months read back to the cent, or not at all", () => {
    const typed: Array<number | string> = [
      800,
      800,
      900,
      900,
      900,
      1000,
      1000,
      1100,
      1200,
      1600,
      900,
      "800.006",
    ];

    expect(readCloudBudgetMonthlyPlan(typed)).toEqual([
      800, 800, 900, 900, 900, 1000, 1000, 1100, 1200, 1600, 900, 800.01,
    ]);
    expect(readCloudBudgetMonthlyPlan(new Array(11).fill(1))).toBeNull();
    expect(readCloudBudgetMonthlyPlan(new Array(13).fill(1))).toBeNull();
    expect(
      readCloudBudgetMonthlyPlan([...new Array(11).fill(1), -1]),
    ).toBeNull();
    expect(
      readCloudBudgetMonthlyPlan([...new Array(11).fill(1), "a lot"]),
    ).toBeNull();
    expect(readCloudBudgetMonthlyPlan("[1,2,3]")).toBeNull();
    // A month that may cost nothing is a month of the plan.
    expect(readCloudBudgetMonthlyPlan(new Array(12).fill(0))).toEqual(
      new Array(12).fill(0),
    );
  });

  test("only a yearly budget is split; one that is not, or whose months do not read, is checked as a whole", () => {
    const months: Array<number> = new Array(12).fill(100);

    expect(
      getCloudBudgetMonthlyPlan({
        period: "quarter",
        amount: 1200,
        planSplit: "equal",
        monthlyPlan: null,
      }),
    ).toBeNull();
    expect(
      getCloudBudgetMonthlyPlan({
        period: "year",
        amount: 1200,
        planSplit: "none",
        monthlyPlan: months,
      }),
    ).toBeNull();
    expect(
      getCloudBudgetMonthlyPlan({
        period: "year",
        amount: 1200,
        planSplit: "byMonth",
        monthlyPlan: [1, 2],
      }),
    ).toBeNull();
    expect(
      getCloudBudgetMonthlyPlan({
        period: "year",
        amount: 1200,
        planSplit: "byMonth",
        monthlyPlan: months,
      }),
    ).toEqual(months);
    expect(
      getCloudBudgetMonthlyPlan({
        period: "year",
        amount: 1200,
        planSplit: "equal",
        monthlyPlan: null,
      }),
    ).toEqual(new Array(12).fill(100));
    expect(readCloudBudgetPlanSplit("seasonal")).toBe(
      CloudBudgetPlanSplit.None,
    );
  });
});

describe("the window a budget is checked against", () => {
  // A fiscal year from April, its December the busiest.
  const SEASONAL: Array<number> = [
    800, 800, 900, 900, 900, 1000, 1000, 1100, 1600, 1200, 900, 800,
  ];

  test("a monthly budget: the month, for its amount", () => {
    const window: CloudBudgetCheckWindow = getCloudBudgetCheckWindow({
      period: "month",
      fiscalYearStartMonth: 1,
      amount: 500,
      planSplit: "none",
      monthlyPlan: null,
      now: at("2026-11-20T00:00:00Z"),
    });

    expect(window.key).toBe("2026-11");
    expect(window.amount).toBe(500);
    expect(window.isPlanMonth).toBe(false);
    expect(window.plan).toBeNull();
  });

  test("a quarterly budget: the quarter so far, for the quarter's amount", () => {
    const window: CloudBudgetCheckWindow = getCloudBudgetCheckWindow({
      period: "quarter",
      fiscalYearStartMonth: 4,
      amount: 15000,
      planSplit: "none",
      monthlyPlan: null,
      now: at("2026-11-20T00:00:00Z"),
    });

    expect(window.key).toBe("2026-10/3");
    expect(window.months).toEqual(["2026-10", "2026-11", "2026-12"]);
    expect(window.amount).toBe(15000);
  });

  test("a yearly budget split equally: this month, for a twelfth", () => {
    const window: CloudBudgetCheckWindow = getCloudBudgetCheckWindow({
      period: "year",
      fiscalYearStartMonth: 4,
      amount: 12000,
      planSplit: "equal",
      monthlyPlan: null,
      now: at("2026-11-20T00:00:00Z"),
    });

    expect(window.key).toBe("2026-11/1");
    expect(window.months).toEqual(["2026-11"]);
    expect(window.amount).toBe(1000);
    expect(window.isPlanMonth).toBe(true);
    expect(window.period.key).toBe("2026-04/12");
  });

  test("a yearly budget typed by month from April: November is the plan's eighth month, December its ninth", () => {
    const november: CloudBudgetCheckWindow = getCloudBudgetCheckWindow({
      period: "year",
      fiscalYearStartMonth: 4,
      amount: 12000,
      planSplit: "byMonth",
      monthlyPlan: SEASONAL,
      now: at("2026-11-20T00:00:00Z"),
    });
    const december: CloudBudgetCheckWindow = getCloudBudgetCheckWindow({
      period: "year",
      fiscalYearStartMonth: 4,
      amount: 12000,
      planSplit: "byMonth",
      monthlyPlan: SEASONAL,
      now: at("2026-12-03T00:00:00Z"),
    });
    const march: CloudBudgetCheckWindow = getCloudBudgetCheckWindow({
      period: "year",
      fiscalYearStartMonth: 4,
      amount: 12000,
      planSplit: "byMonth",
      monthlyPlan: SEASONAL,
      now: at("2027-03-31T00:00:00Z"),
    });

    expect(november.amount).toBe(1100);
    expect(december.amount).toBe(1600);
    expect(march.amount).toBe(800);
    expect(december.key).toBe("2026-12/1");
  });

  test("what a split year planned up to the day: its earlier months, and this one's share of the days reported", () => {
    const window: CloudBudgetCheckWindow = getCloudBudgetCheckWindow({
      period: "year",
      fiscalYearStartMonth: 4,
      amount: 12000,
      planSplit: "byMonth",
      monthlyPlan: SEASONAL,
      now: at("2026-11-20T00:00:00Z"),
    });

    // April to October, then fifteen of November's thirty days of 1,100.
    expect(
      getCloudBudgetPlannedToDate({
        window,
        now: at("2026-11-20T00:00:00Z"),
        latestDay: "2026-11-15",
      }),
    ).toBe(800 + 800 + 900 + 900 + 900 + 1000 + 1000 + 550);
    // Nothing reported this month yet: the months before alone.
    expect(
      getCloudBudgetPlannedToDate({
        window,
        now: at("2026-11-20T00:00:00Z"),
        latestDay: "2026-10-31",
      }),
    ).toBe(6300);
    // A budget not split has nothing planned to date: its amount is the period's.
    expect(
      getCloudBudgetPlannedToDate({
        window: getCloudBudgetCheckWindow({
          period: "year",
          fiscalYearStartMonth: 4,
          amount: 12000,
          planSplit: "none",
          monthlyPlan: null,
          now: at("2026-11-20T00:00:00Z"),
        }),
        now: at("2026-11-20T00:00:00Z"),
      }),
    ).toBeNull();
  });
});

describe("a window's projection", () => {
  const NOW: Date = at("2026-11-20T15:30:00.000Z");

  // November 1-19 at 100 a day, and the 20th, reported in part, at 30.
  function november(): Map<string, number> {
    const totals: Map<string, number> = evenDays("2026-11-01", 19, 100);
    totals.set("2026-11-20", 30);
    return totals;
  }

  test("a monthly budget is projected exactly as months always were", () => {
    const monthly: CloudBudgetWindowSpend = projectCloudBudgetWindow({
      window: getCloudBudgetPeriodWindow({
        period: "month",
        fiscalYearStartMonth: 1,
        now: NOW,
      }),
      now: NOW,
      pastMonths: new Map(),
      dailyTotals: november(),
    });
    const before: { monthToDate: number; projectedMonth: number } =
      projectCloudMonthCost({ dailyTotals: november(), now: NOW });

    expect(monthly.spent).toBe(before.monthToDate);
    expect(monthly.projected).toBe(before.projectedMonth);
    expect(monthly.projected).toBe(1930 + 10 * 100);
    expect(monthly.dailyPace).toBe(100);
    expect(monthly.latestDay).toBe("2026-11-20");
  });

  test("a quarter: its earlier months as they cost, this month at the pace, the next as forecast", () => {
    const quarter: CloudBudgetWindowSpend = projectCloudBudgetWindow({
      window: getCloudBudgetPeriodWindow({
        period: "quarter",
        fiscalYearStartMonth: 1,
        now: NOW,
      }),
      now: NOW,
      pastMonths: new Map([["2026-10", 3000]]),
      dailyTotals: november(),
      laterMonths: new Map([["2026-12", 3500]]),
    });

    expect(quarter.spent).toBe(3000 + 1930);
    expect(quarter.projected).toBe(3000 + 2930 + 3500);
    expect(quarter.monthSpent).toBe(1930);
    expect(quarter.monthProjected).toBe(2930);
  });

  test("a later month with no forecast is at the last full week's pace", () => {
    const quarter: CloudBudgetWindowSpend = projectCloudBudgetWindow({
      window: getCloudBudgetPeriodWindow({
        period: "quarter",
        fiscalYearStartMonth: 1,
        now: NOW,
      }),
      now: NOW,
      pastMonths: new Map([["2026-10", 3000]]),
      dailyTotals: november(),
    });

    // December's 31 days at 100.
    expect(quarter.projected).toBe(3000 + 2930 + 3100);
  });

  test("a year from April: seven months behind it, the rest of November at the pace, four months as forecast", () => {
    const year: CloudBudgetWindowSpend = projectCloudBudgetWindow({
      window: getCloudBudgetPeriodWindow({
        period: "year",
        fiscalYearStartMonth: 4,
        now: NOW,
      }),
      now: NOW,
      pastMonths: new Map([
        ["2026-04", 1000],
        ["2026-05", 1000],
        ["2026-06", 1000],
        ["2026-07", 1000],
        ["2026-08", 1000],
        ["2026-09", 1000],
        ["2026-10", 1000],
        // A month before the year began is never counted.
        ["2026-03", 99999],
      ]),
      dailyTotals: november(),
      laterMonths: new Map([
        ["2026-12", 4000],
        ["2027-01", 3000],
        ["2027-02", 3000],
        ["2027-03", 3000],
        // Nor one after it ends.
        ["2027-04", 99999],
      ]),
    });

    expect(year.spent).toBe(7000 + 1930);
    expect(year.projected).toBe(7000 + 2930 + 13000);
  });

  test("nothing read is nothing spent, and nothing projected but the forecast", () => {
    const quarter: CloudBudgetWindowSpend = projectCloudBudgetWindow({
      window: getCloudBudgetPeriodWindow({
        period: "quarter",
        fiscalYearStartMonth: 1,
        now: NOW,
      }),
      now: NOW,
      pastMonths: new Map(),
      dailyTotals: new Map(),
      laterMonths: new Map([["2026-12", 250]]),
    });

    expect(quarter.spent).toBe(0);
    expect(quarter.projected).toBe(250);
    expect(quarter.dailyPace).toBe(0);
    expect(quarter.latestDay).toBeUndefined();
  });
});

describe("who is told, and how", () => {
  test("below 100% a budget with people to tell tells them with no alert; from 100%, and with nobody to tell, it alerts", () => {
    expect(CLOUD_BUDGET_ALERT_FROM_PERCENT).toBe(100);
    expect(
      isCloudBudgetNoticeOnly({ threshold: 80, hasPeopleToNotify: true }),
    ).toBe(true);
    expect(
      isCloudBudgetNoticeOnly({ threshold: 99, hasPeopleToNotify: true }),
    ).toBe(true);
    expect(
      isCloudBudgetNoticeOnly({ threshold: 100, hasPeopleToNotify: true }),
    ).toBe(false);
    expect(
      isCloudBudgetNoticeOnly({ threshold: 120, hasPeopleToNotify: true }),
    ).toBe(false);
    // As every budget did before it could name anyone.
    expect(
      isCloudBudgetNoticeOnly({ threshold: 80, hasPeopleToNotify: false }),
    ).toBe(false);
  });
});

describe("a budget's own unusual day", () => {
  test("no threshold, or none above zero, is the project-wide rule", () => {
    expect(
      readCloudBudgetUnusualDayRule({ threshold: null, unit: "amount" }),
    ).toBeNull();
    expect(
      readCloudBudgetUnusualDayRule({ threshold: 0, unit: "percent" }),
    ).toBeNull();
    expect(
      readCloudBudgetUnusualDayRule({ threshold: -5, unit: "amount" }),
    ).toBeNull();
    expect(
      readCloudBudgetUnusualDayRule({ threshold: "", unit: "amount" }),
    ).toBeNull();
  });

  test("an amount, or a percent capped at ten times the usual day", () => {
    expect(
      readCloudBudgetUnusualDayRule({ threshold: "250", unit: "amount" }),
    ).toEqual({ unit: CloudBudgetUnusualDayUnit.Amount, threshold: 250 });
    expect(
      readCloudBudgetUnusualDayRule({ threshold: 50, unit: "percent" }),
    ).toEqual({ unit: CloudBudgetUnusualDayUnit.Percent, threshold: 50 });
    expect(
      readCloudBudgetUnusualDayRule({ threshold: 5000, unit: "percent" }),
    ).toEqual({ unit: CloudBudgetUnusualDayUnit.Percent, threshold: 1000 });
    // A unit nobody knows is an amount.
    expect(
      readCloudBudgetUnusualDayRule({ threshold: 7, unit: "dollars" }),
    ).toEqual({ unit: CloudBudgetUnusualDayUnit.Amount, threshold: 7 });
  });

  test("a day is unusual at least the amount above usual", () => {
    const rule: { unit: CloudBudgetUnusualDayUnit; threshold: number } = {
      unit: CloudBudgetUnusualDayUnit.Amount,
      threshold: 250,
    };

    expect(isCloudBudgetUnusualDay({ rule, amount: 1250, usual: 1000 })).toBe(
      true,
    );
    expect(isCloudBudgetUnusualDay({ rule, amount: 1249, usual: 1000 })).toBe(
      false,
    );
    // A scope that cost nothing and now costs 300 is 300 above its usual.
    expect(isCloudBudgetUnusualDay({ rule, amount: 300, usual: 0 })).toBe(true);
  });

  test("a percent also needs the day to be at least 10 more than usual, so cents are never a spike", () => {
    const rule: { unit: CloudBudgetUnusualDayUnit; threshold: number } = {
      unit: CloudBudgetUnusualDayUnit.Percent,
      threshold: 50,
    };

    expect(CLOUD_BUDGET_UNUSUAL_DAY_MIN_INCREASE).toBe(10);
    expect(isCloudBudgetUnusualDay({ rule, amount: 150, usual: 100 })).toBe(
      true,
    );
    expect(isCloudBudgetUnusualDay({ rule, amount: 149, usual: 100 })).toBe(
      false,
    );
    // Doubled, but only 4 more.
    expect(isCloudBudgetUnusualDay({ rule, amount: 8, usual: 4 })).toBe(false);
    // No usual to take a percent of.
    expect(isCloudBudgetUnusualDay({ rule, amount: 500, usual: 0 })).toBe(
      false,
    );
  });
});
