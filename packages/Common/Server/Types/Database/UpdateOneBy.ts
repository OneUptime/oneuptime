import Query from "./Query";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import PartialEntity from "../../../Types/Database/PartialEntity";
import { JSONObject } from "../../../Types/JSON";

export default interface UpdateOneBy<TBaseModel extends BaseModel> {
  query: Query<TBaseModel>;
  data: PartialEntity<TBaseModel>;
  /*
   * Request-scoped choices that are not columns, read by a service's update
   * hooks - the update-side twin of CreateBy.miscDataProps. For example,
   * whether an edit to a public note should notify status page subscribers.
   */
  miscDataProps?: JSONObject | undefined;
  props: DatabaseCommonInteractionProps;
}
