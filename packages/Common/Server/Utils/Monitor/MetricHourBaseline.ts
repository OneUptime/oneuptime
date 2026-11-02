/*
 * WHAT IS NORMAL FOR AN HOUR OF A METRIC.
 *
 * A metric's anomaly condition compares a data point with its hour of the week
 * on earlier days, folded from MetricBaselineHourly: every raw sample of that
 * metric name, across all its series unless the monitor names its services, or
 * from the data points of the query's own series when no rollup can say.
 * These are the things that read has to get right. Each came from a test that
 * failed without it, on simulated traffic, except where it says otherwise: no
 * real traffic has been measured.
 *
 *   - The rollup's hours (toStoredHour). Found on a real server, which no
 *     simulation here can be: the view numbers the week from
 *     toDayOfWeek(time, 1), which makes Monday 0 and not 1, so the hours it
 *     stores are a day behind the ones the code asks for. Asked for as they
 *     are, a check read the next weekday's rows, a Sunday read none and
 *     Monday's were never read.
 *   - The data point's own scale (getSource). A cell of raw samples can only
 *     judge what is on their scale. A Sum or a Count of a minute is not, and
 *     neither is anything of a histogram, whose cell holds each datapoint's
 *     sum: those fired on every check, or never. They are read from their own
 *     data points on the same earlier days, and judged by all that follows.
 *   - The query's own series. A rollup holds no attribute, so a filter on a host
 *     was judged against every host's samples: a fleet's cell is wide enough for
 *     any of its hosts, so it stayed quiet, and most of what happened to one of
 *     them stayed inside it. A query narrowed by an attribute reads its own
 *     data points, a series at a time. That is as far back as telemetry is
 *     kept, so a series that cannot hold two earlier weeks stays on the cell
 *     (keepsWeeksNeeded).
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
 *   - Measured, not a share of the center. A rate can take a share of its
 *     center (COUNT_BASELINE_LEVEL_SPREAD), but a metric's zero may mean
 *     nothing, and a steady gauge lost every change under 12% to it. So nothing
 *     here is tuned: the term is the part of a prediction's variance that the
 *     earlier weeks do not hold.
 *   - Two earlier weeks. One cannot show how far a week moves: on one, a disk
 *     fired on every check. Until then the hour is still learning. The hour's
 *     own samples still count towards minSamples, or a metric reporting every
 *     half hour, with four earlier samples, would learn for ever.
 *   - A history with no spread (leftFlatHistory). A metric that held one value
 *     has no spread to judge by, and its band used to come from the very
 *     samples that left it. It is left alone while they stay on that value,
 *     since a data point a query makes of them need not be that value and is
 *     not a change, and judged by any data point off it once they have not.
 *
 * Days and hours are read as the rollup holds them: ingest writes UTC text that
 * the server stores as written, so `day` is a UTC day.
 */

const DAY_IN_MS: number = 24 * 60 * 60 * 1000;

const DAYS_IN_A_WEEK: number = 7;

const HOURS_IN_A_DAY: number = 24;

const MINUTES_IN_AN_HOUR: number = 60;

// What toUInt8 wraps at, which is what the rollup stores an hour as.
const STORED_HOUR_VALUES: number = 256;

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

// The same, of a query's data points, which no rollup holds folded.
export interface MetricDataPointDayRow extends MetricBaselineDayRow {
  variance: number;
  median: number;
  p95: number;
  // How long the data points of that day are kept, as ClickHouse writes a time.
  keptUntil?: string | undefined;
}

// What an hour's earlier data points hold together, as a cell of samples does.
export interface MetricDataPointCell {
  sampleCount: number;
  mean: number;
  stddev: number;
  median: number;
  p95: number;
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

// Where a query's baseline can be read from.
export enum MetricBaselineSource {
  // The hourly rollup: the metric's raw samples.
  Samples = "Samples",
  // The minute rollup, which holds a plain metric's data points.
  MinuteRollup = "MinuteRollup",
  // The minute rollup of the one host, cluster, container or service filtered to.
  EntityRollup = "EntityRollup",
  // The metric's own rows, which alone hold attributes and observations.
  Rows = "Rows",
}

export default class MetricHourBaseline {
  // A time's day, as `day` holds it.
  public static toDayText(date: Date): string {
    return date.toISOString().slice(0, 10);
  }

