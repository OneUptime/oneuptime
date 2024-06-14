import GroupBy from "./GroupBy";
import Query from "./Query";
import AnalyticsBaseModel from "Common/AnalyticsModels/BaseModel";
import DatabaseCommonInteractionProps from "Common/Types/BaseDatabase/DatabaseCommonInteractionProps";
import PositiveNumber from "Common/Types/PositiveNumber";

export default interface CountBy<TBaseModel extends AnalyticsBaseModel> {
  query: Query<TBaseModel>;
  skip?: PositiveNumber | number;
  limit?: PositiveNumber | number;
  groupBy?: GroupBy<TBaseModel> | undefined;
  props: DatabaseCommonInteractionProps;
}
