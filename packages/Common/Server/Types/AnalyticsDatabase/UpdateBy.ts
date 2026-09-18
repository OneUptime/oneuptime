import Query from "./Query";
import BaseModel from "../../../Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";

export default interface UpdateBy<TBaseModel extends BaseModel> {
  query: Query<TBaseModel>;
  data: TBaseModel;
  props: DatabaseCommonInteractionProps;
}
