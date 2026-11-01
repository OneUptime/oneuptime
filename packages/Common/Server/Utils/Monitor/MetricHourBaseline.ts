/*
 * WHAT IS NORMAL FOR AN HOUR OF A METRIC.
 *
 * A metric's anomaly condition compares a data point with its hour of the week
 * on earlier days, folded from MetricBaselineHourly: every raw sample of that
 * metric name, across all its series unless a service is named. These are the
 * things that read has to get right. Each came from a test that failed without
 * it, on simulated traffic: no real traffic has been measured.
 *
 *   - Earlier days only. The hour being judged used to be part of its own
 *     baseline. Once a change is a share p of a cell's samples it can reach at
 *     most sqrt((1 - p) / p) standard deviations, whatever its size and however
 *     often the metric reports. On a 14-day baseline a change of any size
 *     stopped firing at the 14th minute of the hour and fired again at the top
 *     of the next, a cell with none of it in: a change that lasted a day opened
 *     24 alerts. A query that reads a small part of a cell was never blind,
 *     because the share is of the cell: one of ten series changing never gets
 *     there.
 *   - A level that moves (getLevelVariance). That blindness also kept monitors
 *     quiet, by absorbing each hour's ordinary move within minutes. Earlier
 *     days alone alerted three times as often on a daily rhythm, and fired on
 *     over half of all checks on anything that climbs, because a steady climb
 *     sits exactly three standard deviations from two earlier weeks.
 *   - Measured, not a share of the center. Rates can take a share of their
 *     center, but a metric's zero may mean nothing, and a steady gauge lost
 *     every change under 12% to it. So nothing here is tuned: the term is the
 *     part of a prediction's variance that the earlier weeks do not hold.
 *   - Two earlier weeks. One cannot show how far a week moves: on one, a disk
 *     fired on every check. Until then the hour is still learning. The hour's
 *     own samples still count towards minSamples, or a metric reporting every
 *     half hour, with four earlier samples, would learn for ever.
 *   - A history with no spread (leftFlatHistory). A metric that held one value
 *     has no spread to judge by, and its band used to come from the very
 *     samples that left it. It is left alone while they stay on that value,
 *     since a query's sum of a flat metric is not that value and is not a
 *     change, and judged by any data point off it once they have not.
 *
 * Days and hours are read as the rollup holds them: ingest writes UTC text that
 * the server stores as written, so `day` is a UTC day.
 */

const DAY_IN_MS: number = 24 * 60 * 60 * 1000;

const DAYS_IN_A_WEEK: number = 7;

// A median absolute deviation, as the standard deviation of a normal.
const MEDIAN_TO_SIGMA: number = 1.4826;

/*
 * A difference this small, as a share of the value, is the rounding of a mean
 * and not a move: the means of a constant metric are not quite equal.
 */
export const METRIC_ROUNDING_SHARE: number = 1e-9;

// How many earlier weeks of an hour a baseline asks for.
export const METRIC_BASELINE_MINIMUM_WEEKS: number = 2;

// One hour of one day of a metric, as MetricBaselineHourly folds it.
export interface MetricBaselineDayRow {
  // Its day as ClickHouse writes one: 2026-11-02.
  day: string;
  hourOfWeek: number;
  sampleCount: number;
  mean: number;
  minObserved: number;
  maxObserved: number;
}

export interface MetricHourReading {
  // The spread the band is built on, the level's move included.
  stddev: number;
  isReliable: boolean;
  // Every earlier sample held one value and the hour's own have left it.
  leftFlatHistory: boolean;
}

export default class MetricHourBaseline {
  // A time's day, as `day` holds it.
  public static toDayText(date: Date): string {
    return date.toISOString().slice(0, 10);
  }

  // The same hour of each day of the week: what a level's move is read from.
  public static getHoursOfDay(hourOfWeek: number): Array<number> {
    const hourOfDay: number = hourOfWeek % 24;

    return new Array<number>(DAYS_IN_A_WEEK)
      .fill(0)
      .map((_: number, day: number): number => {
        return day * 24 + hourOfDay;
      });
  }

  /*
   * What an hour's rows say about it. `rows` are the same hour on every day
   * from the start of the baseline window on (getHoursOfDay), the day judged
   * included, and `stddev` the spread of the earlier days' samples as measured.
   */
  public static read(data: {
    rows: Array<MetricBaselineDayRow>;
    hourOfWeek: number;
    judgedDay: string;
    stddev: number;
    windowDays: number;
    minSamples: number;
  }): MetricHourReading {
    const earlier: Array<MetricBaselineDayRow> = data.rows.filter(
      (row: MetricBaselineDayRow): boolean => {
        return row.day < data.judgedDay && row.sampleCount > 0;
      },
    );
    const earlierHours: Array<MetricBaselineDayRow> = earlier.filter(
      (row: MetricBaselineDayRow): boolean => {
        return row.hourOfWeek === data.hourOfWeek;
      },
    );
    const ownHours: Array<MetricBaselineDayRow> = data.rows.filter(
      (row: MetricBaselineDayRow): boolean => {
        return row.day >= data.judgedDay && row.hourOfWeek === data.hourOfWeek;
      },
    );

    const value: number | undefined = earlierHours[0]?.minObserved;
    const isFlat: boolean =
      earlierHours.length > 0 &&
      earlierHours.every((row: MetricBaselineDayRow): boolean => {
        return row.minObserved === value && row.maxObserved === value;
      });

    const levelVariance: number = MetricHourBaseline.getLevelVariance({
      days: earlier,
      hours: earlierHours,
    });

    // A flat history's measured spread is the rounding of its sum of squares.
    const measured: number = isFlat ? 0 : data.stddev;
    const stddev: number = Math.sqrt(measured * measured + levelVariance);

    const weeksNeeded: number = Math.max(
      1,
      Math.min(
        METRIC_BASELINE_MINIMUM_WEEKS,
        Math.floor(data.windowDays / DAYS_IN_A_WEEK),
      ),
    );

    return {
      stddev,
      isReliable:
        earlierHours.length >= weeksNeeded &&
        MetricHourBaseline.countSamples([...earlierHours, ...ownHours]) >=
          data.minSamples,
      leftFlatHistory:
        isFlat &&
        stddev === 0 &&
        ownHours.some((row: MetricBaselineDayRow): boolean => {
          return row.minObserved !== value || row.maxObserved !== value;
        }),
    };
  }

