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
   */
  @CaptureSpan()
  public static getAggregationInterval(data: {
    startDate: Date;
    endDate: Date;
  }): AggregationInterval {
    return AggregationIntervalUtil.getAggregationIntervalForWindow(data);
  }
}
