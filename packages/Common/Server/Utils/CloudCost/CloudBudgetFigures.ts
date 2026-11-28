import {
  CloudBudgetCheckWindow,
  CloudBudgetWindowSpend,
  projectCloudBudgetWindow,
} from "../../../Types/Cloud/CloudBudget";
import {
  CLOUD_COST_HISTORY_DAYS,
  addUtcDays,
  projectCloudMonthCost,
  startOfUtcDay,
  startOfUtcMonth,
  toCloudBudgetMonth,
} from "../../../Types/Cloud/CloudCost";
import {
  CLOUD_COST_FORECAST_MONTHS_AHEAD,
  CloudCostForecast,
  forecastCloudCosts,
  getCloudCostForecastByMonth,
} from "../../../Types/Cloud/CloudCostForecast";
import CaptureSpan from "../Telemetry/CaptureSpan";
import CloudBudgetSpendReader, {
  CloudBudgetScopeRead,
  CloudBudgetSpendReaderClass,
} from "./CloudBudgetSpendReader";

/*
 * A BUDGET'S FIGURES, AND A SCOPE'S FORECAST (#11008), as the budget
 * evaluator, a budget's page and the Forecast page read them - one read of
 * the costs each, so the three never tell a period apart:
 *
 *   - this month's days and the week before them: the month so far, and
 *     the last full week's pace for the rest of it (projectCloudMonthCost);
 *   - the full months OneUptime keeps (CloudCost keeps 400 days), when a
 *     forecast is wanted or the period has months before this one: the
 *     period's earlier months as they cost, and the history a forecast of
 *     the months after this one is made from (CloudCostForecast);
 *   - the window's and the period's spend so far and where they are
 *     heading (projectCloudBudgetWindow).
 */

export interface CloudBudgetFiguresRead {
  // This month's days and the week before them: "2026-11-02" -> amount.
  dailyTotals: Map<string, number>;
  // The full months read: "2026-10" -> amount.
  pastMonths: Map<string, number>;
  // This month so far, at the last full week's pace, and the pace.
  month: {
    monthToDate: number;
    projectedMonth: number;
    dailyPace: number;
    latestDay?: string | undefined;
  };
  // The months ahead, when a forecast was asked for or the period needs one.
  forecast?: CloudCostForecast | undefined;
  period: CloudBudgetWindowSpend;
  window: CloudBudgetWindowSpend;
  // Whether anything was read for the window: nothing read is nothing known.
  hasData: boolean;
}

export default class CloudBudgetFigures {
  // The days a read of this month takes: the month, and the week before it.
  public static getDaysWindow(now: Date): { start: Date; lastDay: Date } {
    const today: Date = startOfUtcDay(now);
    const monthStart: Date = startOfUtcMonth(now);
    const weekBack: Date = addUtcDays(today, -8);

    return {
      start: weekBack.getTime() < monthStart.getTime() ? weekBack : monthStart,
      lastDay: today,
    };
  }

  /*
   * This month so far and the pace, and the full months kept - from the
   * oldest kept in full (or `start`, when earlier) to the end of last month.
   */
  @CaptureSpan()
  public static async readHistory(data: {
    read: CloudBudgetScopeRead;
    now: Date;
    // The first month wanted besides the history: a period's first.
    start?: Date | undefined;
  }): Promise<{
    dailyTotals: Map<string, number>;
    pastMonths: Map<string, number>;
  }> {
    const days: { start: Date; lastDay: Date } =
      CloudBudgetFigures.getDaysWindow(data.now);
    const lastMonthEnd: Date = addUtcDays(startOfUtcMonth(data.now), -1);
    const history: { start: Date; lastDay: Date } | null =
      CloudBudgetSpendReaderClass.getHistoryWindow({
        now: data.now,
        keptDays: CLOUD_COST_HISTORY_DAYS,
      });
    let start: Date | null = history ? history.start : null;

    if (data.start && (!start || data.start.getTime() < start.getTime())) {
      start = data.start;
    }

    const [dailyTotals, pastMonths]: [
      Map<string, number>,
      Map<string, number>,
    ] = await Promise.all([
      CloudBudgetSpendReader.readDays(data.read, days.start, days.lastDay),
      start && start.getTime() <= lastMonthEnd.getTime()
        ? CloudBudgetSpendReader.readMonths(data.read, start, lastMonthEnd)
        : Promise.resolve(new Map<string, number>()),
    ]);

    return { dailyTotals, pastMonths };
  }