  /*
   * How much to add to the earlier hours' variance for how far this hour's
   * level can land from theirs, which they cannot see.
   *
   * With levels that move by tau from one week to the next, the next one lands
   * tau^2 (1 + 1 / W) away from the mean of W earlier ones, in variance. Their
   * own spread holds tau^2 (W - 1) / W of that on average, and it is already in
   * what was measured, so (2 / W) tau^2 is missing. That is one reading of it.
   * Two weeks' spread is a single move, though, and is small whenever they
   * happen to agree, so tau comes from the days around them (getLevelMove).
   *
   * The other reading is the weeks' own. A move of this hour's level that lasts
   * cancels in tau, as a climb does, and the spread of W means is the only
   * thing that sees one: the next lands (W + 1) / (W - 1) times as far from
   * their mean as they do. It keeps a steady climb, which sits three standard
   * deviations from two weeks, at sqrt(3) for every W. The larger of the two
   * is the one that shows how far this hour moves.
   */
  public static getLevelVariance(data: {
    days: Array<MetricBaselineDayRow>;
    hours: Array<MetricBaselineDayRow>;
  }): number {
    const weeks: number = data.hours.length;

    if (weeks === 0) {
      return 0;
    }

    const sampleCount: number = MetricHourBaseline.countSamples(data.hours);
    const mean: number =
      data.hours.reduce((sum: number, row: MetricBaselineDayRow): number => {
        return sum + row.sampleCount * row.mean;
      }, 0) / sampleCount;
    const spreadOfWeeks: number =
      data.hours.reduce((sum: number, row: MetricBaselineDayRow): number => {
        return sum + row.sampleCount * Math.pow(row.mean - mean, 2);
      }, 0) / sampleCount;

    const levelMove: number = MetricHourBaseline.getLevelMove(data.days);

    const variance: number = Math.max(
      (2 / weeks) * levelMove * levelMove,
      weeks > 1 ? (2 / (weeks - 1)) * spreadOfWeeks : 0,
    );

    return Math.sqrt(variance) > Math.abs(mean) * METRIC_ROUNDING_SHARE
      ? variance
      : 0;
  }

  /*
   * How far an hour's level moves from one week to the next, as a standard
   * deviation: from how much its step from one day to the next differs from the
   * same step a week before. That difference is of four levels, so it varies
   * twice as far as one does, and a weekly cycle and a climb cancel in it. A
   * change that lasts is in it only on the day it began. A plain move from one
   * week to the next would hold it for the whole week, and the band would catch
   * up with it on the second or third day: the same blindness, more slowly. The
   * median, so that an incident on one of the days is left out too.
   */
  public static getLevelMove(days: Array<MetricBaselineDayRow>): number {
    const means: Map<number, number> = new Map<number, number>();

    for (const row of days) {
      means.set(MetricHourBaseline.toDayNumber(row.day), row.mean);
    }

    const differences: Array<number> = [];

    for (const [day, mean] of means) {
      const yesterday: number | undefined = means.get(day - 1);
      const aWeekAgo: number | undefined = means.get(day - DAYS_IN_A_WEEK);
      const theDayBefore: number | undefined = means.get(
        day - DAYS_IN_A_WEEK - 1,
      );

      if (
        yesterday !== undefined &&
        aWeekAgo !== undefined &&
        theDayBefore !== undefined
      ) {
        differences.push(
          Math.abs(mean - yesterday - (aWeekAgo - theDayBefore)),
        );
      }
    }

    return (MetricHourBaseline.median(differences) * MEDIAN_TO_SIGMA) / 2;
  }

  private static countSamples(rows: Array<MetricBaselineDayRow>): number {
    return rows.reduce((sum: number, row: MetricBaselineDayRow): number => {
      return sum + row.sampleCount;
    }, 0);
  }

  private static toDayNumber(day: string): number {
    return Math.round(Date.parse(`${day}T00:00:00Z`) / DAY_IN_MS);
  }

  private static median(values: Array<number>): number {
    if (values.length === 0) {
      return 0;
    }

    const sorted: Array<number> = [...values].sort(
      (a: number, b: number): number => {
        return a - b;
      },
    );
    const middle: number = Math.floor(sorted.length / 2);

    return sorted.length % 2 === 1
      ? sorted[middle]!
      : (sorted[middle - 1]! + sorted[middle]!) / 2;
  }
}
