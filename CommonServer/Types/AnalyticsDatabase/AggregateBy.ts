import AggregationInterval from "Common/Types/BaseDatabase/AggregationInterval";
import CommonAggregateBy from "Common/Types/BaseDatabase/AggregateBy";
import AnalyticsBaseModel from "Common/AnalyticsModels/BaseModel";
import DatabaseCommonInteractionProps from "Common/Types/BaseDatabase/DatabaseCommonInteractionProps";

export default interface AggregateBy<TBaseModel extends AnalyticsBaseModel>
  extends CommonAggregateBy<TBaseModel> {
  props: DatabaseCommonInteractionProps;
}

export class AggregateUtil {
  public static getAggregationInterval(data: {
    startDate: Date;
    endDate: Date;
  }): AggregationInterval {
    const diff: number = data.endDate.getTime() - data.startDate.getTime();

    if (diff <= 1000 * 60) {
      return AggregationInterval.Minute;
    } else if (diff <= 1000 * 60 * 60 * 24) {
      return AggregationInterval.Hour;
    } else if (diff <= 1000 * 60 * 60 * 24 * 7) {
      return AggregationInterval.Day;
    } else if (diff <= 1000 * 60 * 60 * 24 * 30) {
      return AggregationInterval.Week;
    } else if (diff <= 1000 * 60 * 60 * 24 * 365) {
      return AggregationInterval.Month;
    }
    return AggregationInterval.Year;
  }
}
