import OneUptimeDate from "../../../Types/Date";
import { JSONObject } from "../../../Types/JSON";
import { EXCEPTION_BASELINE_MINIMUM_WEEKS } from "../../../Types/Monitor/ExceptionMonitor/ExceptionMonitorEvaluation";
import { MetricBaselineService } from "../../Services/MetricBaselineService";
import CountAnomaly, {
  CountBaselineStats,
  CountBaselineSummary,
} from "./Criteria/CountAnomaly";

/*
 * WHAT IS NORMAL FOR A WINDOW OF A LOGS OR TRACES MONITOR.
 *
 * An anomaly condition on a log or span count compares the window with
 * windows of its own length around the same time of the earlier weeks. Logs
 * and spans are too many to read raw, so the windows are folded out of the
 * per-minute rollups (LogCountBaseline, SpanCountBaseline). The idea is the
 * one ExceptionLearnedBaseline reads a monitor's own query with; these are
 * the places it differs, or what it took to keep a busy monitor as it was:
 *
 *   - Earlier weeks only. The hour being judged used to be part of its own
 *     baseline. Once its minutes are a share p of the samples, a change that
 *     lasts can reach at most sqrt((1 - p) / p) standard deviations: three,
 *     at a tenth. So on a 14-day baseline a change of any size stopped firing
 *     at its 14th minute, and a doubling that had lasted half an hour was
 *     caught about one time in five.
 *   - Three hours, not one (COUNT_BASELINE_REACH_IN_WINDOWS). That blindness
 *     was also what kept busy monitors quiet: one hour of two weeks barely
 *     samples how far a rate moves within a day, and read on its own gave a
 *     range narrow enough to alert about three times as often. An hour either
 *     side keeps alerts near what they were and loses little of what they
 *     catch. Exceptions do not need this: a sparse count's range is chance.
 *   - No narrower than a rate's level moves (COUNT_BASELINE_LEVEL_SPREAD).
 *     Two weeks cannot measure how far a rate moves from one day to the next,
 *     so a flat one reads as steadier than it is: without this, simulated flat
 *     traffic went from 2 alerts a day to 30.
 *   - One sample per window, in the window's own unit. A long window's average
 *     varies less than one minute does, and a short window's more. A window
 *     of a minute reads the minutes it always read, and a busy scope's spread
 *     is mostly not chance, so it hardly moves whatever the window's length.
 *   - Empty windows are samples, but only for how low a window can go. A
 *     sparse scope's silence is its normal, so an empty window is not
 *     anomalously low. How high it can go is read from the windows that held
 *     something, or a job that logs 100 lines once an hour would be an outlier
 *     once an hour. A scope that is usually busy and stopped for half an hour
 *     last week did not have a quiet half hour: a week's empty windows count
 *     only as far as every week has as many (getSamples).
 *
 * Silence is only evidence once the monitor's services were reporting, so a
 * week from before that is left out, and a baseline needs two weeks of
 * history. Any severity or status counts as reporting: a service that logged
 * only Information for a month has a baseline of no errors, not none.
 *
 * The result stays a per-minute rate, the unit the criteria judge and word an
 * alert in. Hours and days are read as the rollups hold them: ingest writes
 * UTC text the ClickHouse server stores as written, whatever its zone, so
 * they are UTC hours (MetricBaselineService.computeHourOfWeek).
 */

const MINUTE_IN_MS: number = 60 * 1000;
const HOUR_IN_MS: number = 60 * MINUTE_IN_MS;
const WEEK_IN_MS: number = 7 * 24 * HOUR_IN_MS;

/*
 * How much of each earlier week is read: this many windows, a window counting
 * as an hour if it is shorter, centred on the time of the window judged.
 */
export const COUNT_BASELINE_REACH_IN_WINDOWS: number = 3;

/*
 * The least a window's spread is taken as, as a share of its center: at Medium,
 * a window within 12% of normal is normal. This is a judgement, not a
 * measurement: it is where simulated flat traffic, moving 3% from day to day,
 * alerts as often as it did. A rate with a rhythm or real noise of its own is
 * wider than this already, and a quiet one is wider by chance.
 */
export const COUNT_BASELINE_LEVEL_SPREAD: number = 0.04;

// Windows are numbered from the epoch, here and in the read that groups them.
export interface CountBaselineWeek {
  weeksBack: number;
  firstWindow: number;
  windowCount: number;
}

export interface CountBaselinePlan {
  windowDays: number;
  windowSeconds: number;
  // The minutes each sample is folded from: the window's, rounded up.
  windowMinutes: number;
  // The windows to read, the most recent week first. None when nothing can be.
  weeks: Array<CountBaselineWeek>;
  // The rollup's cells those windows fall in.
  hoursOfWeek: Array<number>;
  firstDay: string;
  lastDay: string;
  // The hour of the week the window judged falls in.
  hourOfWeek: number;
}

