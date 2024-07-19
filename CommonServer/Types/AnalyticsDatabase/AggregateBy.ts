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

    if (diff <= 1000 * 60 * 60 * 3) {
      // if less than 3 hours, then get minute precision
      return AggregationInterval.Minute;
    } else if (diff <= 1000 * 60 * 60 * 24 * 3) {
      // 3 days
      return AggregationInterval.Hour;
    } else if (diff <= 1000 * 60 * 60 * 24 * 7 * 3) {
      // 3 weeks
      return AggregationInterval.Day;
    } else if (diff <= 1000 * 60 * 60 * 24 * 30 * 3) {
      // 3 months
      return AggregationInterval.Week;
    } else if (diff <= 1000 * 60 * 60 * 24 * 365 * 3) {
      // 3 years
      return AggregationInterval.Month;
    }
    return AggregationInterval.Year;
  }
}
