import AnalyticsBaseModel from "../../../Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";

export default interface CreateBy<TBaseModel extends AnalyticsBaseModel> {
  data: TBaseModel;
  props: DatabaseCommonInteractionProps;
}
