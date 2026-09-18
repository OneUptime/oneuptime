import GroupBy from "./GroupBy";
import Query from "./Query";
import Select from "./Select";
import Sort from "./Sort";
import BaseModel from "../../../Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";

export default interface FindOneBy<TBaseModel extends BaseModel> {
  query: Query<TBaseModel>;
  select?: Select<TBaseModel> | undefined;
  sort?: Sort<TBaseModel> | undefined;
  groupBy?: GroupBy<TBaseModel> | undefined;
  props: DatabaseCommonInteractionProps;
}