  /*
   * An hour of the week, counted from Monday 00:00, as the rollup stores it.
   *
   * The view stores (toDayOfWeek(time, 1) - 1) * 24 + toHour(time), and mode 1
   * makes Monday 0 and not 1. So Tuesday 00:00 is stored as 0 and Sunday 23:00
   * as 143, and Monday's hours, below zero, are wrapped by toUInt8 to 232..255.
   * Every hour still has a stored number of its own, so nothing is lost and the
   * read translates. Changing the view instead would split the 90 days it has
   * already stored from the days after it, and it cannot rewrite them: the hour
   * is part of the table's sort key.
   */
  public static toStoredHour(hourOfWeek: number): number {
    return (
      (hourOfWeek - HOURS_IN_A_DAY + STORED_HOUR_VALUES) % STORED_HOUR_VALUES
    );
  }

  // The hour of the week the rollup's number stands for.
  public static fromStoredHour(storedHour: number): number {
    return (storedHour + HOURS_IN_A_DAY) % STORED_HOUR_VALUES;
  }

  /*
   * fromStoredHour in ClickHouse, of a column or expression holding a stored
   * number: for a read that works a row's hour out in SQL. LogCountBaseline
   * and SpanCountBaseline store their hours with the same expression, and
   * CountWindowBaseline reads them through both of these.
   */
  public static fromStoredHourSql(storedHour: string): string {
    return `((${storedHour} + ${HOURS_IN_A_DAY}) % ${STORED_HOUR_VALUES})`;
  }

  /*
   * Where a query's baseline comes from, or null when nothing can say.
   *
   * An average, a minimum, a maximum or a percentile of a plain metric is on
   * its samples' scale, and the hourly rollup reaches 90 days. A Sum or a Count
   * of a minute is not: it grows with how many samples a minute holds. Neither
   * is anything of a histogram, whose samples are each datapoint's sum. Their
   * data points are in the minute rollup, or for a histogram in its rows, since
   * only those hold how many observations each sum was of.
   *
   * Neither rollup knows any attribute but the service. A query narrowed by an
   * attribute reads its own rows instead, or the rollup of the one entity it is
   * filtered to, and is judged by its own history whatever it measures. A query
   * narrowed by something that cannot be read back (isNarrowedByAttributes with
   * no scope, such as a group by the whole attribute map) is left on the
   * samples' cell when it is on their scale, and is not judged when it is not:
   * against a neighbour's scale it could only fire on every check. Nor is a
   * percentile of a histogram, which only its buckets can say, or a data point
   * longer than the hour it would be compared with.
   */
  public static getSource(data: {
    isTotal: boolean;
    isPercentile: boolean;
    isDistribution: boolean;
    isNarrowedByAttributes: boolean;
    bucketInMinutes: number;
    // What narrows the query can be read back: the attributes it filters by.
    hasScope?: boolean | undefined;
    // It is filtered to one entity, whose rollup holds its data points.
    hasEntityRollup?: boolean | undefined;
  }): MetricBaselineSource | null {
    const isOnSamplesScale: boolean = !data.isTotal && !data.isDistribution;

    if (isOnSamplesScale && !data.isNarrowedByAttributes) {
      return MetricBaselineSource.Samples;
    }

    if (
      (data.isDistribution && data.isPercentile) ||
      data.bucketInMinutes > MINUTES_IN_AN_HOUR ||
      (data.isNarrowedByAttributes && !data.hasScope)
    ) {
      return isOnSamplesScale ? MetricBaselineSource.Samples : null;
    }

    if (!data.isNarrowedByAttributes) {
      return data.isDistribution
        ? MetricBaselineSource.Rows
        : MetricBaselineSource.MinuteRollup;
    }

    return data.hasEntityRollup && !data.isDistribution && !data.isPercentile
      ? MetricBaselineSource.EntityRollup
      : MetricBaselineSource.Rows;
  }

