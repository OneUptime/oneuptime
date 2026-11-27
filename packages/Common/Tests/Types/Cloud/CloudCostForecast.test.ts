import { describe, expect, test } from "@jest/globals";
import {
  CLOUD_COST_FORECAST_CONFIDENCE_PERCENT,
  CLOUD_COST_FORECAST_MIN_SPREAD,
  CloudCostForecast,
  CloudCostForecastMethod,
  CloudCostForecastMonth,
  CloudCostForecastMonthKind,
  addCloudCostMonths,
  applyCloudCostGrowth,
  fitCloudCostTrend,
  forecastCloudCosts,
  getCloudBudgetPlanFromForecast,
  getCloudCostForecastAhead,
  getCloudCostForecastByMonth,
  getCloudCostForecastHistory,
  getCloudCostForecastMedian,
  getCloudCostForecastQuantile,
  getCloudCostForecastSpread,
  getCloudCostMonthDays,
  isCloudCostMonth,
  readCloudCostForecastGrowth,
} from "../../../Types/Cloud/CloudCostForecast";

/*
 * A FORECAST OF CLOUD SPEND (#11008), and how it says it was made:
 *
 *   - with fewer than 3 full months, the last full week's pace carried
 *     forward, with no range;
 *   - from 3, a robust trend through the months' daily averages - a
 *     February is no dip, and one odd month barely moves the line;
 *   - from 12, each calendar month's ratio to that trend as its seasonal
 *     factor: a December peak comes back next December;
 *   - an 80% range from how far past months fell from the trend, never
 *     under 5%, wider further ahead;
 *   - a growth what-if from a month on, and a forecast as a yearly
 *     budget's plan in the fiscal year's order.
 */

// Months from `first`, each at a daily average: "2026-04" -> average x days.
function monthsAt(
  first: string,
  dailyAverages: Array<number>,
): Array<{ month: string; amount: number }> {
  return dailyAverages.map((average: number, index: number) => {
    const month: string = addCloudCostMonths(first, index);
    return { month, amount: average * getCloudCostMonthDays(month) };
  });
}

function aheadOf(forecast: CloudCostForecast): Array<CloudCostForecastMonth> {
  return getCloudCostForecastAhead(forecast);
}

function monthOf(
  forecast: CloudCostForecast,
  month: string,
): CloudCostForecastMonth {
  const found: CloudCostForecastMonth | undefined = forecast.months.find(
    (entry: CloudCostForecastMonth): boolean => {
      return entry.month === month;
    },
  );

  if (!found) {
    throw new Error(`No ${month} in the forecast.`);
  }

  return found;
}

describe("months", () => {
  test("a month plus some, across a year's end, and its days", () => {
    expect(addCloudCostMonths("2026-11", 1)).toBe("2026-12");
    expect(addCloudCostMonths("2026-11", 2)).toBe("2027-01");
    expect(addCloudCostMonths("2026-01", -1)).toBe("2025-12");
    expect(getCloudCostMonthDays("2027-02")).toBe(28);
    expect(getCloudCostMonthDays("2028-02")).toBe(29);
    expect(getCloudCostMonthDays("2026-12")).toBe(31);
    expect(isCloudCostMonth("2026-12")).toBe(true);
    expect(isCloudCostMonth("2026-13")).toBe(false);
    expect(isCloudCostMonth("2026-1")).toBe(false);
    expect(isCloudCostMonth(202612)).toBe(false);
  });
});

