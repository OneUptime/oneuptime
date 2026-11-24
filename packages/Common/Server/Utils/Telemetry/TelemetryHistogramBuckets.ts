import AggregationInterval from "../../../Types/BaseDatabase/AggregationInterval";
import TableColumnType from "../../../Types/AnalyticsDatabase/TableColumnType";
import Timezone from "../../../Types/Timezone";
import { AggregateUtil } from "../../Types/AnalyticsDatabase/AggregateBy";
import { SQL, Statement } from "../AnalyticsDatabase/Statement";

/*
 * THE BAR A TELEMETRY HISTOGRAM COUNTS A ROW INTO (issue #7923).
 *
 * The Logs, Traces and Exceptions explorers' histograms and the Logs and
 * Traces Analytics charts pick a bar width in minutes and bucket by that
 * many minutes counted from the epoch: `toStartOfInterval(ts, INTERVAL n
 * SECOND)`. A bar of a day (1440 minutes) so ran from one UTC midnight to the
 * next - 19:00 to 19:00 in New York, 09:00 to 09:00 in Tokyo - while a metric
 * chart over the same 60 days starts each day at the reader's midnight
 * (AggregateBy.timezone, issue #7277): the same days were cut at different
 * hours on the Metrics page and on the Logs page.
 *
 * A request may now name the reader's zone (`timezone`, a name the Timezone
 * list holds - TimezoneAlias.isListedName - as an aggregate's must be). A
 * bar of exactly a day in a request that names one starts at that zone's
 * midnight, with the day expression every aggregate builder cuts its days
 * with (AggregateUtil.buildBucketTimestampStatement): the zone a bound String
 * parameter, the bar's start handed back as the UTC instant the reader's day
 * starts at, so a day the clocks change on is one bar of 23 or 25 hours.
 * Every other width - and a day bar in a request that names no zone - is the
 * epoch's, word for word what it was.
 */
export const DAY_BAR_MINUTES: number = 24 * 60;

export default class TelemetryHistogramBuckets {
  /**
   * The zone a histogram request asks its day bars to be cut in, read as an
   * aggregate's is (AggregateUtil.readTimezone): undefined for none, and a
   * 400 for anything the Timezone list does not hold - a typo, a zone newer
   * than the list, text written to be SQL - before any statement is built.
   */
  public static readTimezone(value: unknown): Timezone | undefined {
    return AggregateUtil.readTimezone(value);
  }

  /**
   * The zone bars `bucketSizeInMinutes` wide are cut in: the reader's, in
   * its current name, for a bar of exactly a day in a request that names
   * one; null - the epoch's grid - for every other bar.
   */
  public static getDayBarTimezone(data: {
    bucketSizeInMinutes: number;
    timezone?: Timezone | undefined;
  }): Timezone | null {
    if (data.bucketSizeInMinutes !== DAY_BAR_MINUTES) {
      return null;
    }

    return AggregateUtil.getBucketTimezone(
      AggregationInterval.Day,
      data.timezone,
    );
  }

  /**
   * The start of the bar `timestampExpression` (a column or a builder-owned
   * expression, written into the query as it is) falls in, as a statement:
   *
   *   toStartOfInterval(<ts>, INTERVAL {n:Int32} SECOND)
   *
   * for every bar but a day in a request that names a zone, and for that one
   *
   *   toTimeZone(toDateTime(toStartOfInterval(<ts>, INTERVAL 1 DAY, {zone:String}), {zone:String}), 'UTC')
   */
  public static buildBucketStatement(data: {
    timestampExpression: string;
    bucketSizeInMinutes: number;
    timezone?: Timezone | undefined;
  }): Statement {
    const zone: Timezone | null = TelemetryHistogramBuckets.getDayBarTimezone({
      bucketSizeInMinutes: data.bucketSizeInMinutes,
      timezone: data.timezone,
    });

    if (zone) {
      return AggregateUtil.buildBucketTimestampStatement(
        AggregationInterval.Day,
        data.timestampExpression,
        zone,
      );
    }

    return new Statement()
      .append(`toStartOfInterval(${data.timestampExpression}, INTERVAL `)
      .append(
        SQL`${{
          type: TableColumnType.Number,
          value: data.bucketSizeInMinutes * 60,
        }}`,
      )
      .append(" SECOND)");
  }
}
