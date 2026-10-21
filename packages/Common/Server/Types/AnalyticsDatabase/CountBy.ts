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
  /*
   * The count is a total a person reads beside the list it describes (the
   * telemetry explorers' "712,345 spans"), so it must be the number of rows
   * findBy returns for the same query — or fail.
   *
   * By default a count is allowed to be approximate, which suits the callers
   * that only compare it with a threshold: SpanService answers eligible
   * counts from an aggregate projection that rounds the window to whole
   * minutes, and a count that runs out of time returns whatever it had
   * counted so far (timeout_overflow_mode 'break'), or 0 when the response
   * is cut short. Exact skips the projection and fails instead of returning
   * a partial count.
   */
  exact?: boolean | undefined;
}