export interface CountBaselineWindowRow {
  windowIndex: number;
  count: number;
}

// One earlier week of counts, zeros included.
export interface CountBaselineWeekCounts {
  week: CountBaselineWeek;
  counts: Array<number>;
  // Whether anything the monitor's services sent falls in this week's windows.
  hasRows: boolean;
}

export default class CountWindowBaseline {
  public static getPlan(data: {
    windowEnd: Date;
    windowSeconds: number;
    windowDays?: number | undefined;
  }): CountBaselinePlan {
    const windowDays: number = Math.min(
      data.windowDays || MetricBaselineService.DEFAULT_WINDOW_DAYS,
      MetricBaselineService.MAX_WINDOW_DAYS,
    );
    const windowSeconds: number = Math.max(1, Math.round(data.windowSeconds));
    const windowInMs: number = windowSeconds * 1000;
    const windowMinutes: number = Math.ceil(windowSeconds / 60);
    const sampleInMs: number = windowMinutes * MINUTE_IN_MS;
    const reachInMs: number = Math.min(
      COUNT_BASELINE_REACH_IN_WINDOWS * Math.max(windowInMs, HOUR_IN_MS),
      WEEK_IN_MS,
    );
    const middle: number = data.windowEnd.getTime() - windowInMs / 2;
    const weeks: Array<CountBaselineWeek> = [];

    // A window of a week or more has no earlier week of its own.
    if (windowInMs < WEEK_IN_MS) {
      for (
        let weeksBack: number = 1;
        weeksBack <= Math.floor(windowDays / 7);
        weeksBack++
      ) {
        const center: number = middle - weeksBack * WEEK_IN_MS;
        const firstWindow: number = Math.floor(
          (center - reachInMs / 2) / sampleInMs,
        );
        const endWindow: number = Math.ceil(
          (center + reachInMs / 2) / sampleInMs,
        );

        weeks.push({
          weeksBack,
          firstWindow,
          windowCount: endWindow - firstWindow,
        });
      }
    }

    const plan: CountBaselinePlan = {
      windowDays,
      windowSeconds,
      windowMinutes,
      weeks,
      hoursOfWeek: [],
      firstDay: "",
      lastDay: "",
      hourOfWeek: MetricBaselineService.computeHourOfWeek(new Date(middle)),
    };

    const newest: CountBaselineWeek | undefined = weeks[0];
    const oldest: CountBaselineWeek | undefined = weeks[weeks.length - 1];

    if (!newest || !oldest) {
      return plan;
    }

    const hoursOfWeek: Set<number> = new Set<number>();
    const reachEnd: number =
      (newest.firstWindow + newest.windowCount) * sampleInMs;

    for (
      let hour: number =
        Math.floor((newest.firstWindow * sampleInMs) / HOUR_IN_MS) * HOUR_IN_MS;
      hour < reachEnd;
      hour += HOUR_IN_MS
    ) {
      hoursOfWeek.add(MetricBaselineService.computeHourOfWeek(new Date(hour)));
    }

    return {
      ...plan,
      hoursOfWeek: Array.from(hoursOfWeek),
      firstDay: CountWindowBaseline.toDayText(oldest.firstWindow * sampleInMs),
      lastDay: CountWindowBaseline.toDayText(reachEnd - 1),
    };
  }

  /*
   * The count of every window of a read, by the week it falls in. A rollup
   * row exists for a minute anything of the services arrived in, so a window
   * with a row and a count of 0 held only what the monitor does not match.
   */
  public static toWeekCounts(data: {
    plan: CountBaselinePlan;
    rows: Array<CountBaselineWindowRow>;
  }): Array<CountBaselineWeekCounts> {
    return data.plan.weeks.map(
      (week: CountBaselineWeek): CountBaselineWeekCounts => {
        const counts: Array<number> = new Array<number>(week.windowCount).fill(
          0,
        );
        let hasRows: boolean = false;

        for (const row of data.rows) {
          const index: number = row.windowIndex - week.firstWindow;

          if (index >= 0 && index < counts.length) {
            counts[index] = row.count;
            hasRows = true;
          }
        }

        return { week, counts, hasRows };
      },
    );
  }

