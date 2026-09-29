import AnalyticsBaseModel from "../../../Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";

export default interface UpdateBy<TBaseModel extends AnalyticsBaseModel> {
  data: TBaseModel;
  props: DatabaseCommonInteractionProps;
}
