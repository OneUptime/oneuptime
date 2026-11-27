import { translationKey } from "../Translator";
import { readCloudBudgetFiscalYearStartMonth } from "./CloudBudget";
import { addUtcMonths, daysInUtcMonth, fromCloudCostDay } from "./CloudCost";

/*
 * WHAT CLOUD SPEND IS ON COURSE TO COST, MONTH BY MONTH (#11008).
 *
 * A forecast is made from the months OneUptime keeps (CloudCost keeps 400
 * days: twelve or thirteen full months) and says how it was made:
 *
 *   - this month: what it cost so far, and the rest of it at the pace of
 *     the last full week, as a budget projects it (projectCloudMonthCost);
 *   - each month ahead, from the full months before this one:
 *       * with fewer than 3 of them, the last full week's pace carried
 *         forward (Pace) - too little to tell a trend from a blip, so no
 *         range is claimed either;
 *       * from 3, a robust trend through them (Trend): the Theil-Sen line,
 *         the median of the slopes between every two months, through each
 *         month's daily average - one odd month barely moves it;
 *       * from 12, the trend and each calendar month's seasonal factor
 *         (TrendAndSeason): how far that month of the last year ran above
 *         or below the trend, so a December peak is forecast for the next
 *         December too. One year shows each month once, so a factor is a
 *         single month's word, and the range says so (below);
 *   - a likely range around each month ahead: how far the past months fell
 *     from their trend (a robust spread: 1.4826 times the median absolute
 *     deviation of their relative errors, never under 5%), scaled for an
 *     80% range by Student's t with the months' degrees of freedom, and
 *     widened as a regression's forecast widens: further from the months it
 *     was made from, and with fewer of them. A month's seasonal factor adds
 *     one month's error of its own, being one month's word.
 *
 * Months a scope had no spend in before its first one (a group made for a
 * new team) are left out: the trend starts where its spend does.
 *
 * A growth what-if ("payments grows 20% next quarter") scales every month
 * ahead from the month it names (applyCloudCostGrowth), and a forecast can
 * become a yearly budget's plan (getCloudBudgetPlanFromForecast).
 *
 * React-free and server-safe: the API makes forecasts, budgets project
 * their later months with them, and the Dashboard applies a what-if as it
 * is typed.
 */

export enum CloudCostForecastMethod {
  Pace = "pace",
  Trend = "trend",
  TrendAndSeason = "trendAndSeason",
}

export enum CloudCostForecastMonthKind {
  // A full month before this one, as it cost.
  Actual = "actual",
  // This month: so far, and the rest at the last full week's pace.
  Current = "current",
  // A month ahead, as forecast.
  Forecast = "forecast",
}

// How many months ahead a forecast says, unless asked for fewer or more.
export const CLOUD_COST_FORECAST_MONTHS_AHEAD: number = 12;

// The most months ahead a forecast says.
export const CLOUD_COST_FORECAST_MAX_MONTHS_AHEAD: number = 24;

// Full months a trend is forecast from.
export const CLOUD_COST_FORECAST_MIN_MONTHS_FOR_TREND: number = 3;

// Full months a season is forecast from: a year.
export const CLOUD_COST_FORECAST_MIN_MONTHS_FOR_SEASON: number = 12;

// The share of months the likely range is made to hold, in percent.
export const CLOUD_COST_FORECAST_CONFIDENCE_PERCENT: number = 80;

// The least spread a forecast claims, as a share of a month: 5%.
export const CLOUD_COST_FORECAST_MIN_SPREAD: number = 0.05;

// The growth a what-if may ask, in percent.
export const CLOUD_COST_FORECAST_MIN_GROWTH_PERCENT: number = -100;
export const CLOUD_COST_FORECAST_MAX_GROWTH_PERCENT: number = 1000;

// The average month, in days: what a trend's daily change is a month of.
export const CLOUD_COST_FORECAST_DAYS_PER_MONTH: number = 30.436875;

/*
 * Student's t at 0.9 - the upper bound of an 80% range - by degrees of
 * freedom, 1 to 12; 1.282 (the normal's) beyond.
 */
const T_80: ReadonlyArray<number> = [
  3.078, 1.886, 1.638, 1.533, 1.476, 1.44, 1.415, 1.397, 1.383, 1.372, 1.363,
  1.356,
];

