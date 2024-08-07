import AnalyticsBaseModel from "Common/Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import DatabaseCommonInteractionProps from "Common/Types/BaseDatabase/DatabaseCommonInteractionProps";

export default interface UpdateBy<TBaseModel extends AnalyticsBaseModel> {
  data: TBaseModel;
  props: DatabaseCommonInteractionProps;
}