  // A forecast of the months ahead, from the months read and this month.
  public static toForecast(data: {
    dailyTotals: Map<string, number>;
    pastMonths: Map<string, number>;
    now: Date;
    monthsAhead?: number | undefined;
  }): CloudCostForecast {
    const month: {
      monthToDate: number;
      projectedMonth: number;
      dailyPace?: number;
    } = projectCloudMonthCost({ dailyTotals: data.dailyTotals, now: data.now });

    return forecastCloudCosts({
      history: Array.from(data.pastMonths.entries()).map(
        ([key, amount]: [string, number]) => {
          return { month: key, amount };
        },
      ),
      current: {
        month: toCloudBudgetMonth(data.now),
        spent: month.monthToDate,
        projected: month.projectedMonth,
        dailyPace: month.dailyPace || 0,
      },
      monthsAhead: data.monthsAhead ?? CLOUD_COST_FORECAST_MONTHS_AHEAD,
    });
  }

  /*
   * A budget's window and period, as the evaluator checks them and its
   * page shows them. With `withForecast`, the months ahead are forecast
   * even when the period ends this month: what a page shows.
   */
  @CaptureSpan()
  public static async read(data: {
    read: CloudBudgetScopeRead;
    window: CloudBudgetCheckWindow;
    now: Date;
    withForecast?: boolean | undefined;
  }): Promise<CloudBudgetFiguresRead> {
    const thisMonth: string = toCloudBudgetMonth(data.now);
    const periodMonths: Array<string> = data.window.period.months;
    const hasEarlierMonths: boolean = periodMonths.some(
      (month: string): boolean => {
        return month < thisMonth;
      },
    );
    const hasLaterMonths: boolean = periodMonths.some(
      (month: string): boolean => {
        return month > thisMonth;
      },
    );
    const wantsForecast: boolean = hasLaterMonths || Boolean(data.withForecast);
    let dailyTotals: Map<string, number>;
    let pastMonths: Map<string, number> = new Map();

    if (wantsForecast) {
      ({ dailyTotals, pastMonths } = await CloudBudgetFigures.readHistory({
        read: data.read,
        now: data.now,
        start: data.window.period.start,
      }));
    } else {
      const days: { start: Date; lastDay: Date } =
        CloudBudgetFigures.getDaysWindow(data.now);
      const lastMonthEnd: Date = addUtcDays(startOfUtcMonth(data.now), -1);

      [dailyTotals, pastMonths] = await Promise.all([
        CloudBudgetSpendReader.readDays(data.read, days.start, days.lastDay),
        hasEarlierMonths
          ? CloudBudgetSpendReader.readMonths(
              data.read,
              data.window.period.start,
              lastMonthEnd,
            )
          : Promise.resolve(new Map<string, number>()),
      ]);
    }

    const month: {
      monthToDate: number;
      projectedMonth: number;
      latestDay?: string;
      dailyPace?: number;
    } = projectCloudMonthCost({ dailyTotals, now: data.now });
    const forecast: CloudCostForecast | undefined = wantsForecast
      ? CloudBudgetFigures.toForecast({
          dailyTotals,
          pastMonths,
          now: data.now,
        })
      : undefined;
    const laterMonths: Map<string, number> | undefined = forecast
      ? getCloudCostForecastByMonth(forecast)
      : undefined;
    const period: CloudBudgetWindowSpend = projectCloudBudgetWindow({
      window: data.window.period,
      now: data.now,
      pastMonths,
      dailyTotals,
      laterMonths,
    });
    const window: CloudBudgetWindowSpend = data.window.isPlanMonth
      ? projectCloudBudgetWindow({
          window: data.window,
          now: data.now,
          pastMonths,
          dailyTotals,
        })
      : period;

    return {
      dailyTotals,
      pastMonths,
      month: {
        monthToDate: month.monthToDate,
        projectedMonth: month.projectedMonth,
        dailyPace: month.dailyPace || 0,
        latestDay: month.latestDay,
      },
      forecast,
      period,
      window,
      hasData:
        dailyTotals.size > 0 ||
        Array.from(pastMonths.keys()).some((key: string): boolean => {
          return data.window.months.includes(key);
        }),
    };
  }

  // A scope's forecast: the Forecast page's, and what saves as a plan.
  @CaptureSpan()
  public static async forecast(data: {
    read: CloudBudgetScopeRead;
    now: Date;
    monthsAhead?: number | undefined;
  }): Promise<{
    forecast: CloudCostForecast;
    latestDay?: string | undefined;
  }> {
    const read: {
      dailyTotals: Map<string, number>;
      pastMonths: Map<string, number>;
    } = await CloudBudgetFigures.readHistory({
      read: data.read,
      now: data.now,
    });

    return {
      forecast: CloudBudgetFigures.toForecast({
        ...read,
        now: data.now,
        monthsAhead: data.monthsAhead,
      }),
      latestDay: projectCloudMonthCost({
        dailyTotals: read.dailyTotals,
        now: data.now,
      }).latestDay,
    };
  }
}
