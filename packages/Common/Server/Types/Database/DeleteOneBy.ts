import Query from "./Query";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
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
  props: DatabaseCommonInteractionProps;
}
