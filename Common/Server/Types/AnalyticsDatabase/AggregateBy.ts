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
   * The SELECT fragment that produces the bucket timestamp column,
   * already aliased to `timestampColumn`. Shared by every aggregate SQL
   * builder so the `Total` (whole-window) shape stays identical across
   * paths:
   *
   *   - normal interval → `date_trunc('<i>', toStartOfInterval(col, INTERVAL 1 <i>)) as col`
   *   - Total           → `min(col) as col` (one row per group; the
   *     earliest sample timestamp in the window is the bucket label)
   *
   * `timestampColumn` is a model-validated identifier (see
   * AnalyticsDatabaseService._aggregateBy), so raw interpolation here is
   * consistent with the surrounding builders.
   */
  public static buildBucketTimestampSelect(
    resolvedInterval: AggregationInterval,
    timestampColumn: string,
  ): string {
    if (AggregateUtil.isTotalAggregation(resolvedInterval)) {
      return `min(${timestampColumn}) as ${timestampColumn}`;
    }

    const interval: string = resolvedInterval.toLowerCase();
    return `date_trunc('${interval}', toStartOfInterval(${timestampColumn}, INTERVAL 1 ${interval})) as ${timestampColumn}`;
  }
}
