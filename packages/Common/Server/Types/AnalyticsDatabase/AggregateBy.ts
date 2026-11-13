import AggregationInterval from "../../../Types/BaseDatabase/AggregationInterval";
import AggregationIntervalUtil from "../../../Types/BaseDatabase/AggregationIntervalUtil";
import CommonAggregateBy from "../../../Types/BaseDatabase/AggregateBy";
import AnalyticsBaseModel from "../../../Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import TableColumnType from "../../../Types/AnalyticsDatabase/TableColumnType";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../../Types/Exception/BadDataException";
import Timezone from "../../../Types/Timezone";
import TimezoneAlias from "../../../Types/TimezoneAlias";
import { SQL, Statement } from "../../Utils/AnalyticsDatabase/Statement";
import CaptureSpan from "../../Utils/Telemetry/CaptureSpan";

export default interface AggregateBy<TBaseModel extends AnalyticsBaseModel>
  extends CommonAggregateBy<TBaseModel> {
  props: DatabaseCommonInteractionProps;
}

// The calendar unit each calendar interval starts its buckets on, in SQL.
const CALENDAR_BUCKET_UNITS: Partial<Record<AggregationInterval, string>> = {
  [AggregationInterval.Day]: "DAY",
  [AggregationInterval.Week]: "WEEK",
  [AggregationInterval.Month]: "MONTH",
  [AggregationInterval.Year]: "YEAR",
};

export const INVALID_TIMEZONE_MESSAGE: string =
  "timezone must be a time zone name from the list OneUptime supports, such as America/New_York.";

export class AggregateUtil {
  /*
   * Delegates to the isomorphic AggregationIntervalUtil so browser
   * code reconstructing the server's bucket grid (heartbeat
   * availability charts) always agrees with the interval the
   * statement generator compiles into `toStartOfInterval(...)`.
   *
   * `aggregationInterval`, when provided, pins the bucket size
   * independent of the window (including `Total` for a single
   * whole-window bucket per group).
   */
  @CaptureSpan()
  public static getAggregationInterval(data: {
    startDate: Date;
    endDate: Date;
    aggregationInterval?: AggregationInterval | undefined;
  }): AggregationInterval {
    return AggregationIntervalUtil.getAggregationIntervalForWindow(data);
  }

  /**
   * True when the resolved interval means "no time bucketing" — the
   * entire window collapses into one aggregate per group.
   */
  public static isTotalAggregation(interval: AggregationInterval): boolean {
    return interval === AggregationInterval.Total;
  }

  /**
   * The single source of truth for "which ClickHouse expression buckets
   * a timestamp at this interval". Every aggregate SQL builder (raw
   * table, minute MV, per-host MV, span projections) must go through
   * this instead of lowercasing the enum value into the statement:
   * the calendar units happen to double as SQL unit names
   * (`date_trunc('hour', ...)`), but the sub-hour tiers
   * (FiveMinutes/...) are not valid units and compile to
   * `toStartOfInterval(col, INTERVAL 5 MINUTE)` instead — which
   * ClickHouse counts in whole intervals since the epoch, so the
   * 5/15/30-minute grids are exact on the client's epoch-ms grid too.
   *
   * `timestampExpression` is a model-validated identifier or a builder-
   * owned expression, so raw interpolation here is consistent with the
   * surrounding builders. `Total` has no bucket expression (the window
   * collapses into `min(col)` — see buildBucketTimestampSelect).
   *
   * These are UTC's buckets: a day from UTC midnight. A builder that serves
   * a request (an AggregateBy, which can carry the reader's zone) uses
   * buildBucketTimestampStatement instead, which is this expression when
   * there is no zone; this one is left for server-side reads that compare
   * against UTC days (MetricBaselineService).
   */
  public static buildBucketTimestampExpression(
    resolvedInterval: AggregationInterval,
    timestampExpression: string,
  ): string {
    switch (resolvedInterval) {
      case AggregationInterval.FiveMinutes:
        return `toStartOfInterval(${timestampExpression}, INTERVAL 5 MINUTE)`;
      case AggregationInterval.FifteenMinutes:
        return `toStartOfInterval(${timestampExpression}, INTERVAL 15 MINUTE)`;
      case AggregationInterval.ThirtyMinutes:
        return `toStartOfInterval(${timestampExpression}, INTERVAL 30 MINUTE)`;
      default: {
        const interval: string = resolvedInterval.toLowerCase();
        return `date_trunc('${interval}', toStartOfInterval(${timestampExpression}, INTERVAL 1 ${interval}))`;
      }
    }
  }

  /**
   * The SELECT fragment that produces the bucket timestamp column,
   * already aliased to `timestampColumn`. Shared by every aggregate SQL
   * builder so the `Total` (whole-window) shape stays identical across
   * paths:
   *
   *   - normal interval → buildBucketTimestampExpression(...) `as col`
   *   - Total           → `min(col) as col` (one row per group; the
   *     earliest sample timestamp in the window is the bucket label)
   *
   * IMPORTANT: because the alias shadows the real column, ClickHouse
   * substitutes it into any same-level unqualified `WHERE col ...`
   * reference — for Total that injects an aggregate into WHERE
   * (ILLEGAL_AGGREGATION), and for bucketed intervals it silently
   * filters on the truncated bucket. Every builder that embeds this
   * fragment at the same level as its WHERE clause must table-qualify
   * the WHERE column references (see
   * StatementGenerator.toWhereStatement's tableAlias option).
   */
  public static buildBucketTimestampSelect(
    resolvedInterval: AggregationInterval,
    timestampColumn: string,
  ): string {
    if (AggregateUtil.isTotalAggregation(resolvedInterval)) {
      return `min(${timestampColumn}) as ${timestampColumn}`;
    }

    return `${AggregateUtil.buildBucketTimestampExpression(resolvedInterval, timestampColumn)} as ${timestampColumn}`;
  }