  /*
   * The samples of the earlier weeks read: every window that held something,
   * and the empty windows that are the scope's normal. A week's empty windows
   * count as far as every week has as many. A scope quiet for most of an hour
   * is quiet in each week; one that stopped once is not, and a week of that is
   * left to the weeks around it, as it always was.
   */
  public static getSamples(
    weeks: Array<Array<number>>,
  ): Array<number> | undefined {
    if (weeks.length === 0) {
      return undefined;
    }

    const usualEmptyWindows: number = Math.min(
      ...weeks.map((counts: Array<number>): number => {
        return CountWindowBaseline.getEmptyWindows(counts);
      }),
    );

    return [
      ...new Array<number>(usualEmptyWindows * weeks.length).fill(0),
      ...CountWindowBaseline.getNonEmptyWindows(weeks),
    ];
  }

  /*
   * What the windows of the earlier weeks say, as a per-minute rate. Null
   * without a sample. `weeks` holds the weeks with history, `plan` every week
   * the baseline window asks for: a baseline window of two weeks needs two,
   * and a shorter one all it has. minSamples counts minutes, as it did when a
   * sample was one, so a window of 15 minutes takes a fifteenth as many.
   */
  public static summarize(data: {
    plan: CountBaselinePlan;
    weeks: Array<Array<number>>;
    minSamples?: number | undefined;
  }): CountBaselineSummary | null {
    const samples: Array<number> | undefined = CountWindowBaseline.getSamples(
      data.weeks,
    );
    const stats: CountBaselineStats | null = samples
      ? CountAnomaly.computeStats(samples)
      : null;

    if (!samples || !stats) {
      return null;
    }

    const nonEmpty: Array<number> = CountWindowBaseline.getNonEmptyWindows(
      data.weeks,
    );
    const nonEmptyStats: CountBaselineStats | null =
      nonEmpty.length < samples.length
        ? CountAnomaly.computeStats(nonEmpty)
        : null;

    const toRate: (stats: CountBaselineStats) => CountBaselineStats = (
      windowStats: CountBaselineStats,
    ): CountBaselineStats => {
      return CountWindowBaseline.toRate({ stats: windowStats, ...data.plan });
    };

    const weeksNeeded: number = Math.min(
      EXCEPTION_BASELINE_MINIMUM_WEEKS,
      data.plan.weeks.length,
    );
    const samplesNeeded: number = data.minSamples
      ? Math.ceil(data.minSamples / data.plan.windowMinutes)
      : MetricBaselineService.DEFAULT_MIN_SAMPLES;

    return {
      ...toRate(stats),
      ...(nonEmptyStats ? { nonEmpty: toRate(nonEmptyStats) } : {}),
      isReliable:
        data.weeks.length >= weeksNeeded && stats.sampleCount >= samplesNeeded,
      windowDays: data.plan.windowDays,
      hourOfWeek: data.plan.hourOfWeek,
    };
  }

  /*
   * The baseline of a window, read through `query` from one rollup. The
   * count's filter goes in `countExpression`, not `scopeClause`: every minute
   * the services sent anything returns a row, which is how a week is known
   * to have history though nothing in it matched.
   */
  public static async read(data: {
    tableName: string;
    countExpression: string;
    scopeClause: string;
    windowEnd: Date;
    windowSeconds: number;
    windowDays?: number | undefined;
    minSamples?: number | undefined;
    query: (sql: string) => Promise<Array<JSONObject>>;
  }): Promise<CountBaselineSummary | null> {
    const plan: CountBaselinePlan = CountWindowBaseline.getPlan(data);

    if (plan.weeks.length === 0) {
      return null;
    }

    const rows: Array<JSONObject> = await data.query(
      CountWindowBaseline.getWindowsSql({ ...data, plan }),
    );

    const weeks: Array<CountBaselineWeekCounts> =
      CountWindowBaseline.toWeekCounts({
        plan,
        rows: rows.map((row: JSONObject): CountBaselineWindowRow => {
          return {
            windowIndex: CountWindowBaseline.toNumber(row["windowIndex"]),
            count: CountWindowBaseline.toNumber(row["c"]),
          };
        }),
      });

    const firstHeardFrom: number | null =
      await CountWindowBaseline.getFirstHeardFrom({ ...data, plan, weeks });

    if (firstHeardFrom === null) {
      return null;
    }

    const sampleInMs: number = plan.windowMinutes * MINUTE_IN_MS;

    return CountWindowBaseline.summarize({
      plan,
      minSamples: data.minSamples,
      weeks: weeks
        .filter((week: CountBaselineWeekCounts): boolean => {
          const weekEnd: number =
            (week.week.firstWindow + week.week.windowCount) * sampleInMs;

          return weekEnd > firstHeardFrom;
        })
        .map((week: CountBaselineWeekCounts): Array<number> => {
          return week.counts;
        }),
    });
  }