describe("the trend and its spread", () => {
  test("a straight line is found exactly", () => {
    const fit: { slope: number; intercept: number } = fitCloudCostTrend([
      { x: 0, y: 100 },
      { x: 1, y: 110 },
      { x: 2, y: 120 },
      { x: 3, y: 130 },
    ]);

    expect(fit.slope).toBeCloseTo(10, 10);
    expect(fit.intercept).toBeCloseTo(100, 10);
  });

  test("one far-off month barely moves it, where a least-squares line would lean towards it", () => {
    const fit: { slope: number; intercept: number } = fitCloudCostTrend([
      { x: 0, y: 100 },
      { x: 1, y: 100 },
      { x: 2, y: 100 },
      { x: 3, y: 900 },
      { x: 4, y: 100 },
      { x: 5, y: 100 },
    ]);

    expect(fit.slope).toBeCloseTo(0, 10);
    expect(fit.intercept).toBeCloseTo(100, 10);
  });

  test("nothing to fit is a flat zero", () => {
    expect(fitCloudCostTrend([])).toEqual({ slope: 0, intercept: 0 });
    expect(fitCloudCostTrend([{ x: 3, y: 50 }])).toEqual({
      slope: 0,
      intercept: 50,
    });
  });

  test("the median, of odd and even counts", () => {
    expect(getCloudCostForecastMedian([3, 1, 2])).toBe(2);
    expect(getCloudCostForecastMedian([4, 1, 2, 3])).toBe(2.5);
    expect(getCloudCostForecastMedian([])).toBe(0);
  });

  test("the spread is robust, and never under 5%", () => {
    expect(getCloudCostForecastSpread([0, 0, 0, 0])).toBe(
      CLOUD_COST_FORECAST_MIN_SPREAD,
    );
    // One month's spike leaves the typical month's spread.
    expect(getCloudCostForecastSpread([0, 0, 0, 0, 0, 5])).toBe(0.05);
    // Months 20% either side of the trend.
    expect(getCloudCostForecastSpread([-0.2, 0.2, -0.2, 0.2])).toBeCloseTo(
      1.4826 * 0.2,
      6,
    );
  });

  test("an 80% range's quantile: Student's t, the normal's beyond twelve degrees", () => {
    expect(getCloudCostForecastQuantile(1)).toBe(3.078);
    expect(getCloudCostForecastQuantile(0)).toBe(3.078);
    expect(getCloudCostForecastQuantile(10)).toBe(1.372);
    expect(getCloudCostForecastQuantile(40)).toBe(1.282);
  });
});

describe("the months a forecast is made from", () => {
  test("from the first month with spend to last month, a month not named costing nothing", () => {
    expect(
      getCloudCostForecastHistory({
        history: [
          { month: "2026-05", amount: 0 },
          { month: "2026-06", amount: 0 },
          { month: "2026-07", amount: 100 },
          { month: "2026-09", amount: 300 },
          // This month and later are never history.
          { month: "2026-11", amount: 999 },
          { month: "2027-01", amount: 999 },
          { month: "not a month", amount: 5 },
        ],
        currentMonth: "2026-11",
      }),
    ).toEqual([
      { month: "2026-07", amount: 100 },
      { month: "2026-08", amount: 0 },
      { month: "2026-09", amount: 300 },
      { month: "2026-10", amount: 0 },
    ]);
  });

  test("no month with spend is no history", () => {
    expect(
      getCloudCostForecastHistory({
        history: [{ month: "2026-10", amount: 0 }],
        currentMonth: "2026-11",
      }),
    ).toEqual([]);
  });
});

