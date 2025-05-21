import AnalyticsBaseModel from "../../../Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";

export default interface CreateBy<TBaseModel extends AnalyticsBaseModel> {
  items: Array<TBaseModel>;
  props: DatabaseCommonInteractionProps;
}
