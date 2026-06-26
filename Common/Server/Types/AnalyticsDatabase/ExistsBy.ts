import Query from "./Query";
import AnalyticsBaseModel from "../../../Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";

export default interface ExistsBy<TBaseModel extends AnalyticsBaseModel> {
  query: Query<TBaseModel>;
  props: DatabaseCommonInteractionProps;
}