export function getCloudCostForecastQuantile(degreesOfFreedom: number): number {
  const index: number = Math.max(1, Math.floor(degreesOfFreedom)) - 1;

  return index < T_80.length ? T_80[index]! : 1.282;
}

export interface CloudCostForecastMonth {
  // "2026-12".
  month: string;
  kind: CloudCostForecastMonthKind;
  // What it cost (actual), is on course to cost (current), or is forecast.
  amount: number;
  // This month so far (current).
  spent?: number | undefined;
  // The likely range (forecast; none for the Pace method).
  low?: number | undefined;
  high?: number | undefined;
}

export interface CloudCostForecastGrowth {
  // In percent: 20 for "grows 20%", -10 for "falls 10%".
  percent: number;
  // The first month it applies to, "2027-01".
  fromMonth: string;
}

export interface CloudCostForecast {
  method: CloudCostForecastMethod;
  // The full months it was made from (after any with no spend before the first).
  monthsOfHistory: number;
  historyFrom?: string | undefined;
  historyTo?: string | undefined;
  // How much a month's spend changes from one month to the next, on the trend.
  trendPerMonth?: number | undefined;
  // Each calendar month's seasonal factor, "01" to "12" (TrendAndSeason).
  seasonalFactors?: Record<string, number> | undefined;
  confidencePercent: number;
  // The last full week's daily average: this month's pace.
  dailyPace: number;
  /*
   * The full months it was made from, this month, then each month ahead,
   * in order.
   */
  months: Array<CloudCostForecastMonth>;
  // A what-if applied (applyCloudCostGrowth).
  growth?: CloudCostForecastGrowth | undefined;
}

// "2026-12" plus `count` months.
export function addCloudCostMonths(month: string, count: number): string {
  return addUtcMonths(fromCloudCostDay(`${month}-01`), count)
    .toISOString()
    .slice(0, 7);
}

export function getCloudCostMonthDays(month: string): number {
  return daysInUtcMonth(fromCloudCostDay(`${month}-01`));
}

// A month as forecasts name one: "2026-12".
const MONTH_TEXT: RegExp = /^\d{4}-\d{2}$/;

export function isCloudCostMonth(value: unknown): value is string {
  if (typeof value !== "string" || !MONTH_TEXT.test(value)) {
    return false;
  }

  const month: number = Number(value.slice(5, 7));

  return month >= 1 && month <= 12;
}

function toCents(amount: number): number {
  return Math.round(amount * 100) / 100;
}