describe("a forecast", () => {
  const CURRENT: {
    month: string;
    spent: number;
    projected: number;
    dailyPace: number;
  } = { month: "2026-11", spent: 1930, projected: 2930, dailyPace: 100 };

  test("with fewer than 3 full months: the last full week's pace carried forward, with no range", () => {
    const forecast: CloudCostForecast = forecastCloudCosts({
      history: monthsAt("2026-09", [40, 45]),
      current: { ...CURRENT, dailyPace: 50 },
    });

    expect(forecast.method).toBe(CloudCostForecastMethod.Pace);
    expect(forecast.monthsOfHistory).toBe(2);
    expect(aheadOf(forecast)).toHaveLength(12);
    expect(monthOf(forecast, "2026-12").amount).toBe(50 * 31);
    expect(monthOf(forecast, "2027-02").amount).toBe(50 * 28);
    expect(
      aheadOf(forecast).every((month: CloudCostForecastMonth): boolean => {
        return month.low === undefined && month.high === undefined;
      }),
    ).toBe(true);
    expect(forecast.trendPerMonth).toBeUndefined();
    expect(forecast.seasonalFactors).toBeUndefined();
  });

  test("lists the months it was made from, this month so far and at the pace, then the months ahead", () => {
    const forecast: CloudCostForecast = forecastCloudCosts({
      history: monthsAt("2026-04", [100, 110, 120, 130, 140, 150, 160]),
      current: CURRENT,
    });

    expect(
      forecast.months.map((month: CloudCostForecastMonth) => {
        return month.kind;
      }),
    ).toEqual([
      ...new Array(7).fill(CloudCostForecastMonthKind.Actual),
      CloudCostForecastMonthKind.Current,
      ...new Array(12).fill(CloudCostForecastMonthKind.Forecast),
    ]);
    expect(monthOf(forecast, "2026-11")).toEqual({
      month: "2026-11",
      kind: CloudCostForecastMonthKind.Current,
      amount: 2930,
      spent: 1930,
    });
    expect(forecast.historyFrom).toBe("2026-04");
    expect(forecast.historyTo).toBe("2026-10");
    expect(forecast.confidencePercent).toBe(
      CLOUD_COST_FORECAST_CONFIDENCE_PERCENT,
    );
    expect(aheadOf(forecast)[0]!.month).toBe("2026-12");
    expect(aheadOf(forecast)[11]!.month).toBe("2027-11");
  });

  test("from 3 full months: the trend of their daily averages, carried forward", () => {
    // April to October at 100, 110 ... 160 a day: 10 more a day each month.
    const forecast: CloudCostForecast = forecastCloudCosts({
      history: monthsAt("2026-04", [100, 110, 120, 130, 140, 150, 160]),
      current: CURRENT,
    });

    expect(forecast.method).toBe(CloudCostForecastMethod.Trend);
    expect(forecast.monthsOfHistory).toBe(7);
    // October is x = 6, November x = 7, December x = 8: 180 a day.
    expect(monthOf(forecast, "2026-12").amount).toBeCloseTo(180 * 31, 2);
    expect(monthOf(forecast, "2027-01").amount).toBeCloseTo(190 * 31, 2);
    // February is no dip: the same trend, over 28 days.
    expect(monthOf(forecast, "2027-02").amount).toBeCloseTo(200 * 28, 2);
    // Ten a day more each month is about 304 more a month.
    expect(forecast.trendPerMonth).toBeCloseTo(304.37, 1);
  });

  test("the range holds the forecast, never goes below nothing, and widens further ahead", () => {
    const forecast: CloudCostForecast = forecastCloudCosts({
      history: monthsAt("2026-04", [100, 130, 90, 120, 140, 110, 150]),
      current: CURRENT,
    });
    const ahead: Array<CloudCostForecastMonth> = aheadOf(forecast);
    const widths: Array<number> = ahead.map(
      (month: CloudCostForecastMonth): number => {
        return (month.high! - month.low!) / month.amount;
      },
    );

    for (const month of ahead) {
      expect(month.low!).toBeGreaterThanOrEqual(0);
      expect(month.low!).toBeLessThanOrEqual(month.amount);
      expect(month.high!).toBeGreaterThanOrEqual(month.amount);
    }

    for (let index: number = 1; index < widths.length; index++) {
      expect(widths[index]!).toBeGreaterThan(widths[index - 1]!);
    }
  });

  test("fewer months behind it claim less: three months' range is wider than twelve's", () => {
    const few: CloudCostForecast = forecastCloudCosts({
      history: monthsAt("2026-08", [100, 102, 101]),
      current: CURRENT,
    });
    const many: CloudCostForecast = forecastCloudCosts({
      history: monthsAt(
        "2025-11",
        [100, 102, 101, 100, 102, 101, 100, 102, 101, 100, 102, 101],
      ),
      current: CURRENT,
    });
    const width: (forecast: CloudCostForecast) => number = (
      forecast: CloudCostForecast,
    ): number => {
      const next: CloudCostForecastMonth = aheadOf(forecast)[0]!;
      return (next.high! - next.low!) / next.amount;
    };

    expect(width(few)).toBeGreaterThan(width(many) * 1.5);
  });

  test("a flat history claims no less than 5% either way", () => {
    const forecast: CloudCostForecast = forecastCloudCosts({
      history: monthsAt("2026-04", [100, 100, 100, 100, 100, 100, 100]),
      current: CURRENT,
    });
    const next: CloudCostForecastMonth = aheadOf(forecast)[0]!;

    expect(next.amount).toBeCloseTo(3100, 2);
    expect(next.high! - next.amount).toBeGreaterThanOrEqual(next.amount * 0.05);
  });

  test("a falling trend stops at nothing", () => {
    const forecast: CloudCostForecast = forecastCloudCosts({
      history: monthsAt("2026-06", [300, 250, 200, 150, 100]),
      current: CURRENT,
    });

    expect(monthOf(forecast, "2027-03").amount).toBe(0);
    expect(monthOf(forecast, "2027-03").low).toBe(0);
    expect(monthOf(forecast, "2027-03").high).toBe(0);
  });

  test("a month the history does not name, after the first with spend, cost nothing", () => {
    // April to July at 100 a day, then nothing in August, September and October.
    const forecast: CloudCostForecast = forecastCloudCosts({
      history: monthsAt("2026-04", [100, 100, 100, 100]),
      current: CURRENT,
    });

    expect(forecast.monthsOfHistory).toBe(7);
    expect(monthOf(forecast, "2026-09").amount).toBe(0);
    // The trend falls with it, and stops at nothing.
    expect(monthOf(forecast, "2027-06").amount).toBe(0);
  });

  test("a scope that started spending in July is forecast from July", () => {
    const forecast: CloudCostForecast = forecastCloudCosts({
      history: [
        { month: "2026-04", amount: 0 },
        { month: "2026-05", amount: 0 },
        { month: "2026-06", amount: 0 },
        ...monthsAt("2026-07", [100, 100, 100, 100]),
      ],
      current: CURRENT,
    });

    expect(forecast.monthsOfHistory).toBe(4);
    expect(forecast.historyFrom).toBe("2026-07");
    expect(monthOf(forecast, "2026-12").amount).toBeCloseTo(3100, 2);
  });

  test("from 12 full months a December peak comes back next December, and every other month stays as it was", () => {
    // October 2025 to October 2026 at 100 a day, December 2025 at 200.
    const daily: Array<number> = new Array(13).fill(100);
    daily[2] = 200;

    const forecast: CloudCostForecast = forecastCloudCosts({
      history: monthsAt("2025-10", daily),
      current: CURRENT,
    });

    expect(forecast.method).toBe(CloudCostForecastMethod.TrendAndSeason);
    expect(forecast.monthsOfHistory).toBe(13);
    expect(monthOf(forecast, "2026-12").amount).toBeCloseTo(200 * 31, 2);
    expect(monthOf(forecast, "2027-01").amount).toBeCloseTo(100 * 31, 2);
    expect(monthOf(forecast, "2027-06").amount).toBeCloseTo(100 * 30, 2);
    // Next December is twice January, as last December was.
    expect(
      monthOf(forecast, "2026-12").amount / monthOf(forecast, "2027-01").amount,
    ).toBeCloseTo(2, 6);
    expect(forecast.seasonalFactors!["12"]).toBeCloseTo(24 / 13, 6);
    expect(forecast.seasonalFactors!["01"]).toBeCloseTo(12 / 13, 6);
    // A flat trend once the season is taken off.
    expect(forecast.trendPerMonth).toBeCloseTo(0, 6);
  });

  test("a season on a growing trend: the peak grows with it", () => {
    // 100 a day growing 5 a month, Decembers half again over the trend.
    const daily: Array<number> = [];

    for (let index: number = 0; index < 13; index++) {
      const month: string = addCloudCostMonths("2025-10", index);
      daily.push((100 + 5 * index) * (month.endsWith("-12") ? 1.5 : 1));
    }

    const forecast: CloudCostForecast = forecastCloudCosts({
      history: monthsAt("2025-10", daily),
      current: CURRENT,
    });
    const december: number = monthOf(forecast, "2026-12").amount / 31;
    const january: number = monthOf(forecast, "2027-01").amount / 31;

    expect(forecast.method).toBe(CloudCostForecastMethod.TrendAndSeason);
    expect(december / january).toBeGreaterThan(1.4);
    expect(december).toBeGreaterThan(daily[2]!);
    expect(forecast.trendPerMonth!).toBeGreaterThan(0);
  });

  test("a seasonal month's range counts its factor as one month's word", () => {
    const daily: Array<number> = new Array(13).fill(100);
    daily[2] = 200;

    const seasonal: CloudCostForecast = forecastCloudCosts({
      history: monthsAt("2025-10", daily),
      current: CURRENT,
    });
    const trendOnly: CloudCostForecast = forecastCloudCosts({
      history: monthsAt("2026-01", daily.slice(3)),
      current: CURRENT,
    });
    const relative: (month: CloudCostForecastMonth) => number = (
      month: CloudCostForecastMonth,
    ): number => {
      return (month.high! - month.amount) / month.amount;
    };

    expect(trendOnly.method).toBe(CloudCostForecastMethod.Trend);
    expect(relative(monthOf(seasonal, "2027-01"))).toBeGreaterThan(
      relative(monthOf(trendOnly, "2027-01")),
    );
  });

  test("asks for months ahead between 1 and 24", () => {
    const history: Array<{ month: string; amount: number }> = monthsAt(
      "2026-07",
      [100, 100, 100, 100],
    );

    expect(
      aheadOf(
        forecastCloudCosts({ history, current: CURRENT, monthsAhead: 3 }),
      ),
    ).toHaveLength(3);
    expect(
      aheadOf(
        forecastCloudCosts({ history, current: CURRENT, monthsAhead: 99 }),
      ),
    ).toHaveLength(24);
    expect(
      aheadOf(
        forecastCloudCosts({ history, current: CURRENT, monthsAhead: 0 }),
      ),
    ).toHaveLength(12);
  });

  test("by month, for a budget's later months", () => {
    const forecast: CloudCostForecast = forecastCloudCosts({
      history: monthsAt("2026-07", [100, 100, 100, 100]),
      current: CURRENT,
    });
    const byMonth: Map<string, number> = getCloudCostForecastByMonth(forecast);

    expect(byMonth.size).toBe(12);
    expect(byMonth.get("2026-12")).toBeCloseTo(3100, 2);
    // This month is the budget's own projection, not the forecast's.
    expect(byMonth.has("2026-11")).toBe(false);
  });
});

