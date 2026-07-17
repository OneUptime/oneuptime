import AggregationInterval from "../../../Types/BaseDatabase/AggregationInterval";
import AggregationIntervalUtil from "../../../Types/BaseDatabase/AggregationIntervalUtil";
import CommonAggregateBy from "../../../Types/BaseDatabase/AggregateBy";
import AnalyticsBaseModel from "../../../Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import CaptureSpan from "../../Utils/Telemetry/CaptureSpan";

export default interface AggregateBy<TBaseModel extends AnalyticsBaseModel>
  extends CommonAggregateBy<TBaseModel> {
  props: DatabaseCommonInteractionProps;
}

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
}
