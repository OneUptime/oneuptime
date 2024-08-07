import AnalyticsBaseModel from "Common/Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import DatabaseCommonInteractionProps from "Common/Types/BaseDatabase/DatabaseCommonInteractionProps";

export default interface CreateBy<TBaseModel extends AnalyticsBaseModel> {
  items: Array<TBaseModel>;
  props: DatabaseCommonInteractionProps;
}
