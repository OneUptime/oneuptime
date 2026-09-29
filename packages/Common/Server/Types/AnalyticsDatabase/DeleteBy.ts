import Query from "./Query";
import BaseModel from "../../../Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";

export default interface DeleteBy<TBaseModel extends BaseModel> {
  query: Query<TBaseModel>;
  props: DatabaseCommonInteractionProps;
}