  /*
   * When the monitor's services were first heard from, or null if not by the
   * last week read. A busy scope's oldest week has rows, which answers it for
   * every week after, and it reads nothing more. Only a quiet or a new scope
   * asks, and it has few rows to ask of. As far back as the rollup holds, not
   * just the weeks read: a service that has been quiet through them is not new.
   */
  private static async getFirstHeardFrom(data: {
    plan: CountBaselinePlan;
    weeks: Array<CountBaselineWeekCounts>;
    tableName: string;
    scopeClause: string;
    query: (sql: string) => Promise<Array<JSONObject>>;
  }): Promise<number | null> {
    if (data.weeks[data.weeks.length - 1]?.hasRows) {
      return 0;
    }

    const rows: Array<JSONObject> = await data.query(`
      SELECT
        count() AS c,
        toString(min(toDate(day))) AS firstDay
      FROM ${data.tableName}
      WHERE ${data.scopeClause}
        AND day <= toDate('${data.plan.lastDay}')
    `);

    const row: JSONObject | undefined = rows[0];

    if (!row || CountWindowBaseline.toNumber(row["c"]) === 0) {
      return null;
    }

    return Date.parse(`${String(row["firstDay"])}T00:00:00Z`);
  }

  private static getWindowsSql(data: {
    plan: CountBaselinePlan;
    tableName: string;
    countExpression: string;
    scopeClause: string;
  }): string {
    /*
     * A rollup row's minute since the epoch, so a window is the same one here
     * as in the plan. toDate: `day` is stored as a DateTime.
     */
    return `
      SELECT
        intDiv(
          toUInt32(toDate(day)) * 1440 + (hourOfWeek % 24) * 60 + minuteOfHour,
          ${data.plan.windowMinutes}
        ) AS windowIndex,
        ${data.countExpression} AS c
      FROM ${data.tableName}
      WHERE ${data.scopeClause}
        AND hourOfWeek IN (${data.plan.hoursOfWeek.join(", ")})
        AND day >= toDate('${data.plan.firstDay}')
        AND day <= toDate('${data.plan.lastDay}')
      GROUP BY windowIndex
    `;
  }

  /*
   * Statistics of whole-minute samples, as a per-minute rate of the window.
   * A window that is not a whole number of minutes is a fraction of its
   * sample. What a count varies by chance grows with the time it is counted
   * over, the rest of what it varies by with the square of it, so a short
   * window of a steady scope is as noisy as chance makes it, and a short
   * window of a scope whose rate moves for other reasons moves as much.
   */
  private static toRate(data: {
    stats: CountBaselineStats;
    windowSeconds: number;
    windowMinutes: number;
  }): CountBaselineStats {
    const { stats } = data;
    const fraction: number = data.windowSeconds / (data.windowMinutes * 60);
    const perMinute: number = 60 / data.windowSeconds;

    const scaleSpread: (spread: number, center: number) => number = (
      spread: number,
      center: number,
    ): number => {
      const chance: number = Math.min(spread * spread, center);
      const rest: number = spread * spread - chance;

      return Math.sqrt(fraction * chance + fraction * fraction * rest);
    };

    const inWindow: CountBaselineStats = CountAnomaly.withCountingNoise({
      sampleCount: stats.sampleCount,
      mean: stats.mean * fraction,
      stddev: scaleSpread(stats.stddev, stats.mean),
      median: stats.median * fraction,
      madSigma: scaleSpread(stats.madSigma, stats.median),
      minObserved: stats.minObserved * fraction,
      maxObserved: stats.maxObserved * fraction,
    });

    return {
      sampleCount: inWindow.sampleCount,
      mean: inWindow.mean * perMinute,
      stddev:
        Math.max(inWindow.stddev, COUNT_BASELINE_LEVEL_SPREAD * inWindow.mean) *
        perMinute,
      median: inWindow.median * perMinute,
      madSigma:
        Math.max(
          inWindow.madSigma,
          COUNT_BASELINE_LEVEL_SPREAD * inWindow.median,
        ) * perMinute,
      minObserved: inWindow.minObserved * perMinute,
      maxObserved: inWindow.maxObserved * perMinute,
    };
  }

  private static getEmptyWindows(counts: Array<number>): number {
    return counts.filter((count: number): boolean => {
      return count === 0;
    }).length;
  }

  private static getNonEmptyWindows(
    weeks: Array<Array<number>>,
  ): Array<number> {
    return weeks.flat().filter((count: number): boolean => {
      return count > 0;
    });
  }

  // The calendar day of an instant, as the text ingest wrote it.
  private static toDayText(time: number): string {
    return OneUptimeDate.toClickhouseDateTime(new Date(time)).substring(0, 10);
  }

  private static toNumber(value: unknown): number {
    const number: number = Number(value);

    return Number.isFinite(number) ? number : 0;
  }
}