export function getCloudCostForecastMedian(values: Array<number>): number {
  const sorted: Array<number> = values
    .filter((value: number): boolean => {
      return Number.isFinite(value);
    })
    .sort((a: number, b: number): number => {
      return a - b;
    });

  if (sorted.length === 0) {
    return 0;
  }

  const middle: number = Math.floor(sorted.length / 2);

  return sorted.length % 2 === 1
    ? sorted[middle]!
    : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

/*
 * The Theil-Sen line through points: the median of the slopes between every
 * two of them, and the median of what is left of each once that slope is
 * taken off. One far-off point - a month's spike - barely moves it, where a
 * least-squares line would lean towards it.
 */
export function fitCloudCostTrend(points: Array<{ x: number; y: number }>): {
  slope: number;
  intercept: number;
} {
  if (points.length === 0) {
    return { slope: 0, intercept: 0 };
  }

  const slopes: Array<number> = [];

  for (let i: number = 0; i < points.length; i++) {
    for (let j: number = i + 1; j < points.length; j++) {
      const dx: number = points[j]!.x - points[i]!.x;

      if (dx !== 0) {
        slopes.push((points[j]!.y - points[i]!.y) / dx);
      }
    }
  }

  const slope: number =
    slopes.length > 0 ? getCloudCostForecastMedian(slopes) : 0;
  const intercept: number = getCloudCostForecastMedian(
    points.map((point: { x: number; y: number }): number => {
      return point.y - slope * point.x;
    }),
  );

  return { slope, intercept };
}

// A robust spread of relative errors: 1.4826 times their median absolute deviation.
export function getCloudCostForecastSpread(errors: Array<number>): number {
  if (errors.length === 0) {
    return CLOUD_COST_FORECAST_MIN_SPREAD;
  }

  const center: number = getCloudCostForecastMedian(errors);
  const deviation: number = getCloudCostForecastMedian(
    errors.map((error: number): number => {
      return Math.abs(error - center);
    }),
  );

  return Math.max(CLOUD_COST_FORECAST_MIN_SPREAD, 1.4826 * deviation);
}

/*
 * The full months a forecast is made from: every month from the first one
 * with spend up to the month before this one, in order, a month the history
 * does not name being a month that cost nothing.
 */
export function getCloudCostForecastHistory(data: {
  history: Array<{ month: string; amount: number }>;
  currentMonth: string;
}): Array<{ month: string; amount: number }> {
  const amounts: Map<string, number> = new Map();

  for (const entry of data.history) {
    if (isCloudCostMonth(entry.month) && entry.month < data.currentMonth) {
      const amount: number = Number(entry.amount);
      amounts.set(
        entry.month,
        (amounts.get(entry.month) || 0) +
          (Number.isFinite(amount) ? amount : 0),
      );
    }
  }

  const withSpend: Array<string> = Array.from(amounts.entries())
    .filter(([, amount]: [string, number]): boolean => {
      return amount > 0.005;
    })
    .map(([month]: [string, number]): string => {
      return month;
    })
    .sort();
  const first: string | undefined = withSpend[0];

  if (!first) {
    return [];
  }

  const months: Array<{ month: string; amount: number }> = [];

  for (
    let month: string = first;
    month < data.currentMonth;
    month = addCloudCostMonths(month, 1)
  ) {
    months.push({ month, amount: toCents(amounts.get(month) || 0) });
  }

  return months;
}

export function forecastCloudCosts(data: {
  // Full months before this one: "2026-10" -> what it cost. Any order.
  history: Array<{ month: string; amount: number }>;
  current: {
    month: string;
    // This month so far, and at the last full week's pace.
    spent: number;
    projected: number;
    dailyPace: number;
  };
  monthsAhead?: number | undefined;
}): CloudCostForecast {
  const monthsAhead: number = Math.min(
    CLOUD_COST_FORECAST_MAX_MONTHS_AHEAD,
    Math.max(
      1,
      Math.floor(Number(data.monthsAhead) || CLOUD_COST_FORECAST_MONTHS_AHEAD),
    ),
  );
  const history: Array<{ month: string; amount: number }> =
    getCloudCostForecastHistory({
      history: data.history,
      currentMonth: data.current.month,
    });
  const n: number = history.length;
  const dailyPace: number = Math.max(0, Number(data.current.dailyPace) || 0);
  const months: Array<CloudCostForecastMonth> = [
    ...history.map(
      (entry: { month: string; amount: number }): CloudCostForecastMonth => {
        return {
          month: entry.month,
          kind: CloudCostForecastMonthKind.Actual,
          amount: entry.amount,
        };
      },
    ),
    {
      month: data.current.month,
      kind: CloudCostForecastMonthKind.Current,
      amount: toCents(Math.max(0, Number(data.current.projected) || 0)),
      spent: toCents(Math.max(0, Number(data.current.spent) || 0)),
    },
  ];
  const base: Omit<CloudCostForecast, "method" | "months"> = {
    monthsOfHistory: n,
    historyFrom: history[0]?.month,
    historyTo: history[n - 1]?.month,
    confidencePercent: CLOUD_COST_FORECAST_CONFIDENCE_PERCENT,
    dailyPace: toCents(dailyPace),
  };

  if (n < CLOUD_COST_FORECAST_MIN_MONTHS_FOR_TREND) {
    for (let ahead: number = 1; ahead <= monthsAhead; ahead++) {
      const month: string = addCloudCostMonths(data.current.month, ahead);

      months.push({
        month,
        kind: CloudCostForecastMonthKind.Forecast,
        amount: toCents(dailyPace * getCloudCostMonthDays(month)),
      });
    }

    return { ...base, method: CloudCostForecastMethod.Pace, months };
  }

  // Each month's daily average, so a February is not a dip.
  const points: Array<{ x: number; y: number }> = history.map(
    (entry: { month: string; amount: number }, index: number) => {
      return { x: index, y: entry.amount / getCloudCostMonthDays(entry.month) };
    },
  );
  const raw: { slope: number; intercept: number } = fitCloudCostTrend(points);
  const rawAt: (x: number) => number = (x: number): number => {
    return raw.intercept + raw.slope * x;
  };
  let seasonalFactors: Record<string, number> | undefined = undefined;

  if (n >= CLOUD_COST_FORECAST_MIN_MONTHS_FOR_SEASON) {
    const lastYear: Array<{ x: number; y: number; month: string }> = points
      .slice(n - 12)
      .map((point: { x: number; y: number }, index: number) => {
        return { ...point, month: history[n - 12 + index]!.month };
      });

    if (
      lastYear.every((point: { x: number }): boolean => {
        return rawAt(point.x) > 0;
      })
    ) {
      const ratios: Array<number> = lastYear.map(
        (point: { x: number; y: number }): number => {
          return point.y / rawAt(point.x);
        },
      );
      const mean: number =
        ratios.reduce((sum: number, ratio: number): number => {
          return sum + ratio;
        }, 0) / ratios.length;

      if (mean > 0) {
        seasonalFactors = {};

        lastYear.forEach((point: { month: string }, index: number): void => {
          seasonalFactors![point.month.slice(5, 7)] = ratios[index]! / mean;
        });
      }
    }
  }

  const factorOf: (month: string) => number = (month: string): number => {
    return seasonalFactors ? seasonalFactors[month.slice(5, 7)] || 1 : 1;
  };

  // The trend through the months as they would read with no season.
  const fit: { slope: number; intercept: number } = seasonalFactors
    ? fitCloudCostTrend(
        points.map((point: { x: number; y: number }, index: number) => {
          return { x: point.x, y: point.y / factorOf(history[index]!.month) };
        }),
      )
    : raw;

  /*
   * How far the months fell from the trend, as a share of it: against the
   * trend with the season left in for a seasonal forecast - its factors
   * were fitted to the same months, so they would read as no error at all.
   */
  const errors: Array<number> = [];

  points.forEach((point: { x: number; y: number }): void => {
    const expected: number = rawAt(point.x);

    if (expected > 0) {
      errors.push(point.y / expected - 1);
    }
  });

  const spread: number = getCloudCostForecastSpread(errors);
  const quantile: number = getCloudCostForecastQuantile(n - 2);
  const meanX: number = (n - 1) / 2;
  let sumOfSquares: number = 0;

  points.forEach((point: { x: number }): void => {
    sumOfSquares += (point.x - meanX) * (point.x - meanX);
  });

  for (let ahead: number = 1; ahead <= monthsAhead; ahead++) {
    const month: string = addCloudCostMonths(data.current.month, ahead);
    // This month is x = n; the first month ahead x = n + 1.
    const x: number = n + ahead;
    const level: number = Math.max(0, fit.intercept + fit.slope * x);
    const amount: number =
      level * factorOf(month) * getCloudCostMonthDays(month);
    const leverage: number =
      1 / n +
      (sumOfSquares > 0 ? ((x - meanX) * (x - meanX)) / sumOfSquares : 0);
    const width: number =
      quantile * spread * Math.sqrt(1 + leverage + (seasonalFactors ? 1 : 0));

    months.push({
      month,
      kind: CloudCostForecastMonthKind.Forecast,
      amount: toCents(amount),
      low: toCents(Math.max(0, amount * (1 - width))),
      high: toCents(amount * (1 + width)),
    });
  }

  return {
    ...base,
    method: seasonalFactors
      ? CloudCostForecastMethod.TrendAndSeason
      : CloudCostForecastMethod.Trend,
    trendPerMonth: toCents(fit.slope * CLOUD_COST_FORECAST_DAYS_PER_MONTH),
    seasonalFactors,
    months,
  };
}

// A what-if as asked, read back: null when it is none or out of bounds.
export function readCloudCostForecastGrowth(
  value: unknown,
): CloudCostForecastGrowth | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const record: Record<string, unknown> = value as Record<string, unknown>;
  const percent: number = Number(record["percent"]);

  if (
    !Number.isFinite(percent) ||
    percent === 0 ||
    percent < CLOUD_COST_FORECAST_MIN_GROWTH_PERCENT ||
    percent > CLOUD_COST_FORECAST_MAX_GROWTH_PERCENT ||
    !isCloudCostMonth(record["fromMonth"])
  ) {
    return null;
  }

  return { percent, fromMonth: record["fromMonth"] as string };
}