  /*
   * An aggregate's `timezone` as a zone name, or undefined when it names
   * none. Only a name in the Timezone list, spelled as the list spells it,
   * is a zone; anything else - a typo, a zone newer than the list, a value
   * that is not text, text written to be SQL - is refused with a 400 before
   * any statement is built, so it never reaches ClickHouse in any form
   * (issue #7277). null is no zone, as undefined is: the API's serializer
   * keeps a null it is given.
   */
  public static readTimezone(timezone: unknown): Timezone | undefined {
    if (timezone === undefined || timezone === null) {
      return undefined;
    }

    if (!TimezoneAlias.isListedName(timezone)) {
      throw new BadDataException(INVALID_TIMEZONE_MESSAGE);
    }

    return timezone;
  }

  /*
   * The zone the buckets of this interval start in, or null for UTC's epoch
   * grid. Only days, weeks, months and years follow a zone: an hour and
   * shorter are the same instants everywhere, and Total is no bucket. The
   * zone is given in its current name (TimezoneAlias), the one the browser
   * draws the chart in, and one ClickHouse knows: it no longer knows
   * US/Pacific-New, which the list keeps for old records.
   */
  public static getBucketTimezone(
    resolvedInterval: AggregationInterval,
    timezone: unknown,
  ): Timezone | null {
    const zone: Timezone | undefined = AggregateUtil.readTimezone(timezone);

    if (
      !zone ||
      !AggregationIntervalUtil.isCalendarInterval(resolvedInterval) ||
      !CALENDAR_BUCKET_UNITS[resolvedInterval]
    ) {
      return null;
    }

    return TimezoneAlias.getCanonicalTimezone(zone);
  }

  /*
   * The bucket expression for a request that may carry the reader's zone
   * (AggregateBy.timezone), as a statement: every aggregate SQL builder
   * that serves the dashboard goes through this. Without a zone, or for an
   * hour and shorter, it is buildBucketTimestampExpression as it always
   * was. With one, a day, week, month or year starts at that zone's
   * midnight, Monday, 1st or 1 January (issue #7277):
   *
   *   toTimeZone(toDateTime(toStartOfInterval(<ts>, INTERVAL 1 DAY, {p0:String}), {p1:String}), 'UTC')
   *
   * toStartOfInterval reads the timestamp's day in the zone; it answers a
   * Date for a week, a month or a year (and, on some versions, a day), so
   * toDateTime turns that day into the instant it starts at in the same
   * zone - a day whose clocks skip midnight starts when they resume - and
   * toTimeZone hands the instant back in UTC, as the result rows are read.
   * The zone is a bound parameter both times, never text in the query.
   */
  public static buildBucketTimestampStatement(
    resolvedInterval: AggregationInterval,
    timestampExpression: string,
    timezone?: Timezone | undefined,
  ): Statement {
    const zone: Timezone | null = AggregateUtil.getBucketTimezone(
      resolvedInterval,
      timezone,
    );
    const statement: Statement = new Statement();

    if (!zone) {
      return statement.append(
        AggregateUtil.buildBucketTimestampExpression(
          resolvedInterval,
          timestampExpression,
        ),
      );
    }

    const unit: string = CALENDAR_BUCKET_UNITS[resolvedInterval]!;

    statement.append(
      `toTimeZone(toDateTime(toStartOfInterval(${timestampExpression}, INTERVAL 1 ${unit}, `,
    );
    statement.append(SQL`${{ type: TableColumnType.Text, value: zone }}`);
    statement.append(`), `);
    statement.append(SQL`${{ type: TableColumnType.Text, value: zone }}`);
    statement.append(`), 'UTC')`);

    return statement;
  }

  /*
   * buildBucketTimestampSelect for a request that may carry the reader's
   * zone: `min(col) as col` for Total, and otherwise the zone-aware bucket
   * (buildBucketTimestampStatement) aliased to the timestamp column. The
   * alias rules of buildBucketTimestampSelect apply unchanged.
   */
  public static buildBucketTimestampSelectStatement(
    resolvedInterval: AggregationInterval,
    timestampColumn: string,
    timezone?: Timezone | undefined,
  ): Statement {
    // Refused for Total too: a request is valid or not whatever it buckets by.
    AggregateUtil.readTimezone(timezone);

    if (AggregateUtil.isTotalAggregation(resolvedInterval)) {
      return new Statement().append(
        AggregateUtil.buildBucketTimestampSelect(
          resolvedInterval,
          timestampColumn,
        ),
      );
    }

    return AggregateUtil.buildBucketTimestampStatement(
      resolvedInterval,
      timestampColumn,
      timezone,
    ).append(` as ${timestampColumn}`);
  }
}
