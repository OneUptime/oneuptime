import GroupBy from "./GroupBy";
import Query from "./Query";
import AnalyticsBaseModel from "../../../Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import PositiveNumber from "../../../Types/PositiveNumber";

export default interface CountBy<TBaseModel extends AnalyticsBaseModel> {
  query: Query<TBaseModel>;
  skip?: PositiveNumber | number;
  limit?: PositiveNumber | number;
  groupBy?: GroupBy<TBaseModel> | undefined;
  props: DatabaseCommonInteractionProps;
}
