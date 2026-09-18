import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import GroupBy from "./GroupBy";
import Query from "./Query";
import Select from "./Select";
import Sort from "./Sort";
import PositiveNumber from "../../../Types/PositiveNumber";

export default interface FindAllBy<TBaseModel extends BaseModel> {
  query: Query<TBaseModel>;
  select?: Select<TBaseModel> | undefined;
  sort?: Sort<TBaseModel> | undefined;
  groupBy?: GroupBy<TBaseModel> | undefined;
  props: DatabaseCommonInteractionProps;
  /**
   * Optional number of documents to skip before fetching results.
   * Acts the same way as `skip` in `findBy` but defaults to 0 when omitted.
   */
  skip?: PositiveNumber | number | undefined;
  /**
   * Optional total number of documents to return across all batches.
   * When omitted, the method keeps fetching until no more data is returned.
   */
  limit?: PositiveNumber | number | undefined;
}