describe("a growth what-if", () => {
  const forecast: CloudCostForecast = forecastCloudCosts({
    history: monthsAt("2026-04", [100, 100, 100, 100, 100, 100, 100]),
    current: { month: "2026-11", spent: 1000, projected: 3000, dailyPace: 100 },
  });

  test("payments grows 20% from January: January on grows, December and this month do not", () => {
    const grown: CloudCostForecast = applyCloudCostGrowth(forecast, {
      percent: 20,
      fromMonth: "2027-01",
    });

    expect(grown.growth).toEqual({ percent: 20, fromMonth: "2027-01" });
    expect(monthOf(grown, "2026-12").amount).toBe(
      monthOf(forecast, "2026-12").amount,
    );
    expect(monthOf(grown, "2026-11").amount).toBe(3000);
    expect(monthOf(grown, "2027-01").amount).toBeCloseTo(
      monthOf(forecast, "2027-01").amount * 1.2,
      2,
    );
    expect(monthOf(grown, "2027-01").high).toBeCloseTo(
      monthOf(forecast, "2027-01").high! * 1.2,
      2,
    );
    expect(monthOf(grown, "2027-01").low).toBeCloseTo(
      monthOf(forecast, "2027-01").low! * 1.2,
      2,
    );
    // The months it was made from are what they cost.
    expect(monthOf(grown, "2026-06").amount).toBe(
      monthOf(forecast, "2026-06").amount,
    );
  });

  test("a fall, and none at all", () => {
    expect(
      monthOf(
        applyCloudCostGrowth(forecast, { percent: -50, fromMonth: "2026-12" }),
        "2026-12",
      ).amount,
    ).toBeCloseTo(monthOf(forecast, "2026-12").amount / 2, 2);
    expect(applyCloudCostGrowth(forecast, null)).toBe(forecast);
  });

  test("a what-if read back only within bounds, from a month", () => {
    expect(
      readCloudCostForecastGrowth({ percent: "20", fromMonth: "2027-01" }),
    ).toEqual({ percent: 20, fromMonth: "2027-01" });
    expect(
      readCloudCostForecastGrowth({ percent: 0, fromMonth: "2027-01" }),
    ).toBeNull();
    expect(
      readCloudCostForecastGrowth({ percent: -101, fromMonth: "2027-01" }),
    ).toBeNull();
    expect(
      readCloudCostForecastGrowth({ percent: 1001, fromMonth: "2027-01" }),
    ).toBeNull();
    expect(
      readCloudCostForecastGrowth({ percent: 20, fromMonth: "next quarter" }),
    ).toBeNull();
    expect(readCloudCostForecastGrowth(null)).toBeNull();
    expect(readCloudCostForecastGrowth([20, "2027-01"])).toBeNull();
  });
});