/*
 * A forecast with a what-if: every month ahead from the one it names grows
 * (or falls) by its percent, its range with it. The months before, this
 * month and the full months it was made from are as forecast.
 */
export function applyCloudCostGrowth(
  forecast: CloudCostForecast,
  growth: CloudCostForecastGrowth | null | undefined,
): CloudCostForecast {
  if (!growth) {
    return forecast;
  }

  const factor: number = 1 + growth.percent / 100;
  const scale: (amount: number | undefined) => number | undefined = (
    amount: number | undefined,
  ): number | undefined => {
    return amount === undefined ? undefined : toCents(amount * factor);
  };

  return {
    ...forecast,
    growth,
    months: forecast.months.map(
      (month: CloudCostForecastMonth): CloudCostForecastMonth => {
        if (
          month.kind !== CloudCostForecastMonthKind.Forecast ||
          month.month < growth.fromMonth
        ) {
          return month;
        }

        return {
          ...month,
          amount: scale(month.amount)!,
          low: scale(month.low),
          high: scale(month.high),
        };
      },
    ),
  };
}

// The months ahead of a forecast, in order.
export function getCloudCostForecastAhead(
  forecast: CloudCostForecast,
): Array<CloudCostForecastMonth> {
  return forecast.months.filter((month: CloudCostForecastMonth): boolean => {
    return month.kind === CloudCostForecastMonthKind.Forecast;
  });
}

