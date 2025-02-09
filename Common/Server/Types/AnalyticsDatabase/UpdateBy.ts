import Query from "./Query";
import BaseModel from "Common/Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import DatabaseCommonInteractionProps from "Common/Types/BaseDatabase/DatabaseCommonInteractionProps";

export default interface UpdateBy<TBaseModel extends BaseModel> {
  query: Query<TBaseModel>;
  data: TBaseModel;
  props: DatabaseCommonInteractionProps;
}