describe("a forecast as a yearly budget's plan", () => {
  // October 2025 to October 2026 at 100 a day, December 2025 at 200.
  const daily: Array<number> = new Array(13).fill(100);
  daily[2] = 200;

  const forecast: CloudCostForecast = forecastCloudCosts({
    history: monthsAt("2025-10", daily),
    current: { month: "2026-11", spent: 2000, projected: 3000, dailyPace: 100 },
  });

  test("in the fiscal year's order: from April, December is the ninth month and holds the peak", () => {
    const plan: Array<number> | null = getCloudBudgetPlanFromForecast({
      forecast,
      fiscalYearStartMonth: 4,
    });

    expect(plan).toHaveLength(12);
    // April 2027, 30 days at 100.
    expect(plan![0]).toBeCloseTo(3000, 2);
    expect(plan![8]).toBeCloseTo(6200, 2);
    // February 2027.
    expect(plan![10]).toBeCloseTo(2800, 2);
    // November: the next one ahead, a year on, not this month's projection.
    expect(plan![7]).toBeCloseTo(3000, 2);
  });

  test("a calendar year's plan starts in January", () => {
    const plan: Array<number> | null = getCloudBudgetPlanFromForecast({
      forecast,
      fiscalYearStartMonth: 1,
    });

    expect(plan![0]).toBeCloseTo(3100, 2);
    expect(plan![11]).toBeCloseTo(6200, 2);
  });

  test("with a what-if, the plan grows with it", () => {
    const plan: Array<number> | null = getCloudBudgetPlanFromForecast({
      forecast: applyCloudCostGrowth(forecast, {
        percent: 10,
        fromMonth: "2026-12",
      }),
      fiscalYearStartMonth: 1,
    });

    expect(plan![11]).toBeCloseTo(6820, 2);
  });

  test("fewer than twelve months ahead cannot be a year's plan", () => {
    expect(
      getCloudBudgetPlanFromForecast({
        forecast: forecastCloudCosts({
          history: monthsAt("2025-10", daily),
          current: {
            month: "2026-11",
            spent: 0,
            projected: 0,
            dailyPace: 100,
          },
          monthsAhead: 6,
        }),
        fiscalYearStartMonth: 1,
      }),
    ).toBeNull();
  });
});