/*
 * A forecast as a yearly budget's plan: each month of the fiscal year, in
 * its order, at the first month ahead of the forecast that is that month
 * of the year - twelve months ahead hold each once. Null when the forecast
 * says fewer than twelve months ahead.
 */
export function getCloudBudgetPlanFromForecast(data: {
  forecast: CloudCostForecast;
  fiscalYearStartMonth: unknown;
}): Array<number> | null {
  const ahead: Array<CloudCostForecastMonth> = getCloudCostForecastAhead(
    data.forecast,
  );
  const fiscalStart: number = readCloudBudgetFiscalYearStartMonth(
    data.fiscalYearStartMonth,
  );
  const plan: Array<number> = [];

  for (let index: number = 0; index < 12; index++) {
    const calendarMonth: number = ((fiscalStart - 1 + index) % 12) + 1;
    const found: CloudCostForecastMonth | undefined = ahead.find(
      (month: CloudCostForecastMonth): boolean => {
        return Number(month.month.slice(5, 7)) === calendarMonth;
      },
    );

    if (!found) {
      return null;
    }

    plan.push(found.amount);
  }

  return plan;
}

/*
 * What the forecast says the months of a window cost after this one:
 * "2026-12" -> amount, for a budget's projection to its window's end.
 */
export function getCloudCostForecastByMonth(
  forecast: CloudCostForecast,
): Map<string, number> {
  const byMonth: Map<string, number> = new Map();

  for (const month of getCloudCostForecastAhead(forecast)) {
    byMonth.set(month.month, month.amount);
  }

  return byMonth;
}

/*
 * ---------------------------------------------------------------------------
 * Words
 * ---------------------------------------------------------------------------
 */

export const CLOUD_COST_FORECAST_METHOD_LABELS: Readonly<
  Record<CloudCostForecastMethod, string>
> = {
  [CloudCostForecastMethod.Pace]: translationKey("Last week's pace"),
  [CloudCostForecastMethod.Trend]: translationKey("Trend"),
  [CloudCostForecastMethod.TrendAndSeason]: translationKey("Trend and season"),
};

/*
 * How each method is made, in a sentence the page and the docs say beside
 * the forecast. {{months}} is the full months it was made from.
 */
export const CLOUD_COST_FORECAST_METHOD_DESCRIPTIONS: Readonly<
  Record<CloudCostForecastMethod, string>
> = {
  [CloudCostForecastMethod.Pace]: translationKey(
    "With fewer than 3 full months of costs, the last full week's pace is carried forward, with no range. A trend is forecast from 3 full months, and a season from 12.",
  ),
  [CloudCostForecastMethod.Trend]: translationKey(
    "The trend of the last {{months}} full months, carried forward. A season is forecast once there are 12 full months of costs.",
  ),
  [CloudCostForecastMethod.TrendAndSeason]: translationKey(
    "The trend of the last {{months}} full months, and how far each month of the last year ran above or below it. A year shows each month once, so a month's peak is expected to come back as it was.",
  ),
};

export const CLOUD_COST_FORECAST_RANGE_DESCRIPTION: string = translationKey(
  "The likely range holds about 8 months in 10: it is how far past months fell from their trend, never less than 5% either way, and it widens further ahead.",
);
