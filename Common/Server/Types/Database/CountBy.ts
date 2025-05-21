import GroupBy from "./GroupBy";
import Query from "./Query";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import PositiveNumber from "../../../Types/PositiveNumber";

export default interface CountBy<TBaseModel extends BaseModel> {
  query: Query<TBaseModel>;
  skip?: PositiveNumber | number;
  groupBy?: GroupBy<TBaseModel> | undefined;
  limit?: PositiveNumber | number;
  props: DatabaseCommonInteractionProps;
  distinctOn?: string | undefined;
}