  /*
   * The earlier hours' data points taken together, as the states of a cell of
   * samples merge. Null when there are none. The rows hold a median and a 95th
   * percentile of their own day, so these two are only those days' weighted
   * mean. Nothing judges by them.
   */
  public static fold(data: {
    rows: Array<MetricDataPointDayRow>;
    hourOfWeek: number;
    judgedDay: string;
  }): MetricDataPointCell | null {
    const hours: Array<MetricDataPointDayRow> = data.rows.filter(
      (row: MetricDataPointDayRow): boolean => {
        return (
          row.day < data.judgedDay &&
          row.hourOfWeek === data.hourOfWeek &&
          row.sampleCount > 0
        );
      },
    );
    const sampleCount: number = MetricHourBaseline.countSamples(hours);

    if (sampleCount === 0) {
      return null;
    }

    const weighted: (
      value: (row: MetricDataPointDayRow) => number,
    ) => number = (value: (row: MetricDataPointDayRow) => number): number => {
      return (
        hours.reduce((sum: number, row: MetricDataPointDayRow): number => {
          return sum + row.sampleCount * value(row);
        }, 0) / sampleCount
      );
    };

    const mean: number = weighted((row: MetricDataPointDayRow): number => {
      return row.mean;
    });
    const variance: number = weighted((row: MetricDataPointDayRow): number => {
      return row.variance + Math.pow(row.mean - mean, 2);
    });

    return {
      sampleCount,
      mean,
      stddev: Math.sqrt(variance),
      median: weighted((row: MetricDataPointDayRow): number => {
        return row.median;
      }),
      p95: weighted((row: MetricDataPointDayRow): number => {
        return row.p95;
      }),
      minObserved: Math.min(
        ...hours.map((row: MetricDataPointDayRow): number => {
          return row.minObserved;
        }),
      ),
      maxObserved: Math.max(
        ...hours.map((row: MetricDataPointDayRow): number => {
          return row.maxObserved;
        }),
      ),
    };
  }

  /*
   * Whether a series' rows can hold the weeks a baseline asks for. A row says
   * how long it is kept, which is its service's telemetry retention, so a read
   * can tell a series that is only young from one whose history leaves before
   * it can be learned from. One with no such row says nothing and is not held
   * back.
   */
  public static keepsWeeksNeeded(data: {
    rows: Array<MetricDataPointDayRow>;
    windowDays: number;
  }): boolean {
    let keptFor: number = Infinity;
    let newest: string = "";

    for (const row of data.rows) {
      if (row.keptUntil && row.day > newest) {
        newest = row.day;
        keptFor =
          Date.parse(`${row.keptUntil.replace(" ", "T")}Z`) -
          MetricHourBaseline.toDayNumber(row.day) * DAY_IN_MS;
      }
    }

    return (
      keptFor >=
      MetricHourBaseline.getWeeksNeeded(data.windowDays) *
        DAYS_IN_A_WEEK *
        DAY_IN_MS
    );
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
   * When the hour of the day starts on each day from the start of the baseline
   * window to the day judged, as ClickHouse writes a time: 2026-11-02 09:00:00.
   */
  public static getHourStarts(data: {
    hourOfWeek: number;
    judgedDay: string;
    windowDays: number;
  }): Array<string> {
    const judgedDay: number = MetricHourBaseline.toDayNumber(data.judgedDay);
    const hour: string = String(data.hourOfWeek % HOURS_IN_A_DAY).padStart(
      2,
      "0",
    );

    return new Array<number>(data.windowDays + 1)
      .fill(0)
      .map((_: number, index: number): string => {
        const day: Date = new Date(
          (judgedDay - data.windowDays + index) * DAY_IN_MS,
        );

        return `${MetricHourBaseline.toDayText(day)} ${hour}:00:00`;
      });
  }

  /*
   * What an hour's rows say about it. `rows` are the same hour on every day
   * from the start of the baseline window on (getHoursOfDay), the day judged
   * included, and `stddev` the spread of the earlier days' samples as measured.
   *
   * With `isOfDataPoints` the rows are a query's own data points on the earlier
   * days alone, and what the day judged would add is in the check's hands: it
   * asks for an hour it holds a data point of, so that is one more towards
   * minSamples, and that data point is on the scale of a flat history's value,
   * so any that is off it has left it, with nothing more to read.
   */
  public static read(data: {
    rows: Array<MetricBaselineDayRow>;
    hourOfWeek: number;
    judgedDay: string;
    stddev: number;
    windowDays: number;
    minSamples: number;
    isOfDataPoints?: boolean | undefined;
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

    return {
      stddev,
      isReliable:
        earlierHours.length >=
          MetricHourBaseline.getWeeksNeeded(data.windowDays) &&
        MetricHourBaseline.countSamples([...earlierHours, ...ownHours]) +
          (data.isOfDataPoints ? 1 : 0) >=
          data.minSamples,
      leftFlatHistory:
        isFlat &&
        stddev === 0 &&
        (Boolean(data.isOfDataPoints) ||
          ownHours.some((row: MetricBaselineDayRow): boolean => {
            return row.minObserved !== value || row.maxObserved !== value;
          })),
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

  private static getWeeksNeeded(windowDays: number): number {
    return Math.max(
      1,
      Math.min(
        METRIC_BASELINE_MINIMUM_WEEKS,
        Math.floor(windowDays / DAYS_IN_A_WEEK),
      ),
    );
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
