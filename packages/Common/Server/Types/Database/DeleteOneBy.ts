import Query from "./Query";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { JSONObject } from "../../../Types/JSON";
import User from "../../../Models/DatabaseModels/User";

export default interface DeleteOneBy<TBaseModel extends BaseModel> {
  query: Query<TBaseModel>;
  deletedByUser?: User | undefined;
  /*
   * Free-text reason the caller gave for the delete. Never persisted on the
   * row being deleted (it is about to be gone) - it rides through to the
   * delete hooks, which are the last place that can record it anywhere.
   */
  deletionReason?: string | undefined;
  /*
   * Request-scoped choices that are not columns, read by a service's delete
   * hooks - the delete-side twin of CreateBy.miscDataProps and
   * UpdateOneBy.miscDataProps. For example, what the workflows that run as a
   * custom role run as once it is deleted (CustomRoleService, #9767).
   */
  miscDataProps?: JSONObject | undefined;
  props: DatabaseCommonInteractionProps;
}
