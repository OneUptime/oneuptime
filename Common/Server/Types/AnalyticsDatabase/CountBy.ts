import GroupBy from "./GroupBy";
import Query from "./Query";
import AnalyticsBaseModel from "../../../Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import PositiveNumber from "../../../Types/PositiveNumber";

export default interface CountBy<TBaseModel extends AnalyticsBaseModel> {
  query: Query<TBaseModel>;
  skip?: PositiveNumber | number;
  limit?: PositiveNumber | number;
  groupBy?: GroupBy<TBaseModel> | undefined;
  props: DatabaseCommonInteractionProps;
  /**
   * Server-side wall-clock cap (max_execution_time, in seconds) for this
   * specific count. Defaults to 45s when unset (see toCountStatement).
   * Background / cron callers (e.g. telemetry-monitor evaluation) pass a
   * tighter value so a runaway count self-limits and frees its ClickHouse
   * socket quickly instead of holding it for the full 45s.
   */
  maxExecutionTimeInSeconds?: number | undefined;
}
