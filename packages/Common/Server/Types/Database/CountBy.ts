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
  /*
   * Count no further than this many records, plus one: an answer above
   * upTo means more than upTo match, anything else is exact (CappedCount).
   * A list asks so its count costs at most that many records, however many
   * match (BaseAPI.getList's countUpTo). Unset, every matching record is
   * counted.
   */
  upTo?: number | undefined;
}
